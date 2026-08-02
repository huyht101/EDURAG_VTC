# Python RAG integration snapshot

## Ownership và provenance

Team Python/Data-RAG sở hữu production source trong upstream repository riêng. [`python-service/`](../../python-service/) là tracked integration snapshot để Node team audit contract/debug; snapshot có thể stale hoặc bị overwrite khi refresh.

| Metadata | Current value |
|---|---|
| Upstream repository | <https://github.com/manh2905/RAG_service> |
| Branch/tag | `Unknown` |
| Upstream commit | `Unknown` |
| Snapshot refreshed | `2026-07-21` (metadata upstream chính xác chưa có) |
| Snapshot audited from Node repository | `2026-08-02` (static/offline scope) |
| Import source | Source copy; exact upstream export metadata chưa được ghi |
| Local Python runtime patch status | Có integration overlays cần upstream, liệt kê bên dưới |

Snapshot-local README/docs là upstream evidence tại thời điểm import, không phải canonical NodeJS-Python contract. Contract duy nhất phía Node: [internal RAG contract](../api/internal-rag-contract.md).

## Observed capability

- FastAPI `main.py::app`.
- `POST /api/ingest`, `POST /api/query`.
- `PATCH /api/docs/{doc_id}/visibility`, `DELETE /api/ingest/{doc_id}`.
- Public `GET /api/health`; business routes dùng internal Bearer.
- Shared-file ingest, background processing và authenticated callback.
- Complete chunk manifest gồm UUID point ID, full text và SHA-256 hash.
- Qdrant point ID được trả làm citation `vector_node_id`.
- Query nhận bounded history/correlation fields và trả answer/no-answer/citations/usage.

Khả năng trên được quan sát trong code và offline contract tests. Một isolated remote run
ngày 2026-07-17 là bằng chứng lịch sử cho snapshot/baseline lúc đó; nó không xác nhận các
thay đổi canonical-DOCX, locator, OCR hoặc citation parser về sau. Python upstream mới
hơn vẫn phải được audit và chạy acceptance lại.

## Integration overlays cần upstream

- Explicit `INTERNAL_SECRET`, constant-time Bearer verification và auth/schema tests.
- `llama-index-llms-google-genai` và `llama-index-embeddings-google-genai` requirements alignment.
- `embedding_config.output_dimensionality=768` cho `gemini-embedding-001`.
- Idempotent Qdrant collection initialization with exact vector-schema validation and bounded concurrent-create postcondition retry.
- Pin `qdrant-client==1.17.1` for the repository's Qdrant server `1.18.2`.
- Fail closed trước Qdrant upsert khi embedding count khác chunk count.
- Grounding guard: CHIT_CHAT và RAG output không có valid structured citation trả `no_answer=true`.
- Safe standalone environment template.

## Limitations

- FastAPI `BackgroundTasks` không phải durable queue.
- Python snapshot Compose là standalone; root `docker-compose.remote.yml` mới là integration topology đã verify.
- Qdrant client `1.17.1` và server `1.18.2` đã được kiểm chứng không còn compatibility warning. Pin này phải được upstream cùng collection race fix.
- Node team không sở hữu retrieval quality, prompt/model tuning hoặc Python release.

Sau mỗi import, cập nhật metadata/capability tại file này và làm theo
[snapshot refresh guide](../setup/python-snapshot-refresh.md). Action/gate hiện hành nằm
tại [Python/Data-RAG handoff](python-rag-handoff.md) và
[project handoff](../../PROJECT_HANDOFF.md); Week 3 readiness chỉ là historical evidence.
