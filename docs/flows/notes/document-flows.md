# Document flow decisions

## Evidence level

Document routes, controllers, services, repositories, validators, upload storage and callback endpoints do not exist yet. The diagrams are based on schema 1.0.0, the implemented JWT/internal-Bearer/transaction foundations, and the reviewed reference flow.

## Locked decisions reflected in diagrams

- Only TEACHER owners and ADMIN manage documents; STUDENT uses citation/source access.
- NodeJS writes `documents`, `document_processing_jobs` and `document_chunks`; Python never writes MySQL.
- NodeJS calls Python only after committing MySQL work and never holds a transaction during the call.
- `document_processing_jobs.attempt_count` guards stale callbacks; exact repeated callbacks are idempotent.
- The service layer must enforce at most one active INGEST or REPROCESS job per document under a row lock.
- `document_chunks.vector_node_id` is the mapping to the Python node/Qdrant point.
- Document `READY` requires a persisted manifest and `processed_at`.
- Hiding disables retrieval but retains vectors; delete deactivates retrieval, removes vectors, then soft-deletes MySQL metadata while retaining file/history.
- Public responses never expose `storage_key`.

## Reprocess limitation from schema

Schema 1.0.0 has one unique `(document_id, chunk_index)` and no generation/version table. Therefore the diagrams do not claim zero-downtime reprocess or parallel active generations. Reprocess must first fail closed by disabling retrieval, then replace old chunks. If it fails, citation snapshots remain readable even when old `chunk_id` references become null.

## Implementation status

All Document API operations and NodeJS–Python document payloads remain `PROVISIONAL`. No Redis, BullMQ, broker, or hidden dispatcher is assumed.
