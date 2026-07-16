# NodeJS/Core flow index

## Scope and conventions

These diagrams describe the implemented NodeJS/Core MVP behavior and its remaining external boundaries.

- Public client calls use a user JWT Bearer token.
- NodeJS/Python calls use the separate `RAG_INTERNAL_TOKEN` Bearer token.
- NodeJS owns MySQL transactions and business/history persistence.
- Python is a black-box RAG service and owns Qdrant interaction.
- Remote contract v0.1 is implemented and tested at the NodeJS HTTP boundary; required upstream Python changes and remote E2E are still outstanding.
- Docker demo uses RAG mock mode by default; remote mode is optional.
- No Draw.io source or export is produced in this review.

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

No diagram is deferred. Remaining limitations are recorded in the open-questions note.

## Notes

- [Document flow decisions](notes/document-flows.md)
- [Chat/RAG flow decisions](notes/chat-rag-flows.md)
- [Assumptions and open questions](notes/assumptions-and-open-questions.md)
