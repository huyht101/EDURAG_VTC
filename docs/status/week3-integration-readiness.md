# Week 3 integration readiness

Baseline Node commit: `c66bf056d0bea40542c2a3ce558e7ea641523c4d`.
Python audit baseline: repository HEAD `65e089a8a8e63505f9cf56d8fa972fdcc189a17d` plus the uncommitted `python-service/` refresh dated `2026-07-17`.

Remote end-to-end chưa chạy. Tài liệu này là release gate cho Phase 2, không phải tuyên bố production readiness.

Python source of truth nằm ở repository upstream của team Python. Kết luận Python bên dưới chỉ dựa trên tracked `python-service/` snapshot hiện tại; snapshot chưa ghi exact upstream commit nên có thể không đại diện bản mới nhất.

## Implemented in NodeJS

- Mock/remote RAG adapter, internal Bearer header và split timeouts.
- Exact Python paths/methods, snake_case serializer.
- Safe shared upload path.
- `action=hide|unhide`; empty `teacher_metadata`.
- `chunks` và `chunk_manifest` callback aliases với conflict rejection.
- Full text/hash/UUID validation, stale/duplicate callback handling.
- Structured citation/usage normalization and strict accepted/query response parsing.
- Configurable internal complete-manifest body limit; public JSON limit remains unchanged.
- Contract fixtures/tests and Part 2 regression.

## Observed in current Python snapshot

- FastAPI ingest/query/visibility/delete/health routes.
- File parsing and Qdrant ingest.
- Random UUID point IDs.
- Visibility/delete background operations.
- Callback sender with Bearer.
- Required processing attempt propagated without callback retry overwrite.
- Full-text/hash/UUID chunk manifest.
- Query history/correlation fields, citation point ID, confidence string and one usage object.
- Bearer dependency on ingest/query/visibility/delete; public health route.

## Observed compatible at the snapshot boundary

- HTTP paths/methods.
- Accepted responses and custom error format.
- Shared `doc_id`, `job_id`, callback URL.
- Visibility `action`.
- Query question/conversation/history/correlation fields.
- Citation `vector_node_id`, `snippet` alias and usage fields.
- Complete manifest and processing-attempt semantics.

## Remaining Python/upstream gates

1. Update Python tests for required Bearer and `attempt_count`; the current route tests still send old payloads without either.
2. Replace weak `INTERNAL_SECRET` fallback, use constant-time comparison, and confirm missing/malformed Bearer status is `401`.
3. Reconcile `core/llm_setup.py` `google_genai` imports with `requirements.txt` and provide an upstream environment template.
4. Record the exact upstream commit for the refresh.

## Deployment gates

- Configure the same 32+ character value for Node `RAG_INTERNAL_TOKEN` and Python `INTERNAL_SECRET`.
- Choose host/container topology and set reachable service/callback URLs.
- Mount the same upload volume; Python access is read-only.
- Use one Python-owned Qdrant.
- Do not pass a Windows host path between containers.
- Current root/Python Compose files do not establish a shared upload volume or common network automatically.

## Definition of Ready for Phase 2

- Snapshot refresh committed from an identified upstream commit.
- Python auth/schema/callback/query tests pass without paid-provider calls.
- Node contract and Part 2 regression pass.
- Shared-volume path verified in selected topology.
- Inbound/outbound Bearer verified.
- One controlled remote ingest, visibility, delete and query smoke plan approved.

## Verification evidence (2026-07-17)

- `npm run check`: PASS.
- `npm run test:contract`: PASS (`RAG_CONTRACT_TESTS_OK`).
- `npm run test:part2`: PASS (`PART2_SMOKE_OK`) against an isolated MySQL 8.4 Compose project; the temporary stack and volume were removed afterwards.
- OpenAPI load/serialize: PASS (OpenAPI 3.0.3, 26 paths).
- Contract JSON fixtures: PASS (12 files parsed).
- `docker compose config --quiet`: PASS.
- Python `compileall`: PASS with the locally available Python 3.14.3; this does not replace validation in the snapshot Docker target (Python 3.11).
- Python pytest: BLOCKED because the local interpreter has no `pytest`/snapshot dependencies installed. No large dependency install or paid-provider call was attempted.
- Remote NodeJS–Python–Qdrant E2E: NOT RUN.

Current assessment: Node boundary and existing mock/business regression checks pass. Full remote E2E remains blocked by snapshot provenance, Python test/security hardening and deployment topology.
