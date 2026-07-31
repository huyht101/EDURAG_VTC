"""
services/ingestion.py
---------------------
Xử lý luồng Ingestion theo pattern async + callback.

Phiên bản v4 (Tuần 4) — Fixes:
  RAG-001: Activation Protocol
    - Upsert Qdrant với is_hidden=True (fail-closed).
    - Chỉ activate (set is_hidden=False) SAU KHI Node.js ACK thành công.
    - Nếu callback thất bại → cleanup toàn bộ points của attempt này.

  RAG-002: Deterministic Point ID + Cleanup
    - chunk_id = deterministic UUID từ (doc_id, job_id, attempt_count, chunk_index).
    - Retry cùng attempt → upsert overwrite, không tạo duplicate.
    - Trước mỗi attempt mới → xóa points của attempt trước (nếu có orphan).

Luồng đầy đủ:
  1. Nhận request → trả 202 ngay.
  2. Background: cleanup orphan attempt trước (nếu cần).
  3. Parse → Chunk → Embed → Upsert Qdrant (is_hidden=True).
  4. Callback SUCCEEDED → nhận ACK.
  5. ACK OK  → activate points (is_hidden=False).
  6. ACK FAIL → cleanup points attempt này.
  7. Callback FAILED nếu có lỗi ở bất kỳ bước nào.
"""

import hashlib
import logging
import uuid

# pyrefly: ignore [missing-import]
from qdrant_client import models

# pyrefly: ignore [missing-import]
from llama_index.core.node_parser import MarkdownNodeParser, SentenceSplitter
# pyrefly: ignore [missing-import]
from llama_index.core.schema import Document as LlamaDocument

from core.config import get_settings
from core.database import get_qdrant_client
from core.llm_setup import get_embedding_model
from models.schemas import (
    IngestRequest,
    ChunkManifestItem,
)
from services.parser import parse_document
from services.callback import (
    send_progress,
    send_succeeded_ingest,
    send_failed,
)

logger = logging.getLogger(__name__)

# ── Payload field đánh dấu attempt (để cleanup orphan) ────────────
_ATTEMPT_FIELD = "ingest_attempt_key"


# ══════════════════════════════════════════════════════════════════
# HÀM SINH DETERMINISTIC CHUNK ID (RAG-002)
# ══════════════════════════════════════════════════════════════════

def _make_chunk_id(doc_id: str, job_id: str, attempt_count: int, chunk_index: int) -> str:
    """
    Sinh deterministic UUID từ (doc_id, job_id, attempt_count, chunk_index).

    Bảo đảm:
    - Cùng attempt + chunk_index → cùng ID → upsert overwrite, không duplicate.
    - Khác attempt → khác ID → cleanup attempt cũ không ảnh hưởng attempt mới.
    """
    seed = f"{doc_id}::{job_id}::{attempt_count}::{chunk_index}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"edurag:{seed}"))


def _make_attempt_key(doc_id: str, job_id: str, attempt_count: int) -> str:
    """Key đánh dấu attempt — lưu trong payload Qdrant để cleanup."""
    return f"{doc_id}::{job_id}::{attempt_count}"


# ══════════════════════════════════════════════════════════════════
# CLEANUP HELPERS
# ══════════════════════════════════════════════════════════════════

async def _cleanup_attempt_points(
    doc_id: str,
    job_id: str,
    attempt_count: int,
) -> int:
    """
    Xóa toàn bộ Qdrant points thuộc về một attempt cụ thể.
    Dùng để:
    - Cleanup orphan points của attempt TRƯỚC khi chạy attempt mới.
    - Cleanup points của attempt HIỆN TẠI nếu callback thất bại.

    Returns: số points đã xóa.
    """
    settings = get_settings()
    attempt_key = _make_attempt_key(doc_id, job_id, attempt_count)
    client = await get_qdrant_client()
    before = _count_attempt_points(client, settings.QDRANT_COLLECTION_NAME, attempt_key)
    client.delete(
        collection_name=settings.QDRANT_COLLECTION_NAME,
        points_selector=models.FilterSelector(
            filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key=_ATTEMPT_FIELD,
                        match=models.MatchValue(value=attempt_key),
                    )
                ]
            )
        ),
        wait=True,
    )
    remaining = _count_attempt_points(client, settings.QDRANT_COLLECTION_NAME, attempt_key)
    if remaining:
        raise RuntimeError(
            f"Cleanup incomplete for attempt_key={attempt_key}: {remaining} points remain"
        )
    logger.info(
        "[INGEST] Đã cleanup %d points của attempt_key=%s",
        before, attempt_key,
    )
    return before


def _count_attempt_points(client, collection_name: str, attempt_key: str) -> int:
    """Đếm số points trong Qdrant có cùng attempt_key."""
    result = client.count(
        collection_name=collection_name,
        count_filter=models.Filter(
            must=[
                models.FieldCondition(
                    key=_ATTEMPT_FIELD,
                    match=models.MatchValue(value=attempt_key),
                )
            ]
        ),
    )
    return result.count


async def _activate_attempt_points(
    doc_id: str,
    job_id: str,
    attempt_count: int,
) -> int:
    """
    Kích hoạt các points của attempt này: set is_hidden=False.
    CHỈ gọi sau khi Node.js ACK thành công (SUCCEEDED callback được nhận).

    Returns: số points đã activate.
    """
    settings = get_settings()
    attempt_key = _make_attempt_key(doc_id, job_id, attempt_count)
    client = await get_qdrant_client()
    client.set_payload(
        collection_name=settings.QDRANT_COLLECTION_NAME,
        payload={"is_hidden": False},
        points=models.Filter(
            must=[
                models.FieldCondition(
                    key=_ATTEMPT_FIELD,
                    match=models.MatchValue(value=attempt_key),
                )
            ]
        ),
        wait=True,
    )
    count = _count_attempt_points(client, settings.QDRANT_COLLECTION_NAME, attempt_key)
    logger.info(
        "[INGEST] Activated %d points sau ACK: doc_id=%s, attempt=%d",
        count, doc_id, attempt_count,
    )
    return count


def _ack_allows_activation(ack: object, job_id: str, attempt_count: int) -> bool:
    """Chỉ ACK đúng job/attempt và canActivate=true mới được mở retrieval."""
    if not isinstance(ack, dict):
        return False
    outcome = ack.get("outcome")
    return (
        str(ack.get("jobId")) == str(job_id)
        and ack.get("attemptCount") == attempt_count
        and ack.get("canActivate") is True
        and outcome in {"ACCEPTED", "IDEMPOTENT_REPLAY"}
        and ack.get("status") == "SUCCEEDED"
    )


# ══════════════════════════════════════════════════════════════════
# HÀM CHÍNH: INGEST BACKGROUND TASK
# ══════════════════════════════════════════════════════════════════

async def ingest_document_background(request: IngestRequest) -> None:
    """
    Xử lý nạp tài liệu vào Qdrant (chạy trong BackgroundTasks).

    Bước 0: Cleanup orphan points của attempt trước (nếu retry).
    Bước 1: Parse file (PDF/DOCX/TXT).
    Bước 2: Chia chunks bằng SentenceSplitter.
    Bước 3: Tạo embeddings.
    Bước 4: Upsert Qdrant (is_hidden=True — fail-closed).
    Bước 5: Callback SUCCEEDED → nhận ACK.
    Bước 6: ACK OK  → activate (is_hidden=False).
             ACK FAIL → cleanup attempt này.
    """
    settings = get_settings()
    callback_url = request.callback_url
    job_id = request.job_id
    attempt_count = request.attempt_count
    doc_id = request.doc_id
    attempt_key = _make_attempt_key(doc_id, job_id, attempt_count)

    try:
        # ── Bước 0: Cleanup orphan points của attempt trước ───────
        if attempt_count > 1:
            logger.info(
                "[INGEST] Cleanup orphan từ attempt trước: doc_id=%s, attempt=%d",
                doc_id, attempt_count - 1,
            )
            await _cleanup_attempt_points(doc_id, job_id, attempt_count - 1)

        # ── Bước 1: Parse tài liệu ────────────────────────────────
        await send_progress(callback_url, job_id, attempt_count, "parsing")

        logger.info("[INGEST] Parsing file: %s", request.file_path)
        pages = await parse_document(request.file_path)

        if not pages:
            await send_failed(
                callback_url, job_id, attempt_count,
                "EMPTY_DOCUMENT", "Không đọc được nội dung từ file", stage="parsing"
            )
            return

        logger.info("[INGEST] Đã parse %d pages", len(pages))

        # ── Bước 2: Chia chunks ───────────────────────────────────
        await send_progress(callback_url, job_id, attempt_count, "chunking")

        documents = _build_llama_documents(
            pages=pages,
            doc_id=doc_id,
            subject_id=request.subject_id,
            teacher_metadata=request.teacher_metadata or {},
        )

        # Sử dụng MarkdownNodeParser để giữ cấu trúc Header
        markdown_parser = MarkdownNodeParser()
        md_nodes = markdown_parser.get_nodes_from_documents(documents)

        # Sử dụng SentenceSplitter để đảm bảo chunk_size
        splitter = SentenceSplitter(
            chunk_size=settings.CHUNK_SIZE,
            chunk_overlap=settings.CHUNK_OVERLAP,
        )
        nodes = splitter.get_nodes_from_documents(md_nodes)

        if not nodes:
            await send_failed(
                callback_url, job_id, attempt_count,
                "NO_CHUNKS", "Tài liệu không có đủ nội dung để chia chunks", stage="chunking"
            )
            return

        logger.info("[INGEST] Tạo được %d chunks", len(nodes))

        # ── Bước 3: Embedding ─────────────────────────────────────
        await send_progress(callback_url, job_id, attempt_count, "embedding")

        embed_model = get_embedding_model()
        texts = [node.get_content() for node in nodes]

        try:
            embeddings = await embed_model.aget_text_embedding_batch(texts)
        except Exception as e:
            await send_failed(
                callback_url, job_id, attempt_count,
                "EMBEDDING_ERROR", f"Lỗi khi tạo embedding: {str(e)}", stage="embedding"
            )
            return

        logger.info("[INGEST] Đã tạo embeddings cho %d chunks", len(embeddings))

        if len(nodes) != len(embeddings):
            await send_failed(
                callback_url, job_id, attempt_count,
                "EMBEDDING_COUNT_MISMATCH",
                "Embedding count does not match chunk count.",
                stage="embedding",
            )
            return

        # ── Bước 4: Upsert Qdrant (is_hidden=True — fail-closed) ──
        await send_progress(callback_url, job_id, attempt_count, "indexing")

        client = await get_qdrant_client()
        points = []
        chunk_manifest = []

        for i, (node, embedding) in enumerate(zip(nodes, embeddings)):
            metadata = node.metadata
            chunk_text = node.get_content()

            # RAG-002: Deterministic chunk_id — retry sẽ overwrite, không duplicate
            chunk_id = _make_chunk_id(doc_id, job_id, attempt_count, i)
            content_hash = hashlib.sha256(chunk_text.encode("utf-8")).hexdigest()
            token_count = len(chunk_text.split())

            point = models.PointStruct(
                id=chunk_id,
                vector=embedding,
                payload={
                    "text": chunk_text,
                    "doc_id": metadata.get("doc_id", doc_id),
                    "subject_id": metadata.get("subject_id", request.subject_id),
                    "page_number": metadata.get("page_number"),
                    "chapter": metadata.get("chapter"),
                    "section": metadata.get("section"),
                    "chunk_index": i,
                    # RAG-001: Fail-closed — KHÔNG retrieval cho đến khi Node ACK
                    "is_hidden": True,
                    # RAG-002: Đánh dấu attempt để cleanup orphan
                    _ATTEMPT_FIELD: attempt_key,
                    # Teacher metadata
                    **{f"teacher_{k}": v for k, v in (request.teacher_metadata or {}).items()},
                },
            )
            points.append(point)

            chunk_manifest.append(
                ChunkManifestItem(
                    chunk_id=chunk_id,
                    chunk_index=i,
                    chunk_text=chunk_text,
                    content_hash=content_hash,
                    token_count=token_count,
                    page_number=metadata.get("page_number"),
                    chapter=metadata.get("chapter"),
                    section=metadata.get("section"),
                    text_preview=chunk_text[:50],
                )
            )

        # Upload theo batch
        BATCH_SIZE = 100
        for batch_start in range(0, len(points), BATCH_SIZE):
            batch = points[batch_start: batch_start + BATCH_SIZE]
            client.upsert(
                collection_name=settings.QDRANT_COLLECTION_NAME,
                points=batch,
            )

        logger.info(
            "[INGEST] Upsert thành công %d chunks (is_hidden=True): doc_id=%s, attempt=%d",
            len(points), doc_id, attempt_count,
        )

        # ── Bước 5: Callback SUCCEEDED → nhận ACK ─────────────────
        ack = await send_succeeded_ingest(
            callback_url=callback_url,
            job_id=job_id,
            attempt_count=attempt_count,
            chunks_count=len(points),
            chunk_manifest=[m.model_dump() for m in chunk_manifest],
        )

        # ── Bước 6: Xử lý kết quả ACK ────────────────────────────
        if _ack_allows_activation(ack, job_id, attempt_count):
            # Node.js đã nhận manifest → kích hoạt retrieval
            try:
                activated = await _activate_attempt_points(doc_id, job_id, attempt_count)
                if activated != len(points):
                    raise RuntimeError(
                        f"Activation count mismatch: expected={len(points)}, actual={activated}"
                    )
            except Exception as activation_error:
                await _cleanup_attempt_points(doc_id, job_id, attempt_count)
                await send_failed(
                    callback_url,
                    job_id,
                    attempt_count,
                    "ACTIVATION_FAILED",
                    str(activation_error),
                    stage="activation",
                )
                return
            logger.info(
                "[INGEST] ✓ Hoàn tất: doc_id=%s, attempt=%d, %d chunks activated",
                doc_id, attempt_count, activated,
            )
        else:
            # ACK stale/rejected/malformed hoặc callback thất bại: không activate.
            logger.error(
                "[INGEST] ACK không cho activate — cleanup attempt: doc_id=%s, attempt=%d",
                doc_id, attempt_count,
            )
            await _cleanup_attempt_points(doc_id, job_id, attempt_count)
            if ack is None:
                await send_failed(
                    callback_url,
                    job_id,
                    attempt_count,
                    "ACTIVATION_ACK_UNAVAILABLE",
                    "Node activation ACK was unavailable or malformed.",
                    stage="activation",
                )

    except FileNotFoundError as e:
        logger.error("[INGEST] File không tồn tại: %s", str(e))
        await send_failed(callback_url, job_id, attempt_count, "FILE_NOT_FOUND", str(e), stage="parsing")

    except ValueError as e:
        logger.error("[INGEST] File không hợp lệ: %s", str(e))
        await send_failed(callback_url, job_id, attempt_count, "INVALID_FORMAT", str(e), stage="parsing")

    except Exception as e:
        logger.exception("[INGEST] Lỗi không xác định")
        await send_failed(callback_url, job_id, attempt_count, "INTERNAL_ERROR", str(e))


# ══════════════════════════════════════════════════════════════════
# HÀM PHỤ TRỢ
# ══════════════════════════════════════════════════════════════════

def _build_llama_documents(
    pages: list[dict],
    doc_id: str,
    subject_id: str,
    teacher_metadata: dict,
) -> list[LlamaDocument]:
    """
    Chuyển đổi pages từ parser thành LlamaIndex Documents kèm metadata.
    """
    documents = []

    for page in pages:
        metadata = {
            "doc_id": doc_id,
            "subject_id": subject_id,
        }

        if "page_number" in page:
            metadata["page_number"] = page["page_number"]
        if "chapter" in page and page["chapter"]:
            metadata["chapter"] = page["chapter"]
        if "section" in page and page["section"]:
            metadata["section"] = page["section"]

        doc = LlamaDocument(
            text=page["text"],
            metadata=metadata,
        )
        documents.append(doc)

    return documents
