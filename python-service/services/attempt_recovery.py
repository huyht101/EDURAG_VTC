"""Exact-attempt Qdrant consistency check and bounded manual recovery helpers."""

from __future__ import annotations

from dataclasses import asdict, dataclass

# pyrefly: ignore [missing-import]
from qdrant_client import models

from core.config import get_settings
from core.database import get_qdrant_client
from services.ingestion import _ATTEMPT_FIELD, _make_attempt_key


class AttemptRecoveryError(RuntimeError):
    """Machine-readable refusal from the operational recovery boundary."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class AttemptConsistency:
    status: str
    document_id: str
    job_id: str
    attempt_count: int
    exact_points: int
    active_exact_points: int
    conflicting_points: int
    recoverable: bool

    def to_dict(self) -> dict:
        return asdict(self)


def _document_points(client, collection_name: str, document_id: str) -> list:
    points = []
    offset = None
    while True:
        batch, offset = client.scroll(
            collection_name=collection_name,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="doc_id",
                        match=models.MatchValue(value=document_id),
                    )
                ]
            ),
            limit=256,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        points.extend(batch)
        if offset is None:
            return points


def inspect_ready_attempt(
    client,
    collection_name: str,
    document_id: str,
    job_id: str,
    attempt_count: int,
    expected_node_status: str,
) -> AttemptConsistency:
    """Compare a Node-confirmed READY exact attempt with its Qdrant payload state."""
    if expected_node_status != "READY":
        raise AttemptRecoveryError(
            "RECOVERY_NODE_STATUS_NOT_READY",
            "Manual activation is only defined for a Node-confirmed READY document.",
        )
    if not document_id or not job_id or attempt_count < 1:
        raise AttemptRecoveryError(
            "RECOVERY_IDENTITY_INVALID",
            "document_id, job_id and a positive attempt_count are required.",
        )

    exact_key = _make_attempt_key(document_id, job_id, attempt_count)
    points = _document_points(client, collection_name, document_id)
    exact = [point for point in points if point.payload.get(_ATTEMPT_FIELD) == exact_key]
    conflicts = [point for point in points if point.payload.get(_ATTEMPT_FIELD) != exact_key]
    active = [point for point in exact if point.payload.get("is_active") is True]

    common = dict(
        document_id=document_id,
        job_id=job_id,
        attempt_count=attempt_count,
        exact_points=len(exact),
        active_exact_points=len(active),
        conflicting_points=len(conflicts),
    )
    if conflicts:
        return AttemptConsistency(
            status="ATTEMPT_CONFLICT",
            recoverable=False,
            **common,
        )
    if not exact:
        return AttemptConsistency(
            status="READY_MISSING_EXACT_ATTEMPT",
            recoverable=False,
            **common,
        )
    if len(active) == len(exact):
        return AttemptConsistency(status="CONSISTENT", recoverable=False, **common)
    if active:
        return AttemptConsistency(
            status="READY_PARTIALLY_ACTIVE_EXACT_ATTEMPT",
            recoverable=False,
            **common,
        )
    return AttemptConsistency(
        status="READY_INACTIVE_EXACT_ATTEMPT",
        recoverable=True,
        **common,
    )


def recover_ready_attempt(
    client,
    collection_name: str,
    document_id: str,
    job_id: str,
    attempt_count: int,
    expected_node_status: str,
) -> AttemptConsistency:
    """Idempotently activate only an unambiguous Node-confirmed exact attempt."""
    before = inspect_ready_attempt(
        client,
        collection_name,
        document_id,
        job_id,
        attempt_count,
        expected_node_status,
    )
    if before.status == "CONSISTENT":
        return before
    if not before.recoverable:
        raise AttemptRecoveryError(
            "RECOVERY_UNSAFE_ATTEMPT_STATE",
            f"Exact-attempt recovery refused for state {before.status}.",
        )

    exact_key = _make_attempt_key(document_id, job_id, attempt_count)
    client.set_payload(
        collection_name=collection_name,
        payload={"is_active": True},
        points=models.Filter(
            must=[
                models.FieldCondition(
                    key=_ATTEMPT_FIELD,
                    match=models.MatchValue(value=exact_key),
                )
            ]
        ),
        wait=True,
    )
    after = inspect_ready_attempt(
        client,
        collection_name,
        document_id,
        job_id,
        attempt_count,
        expected_node_status,
    )
    if after.status != "CONSISTENT":
        raise AttemptRecoveryError(
            "RECOVERY_POSTCONDITION_FAILED",
            "Exact-attempt points were not fully active after recovery.",
        )
    return after


async def runtime_client_and_collection():
    """Resolve the configured runtime target for the operational CLI."""
    settings = get_settings()
    return await get_qdrant_client(), settings.QDRANT_COLLECTION_NAME
