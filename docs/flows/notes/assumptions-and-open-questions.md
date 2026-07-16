# Remaining open questions after implementation

1. Python must preserve processing `attempt_count`; current callback delivery retry overwrites it.
2. Python must return complete chunk text/hash in the manifest, not only `text_preview`.
3. Python citations must include the Qdrant point ID as `vector_node_id`.
4. Python inbound routes must verify `RAG_INTERNAL_TOKEN`.
5. Visibility/delete request bodies, accepted responses and callback support need Python-team confirmation.
6. Optional `teacher_metadata.user_id/email/role` needs Python-team confirmation; it is non-authoritative.
7. Failed ingest/operation jobs have no durable scheduler or public manual retry endpoint.
8. LOCAL shared-volume storage is the only implemented adapter; production object-storage migration remains future work.
9. The Python service owns retrieval activation/deletion semantics; NodeJS does not inspect Qdrant.
10. `estimated_cost` is stored only when supplied by RAG. Pricing/version provenance is not calculated by NodeJS.
11. History-window size is bounded by `RAG_HISTORY_MESSAGE_LIMIT`; token-based trimming is not implemented.

No remaining item requires a schema change for the current MVP.
