"""
services/doc_manager.py
-----------------------
Quản lý trạng thái tài liệu trong Qdrant.

Phiên bản v4 (Tuần 4):
- Hide:   Set is_hidden=True trên tất cả points có doc_id → callback SUCCEEDED.
- Unhide: Set is_hidden=False trên tất cả points có doc_id → callback SUCCEEDED.
- Delete: Xóa tất cả points có doc_id khỏi Qdrant → callback SUCCEEDED.
- Đếm số points THỰC SỰ bị ảnh hưởng sau mỗi operation (idempotent).
- Tất cả đều chạy background + callback (async pattern).

Invariants:
- Hide/Unhide/Delete dùng MatchValue("doc_id") để chỉ thao tác đúng document.
- Delete xóa toàn bộ kể cả is_hidden=True (cleanup triệt để).
- Hide/Unhide không xóa points, chỉ thay đổi payload is_hidden.
"""

import logging

# pyrefly: ignore [missing-import]
from qdrant_client import models

from core.config import get_settings
from core.database import get_qdrant_client
from services.callback import (
    send_progress,
    send_succeeded_visibility,
    send_succeeded_delete,
    send_failed,
)

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════
# HELPER: đếm points theo doc_id
# ══════════════════════════════════════════════════════════════════

def _count_doc_points(client, collection_name: str, doc_id: str) -> int:
    """
    Đếm số points trong collection có doc_id tương ứng.
    Tính toàn bộ kể cả is_hidden=True/False.
    """
    try:
        result = client.count(
            collection_name=collection_name,
            count_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="doc_id",
                        match=models.MatchValue(value=doc_id),
                    )
                ]
            ),
        )
        return result.count
    except Exception:
        return 0


def _make_doc_filter(doc_id: str) -> models.Filter:
    """Filter lọc theo doc_id."""
    return models.Filter(
        must=[
            models.FieldCondition(
                key="doc_id",
                match=models.MatchValue(value=doc_id),
            )
        ]
    )


# ══════════════════════════════════════════════════════════════════
# HIDE — Ẩn tài liệu khỏi retrieval
# ══════════════════════════════════════════════════════════════════

async def hide_document_background(
    doc_id: str,
    job_id: str,
    attempt_count: int,
    callback_url: str,
) -> None:
    """
    Ẩn tài liệu khỏi RAG: set is_hidden=True trên toàn bộ points có doc_id.
    Sau hide, query với filter active + visible sẽ bỏ qua chunks này.
    Idempotent: gọi nhiều lần trên doc đã hide → kết quả như nhau.
    """
    try:
        await send_progress(callback_url, job_id, attempt_count, "hiding")

        settings = get_settings()
        client = await get_qdrant_client()

        # Đếm TRƯỚC để biết có bao nhiêu points bị ảnh hưởng
        count = _count_doc_points(client, settings.QDRANT_COLLECTION_NAME, doc_id)

        if count == 0:
            logger.warning(
                "[DOC_MANAGER] Không tìm thấy points để hide: doc_id=%s — "
                "vẫn callback SUCCEEDED (idempotent)", doc_id,
            )
            await send_succeeded_visibility(callback_url, job_id, attempt_count, updated_count=0)
            return

        # Set is_hidden=True cho tất cả points của doc_id
        client.set_payload(
            collection_name=settings.QDRANT_COLLECTION_NAME,
            payload={"is_hidden": True},
            points=_make_doc_filter(doc_id),
        )

        logger.info("[DOC_MANAGER] Đã hide doc_id=%s (%d chunks)", doc_id, count)
        await send_succeeded_visibility(callback_url, job_id, attempt_count, updated_count=count)

    except Exception as error:
        logger.error(
            "[DOC_MANAGER] Hide failed: doc_id=%s, error_type=%s",
            doc_id, type(error).__name__,
        )
        await send_failed(
            callback_url, job_id, attempt_count,
            "HIDE_ERROR", "Document visibility update failed.",
        )


# ══════════════════════════════════════════════════════════════════
# UNHIDE — Hiện lại tài liệu
# ══════════════════════════════════════════════════════════════════

async def unhide_document_background(
    doc_id: str,
    job_id: str,
    attempt_count: int,
    callback_url: str,
) -> None:
    """
    Hiện lại tài liệu trong RAG: set is_hidden=False trên toàn bộ points có doc_id.
    Idempotent: gọi nhiều lần trên doc đang visible → kết quả như nhau.
    """
    try:
        await send_progress(callback_url, job_id, attempt_count, "unhiding")

        settings = get_settings()
        client = await get_qdrant_client()

        count = _count_doc_points(client, settings.QDRANT_COLLECTION_NAME, doc_id)

        if count == 0:
            logger.warning(
                "[DOC_MANAGER] Không tìm thấy points để unhide: doc_id=%s — "
                "vẫn callback SUCCEEDED (idempotent)", doc_id,
            )
            await send_succeeded_visibility(callback_url, job_id, attempt_count, updated_count=0)
            return

        client.set_payload(
            collection_name=settings.QDRANT_COLLECTION_NAME,
            payload={"is_hidden": False},
            points=_make_doc_filter(doc_id),
        )

        logger.info("[DOC_MANAGER] Đã unhide doc_id=%s (%d chunks)", doc_id, count)
        await send_succeeded_visibility(callback_url, job_id, attempt_count, updated_count=count)

    except Exception as error:
        logger.error(
            "[DOC_MANAGER] Unhide failed: doc_id=%s, error_type=%s",
            doc_id, type(error).__name__,
        )
        await send_failed(
            callback_url, job_id, attempt_count,
            "UNHIDE_ERROR", "Document visibility update failed.",
        )


# ══════════════════════════════════════════════════════════════════
# DELETE — Xóa tài liệu khỏi Qdrant
# ══════════════════════════════════════════════════════════════════

async def delete_document_background(
    doc_id: str,
    job_id: str,
    attempt_count: int,
    callback_url: str,
) -> None:
    """
    Xóa toàn bộ vectors của tài liệu khỏi Qdrant.
    Xóa cả points đang is_hidden=True (cleanup triệt để).
    File gốc và lịch sử MySQL vẫn được giữ (Node.js quản lý).
    Idempotent: gọi nhiều lần trên doc đã xóa → deleted_count=0.
    """
    try:
        await send_progress(callback_url, job_id, attempt_count, "deleting")

        settings = get_settings()
        client = await get_qdrant_client()

        # Đếm TRƯỚC khi xóa để report deleted_count chính xác
        count = _count_doc_points(client, settings.QDRANT_COLLECTION_NAME, doc_id)

        if count == 0:
            logger.info(
                "[DOC_MANAGER] Không tìm thấy points để xóa: doc_id=%s — "
                "callback SUCCEEDED với deleted_count=0 (idempotent)", doc_id,
            )
            await send_succeeded_delete(callback_url, job_id, attempt_count, deleted_count=0)
            return

        # Xóa toàn bộ points có doc_id (kể cả is_hidden=True)
        client.delete(
            collection_name=settings.QDRANT_COLLECTION_NAME,
            points_selector=models.FilterSelector(
                filter=_make_doc_filter(doc_id)
            ),
        )

        logger.info("[DOC_MANAGER] Đã xóa doc_id=%s (%d vectors)", doc_id, count)
        await send_succeeded_delete(callback_url, job_id, attempt_count, deleted_count=count)

    except Exception as error:
        logger.error(
            "[DOC_MANAGER] Delete failed: doc_id=%s, error_type=%s",
            doc_id, type(error).__name__,
        )
        await send_failed(
            callback_url, job_id, attempt_count,
            "DELETE_ERROR", "Document vector deletion failed.",
        )
