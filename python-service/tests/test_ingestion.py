"""
tests/test_ingestion.py
-----------------------
Unit tests cho services/ingestion.py.

Kiểm tra:
- RAG-002: _make_chunk_id() là deterministic (cùng input → cùng output).
- RAG-002: Các attempt khác nhau → ID khác nhau.
- RAG-001: Upsert xảy ra với is_hidden=True trước callback.
- RAG-001: Activate (is_hidden=False) CHỈ xảy ra sau ACK thành công.
- RAG-001: Cleanup xảy ra khi ACK thất bại.
- RAG-002: cleanup_attempt_points xóa đúng points theo attempt_key.
- EMBEDDING_COUNT_MISMATCH guard vẫn hoạt động.
"""

import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

# Setup env trước khi import app modules
os.environ.setdefault("GOOGLE_API_KEY", "test-google-key")
os.environ.setdefault("LLAMA_CLOUD_API_KEY", "test-llama-key")
os.environ.setdefault("INTERNAL_SECRET", "test-internal-secret-0123456789abcdef")

# Mock external LlamaIndex modules
_llama_mock = MagicMock()
sys.modules.setdefault("llama_parse", MagicMock())
sys.modules.setdefault("llama_index", _llama_mock)
sys.modules.setdefault("llama_index.core", MagicMock())
sys.modules.setdefault("llama_index.core.node_parser", MagicMock())
sys.modules.setdefault("llama_index.core.schema", MagicMock())
sys.modules.setdefault("llama_index.llms", MagicMock())
sys.modules.setdefault("llama_index.llms.google_genai", MagicMock())
sys.modules.setdefault("llama_index.embeddings", MagicMock())
sys.modules.setdefault("llama_index.embeddings.google_genai", MagicMock())

from services.ingestion import (
    _make_chunk_id,
    _make_attempt_key,
    _ack_allows_activation,
    _ATTEMPT_FIELD,
)


def accepted_ack(job_id: str, attempt_count: int) -> dict:
    return {
        "jobId": job_id,
        "attemptCount": attempt_count,
        "outcome": "ACCEPTED",
        "canActivate": True,
        "status": "SUCCEEDED",
        "reason": None,
    }


# ──────────────────────────────────────────────────────────────────
# RAG-002: Deterministic chunk ID
# ──────────────────────────────────────────────────────────────────

class TestMakeChunkId:
    def test_same_inputs_produce_same_id(self):
        """Cùng (doc_id, job_id, attempt, index) → cùng UUID."""
        id1 = _make_chunk_id("doc1", "job1", 1, 0)
        id2 = _make_chunk_id("doc1", "job1", 1, 0)
        assert id1 == id2

    def test_different_chunk_index_produces_different_id(self):
        """Chunk index khác → ID khác."""
        id0 = _make_chunk_id("doc1", "job1", 1, 0)
        id1 = _make_chunk_id("doc1", "job1", 1, 1)
        assert id0 != id1

    def test_different_attempt_produces_different_id(self):
        """Attempt khác → ID khác (retry không overwrite attempt trước)."""
        id_a1 = _make_chunk_id("doc1", "job1", 1, 0)
        id_a2 = _make_chunk_id("doc1", "job1", 2, 0)
        assert id_a1 != id_a2

    def test_different_doc_produces_different_id(self):
        """Doc khác → ID khác."""
        id1 = _make_chunk_id("doc1", "job1", 1, 0)
        id2 = _make_chunk_id("doc2", "job1", 1, 0)
        assert id1 != id2

    def test_output_is_valid_uuid_string(self):
        """Output phải là UUID string hợp lệ."""
        import uuid
        chunk_id = _make_chunk_id("doc1", "job1", 1, 5)
        parsed = uuid.UUID(chunk_id)
        assert parsed.version == 5
        assert parsed.variant == uuid.RFC_4122

    def test_retry_same_attempt_produces_same_ids(self):
        """Retry cùng attempt → cùng IDs → Qdrant upsert overwrite, không duplicate."""
        ids_run1 = [_make_chunk_id("doc1", "job1", 1, i) for i in range(5)]
        ids_run2 = [_make_chunk_id("doc1", "job1", 1, i) for i in range(5)]
        assert ids_run1 == ids_run2

    def test_make_attempt_key_format(self):
        """attempt_key phải có format doc_id::job_id::attempt_count."""
        key = _make_attempt_key("doc123", "job456", 2)
        assert key == "doc123::job456::2"

    def test_activation_ack_is_fail_closed(self):
        assert _ack_allows_activation(accepted_ack("job1", 1), "job1", 1)
        for ack in [
            None,
            {},
            {**accepted_ack("job1", 1), "jobId": "other"},
            {**accepted_ack("job1", 1), "attemptCount": 2},
            {**accepted_ack("job1", 1), "canActivate": False},
            {**accepted_ack("job1", 1), "outcome": "REJECTED"},
            {**accepted_ack("job1", 1), "status": "RUNNING"},
        ]:
            assert not _ack_allows_activation(ack, "job1", 1)


# ──────────────────────────────────────────────────────────────────
# RAG-001: Activation protocol
# ──────────────────────────────────────────────────────────────────

@pytest.fixture
def mock_qdrant_client():
    """Mock QdrantClient trả về fake singleton."""
    client = MagicMock()
    client.count.return_value = SimpleNamespace(count=3)
    return client


@pytest.fixture
def mock_ingest_request():
    from models.schemas import IngestRequest
    return IngestRequest(
        doc_id="doc_test",
        job_id="job_test",
        attempt_count=1,
        subject_id="sub_test",
        file_path="/tmp/test.pdf",
        callback_url="http://node/internal/callback",
        teacher_metadata={},
    )


@pytest.mark.asyncio
async def test_ingest_upserts_with_is_hidden_true(mock_qdrant_client, mock_ingest_request):
    """
    RAG-001: Points phải được upsert với is_hidden=True trước callback.
    """
    upserted_payloads = []

    def capture_upsert(collection_name, points):
        for p in points:
            upserted_payloads.append(p.payload.get("is_hidden"))

    mock_qdrant_client.upsert.side_effect = capture_upsert
    mock_qdrant_client.set_payload = MagicMock()

    # Mock pages
    mock_pages = [{"page_number": 1, "text": "Nội dung tài liệu test.", "chapter": "", "section": ""}]

    # Mock nodes với nội dung đơn giản
    mock_node = MagicMock()
    mock_node.get_content.return_value = "Nội dung chunk test."
    mock_node.metadata = {"doc_id": "doc_test", "subject_id": "sub_test", "page_number": 1}

    mock_embedding = [0.1] * 768

    with (
        patch("services.ingestion.parse_document", new=AsyncMock(return_value=mock_pages)),
        patch("services.ingestion.SentenceSplitter") as mock_splitter_cls,
        patch("services.ingestion.get_embedding_model") as mock_embed_factory,
        patch("services.ingestion.get_qdrant_client", new=AsyncMock(return_value=mock_qdrant_client)),
        patch("services.ingestion.send_progress", new=AsyncMock(return_value=True)),
        patch(
            "services.ingestion.send_succeeded_ingest",
            new=AsyncMock(return_value=accepted_ack("job_test", 1)),
        ),
        patch("services.ingestion.send_failed", new=AsyncMock(return_value=True)),
        patch("services.ingestion._activate_attempt_points", new=AsyncMock(return_value=1)),
    ):
        mock_splitter = MagicMock()
        mock_splitter.get_nodes_from_documents.return_value = [mock_node]
        mock_splitter_cls.return_value = mock_splitter

        mock_embed = AsyncMock()
        mock_embed.aget_text_embedding_batch = AsyncMock(return_value=[mock_embedding])
        mock_embed_factory.return_value = mock_embed

        from services.ingestion import ingest_document_background
        await ingest_document_background(mock_ingest_request)

    # Tất cả points upsert phải có is_hidden=True
    assert len(upserted_payloads) > 0, "Phải có ít nhất 1 point được upsert"
    for is_hidden in upserted_payloads:
        assert is_hidden is True, f"is_hidden phải là True khi upsert, nhận: {is_hidden}"


@pytest.mark.asyncio
async def test_activate_called_after_ack_success(mock_qdrant_client, mock_ingest_request):
    """
    RAG-001: _activate_attempt_points() phải được gọi SAU KHI ACK thành công.
    """
    mock_pages = [{"page_number": 1, "text": "Nội dung.", "chapter": "", "section": ""}]
    mock_node = MagicMock()
    mock_node.get_content.return_value = "Chunk."
    mock_node.metadata = {"doc_id": "doc_test", "subject_id": "sub_test"}

    activate_mock = AsyncMock(return_value=1)

    with (
        patch("services.ingestion.parse_document", new=AsyncMock(return_value=mock_pages)),
        patch("services.ingestion.SentenceSplitter") as mock_splitter_cls,
        patch("services.ingestion.get_embedding_model") as mock_embed_factory,
        patch("services.ingestion.get_qdrant_client", new=AsyncMock(return_value=mock_qdrant_client)),
        patch("services.ingestion.send_progress", new=AsyncMock(return_value=True)),
        # ACK thành công
        patch(
            "services.ingestion.send_succeeded_ingest",
            new=AsyncMock(return_value=accepted_ack("job_test", 1)),
        ),
        patch("services.ingestion.send_failed", new=AsyncMock()),
        patch("services.ingestion._activate_attempt_points", activate_mock),
        patch("services.ingestion._cleanup_attempt_points", new=AsyncMock(return_value=0)),
    ):
        mock_splitter = MagicMock()
        mock_splitter.get_nodes_from_documents.return_value = [mock_node]
        mock_splitter_cls.return_value = mock_splitter

        mock_embed = AsyncMock()
        mock_embed.aget_text_embedding_batch = AsyncMock(return_value=[[0.1] * 768])
        mock_embed_factory.return_value = mock_embed

        from services.ingestion import ingest_document_background
        await ingest_document_background(mock_ingest_request)

    activate_mock.assert_called_once_with(
        mock_ingest_request.doc_id,
        mock_ingest_request.job_id,
        mock_ingest_request.attempt_count,
    )


@pytest.mark.asyncio
async def test_cleanup_called_when_ack_fails(mock_qdrant_client, mock_ingest_request):
    """
    RAG-001: _cleanup_attempt_points() phải được gọi khi ACK thất bại.
    Activate KHÔNG được gọi.
    """
    mock_pages = [{"page_number": 1, "text": "Nội dung.", "chapter": "", "section": ""}]
    mock_node = MagicMock()
    mock_node.get_content.return_value = "Chunk."
    mock_node.metadata = {"doc_id": "doc_test", "subject_id": "sub_test"}

    cleanup_mock = AsyncMock(return_value=1)
    activate_mock = AsyncMock(return_value=0)
    send_failed_mock = AsyncMock()

    with (
        patch("services.ingestion.parse_document", new=AsyncMock(return_value=mock_pages)),
        patch("services.ingestion.SentenceSplitter") as mock_splitter_cls,
        patch("services.ingestion.get_embedding_model") as mock_embed_factory,
        patch("services.ingestion.get_qdrant_client", new=AsyncMock(return_value=mock_qdrant_client)),
        patch("services.ingestion.send_progress", new=AsyncMock(return_value=True)),
        # ACK thất bại
        patch("services.ingestion.send_succeeded_ingest", new=AsyncMock(return_value=None)),
        patch("services.ingestion.send_failed", send_failed_mock),
        patch("services.ingestion._activate_attempt_points", activate_mock),
        patch("services.ingestion._cleanup_attempt_points", cleanup_mock),
    ):
        mock_splitter = MagicMock()
        mock_splitter.get_nodes_from_documents.return_value = [mock_node]
        mock_splitter_cls.return_value = mock_splitter

        mock_embed = AsyncMock()
        mock_embed.aget_text_embedding_batch = AsyncMock(return_value=[[0.1] * 768])
        mock_embed_factory.return_value = mock_embed

        from services.ingestion import ingest_document_background
        await ingest_document_background(mock_ingest_request)

    # Cleanup phải được gọi với attempt của lần này
    cleanup_mock.assert_called_with(
        mock_ingest_request.doc_id,
        mock_ingest_request.job_id,
        mock_ingest_request.attempt_count,
    )
    # Activate KHÔNG được gọi
    activate_mock.assert_not_called()
    send_failed_mock.assert_called_once()
    assert "ACTIVATION_ACK_UNAVAILABLE" in str(send_failed_mock.call_args)


@pytest.mark.asyncio
async def test_previous_attempt_cleaned_on_retry():
    """
    RAG-002: Khi attempt_count > 1, cleanup attempt_count-1 trước khi bắt đầu.
    """
    from models.schemas import IngestRequest
    retry_request = IngestRequest(
        doc_id="doc_retry",
        job_id="job_retry",
        attempt_count=2,  # Đây là lần retry
        subject_id="sub1",
        file_path="/tmp/test.txt",
        callback_url="http://node/cb",
    )

    cleanup_mock = AsyncMock(return_value=0)

    with (
        patch("services.ingestion.parse_document", new=AsyncMock(return_value=[])),
        patch("services.ingestion.send_failed", new=AsyncMock()),
        patch("services.ingestion._cleanup_attempt_points", cleanup_mock),
    ):
        from services.ingestion import ingest_document_background
        await ingest_document_background(retry_request)

    # Phải cleanup attempt trước (attempt_count - 1 = 1)
    cleanup_mock.assert_any_call("doc_retry", "job_retry", 1)


@pytest.mark.asyncio
async def test_embedding_count_mismatch_sends_failed():
    """
    Guard: Nếu len(embeddings) != len(nodes) → FAILED, không upsert.
    """
    from models.schemas import IngestRequest
    request = IngestRequest(
        doc_id="doc1", job_id="job1", attempt_count=1,
        subject_id="sub1", file_path="/tmp/test.pdf",
        callback_url="http://node/cb",
    )
    mock_pages = [{"page_number": 1, "text": "text", "chapter": "", "section": ""}]
    node1 = MagicMock()
    node1.get_content.return_value = "chunk1"
    node1.metadata = {}
    node2 = MagicMock()
    node2.get_content.return_value = "chunk2"
    node2.metadata = {}

    send_failed_mock = AsyncMock()
    mock_qdrant = MagicMock()

    with (
        patch("services.ingestion.parse_document", new=AsyncMock(return_value=mock_pages)),
        patch("services.ingestion.SentenceSplitter") as mock_splitter_cls,
        patch("services.ingestion.get_embedding_model") as mock_embed_factory,
        patch("services.ingestion.get_qdrant_client", new=AsyncMock(return_value=mock_qdrant)),
        patch("services.ingestion.send_progress", new=AsyncMock()),
        patch("services.ingestion.send_failed", send_failed_mock),
        patch("services.ingestion._cleanup_attempt_points", new=AsyncMock(return_value=0)),
    ):
        mock_splitter = MagicMock()
        # 2 nodes nhưng chỉ 1 embedding → mismatch
        mock_splitter.get_nodes_from_documents.return_value = [node1, node2]
        mock_splitter_cls.return_value = mock_splitter

        mock_embed = AsyncMock()
        mock_embed.aget_text_embedding_batch = AsyncMock(return_value=[[0.1] * 768])  # chỉ 1
        mock_embed_factory.return_value = mock_embed

        from services.ingestion import ingest_document_background
        await ingest_document_background(request)

    # send_failed phải được gọi với EMBEDDING_COUNT_MISMATCH
    send_failed_mock.assert_called_once()
    call_args = send_failed_mock.call_args
    assert "EMBEDDING_COUNT_MISMATCH" in str(call_args)
    # Qdrant KHÔNG được upsert
    mock_qdrant.upsert.assert_not_called()


@pytest.mark.asyncio
async def test_ingest_payload_contains_attempt_key():
    """
    RAG-002: Mỗi point phải có _ATTEMPT_FIELD trong payload để cleanup hoạt động.
    """
    from models.schemas import IngestRequest
    request = IngestRequest(
        doc_id="doc1", job_id="job1", attempt_count=1,
        subject_id="sub1", file_path="/tmp/test.txt",
        callback_url="http://node/cb",
    )
    mock_pages = [{"page_number": 1, "text": "text", "chapter": "", "section": ""}]
    mock_node = MagicMock()
    mock_node.get_content.return_value = "chunk"
    mock_node.metadata = {"doc_id": "doc1", "subject_id": "sub1", "page_number": 1}

    upserted_points = []

    def capture_upsert(collection_name, points):
        upserted_points.extend(points)

    mock_qdrant = MagicMock()
    mock_qdrant.upsert.side_effect = capture_upsert

    with (
        patch("services.ingestion.parse_document", new=AsyncMock(return_value=mock_pages)),
        patch("services.ingestion.SentenceSplitter") as mock_splitter_cls,
        patch("services.ingestion.get_embedding_model") as mock_embed_factory,
        patch("services.ingestion.get_qdrant_client", new=AsyncMock(return_value=mock_qdrant)),
        patch("services.ingestion.send_progress", new=AsyncMock()),
        patch(
            "services.ingestion.send_succeeded_ingest",
            new=AsyncMock(return_value=accepted_ack("job1", 1)),
        ),
        patch("services.ingestion.send_failed", new=AsyncMock()),
        patch("services.ingestion._activate_attempt_points", new=AsyncMock(return_value=1)),
        patch("services.ingestion._cleanup_attempt_points", new=AsyncMock(return_value=0)),
    ):
        mock_splitter = MagicMock()
        mock_splitter.get_nodes_from_documents.return_value = [mock_node]
        mock_splitter_cls.return_value = mock_splitter

        mock_embed = AsyncMock()
        mock_embed.aget_text_embedding_batch = AsyncMock(return_value=[[0.1] * 768])
        mock_embed_factory.return_value = mock_embed

        from services.ingestion import ingest_document_background
        await ingest_document_background(request)

    assert len(upserted_points) == 1
    point_payload = upserted_points[0].payload
    assert _ATTEMPT_FIELD in point_payload, f"Thiếu {_ATTEMPT_FIELD} trong payload"
    assert point_payload[_ATTEMPT_FIELD] == "doc1::job1::1"
