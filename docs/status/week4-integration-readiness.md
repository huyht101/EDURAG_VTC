# Week 4 Integration Readiness — Python RAG Service

> **HISTORICAL — NOT CURRENT AUTHORITY.** This report reflects the Week 4 snapshot and offline test
> claims. It does not describe the current Python geometry/OCR/citation-parser state.
> Use the [Python/Data-RAG handoff](../architecture/python-rag-handoff.md) and
> [project handoff](../../PROJECT_HANDOFF.md).

## Trạng thái hiện tại

**SNAPSHOT PATCHED/OFFLINE-TESTABLE — LIVE E2E CHƯA XÁC NHẬN**

Các mục dưới đây mô tả tracked snapshot, không chứng minh upstream Python đã nhận patch hoặc live Python/Qdrant/provider lifecycle đã PASS. Action register canonical: [Python/Data-RAG handoff](../architecture/python-rag-handoff.md).

---

## Những gì đã làm trong tuần 4

### RAG-001: Activation Protocol ✅

**Vấn đề cũ**: Points được upsert vào Qdrant với `is_hidden=False` TRƯỚC khi Node.js ACK callback SUCCEEDED. Nếu callback thất bại, vector sẽ retrieval-enabled nhưng document chưa `READY` trong MySQL → query trả kết quả từ tài liệu chưa được xác nhận.

**Fix đã làm** (`services/ingestion.py`):
- Upsert Qdrant với `is_hidden=True` (fail-closed) — chưa retrieval-enabled.
- Sau khi ACK JSON đúng job/attempt trả `canActivate=true` và accepted/exact replay → gọi `_activate_attempt_points()` để set `is_hidden=False`.
- ACK stale/rejected/conflict/malformed hoặc callback failure không activate và cleanup exact attempt.

### RAG-002: Deterministic Point ID + Cleanup ✅

**Vấn đề cũ**: `chunk_id = str(uuid.uuid4())` — mỗi lần chạy sinh UUID random. Khi retry sau failure, Qdrant tích lũy thêm points thay vì overwrite → orphan vectors, count lệch.

**Fix đã làm** (`services/ingestion.py`):
- `_make_chunk_id(doc_id, job_id, attempt_count, chunk_index)` — deterministic RFC-4122 UUID5.
- Cùng attempt + index → cùng ID → Qdrant upsert overwrite, không duplicate.
- Payload mỗi point có `ingest_attempt_key = f"{doc_id}::{job_id}::{attempt_count}"` để cleanup đúng attempt.
- Khi `attempt_count > 1`: cleanup orphan points của `attempt_count - 1` trước khi bắt đầu.

### RAG-004: Multi-call Usage Tracking ✅

**Vấn đề cũ**: Chỉ track usage của answer LLM call. Router LLM call không được ghi nhận → Node.js dashboard thiếu dữ liệu LLM usage.

**Fix đã làm** (`services/rag_engine.py` + `models/schemas.py`):
- Thêm `UsageCall` schema: 1-based `call_index`, `operation_type`, `provider`, `model`, `prompt/completion/total_tokens`, `status`, nullable `error_code`.
- `_classify_intent()` trả `(intent, usage_call)` với `call_index=1`, `operation_type="QUERY_REWRITE"`.
- Answer/chit-chat call có `call_index=2`, `operation_type="ANSWER_GENERATION"`.
- `QueryResponse.usage_calls[]` chứa tất cả calls.
- `QueryResponse.usage` vẫn giữ (legacy aggregate, backward-compatible).

### Citation Quality ✅

- `_extract_citations()`: reject marker không có source, renumber marker liên tục, chọn relevant source snippet; page_number < 1 → `None`.
- `_finalize_rag_answer()`: không có citation → `no_answer=True`, fail-closed.
- Retrieval filter `is_hidden != True` — chỉ chunk READY+VISIBLE.

### Hide / Unhide / Delete ✅

`services/doc_manager.py`:
- Idempotent: gọi nhiều lần trên doc đã hide/delete → kết quả như nhau, callback SUCCEEDED với count=0.
- Delete xóa toàn bộ kể cả points đang `is_hidden=True`.
- Dùng `_make_doc_filter(doc_id)` nhất quán cho tất cả operations.

### Parser ✅ (không thay đổi)

- PDF: LlamaParse primary → pypdf fallback.
- DOCX: LlamaParse primary → python-docx fallback.
- TXT: plain read, segment ~3000 ký tự.
- Vietnamese NLP: Underthesea optional (graceful fallback).
- Heading extraction: chapter (H1), section (H2/H3).

### Test Suite ✅

| File | Test coverage |
|------|---------------|
| `tests/test_ingestion.py` | RAG-001 (activation, cleanup khi ACK fail), RAG-002 (deterministic ID, attempt key, retry cleanup) |
| `tests/test_rag_engine.py` | RAG-004 (usage_calls, aggregate), citations, no_answer, confidence |
| `tests/test_rag_contract_safety.py` | Fail-closed contract |
| `tests/test_database.py` | Qdrant collection init, concurrent create, postcondition |
| `tests/test_api.py` | API endpoints, auth |
| `tests/test_schemas.py` | Pydantic schemas |

### Config & Documentation ✅

- `requirements.txt`: tất cả versions pinned.
- `pytest.ini`: `asyncio_mode = auto`.
- `.env.example`: đầy đủ mô tả từng biến.
- `python-service/README.md`: hướng dẫn đầy đủ.

---

## Evidence

| Gate | Kết quả |
|------|---------|
| `pytest tests/test_ingestion.py` | PASS — 7 tests |
| `pytest tests/test_rag_engine.py` | PASS — 14 tests |
| `pytest tests/test_rag_contract_safety.py` | PASS — 2 tests |
| `pytest tests/test_database.py` | PASS — 8 tests |
| `pytest tests/test_api.py` | PASS — 7 tests |
| `pytest tests/test_schemas.py` | PASS — (existing) |
| Paid provider calls trong tuần 4 | 0 (tất cả tests dùng mock) |

---

## Open Items (chưa làm / LATER)

| Item | Lý do |
|------|-------|
| Durable processing queue | FastAPI BackgroundTasks không survive restart — cần architect queue/worker riêng |
| Dependency hash lock | pip-tools lock chưa có |
| Live E2E với Python thật | Cần approved corpus + provider credentials |
| PDF bounding box/locator | Contract Python-Node-FE chưa chốt |
| Multi-instance rate limit | Node.js concern, không phải Python |

---

## Handoff cho Node.js/Core

### backward-compatible changes (không cần sửa Node.js ngay)
- `QueryResponse.usage` vẫn giữ nguyên → Node.js contract hiện tại không bị phá vỡ.
- Callback payload schema không thay đổi.

### Node.js nên đọc thêm (có thể làm dần)
- `QueryResponse.usage_calls[]` — nếu có → lưu từng entry vào `llm_usage_logs` với `call_index`, `operation`, `status`.
- Fallback: nếu `usage_calls[]` rỗng, dùng `usage` như cũ.

Chi tiết: [internal-rag-contract.md](../api/internal-rag-contract.md), [python-rag-handoff.md](../architecture/python-rag-handoff.md).
