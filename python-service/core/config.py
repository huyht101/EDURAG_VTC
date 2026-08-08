"""
core/config.py
--------------
Quản lý biến môi trường cho toàn bộ ứng dụng.
Sử dụng pydantic-settings để tự động load từ file .env.

Phiên bản v3:
- Thêm LLAMA_CLOUD_API_KEY cho LlamaParse.
- Thêm INTERNAL_SECRET cho callback auth.
- Thêm CALLBACK_TIMEOUT, CALLBACK_MAX_RETRIES cho callback mechanism.
"""

from enum import Enum
from functools import lru_cache

# pyrefly: ignore [missing-import]
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class OCRMode(str, Enum):
    """Explicit parser/OCR mode. API-key presence never changes this value."""

    OFF = "OFF"
    AUTO = "AUTO"


class Settings(BaseSettings):
    """
    Cấu hình ứng dụng — tất cả giá trị được đọc từ biến môi trường
    hoặc file .env ở thư mục gốc dự án.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # === Google Gemini API ===
    GOOGLE_API_KEY: str = Field(min_length=1)

    # === OCR Mode ===
    OCR_MODE: OCRMode = OCRMode.OFF
    OCR_NATIVE_TEXT_MIN_CHARS: int = Field(default=32, ge=1, le=10000)
    OCR_TIMEOUT_SECONDS: int = Field(default=120, ge=1, le=3600)
    OCR_LANGUAGE: str = Field(default="vi", min_length=2, max_length=16)

    # === LlamaParse (LlamaIndex Cloud) ===
    LLAMA_CLOUD_API_KEY: str = ""

    # === Tên model Gemini ===
    GEMINI_LLM_MODEL: str = "models/gemini-3.5-flash"
    GEMINI_EMBEDDING_MODEL: str = "models/gemini-embedding-001"

    # === Qdrant Vector Database ===
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: str | None = None
    QDRANT_COLLECTION_NAME: str = "education_docs"

    # === RAG Parameters ===
    CHUNK_SIZE: int = 512
    CHUNK_OVERLAP: int = 50
    TOP_K: int = 5
    SIMILARITY_THRESHOLD: float = 0.35

    # === CORS — cho phép Node.js backend gọi tới ===
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    # === Embedding Dimension (gemini-embedding-001 trả về 768 chiều) ===
    EMBEDDING_DIMENSION: int = Field(default=768, ge=1)

    # === Callback — gọi ngược Node.js sau khi xử lý xong ===
    INTERNAL_SECRET: str = Field(min_length=32)
    CALLBACK_TIMEOUT: int = Field(default=30, ge=1, le=600)
    CALLBACK_MAX_RETRIES: int = Field(default=3, ge=1, le=10)
    ACTIVATION_MAX_ATTEMPTS: int = Field(default=3, ge=1, le=5)
    ACTIVATION_RETRY_DELAY_SECONDS: float = Field(default=0.25, ge=0, le=5)

    @field_validator("OCR_MODE", mode="before")
    @classmethod
    def normalize_ocr_mode(cls, value):
        if isinstance(value, str):
            return value.strip().upper()
        return value

    @model_validator(mode="after")
    def validate_ocr_provider_configuration(self):
        if self.OCR_MODE == OCRMode.AUTO and not self.LLAMA_CLOUD_API_KEY.strip():
            raise ValueError("LLAMA_CLOUD_API_KEY is required when OCR_MODE=AUTO.")
        return self


@lru_cache()
def get_settings() -> Settings:
    """
    Singleton pattern: chỉ khởi tạo Settings một lần duy nhất
    rồi cache lại cho các lần gọi sau.
    """
    return Settings()
