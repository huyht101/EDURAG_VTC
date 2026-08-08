# Python RAG Service

FastAPI microservice xử lý Retrieval-Augmented Generation cho hệ thống EDURAG.

> **Lưu ý quan trọng**: Đây là integration snapshot từ repository riêng của team Python/Data-RAG. Không sửa đổi nếu không được yêu cầu; thay đổi cần được upstream về Python repository.

---

## Kiến trúc

```
Node.js (Core)  ──POST /api/ingest──►  Python RAG Service
                ◄──callback────────     ├── Parse (PDF/DOCX/TXT + LlamaParse)
                                        ├── Chunk (SentenceSplitter)
                ──POST /api/query──►    ├── Embed (Gemini Embedding)
                ◄──QueryResponse───     ├── Qdrant (vector store)
                                        └── LLM (Gemini — router + answer)
```

**Phân chia trách nhiệm:**
- Python sở hữu: parsing, embedding, retrieval (Qdrant), generation
- Node.js sở hữu: auth, document lifecycle, chat session, MySQL, citations

---

## Cài đặt và chạy

### Yêu cầu
- Python 3.11+
- Qdrant đang chạy (local Docker hoặc Qdrant Cloud)
- Google API Key (Gemini)
- LlamaParse API Key (chỉ bắt buộc khi `OCR_MODE=AUTO`)

### Cài đặt dependencies

```bash
cd python-service
pip install -r requirements.txt
```

### Cấu hình

```bash
cp .env.example .env
# Điền GOOGLE_API_KEY và INTERNAL_SECRET.
# OCR_MODE mặc định OFF; khi đặt AUTO phải điền LLAMA_CLOUD_API_KEY.
```

### Chạy standalone (dev)

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Chạy qua Docker Compose (integrated stack)

```bash
# Từ root project:
npm run docker:remote:dev
```

---

## API Endpoints

| Method | Path | Auth | Mô tả |
|--------|------|------|-------|
| `GET` | `/api/health` | Public | Health check và OCR mode đã resolve |
| `POST` | `/api/ingest` | Internal Bearer | Nạp tài liệu (async, 202) |
| `POST` | `/api/query` | Internal Bearer | Chat/Query RAG (sync, 200) |
| `PATCH` | `/api/docs/{doc_id}/visibility` | Internal Bearer | Hide/Unhide |
| `DELETE` | `/api/ingest/{doc_id}` | Internal Bearer | Xóa vectors |

Swagger UI: `http://localhost:8000/docs`

---

## Luồng Ingest (Tuần 4 — RAG-001 + RAG-002)

```
Node.js gửi POST /api/ingest
  → Python trả 202 ngay
  → Background task:
      1. Parse file; PDF AUTO chỉ OCR trang ảnh/scan thiếu native text
      2. Chunk (SentenceSplitter)
      3. Embed (Gemini Embedding)
      4. Upsert Qdrant với is_active=False (fail-closed — CHƯA retrieval)
      5. Callback SUCCEEDED → chờ Node.js ACK
      6a. ACK OK  → set is_active=True (kích hoạt retrieval)
      6b. ACK FAIL → xóa toàn bộ points attempt này
```

**Deterministic Point ID (RAG-002):**
- chunk_id = deterministic UUID từ `(doc_id, job_id, attempt_count, chunk_index)`
- Retry cùng attempt → upsert overwrite, không tạo duplicate points
- Attempt mới → ID khác; không tự xóa attempt khác trong ingest hiện tại

---

## Luồng Query (Tuần 4 — RAG-004)

```
Node.js gửi POST /api/query
  → Router LLM phân loại: CHIT_CHAT | RAG_REQUIRED  [usage_calls[0]]
  → CHIT_CHAT: LLM trả lời giao tiếp, no_answer=True  [usage_calls[1]]
  → RAG_REQUIRED:
      1. Embed câu hỏi
      2. Search Qdrant (filter is_active=True và is_hidden=False — chỉ READY+VISIBLE)
      3. Không chunk nào vượt threshold → no_answer=True
      4. LLM sinh answer với citations [N]              [usage_calls[1]]
      5. Extract citations từ [1],[2],...
      6. Không có citation hợp lệ → fail-closed → no_answer=True
  → Trả QueryResponse với usage_calls[] đầy đủ
```

**Response invariants:**
- `no_answer=False` → `citations` không rỗng (≥1 structured citation)
- `no_answer=True` → `citations=[]`
- `usage_calls[]` → tất cả LLM calls (router + answer) đều có entry
- `usage` → legacy aggregate (backward-compatible với Node.js)

---

## Chạy Tests

```bash
cd python-service

# Tất cả tests (không cần Qdrant/API key thật)
pytest tests/ -v

# Tests cụ thể
pytest tests/test_ingestion.py -v    # RAG-001, RAG-002
pytest tests/test_rag_engine.py -v  # RAG-004, citations, no_answer
pytest tests/test_database.py -v    # Qdrant collection init
pytest tests/test_qdrant_lifecycle.py -v  # active/hidden/exact-attempt lifecycle
pytest tests/test_parser_ocr.py -v  # OCR OFF/AUTO, digital/scanned/mixed (mocked provider)
pytest tests/test_evaluator_safety.py -v  # disposable-target guard
pytest tests/test_api.py -v         # API endpoints mock
pytest tests/test_schemas.py -v     # Pydantic schemas
pytest tests/test_rag_contract_safety.py -v  # Contract safety
```

Sau Node machine ACK hợp lệ, activation được retry có giới hạn bằng
`ACTIVATION_MAX_ATTEMPTS` và `ACTIVATION_RETRY_DELAY_SECONDS`. Nếu vẫn lỗi, log
`RAG_ACTIVATION_FAILED` chứa exact document/job/attempt và ingest gửi compensation
`ACTIVATION_FAILED`; không activate attempt khác.

Kiểm tra/recover thủ công chỉ dành cho operator đã xác minh exact Node attempt đang
`READY`:

```bash
python scripts/recover_attempt.py --document-id <id> --job-id <id> --attempt-count <n> --expected-node-status READY
python scripts/recover_attempt.py --document-id <id> --job-id <id> --attempt-count <n> --expected-node-status READY --recover --confirm-ready-exact-attempt
```

Tool từ chối recovery nếu có point của attempt khác, exact attempt thiếu point hoặc
Node status không được operator xác nhận; chạy lại recovery exact attempt là idempotent.

---

## Open Issues (để upstream Python repository)

| ID | Vấn đề | Mức độ |
|----|---------|--------|
| RAG-001 | ✅ Fixed: Activation protocol (is_active=False trước ACK) | DONE |
| RAG-002 | ✅ Fixed: Deterministic point ID + orphan cleanup | DONE |
| RAG-004 | ✅ Fixed: usage_calls[] multi-call tracking | DONE |
| Durable queue | FastAPI BackgroundTasks không survive restart | LATER |
| Dependency lock | requirements.txt chưa có hash lock | TODO |

---

## Handoff với Node.js/Core

- Internal contract: xem [`docs/api/internal-rag-contract.md`](../docs/api/internal-rag-contract.md)
- Python handoff items: xem [`docs/architecture/python-rag-handoff.md`](../docs/architecture/python-rag-handoff.md)
- Week 4 status: xem [`docs/status/week4-integration-readiness.md`](../docs/status/week4-integration-readiness.md)

**Backward compatibility:**
- `QueryResponse.usage` vẫn giữ (legacy field)
- `QueryResponse.usage_calls[]` mới — Node.js nên đọc nếu có, fallback về `usage` nếu không
- Callback payload không thay đổi schema
