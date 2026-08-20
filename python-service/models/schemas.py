"""
models/schemas.py
-----------------
Định nghĩa các Pydantic models dùng để validate dữ liệu
giao tiếp giữa Python RAG service và Node.js backend.

Phiên bản v4 (Tuần 4):
- Thêm UsageCall schema cho multi-call tracking (RAG-004).
- QueryResponse.usage_calls[] track từng LLM call riêng.
- Legacy QueryResponse.usage giữ để backward-compatible với Node.
"""

from datetime import datetime, timezone
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


# ============================================================
# ERROR RESPONSE — Format lỗi thống nhất
# ============================================================

class ErrorResponse(BaseModel):
    """
    Format lỗi thống nhất cho tất cả API endpoints.
    Node.js sẽ luôn nhận lỗi theo format này.
    """
    error_code: str = Field(..., description="Mã lỗi (VD: FILE_NOT_FOUND, INVALID_FORMAT)")
    message: str = Field(..., description="Mô tả chi tiết lỗi")
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="Thời điểm xảy ra lỗi (ISO format)"
    )

    model_config = ConfigDict(json_schema_extra={
        "example": {
            "error_code": "INVALID_INPUT",
            "message": "Query input is invalid.",
            "timestamp": "2026-08-21T08:30:00+00:00",
        }
    })


class HealthResponse(BaseModel):
    """Trạng thái công khai của Python RAG service."""

    status: Literal["healthy"] = "healthy"
    service: Literal["rag-education-service"] = "rag-education-service"
    version: str = Field(..., description="Phiên bản API của service")
    ocr_mode: Literal["OFF", "AUTO"] = Field(..., description="Chế độ OCR đã resolve")

    model_config = ConfigDict(json_schema_extra={
        "example": {
            "status": "healthy",
            "service": "rag-education-service",
            "version": "3.0.0",
            "ocr_mode": "OFF",
        }
    })


class ServiceInfoResponse(BaseModel):
    """Thông tin điều hướng cơ bản của service."""

    service: str
    version: str
    docs: str
    openapi: str
    health: str


# ============================================================
# ROUTER SCHEMA — Phân loại ý định câu hỏi
# ============================================================

class QueryIntent(BaseModel):
    """
    Kết quả phân loại ý định câu hỏi bởi Query Router.
    LLM sẽ trả về Structured Output theo schema này.

    - CHIT_CHAT:     Câu hỏi giao tiếp thông thường (chào hỏi, cảm ơn, ...).
    - RAG_REQUIRED:  Câu hỏi cần tra cứu tài liệu để trả lời.
    """
    intent: Literal["CHIT_CHAT", "RAG_REQUIRED"] = Field(
        ...,
        description="Loại ý định: 'CHIT_CHAT' hoặc 'RAG_REQUIRED'"
    )


# ============================================================
# INGEST SCHEMAS — Nạp tài liệu (Async pattern)
# ============================================================

class IngestRequest(BaseModel):
    """
    Request gửi tới endpoint POST /api/ingest.
    Node.js tạo job_id trước, truyền kèm callback_url để Python
    gọi ngược khi xử lý xong.
    """
    doc_id: str = Field(..., description="ID duy nhất của tài liệu")
    job_id: str = Field(..., description="ID job do Node.js tạo trước")
    attempt_count: int = Field(..., ge=1, description="Processing attempt hiện tại, số nguyên từ 1")
    subject_id: str = Field(..., description="ID môn học mà tài liệu thuộc về")
    file_path: str = Field(..., description="Đường dẫn tuyệt đối tới file trên server")
    callback_url: str = Field(..., description="URL để Python callback kết quả về Node.js")
    teacher_metadata: Optional[dict] = Field(
        default_factory=dict,
        description="Metadata bổ sung từ giáo viên (tên tác giả, ghi chú, ...)"
    )

    model_config = ConfigDict(json_schema_extra={
        "examples": [{
            "doc_id": "42",
            "job_id": "105",
            "attempt_count": 1,
            "subject_id": "mvp-global",
            "file_path": "/app/uploads/document-42.pdf",
            "callback_url": "http://node:5000/api/internal/rag/processing-callback",
            "teacher_metadata": {},
        }]
    })


class IngestAcceptedResponse(BaseModel):
    """
    Response 202 Accepted — Python nhận request và bắt đầu xử lý nền.
    Node.js nhận response này ngay lập tức, không cần chờ xử lý xong.
    """
    status: Literal["accepted"] = Field(default="accepted", description="Luôn là 'accepted'")
    job_id: str = Field(..., description="Job ID để tracking")
    message: str = Field(default="Tài liệu đang được xử lý", description="Thông báo")

    model_config = ConfigDict(json_schema_extra={
        "example": {
            "status": "accepted",
            "job_id": "105",
            "message": "Tài liệu 42 đang được xử lý",
        }
    })


# ============================================================
# CALLBACK SCHEMAS — Python gọi ngược Node.js
# ============================================================

class ChunkManifestItem(BaseModel):
    """Thông tin tóm tắt của một chunk trong manifest."""
    chunk_index: int = Field(..., ge=0, description="Thứ tự chunk (0-indexed)")
    chunk_id: str = Field(..., description="UUID thực dùng làm Qdrant point ID")
    chunk_text: str = Field(..., description="Toàn bộ text đã được embedding/index")
    content_hash: str = Field(..., description="SHA-256 lowercase hex của exact UTF-8 chunk_text")
    token_count: Optional[int] = Field(default=None, ge=0, description="Số lượng token (ước tính)")
    page_number: Optional[int] = Field(default=None, ge=1, description="Số trang nguồn (1-based)")
    chapter: Optional[str] = Field(default=None, description="Tên chương")
    section: Optional[str] = Field(default=None, description="Tên mục/phần")
    text_preview: Optional[str] = Field(default=None, description="50 ký tự đầu tiên của chunk")


class CallbackPayload(BaseModel):
    """
    Payload Python gửi tới callback_url của Node.js.
    Dùng chung cho cả ingest, hide/unhide, delete.

    eventType:
    - PROGRESS:  Đang xử lý (kèm stage)
    - SUCCEEDED: Hoàn tất thành công
    - FAILED:    Thất bại (kèm error)
    - CANCELLED: Đã bị hủy
    """
    job_id: str = Field(..., description="Job ID matching với request ban đầu")
    attempt_count: int = Field(..., ge=1, description="Processing-job attempt, giữ nguyên từ request")
    event_type: Literal["PROGRESS", "SUCCEEDED", "FAILED", "CANCELLED"] = Field(
        ..., description="Loại sự kiện"
    )

    # === Dùng cho PROGRESS ===
    stage: Optional[str] = Field(
        default=None,
        description="Giai đoạn hiện tại: 'parsing', 'chunking', 'embedding', 'indexing'"
    )

    # === Dùng cho SUCCEEDED (ingest) ===
    chunks_count: Optional[int] = Field(default=None, ge=0, description="Tổng số chunks đã tạo")
    chunk_manifest: Optional[List[ChunkManifestItem]] = Field(
        default=None, description="Danh sách metadata của từng chunk"
    )

    # === Dùng cho SUCCEEDED (delete) ===
    deleted_count: Optional[int] = Field(default=None, ge=0, description="Số vectors đã xóa")

    # === Dùng cho SUCCEEDED (hide/unhide) ===
    updated_count: Optional[int] = Field(default=None, ge=0, description="Số vectors đã cập nhật")

    # === Dùng cho FAILED ===
    error: Optional[dict] = Field(
        default=None,
        description="Chi tiết lỗi: {code: str, message: str}"
    )


# ============================================================
# DOCUMENT MANAGEMENT SCHEMAS — Hide/Unhide/Delete
# ============================================================

class VisibilityRequest(BaseModel):
    """
    Request gửi tới PATCH /api/docs/{doc_id}/visibility.
    Ẩn hoặc hiện tài liệu trong RAG (bật/tắt truy xuất).
    """
    job_id: str = Field(..., description="ID job do Node.js tạo")
    attempt_count: int = Field(..., ge=1, description="Processing attempt hiện tại")
    action: Literal["hide", "unhide"] = Field(
        ..., description="'hide' = ẩn khỏi RAG, 'unhide' = hiện lại"
    )
    callback_url: str = Field(..., description="URL callback kết quả")

    model_config = ConfigDict(json_schema_extra={
        "examples": [{
            "job_id": "106",
            "attempt_count": 1,
            "action": "hide",
            "callback_url": "http://node:5000/api/internal/rag/processing-callback",
        }]
    })


class DeleteRequest(BaseModel):
    """
    Request body cho DELETE /api/ingest/{doc_id}.
    Xóa toàn bộ vectors của tài liệu khỏi Qdrant.
    """
    job_id: str = Field(..., description="ID job do Node.js tạo")
    attempt_count: int = Field(..., ge=1, description="Processing attempt hiện tại")
    callback_url: str = Field(..., description="URL callback kết quả")

    model_config = ConfigDict(json_schema_extra={
        "examples": [{
            "job_id": "107",
            "attempt_count": 1,
            "callback_url": "http://node:5000/api/internal/rag/processing-callback",
        }]
    })


class AcceptedResponse(BaseModel):
    """
    Response 202 chung cho hide/unhide/delete.
    """
    status: Literal["accepted"] = Field(default="accepted", description="Luôn là 'accepted'")
    job_id: str = Field(..., description="Job ID để tracking")

    model_config = ConfigDict(json_schema_extra={
        "example": {"status": "accepted", "job_id": "106"}
    })


# ============================================================
# QUERY SCHEMAS — Chat/Query RAG
# ============================================================

class ChatMessage(BaseModel):
    """Một tin nhắn trong lịch sử hội thoại."""
    role: Literal["user", "assistant"] = Field(..., description="Vai trò: user hoặc assistant")
    content: str = Field(..., description="Nội dung tin nhắn")


class QueryRequest(BaseModel):
    """
    Request gửi tới endpoint POST /api/query.
    Node.js gửi câu hỏi kèm lịch sử gần nhất để Python dùng làm context.
    Search chỉ dùng point đã activate và visible (is_active == true, is_hidden == false).
    """
    question: str = Field(..., description="Câu hỏi của người dùng")
    conversation_id: str = Field(..., description="ID cuộc hội thoại hiện tại do NodeJS tạo")
    history: Optional[List[ChatMessage]] = Field(
        default_factory=list,
        description="Lịch sử hội thoại gần nhất (Node.js gửi kèm)"
    )
    request_id: Optional[str] = Field(default=None, description="Correlation/idempotency extension")
    user_id: Optional[str] = Field(default=None, description="Correlation context")

    model_config = ConfigDict(json_schema_extra={
        "examples": [{
            "request_id": "req-7f94",
            "user_id": "12",
            "conversation_id": "87",
            "question": "Khái niệm học máy là gì?",
            "history": [{"role": "user", "content": "Chào trợ lý"}],
        }]
    })


class Citation(BaseModel):
    """
    Trích dẫn nguồn từ tài liệu gốc.
    Bao gồm thông tin heading hierarchy (chapter, section) để
    người dùng dễ dàng tra cứu lại vị trí trong tài liệu.
    """
    vector_node_id: str = Field(..., description="Qdrant point ID của retrieved chunk")
    doc_id: str = Field(..., description="ID của tài liệu được trích dẫn")
    snippet: str = Field(..., description="Đoạn trích ngắn từ tài liệu gốc")
    page_number: Optional[int] = Field(default=None, ge=1, description="Số trang chứa thông tin (1-based)")
    chapter: Optional[str] = Field(
        default=None,
        description="Tên chương (H1) chứa đoạn trích dẫn"
    )
    section: Optional[str] = Field(
        default=None,
        description="Tên mục/phần (H2/H3) chứa đoạn trích dẫn"
    )


class UsageInfo(BaseModel):
    """
    Thông tin sử dụng LLM — legacy aggregate field.
    Giữ backward-compatible với Node.js contract hiện tại.
    Nếu có usage_calls[], đây là tổng aggregate của tất cả calls SUCCEEDED.
    """
    prompt_tokens: int = Field(default=0, ge=0, description="Số token trong prompt")
    completion_tokens: int = Field(default=0, ge=0, description="Số token LLM sinh ra")
    total_tokens: int = Field(default=0, ge=0, description="Tổng token")
    model: str = Field(default="", description="Tên model đã sử dụng")


class UsageCall(BaseModel):
    """
    Thông tin sử dụng LLM cho MỘT lần gọi cụ thể (RAG-004).

    Node.js lưu từng entry vào llm_usage_logs với:
    - call_index: thứ tự stable trong request
    - operation_type: loại call (QUERY_REWRITE = router, ANSWER_GENERATION = RAG answer)
    - provider/model/tokens/status: metadata đầy đủ

    Không double-count: mỗi LLM call thật → đúng 1 entry.
    """
    call_index: int = Field(
        ...,
        ge=1,
        description="Thứ tự call trong request (1-based, stable per request)"
    )
    operation_type: Literal["QUERY_REWRITE", "ANSWER_GENERATION", "REFINE", "OTHER"] = Field(
        ...,
        description=(
            "Loại operation: "
            "QUERY_REWRITE = router/classifier call, "
            "ANSWER_GENERATION = RAG answer hoặc chit-chat call"
        )
    )
    provider: str = Field(default="google", description="Provider: 'google', 'openai', ...")
    model: str = Field(..., description="Tên model đã dùng cho call này")
    prompt_tokens: int = Field(default=0, ge=0, description="Số token trong prompt của call này")
    completion_tokens: int = Field(default=0, ge=0, description="Số token output của call này")
    total_tokens: int = Field(default=0, ge=0, description="Tổng token của call này")
    status: Literal["SUCCEEDED", "FAILED"] = Field(
        default="SUCCEEDED",
        description="Kết quả của call: SUCCEEDED hoặc FAILED"
    )
    error_code: Optional[str] = Field(
        default=None,
        max_length=64,
        description="Mã lỗi machine-readable nếu status=FAILED"
    )


class QueryResponse(BaseModel):
    """
    Response trả về từ endpoint POST /api/query.
    Bao gồm câu trả lời, danh sách trích dẫn, đánh giá, và usage.

    Invariants:
    - no_answer=False → citations không rỗng (ít nhất 1 structured citation)
    - no_answer=True  → citations=[], answer là thông báo không tìm thấy hoặc chit-chat
    - usage_calls[]   → đầy đủ tất cả LLM calls trong request (RAG-004)
    - usage           → legacy aggregate, luôn hiện diện để backward-compatible
    """
    answer: str = Field(..., description="Câu trả lời được sinh bởi LLM")
    citations: List[Citation] = Field(
        default_factory=list,
        description="Danh sách trích dẫn nguồn tương ứng với [1], [2],..."
    )
    confidence: Literal["high", "medium", "low"] = Field(
        default="high",
        description="Mức độ tin cậy: 'high', 'medium', 'low'"
    )
    no_answer: bool = Field(
        default=False,
        description="True nếu không tìm thấy thông tin liên quan trong tài liệu"
    )
    # Multi-call usage tracking (RAG-004)
    usage_calls: List[UsageCall] = Field(
        default_factory=list,
        description=(
            "Danh sách usage của từng LLM call riêng (router, answer, ...). "
            "Mỗi call thật → 1 entry với call_index stable. "
            "Node.js lưu mỗi entry vào llm_usage_logs."
        )
    )
    # Legacy single-call aggregate — backward-compatible với Node contract cũ
    usage: Optional[UsageInfo] = Field(
        default=None,
        description=(
            "Legacy aggregate usage (backward-compatible). "
            "Tổng token của tất cả usage_calls có status=SUCCEEDED."
        )
    )

    model_config = ConfigDict(json_schema_extra={
        "example": {
            "answer": "Học máy là một nhánh của trí tuệ nhân tạo [1].",
            "citations": [{
                "vector_node_id": "0e52fb89-6d69-58b1-8535-7ade8f099122",
                "doc_id": "42",
                "snippet": "Học máy là một lĩnh vực thuộc trí tuệ nhân tạo.",
                "page_number": 3,
                "chapter": "Trí tuệ nhân tạo",
                "section": "Học máy",
            }],
            "confidence": "high",
            "no_answer": False,
            "usage_calls": [{
                "call_index": 1,
                "operation_type": "QUERY_REWRITE",
                "provider": "google",
                "model": "models/gemini-3.5-flash",
                "prompt_tokens": 25,
                "completion_tokens": 4,
                "total_tokens": 29,
                "status": "SUCCEEDED",
                "error_code": None,
            }],
            "usage": {
                "prompt_tokens": 25,
                "completion_tokens": 4,
                "total_tokens": 29,
                "model": "models/gemini-3.5-flash",
            },
        }
    })

    @model_validator(mode="after")
    def validate_contract_invariants(self):
        if self.no_answer and self.citations:
            raise ValueError("no_answer=true requires an empty citations array.")
        if not self.no_answer and not self.citations:
            raise ValueError("no_answer=false requires at least one structured citation.")
        expected_indices = list(range(1, len(self.usage_calls) + 1))
        actual_indices = [call.call_index for call in self.usage_calls]
        if actual_indices != expected_indices:
            raise ValueError("usage_calls call_index must be contiguous and 1-based.")
        return self
