"""Behavioral Qdrant activation, visibility and attempt-isolation tests."""

import os
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from qdrant_client import QdrantClient, models

from services.doc_manager import (
    delete_document_background,
    hide_document_background,
    unhide_document_background,
)
from services.ingestion import (
    _activate_attempt_points,
    _cleanup_attempt_points,
    _make_attempt_key,
)
from services.rag_engine import _active_retrieval_filter
from services.attempt_recovery import (
    AttemptRecoveryError,
    inspect_ready_attempt,
    recover_ready_attempt,
)


@pytest.fixture
def qdrant_store():
    url = os.environ.get("QDRANT_TEST_URL", "").strip()
    client = (
        QdrantClient(url=url, check_compatibility=False)
        if url
        else QdrantClient(location=":memory:")
    )
    collection = f"edurag_test_lifecycle_{uuid.uuid4().hex}"
    client.create_collection(
        collection_name=collection,
        vectors_config=models.VectorParams(size=2, distance=models.Distance.COSINE),
    )
    try:
        yield client, collection
    finally:
        try:
            client.delete_collection(collection_name=collection)
        finally:
            client.close()


def upsert(client, collection, point_id, doc_id, payload, vector=None):
    client.upsert(
        collection_name=collection,
        wait=True,
        points=[
            models.PointStruct(
                id=point_id,
                vector=vector or [1.0, 0.0],
                payload={"doc_id": doc_id, **payload},
            )
        ],
    )


def matching_ids(client, collection):
    records, _ = client.scroll(
        collection_name=collection,
        scroll_filter=_active_retrieval_filter(),
        limit=100,
        with_payload=True,
    )
    return {record.id for record in records}


def test_retrieval_excludes_legacy_inactive_and_hidden_points(qdrant_store):
    client, collection = qdrant_store
    upsert(client, collection, 1, "legacy", {"is_hidden": False})
    upsert(client, collection, 2, "unacked", {"is_active": False, "is_hidden": False})
    upsert(client, collection, 3, "ready", {"is_active": True, "is_hidden": False})
    upsert(client, collection, 4, "hidden", {"is_active": True, "is_hidden": True})
    assert matching_ids(client, collection) == {3}


@pytest.mark.asyncio
async def test_activation_is_bounded_to_exact_attempt(qdrant_store):
    client, collection = qdrant_store
    first_key = _make_attempt_key("doc", "job", 1)
    second_key = _make_attempt_key("doc", "job", 2)
    upsert(
        client,
        collection,
        10,
        "doc",
        {"is_active": False, "is_hidden": False, "ingest_attempt_key": first_key},
    )
    upsert(
        client,
        collection,
        11,
        "doc",
        {"is_active": False, "is_hidden": False, "ingest_attempt_key": second_key},
    )

    with (
        patch(
            "services.ingestion.get_settings",
            return_value=SimpleNamespace(QDRANT_COLLECTION_NAME=collection),
        ),
        patch(
            "services.ingestion.get_qdrant_client",
            new=AsyncMock(return_value=client),
        ),
    ):
        count = await _activate_attempt_points("doc", "job", 2)

    points = {point.id: point for point in client.retrieve(collection, [10, 11], with_payload=True)}
    assert count == 1
    assert points[10].payload["is_active"] is False
    assert points[11].payload["is_active"] is True


@pytest.mark.asyncio
async def test_cleanup_is_bounded_and_idempotent_for_exact_attempt(qdrant_store):
    client, collection = qdrant_store
    first_key = _make_attempt_key("doc", "job", 1)
    second_key = _make_attempt_key("doc", "job", 2)
    upsert(
        client,
        collection,
        12,
        "doc",
        {"is_active": False, "is_hidden": False, "ingest_attempt_key": first_key},
    )
    upsert(
        client,
        collection,
        13,
        "doc",
        {"is_active": True, "is_hidden": False, "ingest_attempt_key": second_key},
    )
    upsert(client, collection, 14, "other", {"is_active": True, "is_hidden": False})

    with (
        patch(
            "services.ingestion.get_settings",
            return_value=SimpleNamespace(QDRANT_COLLECTION_NAME=collection),
        ),
        patch(
            "services.ingestion.get_qdrant_client",
            new=AsyncMock(return_value=client),
        ),
    ):
        assert await _cleanup_attempt_points("doc", "job", 1) == 1
        assert await _cleanup_attempt_points("doc", "job", 1) == 0

    remaining, _ = client.scroll(collection_name=collection, limit=100)
    assert {record.id for record in remaining} == {13, 14}


@pytest.mark.asyncio
async def test_hide_unhide_preserves_activation_and_delete_is_document_scoped(qdrant_store):
    client, collection = qdrant_store
    upsert(client, collection, 20, "target", {"is_active": True, "is_hidden": False})
    upsert(client, collection, 21, "target", {"is_active": False, "is_hidden": False})
    upsert(client, collection, 22, "target", {"is_hidden": False})
    upsert(client, collection, 23, "other", {"is_active": True, "is_hidden": False})

    settings = SimpleNamespace(QDRANT_COLLECTION_NAME=collection)
    with (
        patch("services.doc_manager.get_settings", return_value=settings),
        patch("services.doc_manager.get_qdrant_client", new=AsyncMock(return_value=client)),
        patch("services.doc_manager.send_progress", new=AsyncMock()),
        patch("services.doc_manager.send_succeeded_visibility", new=AsyncMock()),
        patch("services.doc_manager.send_succeeded_delete", new=AsyncMock()),
        patch("services.doc_manager.send_failed", new=AsyncMock()),
    ):
        await hide_document_background("target", "visibility-job", 1, "http://node/callback")
        assert matching_ids(client, collection) == {23}
        await unhide_document_background("target", "visibility-job", 1, "http://node/callback")
        assert matching_ids(client, collection) == {20, 23}
        await delete_document_background("target", "delete-job", 1, "http://node/callback")

    remaining, _ = client.scroll(collection_name=collection, limit=100)
    assert {record.id for record in remaining} == {23}


def test_ready_consistency_and_manual_recovery_are_exact_attempt_and_idempotent(qdrant_store):
    client, collection = qdrant_store
    key = _make_attempt_key("recover-doc", "recover-job", 3)
    upsert(
        client,
        collection,
        30,
        "recover-doc",
        {"is_active": False, "is_hidden": False, "ingest_attempt_key": key},
    )

    before = inspect_ready_attempt(
        client, collection, "recover-doc", "recover-job", 3, "READY"
    )
    assert before.status == "READY_INACTIVE_EXACT_ATTEMPT"
    assert before.recoverable is True

    recovered = recover_ready_attempt(
        client, collection, "recover-doc", "recover-job", 3, "READY"
    )
    assert recovered.status == "CONSISTENT"
    assert recovered.active_exact_points == 1
    assert recover_ready_attempt(
        client, collection, "recover-doc", "recover-job", 3, "READY"
    ).status == "CONSISTENT"


def test_manual_recovery_detects_missing_and_refuses_conflicting_attempt(qdrant_store):
    client, collection = qdrant_store
    missing = inspect_ready_attempt(client, collection, "missing-doc", "job", 1, "READY")
    assert missing.status == "READY_MISSING_EXACT_ATTEMPT"

    current = _make_attempt_key("conflict-doc", "current-job", 2)
    other = _make_attempt_key("conflict-doc", "other-job", 1)
    upsert(
        client,
        collection,
        31,
        "conflict-doc",
        {"is_active": False, "is_hidden": False, "ingest_attempt_key": current},
    )
    upsert(
        client,
        collection,
        32,
        "conflict-doc",
        {"is_active": True, "is_hidden": False, "ingest_attempt_key": other},
    )
    conflict = inspect_ready_attempt(
        client, collection, "conflict-doc", "current-job", 2, "READY"
    )
    assert conflict.status == "ATTEMPT_CONFLICT"
    with pytest.raises(AttemptRecoveryError, match="ATTEMPT_CONFLICT"):
        recover_ready_attempt(
            client, collection, "conflict-doc", "current-job", 2, "READY"
        )
