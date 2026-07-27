"""
tests/test_schemas.py
---------------------
Test validation cho các schema Pydantic.
"""

from models.schemas import (
    IngestRequest,
    QueryRequest,
    VisibilityRequest,
    CallbackPayload,
)
# pyrefly: ignore [missing-import]
import pytest
from pydantic import ValidationError

def test_ingest_request_valid():
    data = {
        "doc_id": "123",
        "job_id": "job1",
        "attempt_count": 1,
        "subject_id": "sub1",
        "file_path": "/tmp/file.pdf",
        "callback_url": "http://localhost/cb",
    }
    req = IngestRequest(**data)
    assert req.doc_id == "123"
    assert req.job_id == "job1"
    assert req.teacher_metadata == {}

def test_query_request_valid():
    data = {
        "question": "test",
        "request_id": "request-1",
        "user_id": "user-1",
        "conversation_id": "conv1",
        "history": [{"role": "user", "content": "hi"}]
    }
    req = QueryRequest(**data)
    assert req.question == "test"
    assert len(req.history) == 1
    assert req.history[0].role == "user"

def test_visibility_request_invalid_action():
    data = {
        "job_id": "job1",
        "attempt_count": 1,
        "action": "delete", # Invalid action
        "callback_url": "http://localhost/cb",
    }
    with pytest.raises(ValidationError):
        VisibilityRequest(**data)

def test_callback_payload_valid():
    data = {
        "job_id": "job1",
        "attempt_count": 1,
        "event_type": "PROGRESS",
        "stage": "parsing"
    }
    payload = CallbackPayload(**data)
    assert payload.event_type == "PROGRESS"
    assert payload.stage == "parsing"


# ──────────────────────────────────────────────────────────────────
# Tests mới tuần 4: UsageCall và QueryResponse.usage_calls
# ──────────────────────────────────────────────────────────────────

def test_usage_call_valid():
    """UsageCall schema valid với tất cả fields."""
    from models.schemas import UsageCall
    uc = UsageCall(
        call_index=0,
        operation="QUERY_REWRITE",
        provider="google",
        model="models/gemini-2.5-flash",
        prompt_tokens=100,
        completion_tokens=50,
        total_tokens=150,
        status="SUCCEEDED",
    )
    assert uc.call_index == 0
    assert uc.operation == "QUERY_REWRITE"
    assert uc.status == "SUCCEEDED"
    assert uc.error_message is None


def test_usage_call_failed_requires_error_message_optional():
    """FAILED status có thể không có error_message (Optional)."""
    from models.schemas import UsageCall
    uc = UsageCall(
        call_index=1,
        operation="ANSWER_GENERATION",
        provider="google",
        model="models/gemini-2.5-flash",
        status="FAILED",
        error_message="Network timeout",
    )
    assert uc.status == "FAILED"
    assert uc.error_message == "Network timeout"


def test_usage_call_invalid_operation():
    """operation ngoài Literal → ValidationError."""
    from models.schemas import UsageCall
    with pytest.raises(ValidationError):
        UsageCall(
            call_index=0,
            operation="INVALID_OP",
            model="m",
        )


def test_query_response_usage_calls_backward_compatible():
    """QueryResponse vẫn valid khi usage_calls rỗng (backward-compatible)."""
    from models.schemas import QueryResponse
    response = QueryResponse(
        answer="Câu trả lời",
        citations=[],
        no_answer=True,
        usage_calls=[],  # rỗng là OK
    )
    assert response.usage_calls == []
    assert response.usage is None  # legacy field optional


def test_query_response_with_usage_calls():
    """QueryResponse với usage_calls đầy đủ."""
    from models.schemas import QueryResponse, UsageCall
    uc0 = UsageCall(call_index=0, operation="QUERY_REWRITE", model="m", status="SUCCEEDED")
    uc1 = UsageCall(call_index=1, operation="ANSWER_GENERATION", model="m", status="SUCCEEDED")
    response = QueryResponse(
        answer="Câu trả lời [1]",
        no_answer=False,
        usage_calls=[uc0, uc1],
    )
    assert len(response.usage_calls) == 2
    assert response.usage_calls[0].call_index == 0
    assert response.usage_calls[1].call_index == 1
