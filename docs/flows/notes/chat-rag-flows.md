# Chat/RAG flow decisions

## Evidence level

Chat, citation, usage and dashboard runtime modules are missing. The diagrams describe a schema-backed target boundary and mark route/DTO/payload details as `PROVISIONAL`.

## Locked decisions reflected in diagrams

- MySQL/NodeJS is the durable source for sessions, message ordering, citations and usage.
- `client_request_id` belongs only to the USER message and provides request idempotency.
- NodeJS allocates `message_order` under a session lock and may create an ASSISTANT `PENDING` placeholder.
- NodeJS does not keep a transaction open while querying Python.
- Python receives only a bounded history window for the current request; it does not own durable chat memory.
- Assistant completion, citation snapshots, returned usage rows and `last_message_at` are persisted atomically.
- Citations come from structured source fragments, not bracket parsing. Multiple fragments may refer to one parent chunk.
- Citation snapshot fields remain readable after document/chunk references become null.
- One assistant message may have multiple `llm_usage_logs` rows identified by `request_id` and `call_index`.
- Dashboard usage is explicitly `LLM_CALLS_ONLY`; retrieval/rerank scores remain citation metadata.

## Failure behavior

Transport failure marks the assistant message `FAILED`. A failed usage row is stored only when Python returned enough structured provider/model/operation metadata to satisfy the schema. Retrying the same `clientRequestId` returns the stored state instead of creating duplicate USER messages.
