# Chat/RAG flow implementation notes

- Chat session CRUD, offset-limit history, soft delete and ownership checks are implemented.
- A session row lock allocates stable `message_order`; `client_request_id` prevents duplicate USER messages.
- USER and ASSISTANT PENDING rows commit before the RAG network call.
- Mock and remote RAG clients return the same normalized answer/source/usage structure. Remote HTTP uses `POST /api/query`, snake_case and lowercase history roles.
- Python receives only the bounded current history window; MySQL remains durable history.
- Assistant completion, verified citation fragments, usage rows and `last_message_at` persist in one transaction.
- Citation fragments resolve through `document_chunks.vector_node_id`; bracket markers are never parsed.
- Remote citations without `vector_node_id` are rejected; the current snapshot lacks that ID and the fix must be upstreamed by the Python team.
- Citation snapshot access survives document hide/delete. Original file access follows current authorization/state.
- Multiple usage calls per assistant message are supported. Dashboard scope is `LLM_CALLS_ONLY`.

Realtime delivery, automatic query retry, pricing calculation and Python/Qdrant internals remain outside MVP.
