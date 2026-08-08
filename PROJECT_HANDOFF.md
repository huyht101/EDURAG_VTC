# EDURAG project handoff

Updated: 2026-08-08. This document is the canonical current-state handoff for the
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
| Whole-document ingest boundary | **IMPLEMENTED + PRODUCTION OFFLINE E2E VERIFIED; LIVE PROVIDER NOT VERIFIED** | `test:rag-production-offline-e2e` runs the production Node app/adapter/callback transaction with disposable MySQL, Python HTTP and Qdrant plus deterministic local providers. It verifies inactive-before-ACK, exact activation/replay/stale cleanup, strict retrieval, failure compensation, restart inspection and manual recovery. `test:rag-offline-e2e` remains the narrower Python + callback-harness regression. |
| Chat, rich Markdown persistence, idempotency and usage | **IMPLEMENTED + CONTRACT/LOCAL TESTED** | Node preserves answer strings and citation/usage transactions. Python now resolves valid prose/table markers independently, preserves code/index syntax and rejects unresolvable sources in offline tests. Live generation remains unverified. |
| Citation snapshot and dynamic file URLs | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | Snapshot data is immutable; URLs are computed from current actor/state. Citation history authorization is separate from Library visibility. |
| `sourceLocator` Node boundary | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | Node validates/persists/maps nullable ordered normalized boxes. Python snapshot does not produce geometry. Baseline citation uses document name, `pageNumber` and `sourceText`; precise highlight is **OPTIONAL/LATER** and waits for Python. |
| OCR/parser selection | **IMPLEMENTED + OFFLINE TESTED; LIVE PROVIDER NOT VERIFIED** | Python uses explicit `OFF|AUTO`; key presence alone does not enable OCR. Mock fixtures cover digital/scanned/mixed/blank and required OCR failure. Live provider/privacy/quota acceptance remains a separate gate. |
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
may fail it. Python now retries exact-attempt activation after ACK with a bounded budget,
emits machine-readable residual state, and provides fail-closed exact-attempt
consistency/recovery tooling. `BackgroundTasks` itself is still not durable; operator
confirmation against Node's current READY attempt is required before manual activation.
See the [Python handoff](docs/architecture/python-rag-handoff.md).

## Current decisions and limitations

- Rich answers are Markdown/GFM-compatible strings. Raw HTML, chart JSON,
  `edurag-chart`, and `visualizations` are not CURRENT.
- Citation `pageNumber` is 1-based. `sourceLocator` is nullable and, when present,
  contains ordered normalized top-left boxes. Node never invents geometry.
- Parser/OCR mode is explicit and defaults `OFF`; a provider key alone must not change it.
  OCR is required for MVP, with deterministic offline coverage for digital, scanned and
  mixed PDFs. Live provider/privacy/quota acceptance is still **NOT VERIFIED**.
- Existing vectors remain query-compatible. Re-ingest is optional to gain future OCR or
  geometry; old citation snapshots must not be rewritten or given synthetic boxes.
- PPTX, subject/course/class scope, byte Range, public reprocess, image chat, object
  storage, full AI cost, and structured visualizations are **OPTIONAL/LATER**.
- Legacy DOCX ingested before the canonical-PDF flow must not be claimed page-aligned
  without a controlled reprocess.

## Safe next actions

1. Upstream the reviewed Python snapshot repair to the Python-owned repository; retain
   exact offline commands and results in its delivery.
2. Run an isolated full Node app/MySQL → Python → Qdrant/provider acceptance for the exact current revisions;
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
| `npm run test:docs` | PASS (`41` files, `144` relative links, `78` npm commands) | Documentation/link/command contract |
| `npm run test:openapi` | PASS (`44` operations, `12` tags) | Static OpenAPI contract |
| `npm run test:contract` | PASS | Node–RAG mocked contract boundary |
| `npm run test:documents` | PASS | Node unit/mock document/preview contract |
| `npm run test:library` | PASS | Node Library authorization/DTO contract |
| `npm run test:user-assets` | PASS | Node HTTP/unit avatar, CSV and Unicode multipart regression |
| `npm run test:node-consolidation` | PASS | Node local regression; not cross-runtime |
| `npm run test:rag-config` | PASS | Explicit OCR mode/root Compose prerequisite |
| Python container `pytest tests -q` | PASS (`120`) | Offline unit/mock Python behavior; network disabled |
| `npm run test:rag-offline-e2e` | PASS | Python HTTP + disposable Qdrant lifecycle with callback harness; not full Node |
| `npm run test:rag-production-offline-e2e` | PASS | Production Node + disposable MySQL + Python HTTP + Qdrant; deterministic providers, no live provider |
| `npm run test:corpus:fresh` | PASS | Synthetic three-store restore, marker/no-op, one-command reset rerun, full-stack start and disposable cleanup |
| `npm run test:corpus:reset` | PASS | Reset orchestration failure matrix; preflight fail-closed and no false READY |
| `npm run test:corpus:partial` | PASS | Partial local state fails closed in disposable project |
| `npm run test:document-schema` | BLOCKED (`ECONNREFUSED`) | MySQL runtime was not running; no schema mutation was attempted |
| Python container `compileall` | PASS | Syntax/import compilation in the built Python 3.11 image |
| `npm run corpus:inspect` | PASS | Local-only, read-only pointer inspection; remote/local stores not checked |

No live provider call, GCS verification, live corpus publish/restore or canonical mutation
was run. The full production Node app/MySQL → Python HTTP → Qdrant boundary did run in an
isolated Docker project with synthetic data and deterministic local providers; it is not
live-provider or real-corpus evidence.

Historical Week 3/4 files remain for chronology only. They are not the current readiness
source and must not override this handoff or the canonical contracts above.
