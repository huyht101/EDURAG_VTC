# Bản đồ luồng nghiệp vụ

Các sơ đồ mô tả behavior NodeJS/Core hiện hành và ranh giới tích hợp. Exact field,
endpoint, status và constraint vẫn phải đối chiếu OpenAPI, schema và internal contract.

Quy ước chung:

- Public client dùng user JWT; Node–Python dùng internal Bearer riêng.
- Node sở hữu MySQL transaction và business/history state; Python sở hữu Qdrant.
- `RAG_MODE=mock` chỉ dành cho regression; integration path dùng `RAG_MODE=remote`.
- Historical isolated run không thay current full-stack verification.

| Sơ đồ | Nội dung | Trạng thái diễn giải |
|---|---|---|
| [01](mermaid/01_document_upload.mmd) | Upload, preview và ingest dispatch | Implemented ở Node boundary |
| [02](mermaid/02_processing_callback.mmd) | Complete manifest, transaction và machine ACK | Implemented ở Node boundary |
| [03](mermaid/03_document_job_states.mmd) | Document/job lifecycle | Implemented; recovery tự động ngoài scope |
| [04](mermaid/04_document_management.mmd) | Management và Library ownership | Implemented ở Node boundary |
| [05](mermaid/05_hide_unhide_delete.mmd) | Hide/unhide/delete | Implemented; stale ordering còn unresolved |
| [06](mermaid/06_chat_rag.mmd) | Chat, RAG, citation và usage | Contract/local tested; current live E2E unverified |
| [07](mermaid/07_citation_source.mmd) | Citation snapshot và source viewer | Implemented; page identity còn residual risk |
| [08](mermaid/08_chat_history.mmd) | Session/history | Implemented ở Node boundary |
| [09](mermaid/09_usage_dashboard.mmd) | Usage/Admin dashboard | Implemented, scope `LLM_CALLS_ONLY` |
| [10](mermaid/10_corpus_publish.mmd) | Immutable corpus publish | Tooling implemented; current remote state unverified |

Business explanation canonical nằm tại [module docs](../modules/), trạng thái/gap tại
[project handoff](../../PROJECT_HANDOFF.md), không lặp lại bằng flow notes riêng.
