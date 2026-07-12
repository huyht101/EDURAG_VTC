# NodeJS/Core flow index

## Scope and conventions

These diagrams describe the intended Week 2 Part 2/3 NodeJS/Core behavior. They are design documents, not evidence that the APIs are implemented.

- Public client calls use a user JWT Bearer token.
- NodeJS/Python calls use the separate `RAG_INTERNAL_TOKEN` Bearer token.
- NodeJS owns MySQL transactions and business/history persistence.
- Python is a black-box RAG service and owns Qdrant interaction.
- `PROVISIONAL` marks public routes, DTOs, dispatch behavior, or NodeJS–Python payload details that are not implemented or locked.
- No Draw.io source or export is produced in this review.

## Review status

| Diagram | Domain | Audit classification | Current review status |
|---|---|---|---|
| [01 Document upload](mermaid/01_document_upload.mmd) | Document | REVISE | Ready with provisional storage/dispatch details |
| [02 Processing callback](mermaid/02_processing_callback.mmd) | Document | REVISE | Ready with provisional callback payload |
| [03 Document/job states](mermaid/03_document_job_states.mmd) | Document | REVISE | Schema states locked; service transitions provisional |
| [04 Document management](mermaid/04_document_management.mmd) | Document | REVISE | Public API not implemented |
| [05 Hide/unhide/delete](mermaid/05_hide_unhide_delete.mmd) | Document | REVISE | Orchestration contract provisional |
| [06 Chat RAG](mermaid/06_chat_rag.mmd) | Chat/RAG | REVISE | Public/internal contracts provisional |
| [07 Citation/source](mermaid/07_citation_source.mmd) | Chat/RAG | REPLACE | Rewritten around structured citation fragments |
| [08 Chat history](mermaid/08_chat_history.mmd) | Chat/RAG | KEEP | Normalized and marked provisional |
| [09 Usage/dashboard](mermaid/09_usage_dashboard.mmd) | Usage/Admin | KEEP | Schema-backed read flow; endpoint provisional |

No diagram is deferred: the schema and current architecture provide enough evidence for boundary-level flows, while unresolved API details are explicitly provisional.

## Notes

- [Document flow decisions](notes/document-flows.md)
- [Chat/RAG flow decisions](notes/chat-rag-flows.md)
- [Assumptions and open questions](notes/assumptions-and-open-questions.md)
