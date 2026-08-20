"""
api/routes.py
-------------
Định nghĩa các API endpoints cho RAG microservice.
Giao tiếp nội bộ với Node.js backend qua HTTP.

Phiên bản v3 — Theo sơ đồ luồng:
  POST   /api/ingest              — Nạp tài liệu (async, 202)
  POST   /api/query               — Chat/Query RAG (sync, 200)
  PATCH  /api/docs/{doc_id}/visibility — Hide/Unhide (async, 202)
  DELETE /api/ingest/{doc_id}      — Xóa vectors (async, 202)
  GET    /api/health               — Health check

Error handling thống nhất dùng ErrorResponse.
"""

import logging
import time
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Body, HTTPException, Path, status, Depends
from fastapi.responses import JSONResponse

from api.dependencies import verify_internal_token
from core.config import get_settings
from models.schemas import (
    IngestRequest,
    IngestAcceptedResponse,
    VisibilityRequest,
    DeleteRequest,
    AcceptedResponse,
    QueryRequest,
    QueryResponse,
    ErrorResponse,
    HealthResponse,
)
from services.ingestion import ingest_document_background
from services.doc_manager import (
    hide_document_background,
    unhide_document_background,
    delete_document_background,
)
from services.rag_engine import process_query

logger = logging.getLogger(__name__)

# ── Khởi tạo router với prefix chung ────────────────────────────
# Router bảo vệ bằng token (tất cả trừ health)
router = APIRouter(prefix="/api", tags=["RAG"], dependencies=[Depends(verify_internal_token)])
public_router = APIRouter(prefix="/api", tags=["Public"])

# ══════════════════════════════════════════════════════════════════
# HELPER: Error Response thống nhất
# ══════════════════════════════════════════════════════════════════

def _error_response(
    status_code: int,
    error_code: str,
    message: str,
) -> JSONResponse:
    """Tạo error response theo format thống nhất."""
    return JSONResponse(
        status_code=status_code,
        content=ErrorResponse(
            error_code=error_code,
            message=message,
            timestamp=datetime.now(timezone.utc).isoformat(),
        ).model_dump(),
    )


# ══════════════════════════════════════════════════════════════════
# ENDPOINT 1: Nạp tài liệu (Async — 202 Accepted)
# ══════════════════════════════════════════════════════════════════

@router.post(
    "/ingest",
    response_model=IngestAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Nạp tài liệu — Async, trả 202 ngay, callback khi xong",
    description=(
        "Nhận request nạp tài liệu, trả 202 Accepted ngay lập tức. "
        "Xử lý nền: Parse → Chunk → Embed → Lưu Qdrant. "
        "Gọi callback_url khi hoàn tất (SUCCEEDED/FAILED)."
    ),
    operation_id="ingestDocument",
    responses={
        401: {"description": "Bearer token thiếu hoặc không hợp lệ"},
        422: {"description": "Request không đúng schema"},
    },
)
async def ingest_endpoint(
    request: Annotated[IngestRequest, Body(openapi_examples={
        "pdf_document": {
            "summary": "Nạp một tài liệu PDF",
            "value": {
                "doc_id": "42",
                "job_id": "105",
                "attempt_count": 1,
                "subject_id": "mvp-global",
                "file_path": "/shared/uploads/documents/document-42.pdf",
                "callback_url": "http://app:5000/api/internal/rag/processing-callback",
                "teacher_metadata": {},
            },
        }
    })],
    background_tasks: BackgroundTasks,
) -> IngestAcceptedResponse:
    """
    Xử lý nạp tài liệu vào Qdrant (async pattern).

    Luồng: Trả 202 → Background task → Callback khi xong.
    """
    logger.info(
        "[INGEST] Nhận request: doc_id=%s, job_id=%s",
        request.doc_id,
        request.job_id,
    )

    # Thêm task xử lý vào background
    background_tasks.add_task(ingest_document_background, request)

    # Trả 202 ngay lập tức
    return IngestAcceptedResponse(
        status="accepted",
        job_id=request.job_id,
        message=f"Tài liệu {request.doc_id} đang được xử lý",
    )


# ══════════════════════════════════════════════════════════════════
# ENDPOINT 2: Chat/Query RAG (Sync — 200 OK)
# ══════════════════════════════════════════════════════════════════

@router.post(
    "/query",
    response_model=QueryResponse,
    summary="Truy vấn RAG — Hỏi đáp với Query Router",
    description=(
        "Nhận câu hỏi + lịch sử hội thoại. Query Router phân loại intent:\n"
        "- CHIT_CHAT → LLM trả lời giao tiếp.\n"
        "- RAG_REQUIRED → Search READY+VISIBLE docs trong Qdrant → LLM → Citations.\n"
        "Trả kèm usage (token counts) để Node.js lưu cho dashboard."
    ),
    operation_id="queryRag",
    responses={
        401: {"description": "Bearer token thiếu hoặc không hợp lệ"},
        404: {"model": ErrorResponse, "description": "Không tìm thấy resource cần thiết"},
        422: {"model": ErrorResponse, "description": "Input không hợp lệ"},
        500: {"model": ErrorResponse, "description": "Lỗi xử lý nội bộ đã được làm sạch"},
    },
)
async def query_endpoint(
    request: Annotated[QueryRequest, Body(openapi_examples={
        "rag_question": {
            "summary": "Câu hỏi cần tra cứu tài liệu",
            "value": {
                "request_id": "req-7f94",
                "user_id": "12",
                "conversation_id": "87",
                "question": "Khái niệm học máy là gì?",
                "history": [],
            },
        },
        "with_history": {
            "summary": "Câu hỏi có lịch sử hội thoại",
            "value": {
                "request_id": "req-7f95",
                "user_id": "12",
                "conversation_id": "87",
                "question": "Hãy giải thích kỹ hơn phần đó",
                "history": [
                    {"role": "user", "content": "Học máy là gì?"},
                    {"role": "assistant", "content": "Học máy là một nhánh của AI."},
                ],
            },
        },
    })],
) -> QueryResponse:
    """Xử lý truy vấn RAG (sync, trả kết quả ngay)."""
    start_time = time.time()

    try:
        logger.info(
            "[QUERY] Nhận request: conv=%s, question_length=%d, history=%d msgs",
            request.conversation_id,
            len(request.question),
            len(request.history or []),
        )

        response = await process_query(request)

        elapsed = time.time() - start_time
        logger.info(
            "[QUERY] Hoàn tất trong %.2fs | no_answer=%s | citations=%d",
            elapsed,
            response.no_answer,
            len(response.citations),
        )

        return response

    except FileNotFoundError:
        return _error_response(
            status.HTTP_404_NOT_FOUND,
            "FILE_NOT_FOUND",
            "Required query resource was not found.",
        )

    except ValueError:
        return _error_response(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "INVALID_INPUT",
            "Query input is invalid.",
        )

    except Exception as error:
        logger.error("[QUERY] Internal failure: error_type=%s", type(error).__name__)
        return _error_response(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "Query processing failed.",
        )


# ══════════════════════════════════════════════════════════════════
# ENDPOINT 3: Hide/Unhide tài liệu (Async — 202 Accepted)
# ══════════════════════════════════════════════════════════════════

@router.patch(
    "/docs/{doc_id}/visibility",
    response_model=AcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ẩn/Hiện tài liệu — Bật/tắt truy xuất trong RAG",
    description=(
        "Hide: set is_hidden=true → tài liệu không xuất hiện khi search.\n"
        "Unhide: set is_hidden=false → tài liệu xuất hiện lại khi search.\n"
        "Async: trả 202, callback khi xong."
    ),
    operation_id="changeDocumentVisibility",
    responses={
        401: {"description": "Bearer token thiếu hoặc không hợp lệ"},
        422: {"description": "Request không đúng schema"},
    },
)
async def visibility_endpoint(
    doc_id: Annotated[str, Path(description="ID tài liệu", examples=["42"])],
    request: Annotated[VisibilityRequest, Body(openapi_examples={
        "hide": {
            "summary": "Ẩn tài liệu khỏi kết quả RAG",
            "value": {
                "job_id": "106",
                "attempt_count": 1,
                "action": "hide",
                "callback_url": "http://app:5000/api/internal/rag/processing-callback",
            },
        },
        "unhide": {
            "summary": "Hiện lại tài liệu",
            "value": {
                "job_id": "107",
                "attempt_count": 1,
                "action": "unhide",
                "callback_url": "http://app:5000/api/internal/rag/processing-callback",
            },
        },
    })],
    background_tasks: BackgroundTasks,
) -> AcceptedResponse:
    """Xử lý hide/unhide tài liệu (async pattern)."""
    logger.info(
        "[VISIBILITY] Nhận request: doc_id=%s, action=%s, job_id=%s",
        doc_id,
        request.action,
        request.job_id,
    )

    if request.action == "hide":
        background_tasks.add_task(
            hide_document_background,
            doc_id=doc_id,
            job_id=request.job_id,
            attempt_count=request.attempt_count,
            callback_url=request.callback_url,
        )
    else:  # unhide
        background_tasks.add_task(
            unhide_document_background,
            doc_id=doc_id,
            job_id=request.job_id,
            attempt_count=request.attempt_count,
            callback_url=request.callback_url,
        )

    return AcceptedResponse(
        status="accepted",
        job_id=request.job_id,
    )


# ══════════════════════════════════════════════════════════════════
# ENDPOINT 4: Xóa tài liệu (Async — 202 Accepted)
# ══════════════════════════════════════════════════════════════════

@router.delete(
    "/ingest/{doc_id}",
    response_model=AcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Xóa vectors tài liệu — Dọn dẹp Qdrant",
    description=(
        "Xóa toàn bộ vectors có doc_id khỏi Qdrant.\n"
        "File gốc và lịch sử MySQL vẫn được giữ (Node.js quản lý).\n"
        "Async: trả 202, callback khi xong."
    ),
    operation_id="deleteDocumentVectors",
    responses={
        401: {"description": "Bearer token thiếu hoặc không hợp lệ"},
        422: {"description": "Request không đúng schema"},
    },
)
async def delete_endpoint(
    doc_id: Annotated[str, Path(description="ID tài liệu", examples=["42"])],
    request: Annotated[DeleteRequest, Body(openapi_examples={
        "delete_vectors": {
            "summary": "Xóa vector của một tài liệu",
            "value": {
                "job_id": "108",
                "attempt_count": 1,
                "callback_url": "http://app:5000/api/internal/rag/processing-callback",
            },
        }
    })],
    background_tasks: BackgroundTasks,
) -> AcceptedResponse:
    """Xử lý xóa vectors tài liệu (async pattern)."""
    logger.info(
        "[DELETE] Nhận request: doc_id=%s, job_id=%s",
        doc_id,
        request.job_id,
    )

    background_tasks.add_task(
        delete_document_background,
        doc_id=doc_id,
        job_id=request.job_id,
        attempt_count=request.attempt_count,
        callback_url=request.callback_url,
    )

    return AcceptedResponse(
        status="accepted",
        job_id=request.job_id,
    )


# ══════════════════════════════════════════════════════════════════
# ENDPOINT 5: Health Check
# ══════════════════════════════════════════════════════════════════

@public_router.get(
    "/health",
    response_model=HealthResponse,
    summary="Kiểm tra trạng thái service",
    description="Endpoint để monitoring/load balancer kiểm tra service còn hoạt động.",
    operation_id="getHealth",
)
async def health_check() -> HealthResponse:
    """Trả về trạng thái hoạt động của service."""
    settings = get_settings()
    return HealthResponse(version="3.0.0", ocr_mode=settings.OCR_MODE.value)
