# Week 3 integration readiness

Repository baseline: `95660f902a8f996a4e36f56e8375cf40632b0522` on `main`. Python source of truth remains the Python team's upstream repository; `python-service/` is the tracked integration snapshot audited and tested here.

Current assessment: **REMOTE E2E READY** for the documented isolated development topology. This is integration evidence, not production readiness.

## Runtime configuration verified

- Provider configuration loaded from ignored `PythonSevice.env`; the file was not mounted or copied into images.
- Root `RAG_INTERNAL_TOKEN` was injected into Python as `INTERNAL_SECRET` and passed both auth directions.
- Generation: `models/gemini-3.5-flash`.
- Embedding: `models/gemini-embedding-001`, explicitly reduced to agreed dimension `768`.
- Python 3.11, MySQL 8.4 and one Python-owned Qdrant.

## Live evidence — 2026-07-17

`npm run test:remote` returned:

```text
REMOTE_E2E_SMOKE_OK documentId=6 ingestJobId=10 chunks=1 citations=3 usageRows=1
```

Verified through public/internal HTTP plus persistence assertions:

- Node upload and shared Python-visible file path.
- LlamaParse returned one page.
- Gemini embedding and Qdrant upsert/retrieval.
- Authenticated progress/terminal callbacks and complete manifest persistence.
- Duplicate/stale/mismatched/unauthorized/invalid callbacks and MySQL rollback.
- Chat answer, structured citation mapping, immutable source snapshot and usage persistence.
- Hide removed retrieval; unhide restored it; delete removed retrieval while history/snapshot remained readable.
- Python-unavailable dispatch failed closed instead of reporting false success.

Database evidence for the final document:

- final document state `READY/DELETED`;
- `INGEST`, two `SET_RETRIEVAL` and `DELETE_VECTORS` jobs succeeded;
- one persisted chunk with UUID-shaped vector ID and matching SHA-256;
- target citations mapped to `document_chunks`, snapshots were non-empty and usage rows were `SUCCEEDED` with model/tokens.

Live `no_answer` remains intentionally non-deterministic; its semantics stay covered by contract/mock tests.

## Verification matrix

| Check | Result |
|---|---|
| `npm run check` | PASS |
| `npm run test:contract` | PASS — `RAG_CONTRACT_TESTS_OK` |
| `npm run test:part2` | PASS — `PART2_SMOKE_OK` |
| OpenAPI 3.0.3 load/serialize | PASS — 26 paths |
| Contract fixtures JSON | PASS |
| Mock and remote Compose config | PASS |
| Python 3.11 image import/compile | PASS |
| Remote preflight | PASS |
| Live remote smoke | PASS |
| Python snapshot pytest | FAIL — stale upstream mocks/payload fixtures |

## Required upstream/deployment follow-up

1. Upstream `llama-index-llms-google-genai` and `llama-index-embeddings-google-genai` requirements.
2. Upstream `embedding_config.output_dimensionality=768` in `core/llm_setup.py`.
3. Update Python tests for `google_genai`, Bearer auth and required `attempt_count`.
4. Replace weak snapshot `INTERNAL_SECRET` fallback and use constant-time comparison.
5. Align Qdrant client `1.14.2` and server `1.18.2`; live passed but emitted a compatibility warning.
6. Record the exact Python upstream commit, currently `UNKNOWN`.

The second Node member should repeat the [independent test plan](../testing/week3-remote-test-plan.md) from a fresh clone.
