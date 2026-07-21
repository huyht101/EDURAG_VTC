"""
core/database.py
----------------
Khởi tạo và quản lý kết nối Singleton tới Qdrant Vector Database.
Tự động tạo collection và payload indexes nếu chưa tồn tại.

Phiên bản v3:
- Thêm payload index cho doc_id (tăng tốc filter/delete).
- Thêm payload index cho is_hidden (tăng tốc filter khi search).
"""

import asyncio
import logging
# pyrefly: ignore [missing-import]
from qdrant_client import QdrantClient, models
from core.config import get_settings

logger = logging.getLogger(__name__)

# ── Biến toàn cục lưu trữ singleton client ──────────────────────
_qdrant_client: QdrantClient | None = None


async def get_qdrant_client() -> QdrantClient:
    """
    Lấy hoặc tạo QdrantClient singleton.
    Nếu client chưa tồn tại, khởi tạo kết nối mới tới Qdrant server
    và tạo collection + indexes nếu cần.
    """
    global _qdrant_client

    if _qdrant_client is not None:
        return _qdrant_client

    settings = get_settings()

    try:
        logger.info("Đang khởi tạo kết nối tới Qdrant tại: %s", settings.QDRANT_URL)

        _qdrant_client = QdrantClient(
            url=settings.QDRANT_URL,
            api_key=settings.QDRANT_API_KEY,
            timeout=30,
        )

        # Kiểm tra và tạo collection nếu chưa có
        await _ensure_collection_exists(
            client=_qdrant_client,
            collection_name=settings.QDRANT_COLLECTION_NAME,
            vector_size=settings.EMBEDDING_DIMENSION,
        )

        logger.info("Kết nối Qdrant thành công ✓")
        return _qdrant_client

    except Exception as e:
        logger.error("Lỗi khi kết nối tới Qdrant: %s", str(e))
        _qdrant_client = None
        raise


async def _ensure_collection_exists(
    client: QdrantClient,
    collection_name: str,
    vector_size: int,
    postcondition_attempts: int = 10,
) -> None:
    """
    Kiểm tra collection đã tồn tại chưa.
    Nếu chưa → tạo mới với Cosine similarity + payload indexes.
    """
    collections = client.get_collections().collections
    existing_names = [col.name for col in collections]

    if collection_name in existing_names:
        _validate_collection(client, collection_name, vector_size)
        logger.info("Collection '%s' đã tồn tại và tương thích ✓", collection_name)
        return

    logger.info("Collection '%s' chưa tồn tại — đang tạo mới...", collection_name)
    created = False
    try:
        client.create_collection(
            collection_name=collection_name,
            vectors_config=models.VectorParams(
                size=vector_size,
                distance=models.Distance.COSINE,
            ),
        )
        created = True
    except Exception as error:
        if not _is_concurrent_create_conflict(error):
            raise
        logger.info(
            "Collection '%s' vừa được worker khác tạo; đang kiểm tra postcondition...",
            collection_name,
        )

    # Never treat a 409 as success by itself. The collection must now exist,
    # be available and match the exact unnamed-vector contract.
    await _wait_for_collection_postcondition(
        client, collection_name, vector_size, attempts=postcondition_attempts
    )

    if created:
        _create_payload_indexes(client, collection_name)
        logger.info("Đã tạo collection '%s' với %d chiều vector ✓", collection_name, vector_size)


def _is_concurrent_create_conflict(error: Exception) -> bool:
    """Only accept qdrant-client's exact HTTP 409 create conflict."""
    try:
        from qdrant_client.http.exceptions import UnexpectedResponse
    except ImportError:
        return False
    return isinstance(error, UnexpectedResponse) and error.status_code == 409


def _is_transient_collection_read(error: Exception) -> bool:
    """Recognize only bounded post-create read failures observed from Qdrant."""
    try:
        from qdrant_client.http.exceptions import UnexpectedResponse
    except ImportError:
        return False
    return isinstance(error, UnexpectedResponse) and error.status_code in {404, 500, 503}


async def _wait_for_collection_postcondition(
    client: QdrantClient,
    collection_name: str,
    vector_size: int,
    attempts: int = 10,
) -> None:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            _validate_collection(client, collection_name, vector_size)
            return
        except Exception as error:
            if not _is_transient_collection_read(error):
                raise
            last_error = error
            if attempt < attempts:
                await asyncio.sleep(min(0.05 * attempt, 0.25))
    assert last_error is not None
    raise last_error


def _validate_collection(client: QdrantClient, collection_name: str, vector_size: int) -> None:
    """Validate availability and the exact unnamed cosine-vector schema."""
    info = client.get_collection(collection_name=collection_name)
    status = getattr(getattr(info, "status", None), "value", getattr(info, "status", None))
    if str(status).lower() not in {"green", "yellow", "grey"}:
        raise RuntimeError(f"Qdrant collection '{collection_name}' is not available.")

    vectors = getattr(getattr(getattr(info, "config", None), "params", None), "vectors", None)
    if vectors is None or isinstance(vectors, dict):
        raise RuntimeError(f"Qdrant collection '{collection_name}' does not use one unnamed vector.")

    actual_size = getattr(vectors, "size", None)
    distance = getattr(vectors, "distance", None)
    actual_distance = getattr(distance, "value", distance)
    if actual_size != vector_size or str(actual_distance).lower() != "cosine":
        raise RuntimeError(
            f"Qdrant collection '{collection_name}' has an incompatible vector configuration."
        )


def _create_payload_indexes(client: QdrantClient, collection_name: str) -> None:
    """Tạo payload indexes cho các field thường dùng để filter."""
    indexes = [
        ("doc_id", models.PayloadSchemaType.KEYWORD),
        ("subject_id", models.PayloadSchemaType.KEYWORD),
        ("is_hidden", models.PayloadSchemaType.BOOL),
    ]

    for field_name, schema_type in indexes:
        try:
            client.create_payload_index(
                collection_name=collection_name,
                field_name=field_name,
                field_schema=schema_type,
            )
            logger.info("Đã tạo index cho field '%s' ✓", field_name)
        except Exception as e:
            logger.warning("Không tạo được index cho '%s': %s", field_name, str(e))


async def close_qdrant_client() -> None:
    """Đóng kết nối tới Qdrant khi shutdown app."""
    global _qdrant_client

    if _qdrant_client is not None:
        try:
            _qdrant_client.close()
            logger.info("Đã đóng kết nối Qdrant ✓")
        except Exception as e:
            logger.warning("Lỗi khi đóng kết nối Qdrant: %s", str(e))
        finally:
            _qdrant_client = None
