"""
tests/test_rag_engine.py
------------------------
Unit tests cho services/rag_engine.py.

Kiểm tra:
- RAG-004: usage_calls[] có đủ entries cho tất cả LLM calls.
- Router call (QUERY_REWRITE) luôn có entry trong usage_calls[].
- Answer call (ANSWER_GENERATION) luôn có entry trong usage_calls[].
- no_answer=True khi không có citation hợp lệ (fail-closed).
- no_answer=True khi CHIT_CHAT.
- no_answer=True khi không có chunk vượt similarity threshold.
- Citation extraction đúng từ [1], [2] markers.
- Legacy usage field là aggregate của tất cả calls SUCCEEDED.
- _finalize_rag_answer: no citations → no_answer=True với answer dự phòng.
"""

import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Setup env
os.environ.setdefault("GOOGLE_API_KEY", "test-google-key")
os.environ.setdefault("LLAMA_CLOUD_API_KEY", "test-llama-key")
os.environ.setdefault("INTERNAL_SECRET", "test-internal-secret-0123456789abcdef")

# Mock LlamaIndex
sys.modules.setdefault("llama_parse", MagicMock())
sys.modules.setdefault("llama_index", MagicMock())
sys.modules.setdefault("llama_index.core", MagicMock())
sys.modules.setdefault("llama_index.core.node_parser", MagicMock())
sys.modules.setdefault("llama_index.core.schema", MagicMock())
sys.modules.setdefault("llama_index.llms", MagicMock())
sys.modules.setdefault("llama_index.llms.google_genai", MagicMock())
sys.modules.setdefault("llama_index.embeddings", MagicMock())
sys.modules.setdefault("llama_index.embeddings.google_genai", MagicMock())

from models.schemas import Citation, UsageInfo, UsageCall, QueryRequest
from services.rag_engine import (
    _extract_citations,
    _evaluate_confidence,
    _finalize_rag_answer,
    _aggregate_usage,
    _make_usage_call,
    _extract_usage_info,
    _format_history,
    _build_context,
)


# ──────────────────────────────────────────────────────────────────
# _extract_usage_info
# ──────────────────────────────────────────────────────────────────

class TestExtractUsageInfo:
    def test_extracts_gemini_token_counts(self):
        """Lấy đúng token counts từ Gemini response."""
        meta = SimpleNamespace(
            prompt_token_count=100,
            candidates_token_count=50,
            total_token_count=150,
        )
        raw = SimpleNamespace(usage_metadata=meta)
        response = SimpleNamespace(raw=raw)
        info = _extract_usage_info(response, "gemini-model")
        assert info.prompt_tokens == 100
        assert info.completion_tokens == 50
        assert info.total_tokens == 150
        assert info.model == "gemini-model"

    def test_fallback_to_zeros_when_no_metadata(self):
        """Fallback về 0 khi không có usage_metadata."""
        response = SimpleNamespace(raw=None)
        info = _extract_usage_info(response, "gemini-model")
        assert info.prompt_tokens == 0
        assert info.completion_tokens == 0
        assert info.total_tokens == 0

    def test_fallback_when_raw_missing(self):
        """Fallback về 0 khi response không có raw attr."""
        response = SimpleNamespace()
        info = _extract_usage_info(response, "model")
        assert info.total_tokens == 0


# ──────────────────────────────────────────────────────────────────
# _make_usage_call
# ──────────────────────────────────────────────────────────────────

class TestMakeUsageCall:
    def test_creates_usage_call_with_correct_fields(self):
        usage = UsageInfo(prompt_tokens=10, completion_tokens=20, total_tokens=30, model="m")
        uc = _make_usage_call(0, "QUERY_REWRITE", "m", usage)
        assert uc.call_index == 0
        assert uc.operation == "QUERY_REWRITE"
        assert uc.prompt_tokens == 10
        assert uc.completion_tokens == 20
        assert uc.total_tokens == 30
        assert uc.status == "SUCCEEDED"
        assert uc.error_message is None

    def test_creates_failed_usage_call(self):
        usage = UsageInfo(prompt_tokens=0, completion_tokens=0, total_tokens=0, model="m")
        uc = _make_usage_call(1, "ANSWER_GENERATION", "m", usage, status="FAILED", error_message="oops")
        assert uc.status == "FAILED"
        assert uc.error_message == "oops"


# ──────────────────────────────────────────────────────────────────
# _aggregate_usage
# ──────────────────────────────────────────────────────────────────

class TestAggregateUsage:
    def test_sums_only_succeeded_calls(self):
        """Chỉ cộng dồn token của SUCCEEDED calls."""
        usage_ok = UsageInfo(prompt_tokens=100, completion_tokens=50, total_tokens=150, model="m")
        usage_fail = UsageInfo(prompt_tokens=200, completion_tokens=100, total_tokens=300, model="m")
        uc1 = _make_usage_call(0, "QUERY_REWRITE", "m", usage_ok, status="SUCCEEDED")
        uc2 = _make_usage_call(1, "ANSWER_GENERATION", "m", usage_fail, status="FAILED")

        aggregate = _aggregate_usage([uc1, uc2], "m")
        assert aggregate.prompt_tokens == 100
        assert aggregate.completion_tokens == 50
        assert aggregate.total_tokens == 150

    def test_empty_calls_returns_zeros(self):
        aggregate = _aggregate_usage([], "m")
        assert aggregate.total_tokens == 0


# ──────────────────────────────────────────────────────────────────
# _extract_citations
# ──────────────────────────────────────────────────────────────────

class TestExtractCitations:
    def _make_result(self, point_id, doc_id, text, page=1):
        return SimpleNamespace(
            id=point_id,
            score=0.8,
            payload={
                "doc_id": doc_id,
                "text": text,
                "page_number": page,
                "chapter": None,
                "section": None,
            },
        )

    def test_extracts_single_citation(self):
        answer = "Theo tài liệu [1] thì..."
        results = [self._make_result("uuid-1", "1", "nội dung", 1)]
        citations = _extract_citations(answer, results)
        assert len(citations) == 1
        assert citations[0].vector_node_id == "uuid-1"
        assert citations[0].doc_id == "1"
        assert citations[0].page_number == 1

    def test_extracts_multiple_citations(self):
        answer = "Theo [1] và [2] thì..."
        results = [
            self._make_result("uuid-1", "1", "text1"),
            self._make_result("uuid-2", "2", "text2"),
        ]
        citations = _extract_citations(answer, results)
        assert len(citations) == 2

    def test_deduplicates_repeated_citation(self):
        """[1] xuất hiện nhiều lần → chỉ 1 citation."""
        answer = "Theo [1], thêm [1], cũng [1]."
        results = [self._make_result("uuid-1", "1", "text")]
        citations = _extract_citations(answer, results)
        assert len(citations) == 1

    def test_no_citation_marker_returns_empty(self):
        """Không có [N] → citations rỗng."""
        answer = "Câu trả lời không có trích dẫn."
        results = [self._make_result("uuid-1", "1", "text")]
        citations = _extract_citations(answer, results)
        assert len(citations) == 0

    def test_out_of_range_index_ignored(self):
        """[5] khi chỉ có 2 results → bị bỏ qua."""
        answer = "Theo [5] thì..."
        results = [
            self._make_result("uuid-1", "1", "text1"),
            self._make_result("uuid-2", "2", "text2"),
        ]
        citations = _extract_citations(answer, results)
        assert len(citations) == 0

    def test_citation_snippet_max_200_chars(self):
        """snippet được truncate tại 200 ký tự."""
        long_text = "A" * 500
        answer = "Theo [1]..."
        results = [self._make_result("uuid-1", "1", long_text)]
        citations = _extract_citations(answer, results)
        assert len(citations[0].snippet) <= 200

    def test_invalid_page_number_becomes_none(self):
        """page_number < 1 → None."""
        result = SimpleNamespace(
            id="uuid-1", score=0.9,
            payload={"doc_id": "1", "text": "text", "page_number": 0, "chapter": None, "section": None},
        )
        citations = _extract_citations("[1]", [result])
        assert citations[0].page_number is None


# ──────────────────────────────────────────────────────────────────
# _finalize_rag_answer
# ──────────────────────────────────────────────────────────────────

class TestFinalizeRagAnswer:
    def _empty_usage(self):
        return UsageInfo(prompt_tokens=0, completion_tokens=0, total_tokens=0, model="m")

    def test_no_citations_returns_no_answer(self):
        """Không có citation → no_answer=True, confidence=low."""
        response = _finalize_rag_answer("some text", [], "high", [], self._empty_usage())
        assert response.no_answer is True
        assert response.confidence == "low"
        assert response.citations == []

    def test_with_citations_returns_normal_answer(self):
        """Có citation → no_answer=False."""
        citation = Citation(
            vector_node_id="uuid-1", doc_id="1", snippet="text"
        )
        response = _finalize_rag_answer("answer [1]", [citation], "high", [], self._empty_usage())
        assert response.no_answer is False
        assert len(response.citations) == 1

    def test_usage_calls_propagated(self):
        """usage_calls[] phải được giữ trong response."""
        usage_info = UsageInfo(prompt_tokens=10, completion_tokens=5, total_tokens=15, model="m")
        uc = _make_usage_call(0, "QUERY_REWRITE", "m", usage_info)
        response = _finalize_rag_answer("text", [], "low", [uc], self._empty_usage())
        assert len(response.usage_calls) == 1
        assert response.usage_calls[0].call_index == 0


# ──────────────────────────────────────────────────────────────────
# _evaluate_confidence
# ──────────────────────────────────────────────────────────────────

class TestEvaluateConfidence:
    def _result_with_score(self, score):
        return SimpleNamespace(score=score)

    def test_high_confidence_above_0_7(self):
        results = [self._result_with_score(0.8), self._result_with_score(0.9)]
        assert _evaluate_confidence(results) == "high"

    def test_medium_confidence_between_0_5_and_0_7(self):
        results = [self._result_with_score(0.6)]
        assert _evaluate_confidence(results) == "medium"

    def test_low_confidence_below_0_5(self):
        results = [self._result_with_score(0.3)]
        assert _evaluate_confidence(results) == "low"

    def test_empty_results_returns_low(self):
        assert _evaluate_confidence([]) == "low"


# ──────────────────────────────────────────────────────────────────
# RAG-004: Multi-call usage via process_query
# ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_process_query_chit_chat_has_two_usage_calls():
    """
    CHIT_CHAT path phải có 2 usage_calls: [QUERY_REWRITE, ANSWER_GENERATION].
    """
    from models.schemas import QueryIntent

    mock_router_response = SimpleNamespace(
        text='{"intent": "CHIT_CHAT"}',
        raw=SimpleNamespace(usage_metadata=SimpleNamespace(
            prompt_token_count=20, candidates_token_count=5, total_token_count=25
        )),
    )
    mock_answer_response = SimpleNamespace(
        text="Xin chào! Tôi có thể giúp gì cho bạn?",
        raw=SimpleNamespace(usage_metadata=SimpleNamespace(
            prompt_token_count=50, candidates_token_count=30, total_token_count=80
        )),
    )

    mock_router_llm = AsyncMock()
    mock_router_llm.acomplete = AsyncMock(return_value=mock_router_response)

    mock_llm = AsyncMock()
    mock_llm.acomplete = AsyncMock(return_value=mock_answer_response)

    request = QueryRequest(question="Xin chào!", conversation_id="conv1")

    with (
        patch("services.rag_engine.get_router_llm", return_value=mock_router_llm),
        patch("services.rag_engine.get_llm", return_value=mock_llm),
    ):
        from services.rag_engine import process_query
        response = await process_query(request)

    assert response.no_answer is True  # CHIT_CHAT → no_answer
    assert len(response.usage_calls) == 2
    assert response.usage_calls[0].operation == "QUERY_REWRITE"
    assert response.usage_calls[0].call_index == 0
    assert response.usage_calls[1].operation == "ANSWER_GENERATION"
    assert response.usage_calls[1].call_index == 1
    # Legacy usage phải có tổng
    assert response.usage is not None
    assert response.usage.total_tokens == 25 + 80  # router + answer


@pytest.mark.asyncio
async def test_process_query_rag_below_threshold_returns_no_answer_with_router_usage():
    """
    RAG_REQUIRED nhưng không có chunk vượt threshold → no_answer=True.
    usage_calls phải có ít nhất router call.
    """
    mock_router_response = SimpleNamespace(
        text='{"intent": "RAG_REQUIRED"}',
        raw=SimpleNamespace(usage_metadata=SimpleNamespace(
            prompt_token_count=15, candidates_token_count=3, total_token_count=18
        )),
    )
    mock_router_llm = AsyncMock()
    mock_router_llm.acomplete = AsyncMock(return_value=mock_router_response)

    mock_embed_model = AsyncMock()
    mock_embed_model.aget_text_embedding = AsyncMock(return_value=[0.1] * 768)

    # Qdrant trả kết quả nhưng score thấp hơn threshold
    low_score_point = SimpleNamespace(
        id="uuid-1", score=0.1,
        payload={"doc_id": "1", "text": "irrelevant", "page_number": 1,
                 "is_hidden": False, "chapter": None, "section": None},
    )
    mock_qdrant = MagicMock()
    mock_qdrant.query_points.return_value = SimpleNamespace(points=[low_score_point])

    request = QueryRequest(question="Câu hỏi học thuật?", conversation_id="conv2")

    with (
        patch("services.rag_engine.get_router_llm", return_value=mock_router_llm),
        patch("services.rag_engine.get_embedding_model", return_value=mock_embed_model),
        patch("services.rag_engine.get_qdrant_client", new=AsyncMock(return_value=mock_qdrant)),
    ):
        from services.rag_engine import process_query
        response = await process_query(request)

    assert response.no_answer is True
    assert response.citations == []
    # Phải có router usage_call
    assert len(response.usage_calls) >= 1
    assert response.usage_calls[0].operation == "QUERY_REWRITE"


@pytest.mark.asyncio
async def test_process_query_rag_with_citation_returns_answer():
    """
    RAG_REQUIRED với chunk đủ điểm và LLM trả answer có [1] → no_answer=False.
    usage_calls phải có 2 entries.
    """
    mock_router_response = SimpleNamespace(
        text='{"intent": "RAG_REQUIRED"}',
        raw=SimpleNamespace(usage_metadata=SimpleNamespace(
            prompt_token_count=10, candidates_token_count=2, total_token_count=12
        )),
    )
    mock_router_llm = AsyncMock()
    mock_router_llm.acomplete = AsyncMock(return_value=mock_router_response)

    mock_embed_model = AsyncMock()
    mock_embed_model.aget_text_embedding = AsyncMock(return_value=[0.5] * 768)

    high_score_point = SimpleNamespace(
        id="point-uuid-1", score=0.85,
        payload={"doc_id": "42", "text": "Nội dung tài liệu quan trọng.",
                 "page_number": 3, "is_hidden": False, "chapter": "Ch1", "section": None},
    )
    mock_qdrant = MagicMock()
    mock_qdrant.query_points.return_value = SimpleNamespace(points=[high_score_point])

    mock_llm_response = SimpleNamespace(
        text="Câu trả lời dựa vào tài liệu [1].",
        raw=SimpleNamespace(usage_metadata=SimpleNamespace(
            prompt_token_count=200, candidates_token_count=100, total_token_count=300
        )),
    )
    mock_llm = AsyncMock()
    mock_llm.acomplete = AsyncMock(return_value=mock_llm_response)

    request = QueryRequest(question="Câu hỏi về tài liệu?", conversation_id="conv3")

    with (
        patch("services.rag_engine.get_router_llm", return_value=mock_router_llm),
        patch("services.rag_engine.get_llm", return_value=mock_llm),
        patch("services.rag_engine.get_embedding_model", return_value=mock_embed_model),
        patch("services.rag_engine.get_qdrant_client", new=AsyncMock(return_value=mock_qdrant)),
    ):
        from services.rag_engine import process_query
        response = await process_query(request)

    assert response.no_answer is False
    assert len(response.citations) == 1
    assert response.citations[0].doc_id == "42"
    assert response.citations[0].page_number == 3
    # 2 usage_calls: router + answer
    assert len(response.usage_calls) == 2
    assert response.usage_calls[0].operation == "QUERY_REWRITE"
    assert response.usage_calls[1].operation == "ANSWER_GENERATION"
    assert response.usage_calls[1].call_index == 1
    # Legacy aggregate
    assert response.usage is not None
    assert response.usage.total_tokens == 12 + 300
