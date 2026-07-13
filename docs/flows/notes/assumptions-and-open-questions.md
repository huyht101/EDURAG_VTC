# Remaining open questions after implementation

1. Python team must confirm compatibility with the remote paths and normalized request/response fields documented in [`docs/api/internal-rag-contract.md`](../../api/internal-rag-contract.md).
2. Failed ingest/operation jobs have no durable scheduler or public manual retry endpoint in Week 2 Part 2.
3. LOCAL storage is the only implemented adapter; production object-storage migration remains future work.
4. The Python service owns retrieval activation/deletion semantics behind its terminal callback; NodeJS does not inspect Qdrant.
5. `estimated_cost` is stored only when supplied by RAG. Pricing/version provenance is not calculated by NodeJS.
6. History-window size is bounded by `RAG_HISTORY_MESSAGE_LIMIT`; token-based trimming is not implemented.

No remaining item requires a schema change for the current MVP.
