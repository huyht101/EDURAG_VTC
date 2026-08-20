"""
main.py
-------
File khởi chạy chính cho FastAPI RAG Microservice.

Chức năng:
- Cấu hình CORS cho phép Node.js backend gọi tới.
- Mount tất cả API routes.
- Quản lý lifecycle: khởi tạo kết nối Qdrant khi startup,
  đóng kết nối khi shutdown.
- Cấu hình logging cho toàn bộ ứng dụng.

Chạy server:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router as api_router, public_router
from core.config import get_settings
from core.database import get_qdrant_client, close_qdrant_client
from models.schemas import ServiceInfoResponse

API_VERSION = "3.0.0"

OPENAPI_TAGS = [
    {
        "name": "Public",
        "description": "Endpoint công khai phục vụ health check và monitoring.",
    },
    {
        "name": "RAG",
        "description": (
            "API nội bộ NodeJS–Python. Nhấn **Authorize** và nhập internal token; "
            "Swagger UI tự gửi header `Authorization: Bearer <token>`."
        ),
    },
    {
        "name": "Root",
        "description": "Thông tin service và các đường dẫn tài liệu.",
    },
]

# ── Cấu hình logging ────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════
# LIFESPAN — Quản lý vòng đời của ứng dụng
# ══════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Quản lý startup và shutdown của ứng dụng.

    Startup:
    - Load cấu hình từ .env
    - Khởi tạo kết nối tới Qdrant (tạo collection nếu chưa có)

    Shutdown:
    - Đóng kết nối Qdrant an toàn
    """
    # ── STARTUP ──────────────────────────────────────────────────
    settings = get_settings()
    logger.info("=" * 60)
    logger.info("🚀 RAG Education Service đang khởi động...")
    logger.info("   Collection   : %s", settings.QDRANT_COLLECTION_NAME)
    logger.info("   OCR Mode     : %s", settings.OCR_MODE.value)
    logger.info("   LLM Model    : %s", settings.GEMINI_LLM_MODEL)
    logger.info("   Embed Model  : %s", settings.GEMINI_EMBEDDING_MODEL)
    logger.info("   Top-K        : %d", settings.TOP_K)
    logger.info("   Sim Threshold: %.2f", settings.SIMILARITY_THRESHOLD)
    logger.info("=" * 60)

    # Khởi tạo sớm và fail-fast: không phục vụ request nếu collection thiếu,
    # unavailable hoặc không khớp vector contract.
    await get_qdrant_client()
    logger.info("Khởi tạo thành công — Service sẵn sàng phục vụ ✓")

    yield  # ← App chạy ở đây

    # ── SHUTDOWN ─────────────────────────────────────────────────
    logger.info("Đang tắt service...")
    await close_qdrant_client()
    logger.info("Service đã tắt an toàn ✓")


# ══════════════════════════════════════════════════════════════════
# KHỞI TẠO FASTAPI APP
# ══════════════════════════════════════════════════════════════════

app = FastAPI(
    title="EDURAG Python RAG API",
    description=(
        "Microservice xử lý RAG (Retrieval-Augmented Generation) cho EDURAG.\n\n"
        "Các endpoint nghiệp vụ chỉ dành cho NodeJS/Core và yêu cầu Bearer token. "
        "Client web/mobile không gọi trực tiếp service này. Các thao tác ingest, "
        "visibility và delete trả `202 Accepted`; kết quả cuối được gửi về "
        "`callback_url`.\n\n"
        "Contract chuẩn: `docs/api/internal-rag-contract.md` tại repository gốc."
    ),
    version=API_VERSION,
    lifespan=lifespan,
    docs_url="/docs",       # Swagger UI tại /docs
    redoc_url="/redoc",     # ReDoc tại /redoc
    openapi_url="/openapi.json",
    openapi_tags=OPENAPI_TAGS,
    swagger_ui_parameters={
        "persistAuthorization": True,
        "displayRequestDuration": True,
        "filter": True,
    },
)


# ── Cấu hình CORS — cho phép Node.js backend gọi tới ───────────
settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Mount tất cả API routes ─────────────────────────────────────
app.include_router(public_router)
app.include_router(api_router)


# ══════════════════════════════════════════════════════════════════
# ROOT ENDPOINT
# ══════════════════════════════════════════════════════════════════

@app.get(
    "/",
    tags=["Root"],
    response_model=ServiceInfoResponse,
    summary="Thông tin Python RAG service",
    operation_id="getServiceInfo",
)
async def root() -> ServiceInfoResponse:
    """Endpoint gốc — hiển thị thông tin cơ bản về service."""
    return ServiceInfoResponse(
        service="RAG Education Service",
        version=API_VERSION,
        docs="/docs",
        openapi="/openapi.json",
        health="/api/health",
    )


# ── Chạy trực tiếp bằng: python main.py ─────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
