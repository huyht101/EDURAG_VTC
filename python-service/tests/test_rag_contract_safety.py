"""
tests/test_rag_contract_safety.py
----------------------------------
Kiểm tra tính đúng đắn của hợp đồng RAG answer:
- Answer không có citation → phải là no_answer=True (fail-closed).
- Answer có structured citation → no_answer=False.

Những test này không cần Qdrant hoặc LLM thật.
"""

from models.schemas import Citation, UsageInfo
from services.rag_engine import _finalize_rag_answer


def _empty_usage():
    return UsageInfo(prompt_tokens=0, completion_tokens=0, total_tokens=0, model="test-model")


def test_rag_answer_without_citation_becomes_no_answer():
    """Normal answer không có citation → fail-closed → no_answer=True."""
    response = _finalize_rag_answer("Ungrounded model text", [], "high", [], _empty_usage())
    assert response.no_answer is True
    assert response.citations == []
    assert response.confidence == "low"
    # Answer phải là dự phòng, không phải text gốc
    assert "trích dẫn" in response.answer


def test_rag_answer_with_structured_citation_remains_answer():
    """Answer có ít nhất 1 citation hợp lệ → no_answer=False."""
    citation = Citation(
        vector_node_id="9589059b-c74b-40b8-896a-47aa77ed4601",
        doc_id="1",
        snippet="Grounded source",
    )
    response = _finalize_rag_answer("Grounded model text [1]", [citation], "high", [], _empty_usage())
    assert response.no_answer is False
    assert response.citations == [citation]
    assert response.confidence == "high"
