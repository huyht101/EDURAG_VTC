# Chat/RAG flow implementation notes

- Chat session CRUD, offset-limit history, soft delete and ownership checks are implemented.
- A session row lock allocates stable `message_order`; optional `clientRequestId` is generated server-side when blank/omitted, while a supplied UUID prevents duplicate USER messages.
- USER and ASSISTANT PENDING rows commit before the RAG network call.
- Mock and remote RAG clients return the same normalized answer/source/usage structure. Remote HTTP uses `POST /api/query`, snake_case and lowercase history roles.
- Python receives only the bounded current history window; MySQL remains durable history.
- Assistant completion, verified citation fragments, usage rows and `last_message_at` persist in one transaction.
- A normal answer (`no_answer=false`) requires at least one verified structured citation; missing/unverifiable sources fail the assistant instead of persisting an unsourced completion.
- Citation fragments resolve through `document_chunks.vector_node_id`; NodeJS never parses bracket markers.
- Remote citations without `vector_node_id` are rejected. The current snapshot now returns the Qdrant point ID in that field.
- Citation snapshot access survives document hide/delete, but only the session owner may read it; ADMIN has no public bypass. Original file access then follows current authorization/state.
- Multiple usage calls per assistant message are supported. Dashboard scope is `LLM_CALLS_ONLY`.

Realtime delivery, automatic query retry, pricing calculation and Python/Qdrant internals remain outside MVP.
