"""
services/parser.py
------------------
Parser đa định dạng: PDF, DOCX, TXT.

Theo sơ đồ 3 (Ingest Flow):
- Đọc cấu trúc tài liệu (LlamaParse / fallback)
- Bảo toàn từ ghép Tiếng Việt (Underthesea)
- Trích xuất heading hierarchy (chapter, section)

Strategy:
- PDF OFF: native extraction only.
- PDF AUTO: native extraction for digital pages and OCR for image-only pages.
- DOCX/TXT: local parser only. Integrated DOCX ingest receives Node's derived PDF.
"""

import asyncio
import logging
import re
from pathlib import Path

from core.config import OCRMode, get_settings

try:
    # pyrefly: ignore [missing-import]
    from underthesea import word_tokenize
    HAS_UNDERTHESEA = True
except ImportError:
    HAS_UNDERTHESEA = False

logger = logging.getLogger(__name__)

# Định dạng file được hỗ trợ
SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".txt"}


class OCRProcessingError(RuntimeError):
    """Required OCR could not produce trustworthy text for the document."""


# ══════════════════════════════════════════════════════════════════
# HÀM CHÍNH: PARSE TÀI LIỆU
# ══════════════════════════════════════════════════════════════════

async def parse_document(file_path: str) -> list[dict]:
    """
    Parse tài liệu thành danh sách pages với text và metadata.

    Args:
        file_path: Đường dẫn tuyệt đối tới file.

    Returns:
        List[dict]: Mỗi item là {page_number, text, chapter, section}

    Raises:
        FileNotFoundError: File không tồn tại.
        ValueError: Định dạng file không hỗ trợ.
    """
    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(f"Không tìm thấy file: {file_path}")

    ext = path.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Định dạng '{ext}' không được hỗ trợ. "
            f"Chỉ hỗ trợ: {', '.join(SUPPORTED_EXTENSIONS)}"
        )

    settings = get_settings()

    if ext == ".pdf":
        pages = (
            await _parse_pdf_auto(file_path, settings)
            if settings.OCR_MODE == OCRMode.AUTO
            else _parse_pdf_fallback(file_path)
        )
    elif ext == ".docx":
        pages = _parse_docx_fallback(file_path)
    elif ext == ".txt":
        pages = _parse_txt(file_path)
    else:
        raise ValueError(f"Không có parser cho định dạng: {ext}")

    logger.info("Parser hoàn tất: extension=%s, pages=%d", ext, len(pages))
    return _enrich_with_headings(pages)


# ══════════════════════════════════════════════════════════════════
# LLAMAPARSE (PRIMARY)
# ══════════════════════════════════════════════════════════════════

async def _parse_with_llamaparse(
    file_path: str,
    api_key: str,
    *,
    timeout_seconds: int,
    language: str,
) -> list[dict]:
    """
    Parse tài liệu bằng LlamaParse (LlamaIndex Cloud).
    Hỗ trợ PDF, DOCX, TXT — trả về structured markdown.
    """
    try:
        # pyrefly: ignore [missing-import]
        from llama_parse import LlamaParse
    except ImportError as error:
        raise OCRProcessingError("OCR provider dependency is unavailable.") from error

    parser = LlamaParse(
        api_key=api_key,
        result_type="markdown",
        language=language,
        premium_mode=True,
        split_by_page=True,
        ignore_errors=False,
        show_progress=False,
        max_timeout=timeout_seconds,
    )

    try:
        documents = await asyncio.wait_for(
            parser.aload_data(file_path),
            timeout=timeout_seconds,
        )
    except asyncio.TimeoutError as error:
        raise OCRProcessingError("OCR provider timed out.") from error
    except Exception as error:
        raise OCRProcessingError("OCR provider failed.") from error

    pages = [
        {"page_number": page_number, "text": (document.text or "").strip()}
        for page_number, document in enumerate(documents, start=1)
    ]
    logger.info("OCR provider completed: pages=%d", len(pages))
    return pages


async def _parse_pdf_auto(file_path: str, settings) -> list[dict]:
    """Use native text per page and OCR only image-only/scan pages."""
    native_pages = _read_pdf_pages(file_path)
    required_pages = {
        page["page_number"]
        for page in native_pages
        if page["has_images"]
        and len(page["text"].strip()) < settings.OCR_NATIVE_TEXT_MIN_CHARS
    }

    if not required_pages:
        return _content_pages(native_pages)

    provider_pages = await _parse_with_llamaparse(
        file_path,
        settings.LLAMA_CLOUD_API_KEY,
        timeout_seconds=settings.OCR_TIMEOUT_SECONDS,
        language=settings.OCR_LANGUAGE,
    )
    provider_by_page = {
        page["page_number"]: page["text"].strip()
        for page in provider_pages
        if page.get("page_number") is not None
    }

    combined = []
    for page in native_pages:
        page_number = page["page_number"]
        if page_number in required_pages:
            ocr_text = provider_by_page.get(page_number, "")
            if not ocr_text:
                raise OCRProcessingError(
                    f"OCR returned no usable text for required page {page_number}."
                )
            combined.append({"page_number": page_number, "text": ocr_text})
        elif page["text"].strip():
            combined.append({"page_number": page_number, "text": page["text"].strip()})
    return combined


# ══════════════════════════════════════════════════════════════════
# FALLBACK PARSERS
# ══════════════════════════════════════════════════════════════════

def _parse_pdf_fallback(file_path: str) -> list[dict]:
    """Đọc PDF bằng pypdf (fallback khi không có LlamaParse)."""
    return _content_pages(_read_pdf_pages(file_path, inspect_images=False))


def _read_pdf_pages(file_path: str, *, inspect_images: bool = True) -> list[dict]:
    """Read every physical PDF page, preserving blank/image-only page positions."""
    try:
        # pyrefly: ignore [missing-import]
        from pypdf import PdfReader

        reader = PdfReader(file_path)
        return [
            {
                "page_number": page_number,
                "text": (page.extract_text() or "").strip(),
                "has_images": _pdf_page_has_images(page) if inspect_images else False,
            }
            for page_number, page in enumerate(reader.pages, start=1)
        ]
    except OCRProcessingError:
        raise
    except Exception as error:
        logger.error("PDF parse failed: error_type=%s", type(error).__name__)
        raise ValueError("PDF could not be parsed.") from error


def _content_pages(pages: list[dict]) -> list[dict]:
    return [
        {"page_number": page["page_number"], "text": page["text"].strip()}
        for page in pages
        if page["text"].strip()
    ]


def _pdf_page_has_images(page) -> bool:
    """Detect image XObjects without treating a genuinely blank page as OCR failure."""
    try:
        return bool(list(page.images))
    except (AttributeError, TypeError):
        pass
    except Exception as error:
        raise OCRProcessingError("PDF page image inspection failed.") from error

    try:
        resources = page.get("/Resources")
        if not resources:
            return False
        resources = resources.get_object()
        xobjects = resources.get("/XObject")
        if not xobjects:
            return False
        for candidate in xobjects.get_object().values():
            if candidate.get_object().get("/Subtype") == "/Image":
                return True
        return False
    except Exception as error:
        raise OCRProcessingError("PDF page image inspection failed.") from error


def _parse_docx_fallback(file_path: str) -> list[dict]:
    """Đọc DOCX bằng python-docx (fallback)."""
    try:
        # pyrefly: ignore [missing-import]
        from docx import Document

        doc = Document(file_path)
        full_text = []
        for para in doc.paragraphs:
            if para.text.strip():
                full_text.append(para.text)

        # DOCX không có page concept rõ ràng → trả về None cho page_number
        combined = "\n".join(full_text)
        pages = []
        if combined.strip():
            pages.append({
                "page_number": None,
                "text": combined.strip(),
            })

        return pages

    except Exception as error:
        logger.error("DOCX parse failed: error_type=%s", type(error).__name__)
        raise ValueError("DOCX could not be parsed.") from error


def _parse_txt(file_path: str) -> list[dict]:
    """Đọc file TXT thuần."""
    try:
        path = Path(file_path)
        content = path.read_text(encoding="utf-8")

        if not content.strip():
            return []

        # TXT không có physical page → trả về None cho page_number
        pages = []
        if content.strip():
            pages.append({
                "page_number": None,
                "text": content.strip(),
            })

        return pages

    except Exception as error:
        logger.error("TXT parse failed: error_type=%s", type(error).__name__)
        raise ValueError("TXT could not be parsed as UTF-8.") from error


# ══════════════════════════════════════════════════════════════════
# HEADING EXTRACTION + VIETNAMESE NORMALIZATION
# ══════════════════════════════════════════════════════════════════

def _enrich_with_headings(pages: list[dict]) -> list[dict]:
    """
    Bổ sung heading hierarchy (chapter, section) cho mỗi page.
    Heading có tính kế thừa: trang trước truyền cho trang sau.
    Đồng thời normalize text tiếng Việt nếu có Underthesea.
    """
    current_chapter = None
    current_section = None

    for page in pages:
        text = page["text"]

        # Normalize tiếng Việt
        text = _normalize_vietnamese(text)
        page["text"] = text

        # Trích xuất headings
        headings = _extract_headings(text)

        if headings["chapter"]:
            current_chapter = headings["chapter"]
            current_section = None  # Reset section khi vào chapter mới

        if headings["section"]:
            current_section = headings["section"]

        page["chapter"] = current_chapter or ""
        page["section"] = current_section or ""

    return pages


def _extract_headings(text: str) -> dict:
    """
    Trích xuất heading hierarchy từ text.
    Nhận diện pattern heading phổ biến trong tài liệu giáo dục.
    """
    chapter = None
    section = None

    lines = text.split("\n")

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # ── Nhận diện H1 (Chapter) ───────────────────────────────
        chapter_match = re.match(
            r"^(?:Chương|CHƯƠNG|Chapter)\s+[\dIVXivx]+[:\.\s]?\s*(.+)",
            stripped,
            re.IGNORECASE,
        )
        if chapter_match:
            chapter = stripped
            continue

        # Pattern: Dòng VIẾT HOA hoàn toàn (tiêu đề chương)
        if (
            stripped.isupper()
            and 5 <= len(stripped) <= 100
            and not stripped.startswith(("HTTP", "URL", "ISBN"))
        ):
            chapter = stripped
            continue

        # ── Nhận diện H2/H3 (Section) ───────────────────────────
        section_match = re.match(
            r"^(\d+(?:\.\d+)+)\.?\s+(.+)",
            stripped,
        )
        if section_match:
            section = stripped
            continue

        section_match2 = re.match(
            r"^(?:Phần|Bài|Mục|Section)\s+[\dIVXivx]+[:\.\s]?\s*(.+)",
            stripped,
            re.IGNORECASE,
        )
        if section_match2:
            section = stripped
            continue

    return {"chapter": chapter, "section": section}


def _normalize_vietnamese(text: str) -> str:
    """
    Normalize text tiếng Việt bằng Underthesea (word segmentation).
    Nếu Underthesea không available, trả về text gốc (graceful fallback).
    """
    if HAS_UNDERTHESEA:
        try:
            return word_tokenize(text, format="text")
        except Exception as error:
            logger.warning(
                "Vietnamese normalization failed: error_type=%s",
                type(error).__name__,
            )
            return text
    return text
