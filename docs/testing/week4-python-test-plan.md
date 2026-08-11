# Week 4 Python RAG Test Plan

> **HISTORICAL — NOT CURRENT AUTHORITY.** Checklist này phản ánh snapshot Week 4 và có
> tên test/expected behavior đã cũ. Authority hiện hành là
> [Python/Data-RAG handoff](../architecture/python-rag-handoff.md); không chạy hoặc nâng
> trạng thái theo file này trong final report.

## Mục đích

Checklist kiểm thử đầy đủ cho Python RAG Service sau các thay đổi tuần 4.
Không cần Qdrant thật hay API key thật để chạy phần tự động.

---

## 1. Automated Tests (không cần provider thật)

### Setup

```bash
cd python-service
pip install -r requirements.txt
```

### Chạy tất cả

```bash
pytest tests/ -v
```

**Expected**: Tất cả PASS, không có warning về async mode.

### Chạy từng file

```bash
# RAG-001: Activation protocol + RAG-002: Deterministic ID
pytest tests/test_ingestion.py -v

# RAG-004: Multi-call usage + Citation quality
pytest tests/test_rag_engine.py -v

# Fail-closed contract
pytest tests/test_rag_contract_safety.py -v

# Qdrant collection init
pytest tests/test_database.py -v

# API endpoints
pytest tests/test_api.py -v

# Schemas
pytest tests/test_schemas.py -v
```

---

## 2. Kiểm tra Activation Protocol (RAG-001)

**Mục tiêu**: Đảm bảo vector KHÔNG retrieval-enabled trước khi Node ACK.

### Test tự động (đã có)

```bash
pytest tests/test_ingestion.py::test_ingest_upserts_with_is_hidden_true -v
pytest tests/test_ingestion.py::test_activate_called_after_ack_success -v
pytest tests/test_ingestion.py::test_cleanup_called_when_ack_fails -v
```

### Manual check (khi có Qdrant thật)

1. Chạy Qdrant local: `docker run -p 6333:6333 qdrant/qdrant`
2. Upload document qua Node.js API
3. Sau khi Python nhận ingest request, **trước khi** callback:
   - Query Qdrant: `GET /collections/education_docs/points/search` → phải trả 0 kết quả
4. Sau callback SUCCEEDED và Node ACK:
   - Query Qdrant → phải trả kết quả

**Expected**: Vector không xuất hiện trong search trước ACK.

---

## 3. Kiểm tra Deterministic ID + Retry (RAG-002)

### Test tự động (đã có)

```bash
pytest tests/test_ingestion.py::TestMakeChunkId -v
pytest tests/test_ingestion.py::test_ingest_payload_contains_attempt_key -v
pytest tests/test_ingestion.py::test_previous_attempt_cleaned_on_retry -v
```

### Manual check (khi có Qdrant thật)

1. Ingest document lần 1 (attempt_count=1)
   - Đếm points: `GET /collections/education_docs` → ghi nhận count
2. Simulate failure: ingest lại cùng job với attempt_count=1
   - Đếm points → phải BẰNG count ban đầu (không tăng)
3. Retry với attempt_count=2
   - Đếm points → phải BẰNG count của attempt_count=2 (attempt 1 đã được cleanup)

**Expected**: Point count không tăng dần qua các retry.

---

## 4. Kiểm tra Multi-call Usage (RAG-004)

### Test tự động (đã có)

```bash
pytest tests/test_rag_engine.py::test_process_query_chit_chat_has_two_usage_calls -v
pytest tests/test_rag_engine.py::test_process_query_rag_with_citation_returns_answer -v
pytest tests/test_rag_engine.py::test_process_query_rag_below_threshold_returns_no_answer_with_router_usage -v
```

### Manual check (khi có provider thật)

Gửi request đến Node.js `/api/chat/sessions/{id}/messages`:
```json
{"content": "Câu hỏi về tài liệu?"}
```

Kiểm tra Node.js response → `assistantMessage.usage` có token counts.
Kiểm tra MySQL `llm_usage_logs` → phải có ≥2 rows (router + answer).

**Expected**: Mỗi LLM call → 1 row trong `llm_usage_logs`.

---

## 5. Kiểm tra Hide / Unhide / Delete

### Test tự động

```bash
pytest tests/test_api.py::test_hide_document_accepted -v
pytest tests/test_api.py::test_delete_document_accepted -v
```

### Manual check (khi có Qdrant thật)

1. Ingest document → READY
2. Gọi Node.js `PUT /api/documents/{id}` (hide)
   - Kiểm tra Qdrant: points có `is_hidden=True`
   - Query RAG → không trả kết quả từ doc này
3. Unhide → `is_hidden=False` → Query RAG trả kết quả lại
4. Delete → points xóa khỏi Qdrant → Query không trả kết quả

---

## 6. Kiểm tra Chat RAG — Citation Safety

### Test tự động

```bash
pytest tests/test_rag_contract_safety.py -v
pytest tests/test_rag_engine.py::test_process_query_rag_with_citation_returns_answer -v
```

### Manual check

Gửi câu hỏi không liên quan đến tài liệu:
- `no_answer=True`, `citations=[]`

Gửi câu hỏi có trong tài liệu:
- `no_answer=False`, `citations` có ≥1 entry
- Mỗi citation có `vector_node_id`, `doc_id`, `snippet`, `page_number`

---

## 7. Kiểm tra Parser (TXT, DOCX, PDF)

### Manual check với file thật

```python
# python-service/test_real.py hoặc python-service/test_search.py
import asyncio
from services.parser import parse_document

async def test():
    # Test TXT
    pages = await parse_document("/path/to/test.txt")
    print(f"TXT: {len(pages)} pages")

    # Test PDF
    pages = await parse_document("/path/to/test.pdf")
    print(f"PDF: {len(pages)} pages")

asyncio.run(test())
```

**Expected**:
- TXT: ít nhất 1 page với nội dung đúng
- PDF: page_number 1-based, chapter/section nếu có heading
- DOCX: synthetic page_number từ 3000-char segments

---

## 8. Cleanup và Evidence

Sau khi test xong:
- Không commit `.env` hoặc credential
- Ghi lại kết quả theo format: `[TEST_NAME] PASS/FAIL | counts | notes`
- Báo branch/commit hiện tại

```bash
git status --short  # phải không có .env hay credential
git log --oneline -5
```
