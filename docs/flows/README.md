# NodeJS/Core flow index

## Scope and conventions

These diagrams describe the implemented NodeJS/Core MVP behavior and its remaining external boundaries.

- Public client calls use a user JWT Bearer token.
- NodeJS/Python calls use the separate `RAG_INTERNAL_TOKEN` Bearer token.
- NodeJS owns MySQL transactions and business/history persistence.
- Python is a black-box RAG service and owns Qdrant interaction.
- Remote contract v0.1 is implemented at the NodeJS boundary; isolated live ingest/chat/document-operation E2E passed on 2026-07-17.
- Mock stack uses `RAG_MODE=mock`; the integrated stack uses `RAG_MODE=remote`.

## Review status

| Diagram | Domain | Current review status |
|---|---|---|
| [01 Document upload](mermaid/01_document_upload.mmd) | Document | MVP implemented |
| [02 Processing callback](mermaid/02_processing_callback.mmd) | Document | Complete-manifest callback implemented |
| [03 Document/job states](mermaid/03_document_job_states.mmd) | Document | MVP transitions implemented |
| [04 Document management](mermaid/04_document_management.mmd) | Document | MVP implemented |
| [05 Hide/unhide/delete](mermaid/05_hide_unhide_delete.mmd) | Document | MVP implemented |
| [06 Chat RAG](mermaid/06_chat_rag.mmd) | Chat/RAG | Mock/remote adapter implemented |
| [07 Citation/source](mermaid/07_citation_source.mmd) | Chat/RAG | MVP implemented |
| [08 Chat history](mermaid/08_chat_history.mmd) | Chat/RAG | MVP implemented |
| [09 Usage/dashboard](mermaid/09_usage_dashboard.mmd) | Usage/Admin | Basic summary implemented |
| [10 Corpus publish](mermaid/10_corpus_publish.mmd) | Host-side Corpus tooling | Immutable publish and pointer-last guards implemented; signal-time staging cleanup limitation shown |

No diagram is deferred. Current limitations are recorded in the open-questions note; release evidence stays in the readiness document.

## Notes

- [Document flow decisions](notes/document-flows.md)
- [Chat/RAG flow decisions](notes/chat-rag-flows.md)
- [Assumptions and open questions](notes/assumptions-and-open-questions.md)
