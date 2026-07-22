# Assumptions and open questions

Current release status and external deployment debt are maintained in:

[`docs/status/week3-integration-readiness.md`](../../status/week3-integration-readiness.md)

Remaining product/infrastructure limitations:

1. Failed jobs have no durable scheduler or public manual retry endpoint.
2. LOCAL shared-volume storage is the only implemented adapter.
3. Python owns retrieval activation/deletion and Qdrant; NodeJS does not inspect Qdrant.
4. NodeJS does not calculate pricing when Python omits `estimated_cost`.
5. History is bounded by message count, not token budget.
6. Chat image/multimodal upload is not implemented; document upload is a separate workflow.
7. Student email currently has format-only validation. `@student.edu.vn` requires an owner/BA decision before server enforcement.
8. Python does not emit locator boxes; frontend highlighting is text-search best effort.
9. Original-file endpoints stream attachments without byte Range or derived DOCX/TXT preview.

None requires a schema change for the current MVP.
