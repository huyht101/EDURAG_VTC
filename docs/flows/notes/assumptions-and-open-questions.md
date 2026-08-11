# Assumptions and open questions

Current status and external integration debt are maintained in the
[project handoff](../../../PROJECT_HANDOFF.md), [MVP gap matrix](../../status/mvp-gap-matrix.md)
and [issue register](../../status/issue-quality-register.md). Week 3/4 readiness files are historical.

Remaining product/infrastructure limitations:

1. Failed jobs have no durable scheduler or public manual retry endpoint. Whether a
   durable mechanism is required, and who owns bounded recovery/reconciliation before
   operational acceptance, remain unresolved rather than automatically OPTIONAL/LATER.
2. LOCAL shared-volume storage is the only implemented adapter.
3. Python owns retrieval activation/deletion and Qdrant; NodeJS does not inspect Qdrant.
4. NodeJS does not calculate pricing when Python omits `estimated_cost`.
5. History is bounded by message count, not token budget.
6. Chat image/multimodal upload is not implemented; document upload is a separate workflow.
7. Student email currently has format-only validation. `@student.edu.vn` requires an owner/BA decision before server enforcement.
8. The bounded 2026-08-11 LlamaParse probe returned all four fixture pages consistently,
   including a blank sentinel and image-only OCR, but exposed no explicit page identity.
   Status is **FIXTURE DID NOT REPRODUCE — RESIDUAL RISK DOCUMENTED**: general sparse or
   omitted-output alignment remains unverified. Node validates/persists locator boxes,
   but Python does not emit them; nullable geometry does not resolve uncertain page
   alignment. Precise highlighting remains OPTIONAL/LATER.
9. Original-file endpoints stream attachments without byte Range. PDF uses original as preview; DOCX has asynchronous generated-PDF preview; TXT has no derived preview.

The [project handoff](../../../PROJECT_HANDOFF.md) separately records stale hide/unhide
ordering and corpus/GCS review scope. This note does not select a schema/wire change,
recovery owner, durable queue policy, page convention or corpus completion state.
