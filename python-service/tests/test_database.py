"""Qdrant collection initialization postcondition tests."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from qdrant_client import models
from qdrant_client.http.exceptions import UnexpectedResponse

from core.database import _ensure_collection_exists


COLLECTION = "education_docs"
DIMENSION = 768


def collection_info(*, size=DIMENSION, distance=models.Distance.COSINE, status="green"):
    return SimpleNamespace(
        status=status,
        config=SimpleNamespace(
            params=SimpleNamespace(vectors=SimpleNamespace(size=size, distance=distance))
        ),
    )


def qdrant_conflict():
    return UnexpectedResponse(
        status_code=409,
        reason_phrase="Conflict",
        content=b"collection already exists",
        headers=MagicMock(),
    )


def qdrant_read_error(status_code):
    return UnexpectedResponse(
        status_code=status_code,
        reason_phrase="Temporary failure",
        content=b"postcondition unavailable",
        headers=MagicMock(),
    )


@pytest.mark.asyncio
async def test_existing_compatible_collection_is_reused():
    client = MagicMock()
    client.get_collections.return_value.collections = [SimpleNamespace(name=COLLECTION)]
    client.get_collection.return_value = collection_info()

    await _ensure_collection_exists(client, COLLECTION, DIMENSION)

    client.create_collection.assert_not_called()
    client.get_collection.assert_called_once_with(collection_name=COLLECTION)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "info",
    [collection_info(size=1536), collection_info(distance=models.Distance.DOT), collection_info(status="red")],
)
async def test_existing_incompatible_or_unavailable_collection_fails(info):
    client = MagicMock()
    client.get_collections.return_value.collections = [SimpleNamespace(name=COLLECTION)]
    client.get_collection.return_value = info

    with pytest.raises(RuntimeError):
        await _ensure_collection_exists(client, COLLECTION, DIMENSION)


@pytest.mark.asyncio
async def test_first_creator_validates_postcondition_and_creates_indexes():
    client = MagicMock()
    client.get_collections.return_value.collections = []
    client.get_collection.return_value = collection_info()

    await _ensure_collection_exists(client, COLLECTION, DIMENSION)

    client.create_collection.assert_called_once()
    assert client.create_payload_index.call_count == 3


@pytest.mark.asyncio
async def test_concurrent_creator_409_reloads_compatible_collection():
    client = MagicMock()
    client.get_collections.return_value.collections = []
    client.create_collection.side_effect = qdrant_conflict()
    client.get_collection.return_value = collection_info()

    await _ensure_collection_exists(client, COLLECTION, DIMENSION)

    client.get_collection.assert_called_once_with(collection_name=COLLECTION)
    client.create_payload_index.assert_not_called()


@pytest.mark.asyncio
async def test_concurrent_creator_retries_transient_postcondition_read():
    client = MagicMock()
    client.get_collections.return_value.collections = []
    client.create_collection.side_effect = qdrant_conflict()
    client.get_collection.side_effect = [qdrant_read_error(500), collection_info()]

    with patch("core.database.asyncio.sleep", return_value=None) as sleep:
        await _ensure_collection_exists(client, COLLECTION, DIMENSION)

    sleep.assert_called_once()
    assert client.get_collection.call_count == 2


@pytest.mark.asyncio
async def test_concurrent_creator_fails_when_postcondition_never_appears():
    client = MagicMock()
    client.get_collections.return_value.collections = []
    client.create_collection.side_effect = qdrant_conflict()
    client.get_collection.side_effect = [qdrant_read_error(503), qdrant_read_error(503)]

    with patch("core.database.asyncio.sleep", return_value=None), pytest.raises(UnexpectedResponse):
        await _ensure_collection_exists(client, COLLECTION, DIMENSION, postcondition_attempts=2)


@pytest.mark.asyncio
@pytest.mark.parametrize("postcondition", [RuntimeError("missing"), collection_info(size=1536)])
async def test_conflict_without_compatible_postcondition_fails(postcondition):
    client = MagicMock()
    client.get_collections.return_value.collections = []
    client.create_collection.side_effect = qdrant_conflict()
    if isinstance(postcondition, Exception):
        client.get_collection.side_effect = postcondition
    else:
        client.get_collection.return_value = postcondition

    with pytest.raises(RuntimeError):
        await _ensure_collection_exists(client, COLLECTION, DIMENSION)


@pytest.mark.asyncio
async def test_unexpected_create_error_propagates():
    client = MagicMock()
    client.get_collections.return_value.collections = []
    client.create_collection.side_effect = RuntimeError("network failed")

    with pytest.raises(RuntimeError, match="network failed"):
        await _ensure_collection_exists(client, COLLECTION, DIMENSION)


@pytest.mark.asyncio
async def test_non_qdrant_409_is_not_swallowed():
    client = MagicMock()
    client.get_collections.return_value.collections = []
    error = RuntimeError("generic conflict")
    error.status_code = 409
    client.create_collection.side_effect = error

    with pytest.raises(RuntimeError, match="generic conflict"):
        await _ensure_collection_exists(client, COLLECTION, DIMENSION)


@pytest.mark.asyncio
async def test_repeated_startup_reuses_restored_collection_without_mutation():
    client = MagicMock()
    client.get_collections.return_value.collections = [SimpleNamespace(name=COLLECTION)]
    client.get_collection.return_value = collection_info()

    await _ensure_collection_exists(client, COLLECTION, DIMENSION)
    await _ensure_collection_exists(client, COLLECTION, DIMENSION)

    client.create_collection.assert_not_called()
    client.create_payload_index.assert_not_called()
    assert client.get_collection.call_count == 2
