# Assumptions and open questions

Contract blockers and Phase 2 release gates are maintained in:

[`docs/status/week3-integration-readiness.md`](../../status/week3-integration-readiness.md)

Remaining product/infrastructure limitations:

1. Failed jobs have no durable scheduler or public manual retry endpoint.
2. LOCAL shared-volume storage is the only implemented adapter.
3. Python owns retrieval activation/deletion and Qdrant; NodeJS does not inspect Qdrant.
4. NodeJS does not calculate pricing when Python omits `estimated_cost`.
5. History is bounded by message count, not token budget.

None requires a schema change for the current MVP.
