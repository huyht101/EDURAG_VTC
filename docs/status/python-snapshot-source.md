# Python snapshot source

## Purpose and provenance

`python-service/` is a tracked integration snapshot used by the NodeJS team for compatibility audits, contract checks and integration debugging. The Python/Data-RAG team's separate upstream repository remains the Python source of truth; this snapshot may be stale and may be overwritten by a later refresh.

| Field | Current value |
|---|---|
| Upstream repository | <https://github.com/manh2905/RAG_service> |
| Upstream branch/tag | `Unknown` |
| Upstream commit | `Unknown` |
| Snapshot refreshed | `2026-07-17` |
| Import source | Source copy committed in the Node repository; exact upstream export metadata was not recorded |
| Snapshot directory | `python-service/` |
| Git baseline | repository HEAD `95660f902a8f996a4e36f56e8375cf40632b0522` before the current Node integration changes |
| Node-authored Python runtime patches | `requirements.txt`: align packages with `google_genai` imports; `core/llm_setup.py`: request agreed 768-dimensional embeddings. Both must be upstreamed |
| Latest compatibility audit | `2026-07-17` |

The Git baseline identifies the repository copy, not an upstream Python commit. The refresh must record its exact upstream commit before it can be treated as reproducible provenance.

## Current refresh inventory

- Modified runtime: `api/routes.py`, `main.py`, `models/schemas.py`, `services/callback.py`, `services/doc_manager.py`, `services/ingestion.py`, `services/rag_engine.py`.
- Modified ad-hoc scripts: `test_all.py`, `test_real.py`.
- Added runtime dependency: `api/dependencies.py`.
- Added snapshot-local contract/package: `API_CONTRACT.md` and `python-rag-integration-v0.1.1/`. These are audit evidence only; the root [internal contract](../api/internal-rag-contract.md) remains canonical for NodeJS.

## Compatibility result

The refresh resolved the previous target-boundary blockers:

1. Ingest, visibility and delete schemas now accept processing `attempt_count`.
2. Callback HTTP retry no longer overwrites processing `attempt_count`.
3. Successful ingest callbacks now return full `chunk_text` and matching SHA-256 `content_hash`.
4. Query citations now return the Qdrant point ID as `vector_node_id`.
5. Python inbound business routes now use Bearer verification; health remains public.
6. Query schemas now retain optional `request_id` and `user_id` correlation fields.

Remaining Python/deployment work:

1. Replace the weak `INTERNAL_SECRET` fallback and use constant-time comparison; verify missing/malformed Bearer returns the agreed `401`.
2. Update Python route/schema tests for Bearer and required `attempt_count`; current tracked tests still use the old unauthenticated DTOs.
3. Upstream the minimal `google_genai` requirements alignment and `output_dimensionality=768` configuration; restore an upstream-safe environment template.
4. Record the exact upstream commit and run Python tests without paid-provider calls.
5. Align the pinned Python Qdrant client and deployed Qdrant server versions. Isolated live E2E passed despite the current compatibility warning.

These are observations from the tracked local snapshot plus the explicitly listed requirements overlay, not claims about the latest upstream state. See [Week 3 integration readiness](week3-integration-readiness.md) for release gates.

## After each refresh

Update the upstream URL, exact branch/tag/commit, refresh date, import source, local patch status, audit date and blocker list. Follow the [Python snapshot refresh guide](../setup/python-snapshot-refresh.md), and do not infer missing upstream metadata from an archive filename.
