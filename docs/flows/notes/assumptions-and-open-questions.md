# Assumptions and open questions

Current status and external integration debt are maintained in the
[project handoff](../../../PROJECT_HANDOFF.md), [MVP gap matrix](../../status/mvp-gap-matrix.md)
and [issue register](../../status/issue-quality-register.md). Week 3/4 readiness files are historical.

Remaining product/infrastructure limitations:

1. Failed jobs have no durable scheduler or public manual retry endpoint.
2. LOCAL shared-volume storage is the only implemented adapter.
3. Python owns retrieval activation/deletion and Qdrant; NodeJS does not inspect Qdrant.
4. NodeJS does not calculate pricing when Python omits `estimated_cost`.
5. History is bounded by message count, not token budget.
6. Chat image/multimodal upload is not implemented; document upload is a separate workflow.
7. Student email currently has format-only validation. `@student.edu.vn` requires an owner/BA decision before server enforcement.
8. Node validates/persists locator boxes, but the Python snapshot does not emit them;
   frontend highlighting is page/sourceText fallback until Python geometry is verified.
9. Original-file endpoints stream attachments without byte Range. PDF uses original as preview; DOCX has asynchronous generated-PDF preview; TXT has no derived preview.

None requires a schema change for the current MVP.
