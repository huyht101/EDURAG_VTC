# Assumptions and open questions

Only decisions that can materially affect implementation contracts are listed here.

## Document

1. **Storage adapter:** schema supports `LOCAL` and `OBJECT`; current env/Compose reserve local uploads, but upload/storage code does not exist. Confirm the first implementation remains LOCAL behind an adapter.
2. **Dispatch durability:** no worker, broker, polling loop or retry scheduler exists. Define how a QUEUED/FAILED job is redispatched after a transient Python outage or NodeJS restart.
3. **Dispatch failure response:** return 202 only if a durable retry mechanism exists; otherwise return 503 while retaining inspectable job state.
4. **Internal endpoints and event envelope:** lock endpoint names, event discriminator, batch identity, attemptCount representation, and terminal proof that retrieval activation completed.
5. **Reprocess trigger:** decide whether MVP exposes manual reprocess publicly or only as an Admin/operational action. Schema cannot support parallel generations.
6. **Source-file policy:** citation snapshot is always historical; confirm whether a session owner may open a current READY+VISIBLE original file, while HIDDEN/DELETED originals remain uploader/Admin-only or unavailable.

## Chat/RAG

7. **Public API names and pagination:** session/message/citation/dashboard routes, cursor shape and limits are not implemented.
8. **History window:** define maximum messages/tokens and whether system-generated session titles are in scope.
9. **Query contract:** lock request/response DTOs for requestId, history roles, no-answer, structured fragments and optional usage calls.
10. **Retry policy:** define whether NodeJS automatically retries a timed-out query or requires the client to repeat the same `clientRequestId`.
11. **Usage cost provenance:** define which component calculates `estimated_cost`, pricing version rules, and behavior when cost is unknown.

None of these questions requires a database change before Mermaid review. They must be resolved before publishing the related API/internal contract as final.
