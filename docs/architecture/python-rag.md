# Python RAG integration snapshot

Team Python/Data-RAG duy trì source of truth trong repository upstream riêng. URL và metadata của lần import hiện tại được ghi tại [Python snapshot provenance](../status/python-snapshot-source.md).

[`python-service/`](../../python-service/) là tracked snapshot được refresh định kỳ để NodeJS team audit compatibility, chạy checks và hỗ trợ integration/debug. Snapshot có thể chậm hơn upstream và mọi local patch có thể bị overwrite ở lần refresh sau.

Snapshot-local README/API docs phản ánh upstream tại thời điểm import nhưng không phải canonical contract của project này. Contract phía Node được duy trì tại [`docs/api/internal-rag-contract.md`](../api/internal-rag-contract.md).

## Observed in the current snapshot

- FastAPI entry point `main.py::app`.
- `POST /api/ingest`, `POST /api/query`.
- `PATCH /api/docs/{doc_id}/visibility`.
- `DELETE /api/ingest/{doc_id}`.
- `GET /api/health`.
- PDF/DOCX/DOC/TXT parsing, local fallback và optional LlamaParse.
- Random UUID Qdrant point IDs.
- Qdrant payload `doc_id`, `subject_id`, page/heading, chunk index và `is_hidden`.
- Async `BackgroundTasks` ingest/visibility/delete and callback sender.
- Processing-attempt propagation, full-text/hash manifest and UUID Qdrant point IDs.
- Query history/correlation fields, citation point ID, snippet, confidence string và Gemini usage metadata.
- Internal Bearer dependency for all business routes; health remains public.
- Python tests for route acceptance and Pydantic schemas.

## Observed limitations

- `BackgroundTasks` không durable.
- Service Compose chưa mount shared Node upload volume.
- Current tracked Python tests have not been updated for required Bearer/`attempt_count`.
- `INTERNAL_SECRET` still has a weak fallback and inbound comparison is not constant-time.
- Exact upstream commit for the uncommitted refresh is unknown.
- Python dependency/environment packaging for the current `google_genai` imports remains to be verified.

Các mismatch cần được chuyển/upstream cho team Python. NodeJS team không sở hữu retrieval quality, prompt/model tuning hoặc Python production releases.

Refresh process: [`docs/setup/python-snapshot-refresh.md`](../setup/python-snapshot-refresh.md).
