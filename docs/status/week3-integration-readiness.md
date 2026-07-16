# Week 3 integration readiness

Baseline Node commit: `c66bf056d0bea40542c2a3ce558e7ea641523c4d`.

Remote end-to-end chưa chạy. Tài liệu này là release gate cho Phase 2, không phải tuyên bố production readiness.

## Implemented in NodeJS

- Mock/remote RAG adapter, internal Bearer header và split timeouts.
- Exact Python paths/methods, snake_case serializer.
- Safe shared upload path.
- `action=hide|unhide`; empty `teacher_metadata`.
- `chunks` và `chunk_manifest` callback aliases với conflict rejection.
- Full text/hash/UUID validation, stale/duplicate callback handling.
- Structured citation/usage normalization.
- Contract fixtures/tests and Part 2 regression.

## Implemented in Python

- FastAPI ingest/query/visibility/delete/health routes.
- File parsing and Qdrant ingest.
- Random UUID point IDs.
- Visibility/delete background operations.
- Callback sender with Bearer.
- Query history, confidence string, citation snippets and usage.

## Compatible now

- HTTP paths/methods.
- Accepted responses and custom error format.
- Shared `doc_id`, `job_id`, callback URL.
- Visibility `action`.
- Query question/conversation/history.
- Citation `snippet` alias and usage fields.

## Required Python changes

1. Accept and preserve processing `attempt_count`; do not replace it with callback delivery retry.
2. Return complete `chunk_manifest` with full `chunk_text` and matching SHA-256 `content_hash`.
3. Return citation `vector_node_id` equal to the Qdrant point ID.
4. Verify internal Bearer on every inbound NodeJS → Python route.

## Deployment gates

- Configure the same 32+ character value for Node `RAG_INTERNAL_TOKEN` and Python `INTERNAL_SECRET`.
- Choose host/container topology and set reachable service/callback URLs.
- Mount the same upload volume; Python access is read-only.
- Use one Python-owned Qdrant.
- Do not pass a Windows host path between containers.

## Definition of Ready for Phase 2

- Four Python changes implemented with tests.
- Python contract tests pass against handoff fixtures.
- Node contract and Part 2 regression pass.
- Shared-volume path verified in selected topology.
- Inbound/outbound Bearer verified.
- One controlled remote ingest, visibility, delete and query smoke plan approved.
