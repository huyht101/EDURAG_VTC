# EDURAG project handoff

Updated: 2026-08-02. This document is the canonical current-state handoff for the
NodeJS/Core repository. It summarizes evidence and remaining ownership; it does not
replace the runtime OpenAPI, database DDL, or the internal Node–Python contract.

## Evidence vocabulary

- **IMPLEMENTED + CONTRACT/LOCAL TESTED**: implementation exists and the named
  static/unit/contract/local test passed; this does not imply Docker/runtime conversion
  or live cross-runtime evidence.
- **RUNTIME NOT RE-VERIFIED**: a runtime path may have historical evidence, but was not
  rerun for the current HEAD/worktree.
- **LIVE CROSS-RUNTIME NOT VERIFIED**: no current Node → Python → Qdrant/provider proof.
- **IMPLEMENTED, NOT RUNTIME VERIFIED**: code and contract exist, but this audit has
  no current runtime/cross-runtime result.
- **REQUIRED FROM PYTHON**: Node boundary is ready; the Python-owned behavior is not.
- **CONTRACT AGREED, NOT VERIFIED**: both sides have an agreed boundary but current
  cross-runtime evidence is missing.
- **DECISION REQUIRED**, **BLOCKED**, **OPTIONAL/LATER**, and **LEGACY LIMITATION**
  have their literal meanings. No status in this file means production-ready.

## Ownership and canonical sources

| Topic | Owner/source of truth |
|---|---|
| Public API, auth and errors | Node runtime OpenAPI at `/api-docs.json`; overview at [Public API](docs/api/public-api.md) |
| MySQL schema and migration ledger | [`src/database/schema.sql`](src/database/schema.sql), then versioned files in [`src/database/migrations/`](src/database/migrations/) |
| Node–Python JSON/file boundary | [Internal RAG contract v0.1](docs/api/internal-rag-contract.md) |
| Python actions and acceptance | [Python/Data-RAG handoff](docs/architecture/python-rag-handoff.md) |
| Web/Mobile consumption | [Frontend integration](docs/api/frontend-integration.md) |
| Current requirement coverage | [MVP gap matrix](docs/status/mvp-gap-matrix.md) |
| Defects and quality debt | [Issue/quality register](docs/status/issue-quality-register.md) |
| Portable private corpus | [Corpus portability](docs/architecture/corpus-portability.md) and [`bootstrap/corpus-release.json`](bootstrap/corpus-release.json) |

`python-service/` is an integration snapshot, not the canonical Python upstream.
Node is the only MySQL writer; Python owns Qdrant; neither service crosses that
persistence boundary.

## Current MVP state

| Area | Status | Evidence and limitation |
|---|---|---|
| Roles, registration, approval, lock, password lifecycle and JWT invalidation | **IMPLEMENTED + CONTRACT/LOCAL TESTED** | `src/services/auth-service.js`, `src/services/user-service.js`; Node consolidation and user-assets regressions. Rate limiting is process-local. |
| Avatar and Admin CSV export | **IMPLEMENTED + CONTRACT/LOCAL TESTED** | Authenticated self-only avatar and ADMIN-only CSV are in OpenAPI and `scripts/user-assets-test.js`; existing DBs require `20260801_user_avatar_storage.sql`. |
| Document Management and Student Library | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | Node tests cover ownership, `READY + VISIBLE`, search aliases, stable pagination and IDOR. No Web/Mobile implementation repository was audited. |
| PDF/DOCX/TXT artifacts | **IMPLEMENTED + CONTRACT/LOCAL TESTED; RUNTIME NOT RE-VERIFIED** | Node tests cover uploaded PDF/TXT and persistent DOCX-derived PDF mapping across preview/download/ingest. LibreOffice conversion was not rerun in this documentation work, and live Python ingest of that artifact is not current evidence. |
| Whole-document ingest boundary | **CONTRACT AGREED; LIVE CROSS-RUNTIME NOT VERIFIED** | Node jobs, complete-manifest transaction/ACK and timeout semantics are covered by contract tests. The current HEAD has no fresh Node → Python → Qdrant/provider acceptance. |
| Chat, rich Markdown persistence, idempotency and usage | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | Node preserves answer strings and citation/usage transactions. Python citation parsing has an open defect for code/index syntax; see `PY-MD-001`. |
| Citation snapshot and dynamic file URLs | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | Snapshot data is immutable; URLs are computed from current actor/state. Citation history authorization is separate from Library visibility. |
| `sourceLocator` Node boundary | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | Node validates/persists/maps nullable ordered normalized boxes. Python snapshot does not produce geometry. Baseline citation uses document name, `pageNumber` and `sourceText`; precise highlight is **OPTIONAL/LATER** and waits for Python. |
| OCR/parser selection | **CONTRACT_GAP before keyed runtime; OCR quality OPTIONAL/LATER** | Current snapshot may select premium cloud parsing solely from key presence. Explicit parser mode is required before running with that key; AUTO/FORCE thresholds, provider policy and OCR quality are not baseline MVP blockers. |
| Private corpus release/equivalence | **VERIFICATION_GAP** | Local pointer currently selects `v1-e7a8109f714792d4312713f5`; historical evidence mentions `v1-7463f169257976a90e65ab7c`. Repository metadata does not prove why they differ or that GCS artifacts, originals, MySQL and Qdrant are equivalent. `corpus:inspect` was local-only. |

## Artifact and authorization contract

| Upload | Original | Canonical preview / Student download / Python ingest |
|---|---|---|
| PDF | Uploaded PDF | The same validated PDF bytes |
| DOCX | Uploaded DOCX, owner Teacher/Admin only | Persistent PDF created by Node before ingest; no conversion on read |
| TXT | Uploaded TXT | Uploaded TXT; no PDF/page geometry semantics |

All file URLs are authenticated relative routes. Library list/detail/preview/download
always re-check `READY + VISIBLE`; a saved URL cannot bypass a later hide/state change.
Citation history remains readable by the owning chat session after hide/delete, while a
file URL is generated from current authorization and artifact availability.

## Whole-document boundary

The agreed flow remains:

```text
Node upload/job → Python parse/chunk/embed → Qdrant hidden upsert
→ complete-manifest → Node transaction/ACK → Python activate
```

Node does not implement partial business success. An ingest dispatch timeout is an
unknown transport outcome and leaves the same attempt `RUNNING`; definitive rejection
may fail it. Python `BackgroundTasks` is not durable, so restart recovery/reconciliation
is still open. See the [Python handoff](docs/architecture/python-rag-handoff.md).

## Current decisions and limitations

- Rich answers are Markdown/GFM-compatible strings. Raw HTML, chart JSON,
  `edurag-chart`, and `visualizations` are not CURRENT.
- Citation `pageNumber` is 1-based. `sourceLocator` is nullable and, when present,
  contains ordered normalized top-left boxes. Node never invents geometry.
- Parser/OCR mode must be explicit before any environment carries a cloud parser key.
  AUTO/FORCE trigger thresholds, mixed-page handling limits, provider acceptance and
  OCR quality remain **OPTIONAL/LATER** unless Owner promotes them.
- Existing vectors remain query-compatible. Re-ingest is optional to gain future OCR or
  geometry; old citation snapshots must not be rewritten or given synthetic boxes.
- PPTX, subject/course/class scope, byte Range, public reprocess, image chat, object
  storage, full AI cost, and structured visualizations are **OPTIONAL/LATER**.
- Legacy DOCX ingested before the canonical-PDF flow must not be claimed page-aligned
  without a controlled reprocess.

## Safe next actions

1. Python team addresses P0 citation correctness and bounded recovery, then the P1
   explicit parser-mode guard, using offline fixtures.
2. Run an isolated Node → Python → Qdrant acceptance for the exact current HEAD/snapshot;
   record provider/model/collection without exposing credentials.
3. Verify the selected private corpus release and cross-store equivalence before corpus
   acceptance; do not infer equivalence from either historical release ID.
4. FE/Mobile teams can implement authenticated artifact fetching and locator-null
   fallback from the guidance; their implementation has not been audited here. Precise
   overlay is optional and waits for verified Python geometry.
5. Before the next schema migration, harden or document recovery for partially applied
   MySQL DDL (`DB-MIG-001`).

## Verification recorded by the documentation audit

| Command | Result | Evidence class |
|---|---|---|
| `npm run check` | PASS | Static Node syntax |
| `npm run test:docs` | PASS (`40` files, `141` relative links, `77` npm commands) | Documentation/link/command contract |
| `npm run test:openapi` | PASS (`44` operations, `12` tags) | Static OpenAPI contract |
| `npm run test:contract` | PASS | Node–RAG mocked contract boundary |
| `npm run test:documents` | PASS | Node unit/mock document/preview contract |
| `npm run test:library` | PASS | Node Library authorization/DTO contract |
| `npm run test:user-assets` | PASS | Node HTTP/unit avatar, CSV and Unicode multipart regression |
| `npm run test:node-consolidation` | PASS | Node local regression; not cross-runtime |
| `npm run test:document-schema` | BLOCKED (`ECONNREFUSED`) | MySQL runtime was not running; no schema mutation was attempted |
| Python AST parse | STATIC PASS (`31` files) | Syntax only |
| `python -m pytest python-service/tests -q` | BLOCKED | Host is Python 3.14.3 and has no `pytest`; dependencies were not changed |
| `npm run corpus:inspect` | PASS | Local-only, read-only pointer inspection; remote/local stores not checked |

No Docker conversion, provider call, GCS verification, corpus restore/publish, or live
Node → Python → Qdrant flow was run by this audit.

Historical Week 3/4 files remain for chronology only. They are not the current readiness
source and must not override this handoff or the canonical contracts above.
