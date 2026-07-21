from models.schemas import Citation
from services.rag_engine import _finalize_rag_answer


def test_rag_answer_without_citation_becomes_no_answer():
    response = _finalize_rag_answer("Ungrounded model text", [], "high", None)
    assert response.no_answer is True
    assert response.citations == []
    assert response.confidence == "low"
    assert "trích dẫn" in response.answer


def test_rag_answer_with_structured_citation_remains_answer():
    citation = Citation(
        vector_node_id="9589059b-c74b-40b8-896a-47aa77ed4601",
        doc_id="1",
        snippet="Grounded source",
    )
    response = _finalize_rag_answer("Grounded model text [1]", [citation], "high", None)
    assert response.no_answer is False
    assert response.citations == [citation]
