# Python RAG service

Runtime source nằm tại [`python-service/`](../../python-service/).

## Implemented

- FastAPI entry point `main.py::app`.
- `POST /api/ingest`, `POST /api/query`.
- `PATCH /api/docs/{doc_id}/visibility`.
- `DELETE /api/ingest/{doc_id}`.
- `GET /api/health`.
- PDF/DOCX/DOC/TXT parsing, local fallback và optional LlamaParse.
- Random UUID Qdrant point IDs.
- Qdrant payload `doc_id`, `subject_id`, page/heading, chunk index và `is_hidden`.
- Async `BackgroundTasks` ingest/visibility/delete and callback sender.
- Query history, citation snippet, confidence string và Gemini usage metadata.
- Python tests for route acceptance and Pydantic schemas.

## Current limitations

- `BackgroundTasks` không durable.
- Inbound routes chưa verify internal Bearer.
- Callback delivery retry ghi đè processing `attempt_count`.
- Ingest manifest chỉ có `text_preview`, thiếu full text/hash.
- Citation không có Qdrant point ID.
- Python Compose chưa mount shared Node upload volume.
- Runtime startup cố kết nối Qdrant; tests mock heavy dependencies.

Đây là compatibility/readiness assessment, không đánh giá retrieval quality, prompt quality hoặc model accuracy.

Contract canonical: [`docs/api/internal-rag-contract.md`](../api/internal-rag-contract.md).
