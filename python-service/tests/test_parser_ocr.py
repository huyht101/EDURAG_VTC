"""Deterministic OCR-mode and mixed-PDF parsing regressions."""

import asyncio
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError

from core.config import OCRMode, Settings
from services.parser import (
    OCRProcessingError,
    _parse_pdf_auto,
    _parse_pdf_fallback,
    _parse_with_llamaparse,
    parse_document,
)


def make_settings(**overrides):
    values = {
        "GOOGLE_API_KEY": "offline-google-key",
        "INTERNAL_SECRET": "offline-internal-secret-0123456789abcdef",
        "OCR_MODE": "OFF",
        "LLAMA_CLOUD_API_KEY": "",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def auto_settings():
    return make_settings(
        OCR_MODE="AUTO",
        LLAMA_CLOUD_API_KEY="offline-llama-key",
        OCR_NATIVE_TEXT_MIN_CHARS=8,
        OCR_TIMEOUT_SECONDS=5,
        OCR_LANGUAGE="vi",
    )


def test_ocr_mode_is_explicit_and_key_presence_does_not_enable_it():
    settings = make_settings(LLAMA_CLOUD_API_KEY="present-but-disabled")
    assert settings.OCR_MODE == OCRMode.OFF


def test_invalid_ocr_mode_fails_configuration():
    with pytest.raises(ValidationError):
        make_settings(OCR_MODE="sometimes")


def test_auto_requires_provider_credential_but_off_does_not():
    with pytest.raises(ValidationError):
        make_settings(OCR_MODE="AUTO", LLAMA_CLOUD_API_KEY="")
    assert make_settings(OCR_MODE="OFF", LLAMA_CLOUD_API_KEY="").OCR_MODE == OCRMode.OFF


def test_off_native_pdf_does_not_inspect_images():
    native = [{"page_number": 1, "text": "native", "has_images": False}]
    with patch("services.parser._read_pdf_pages", return_value=native) as reader:
        assert _parse_pdf_fallback("digital.pdf") == [
            {"page_number": 1, "text": "native"}
        ]
    reader.assert_called_once_with("digital.pdf", inspect_images=False)


@pytest.mark.asyncio
async def test_off_uses_native_parser_without_provider(tmp_path):
    pdf = tmp_path / "digital.pdf"
    pdf.write_bytes(b"fixture")
    provider = AsyncMock()
    with (
        patch("services.parser.get_settings", return_value=make_settings()),
        patch(
            "services.parser._parse_pdf_fallback",
            return_value=[{"page_number": 1, "text": "Native text"}],
        ),
        patch("services.parser._parse_with_llamaparse", provider),
    ):
        pages = await parse_document(str(pdf))
    assert pages[0]["text"] == "Native text"
    provider.assert_not_called()


@pytest.mark.asyncio
async def test_auto_digital_pdf_does_not_call_ocr():
    native = [{"page_number": 1, "text": "Digital native text", "has_images": False}]
    provider = AsyncMock()
    with (
        patch("services.parser._read_pdf_pages", return_value=native),
        patch("services.parser._parse_with_llamaparse", provider),
    ):
        pages = await _parse_pdf_auto("digital.pdf", auto_settings())
    assert pages == [{"page_number": 1, "text": "Digital native text"}]
    provider.assert_not_called()


@pytest.mark.asyncio
async def test_auto_scanned_pdf_uses_ocr_text_and_physical_page():
    native = [{"page_number": 1, "text": "", "has_images": True}]
    with (
        patch("services.parser._read_pdf_pages", return_value=native),
        patch(
            "services.parser._parse_with_llamaparse",
            new=AsyncMock(return_value=[{"page_number": 1, "text": "Tiếng Việt OCR"}]),
        ) as provider,
    ):
        pages = await _parse_pdf_auto("scan.pdf", auto_settings())
    assert pages == [{"page_number": 1, "text": "Tiếng Việt OCR"}]
    provider.assert_awaited_once()


@pytest.mark.asyncio
async def test_auto_mixed_pdf_uses_native_and_ocr_per_page():
    native = [
        {"page_number": 1, "text": "Digital native text", "has_images": False},
        {"page_number": 2, "text": "", "has_images": True},
        {"page_number": 3, "text": "", "has_images": False},
        {"page_number": 4, "text": "Hybrid native text", "has_images": True},
    ]
    provider_pages = [
        {"page_number": 1, "text": "provider must not replace digital"},
        {"page_number": 2, "text": "OCR scan page"},
        {"page_number": 4, "text": "provider must not replace hybrid native"},
    ]
    with (
        patch("services.parser._read_pdf_pages", return_value=native),
        patch(
            "services.parser._parse_with_llamaparse",
            new=AsyncMock(return_value=provider_pages),
        ),
    ):
        pages = await _parse_pdf_auto("mixed.pdf", auto_settings())
    assert pages == [
        {"page_number": 1, "text": "Digital native text"},
        {"page_number": 2, "text": "OCR scan page"},
        {"page_number": 4, "text": "Hybrid native text"},
    ]


@pytest.mark.asyncio
async def test_required_ocr_empty_or_provider_failure_fails_whole_parse():
    native = [{"page_number": 2, "text": "", "has_images": True}]
    with (
        patch("services.parser._read_pdf_pages", return_value=native),
        patch(
            "services.parser._parse_with_llamaparse",
            new=AsyncMock(return_value=[{"page_number": 2, "text": ""}]),
        ),
        pytest.raises(OCRProcessingError, match="no usable text"),
    ):
        await _parse_pdf_auto("scan.pdf", auto_settings())

    with (
        patch("services.parser._read_pdf_pages", return_value=native),
        patch(
            "services.parser._parse_with_llamaparse",
            new=AsyncMock(side_effect=OCRProcessingError("provider failed")),
        ),
        pytest.raises(OCRProcessingError, match="provider failed"),
    ):
        await _parse_pdf_auto("scan.pdf", auto_settings())


@pytest.mark.asyncio
async def test_provider_timeout_is_normalized(monkeypatch):
    class FakeLlamaParse:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def aload_data(self, _file_path):
            return []

    async def raise_timeout(coroutine, *, timeout):
        coroutine.close()
        raise asyncio.TimeoutError

    monkeypatch.setitem(sys.modules, "llama_parse", SimpleNamespace(LlamaParse=FakeLlamaParse))
    monkeypatch.setattr("services.parser.asyncio.wait_for", raise_timeout)
    with pytest.raises(OCRProcessingError, match="timed out"):
        await _parse_with_llamaparse(
            "scan.pdf",
            "offline-key",
            timeout_seconds=5,
            language="vi",
        )
