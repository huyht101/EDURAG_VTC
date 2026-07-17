# Python RAG integration snapshot

## Ownership và provenance

Team Python/Data-RAG sở hữu production source trong upstream repository riêng. [`python-service/`](../../python-service/) là tracked integration snapshot để Node team audit contract/debug; snapshot có thể stale hoặc bị overwrite khi refresh.

| Metadata | Current value |
|---|---|
| Upstream repository | <https://github.com/manh2905/RAG_service> |
| Branch/tag | `Unknown` |
| Upstream commit | `Unknown` |
| Snapshot refreshed/audited | `2026-07-17` |
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

Khả năng trên đã được contract tests và isolated remote E2E kiểm chứng cho snapshot hiện tại. Python upstream mới hơn vẫn phải được audit lại.

## Integration overlays cần upstream

- Explicit `INTERNAL_SECRET`, constant-time Bearer verification và auth/schema tests.
- `llama-index-llms-google-genai` và `llama-index-embeddings-google-genai` requirements alignment.
- `embedding_config.output_dimensionality=768` cho `gemini-embedding-001`.
- Safe standalone environment template.

## Limitations

- FastAPI `BackgroundTasks` không phải durable queue.
- Python snapshot Compose là standalone; root `docker-compose.remote.yml` mới là integration topology đã verify.
- Qdrant client `1.14.2` cảnh báo với server `1.18.2`; live integration PASS nhưng version support cần được team Python chốt.
- Node team không sở hữu retrieval quality, prompt/model tuning hoặc Python release.

Sau mỗi import, cập nhật metadata/capability tại file này và làm theo [snapshot refresh guide](../setup/python-snapshot-refresh.md). Current gate nằm tại [Week 3 readiness](../status/week3-integration-readiness.md).
