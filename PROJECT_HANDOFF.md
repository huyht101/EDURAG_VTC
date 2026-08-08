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
| PDF/DOCX/TXT artifacts | **IMPLEMENTED + CONTRACT/LOCAL TESTED; CURRENT DOCX CONVERSION AND LIVE PDF INGEST VERIFIED** | Node tests cover uploaded PDF/TXT and persistent DOCX-derived PDF mapping across preview/download/ingest. Phase 2 ran `test:part2` inside the app image with LibreOffice and ingested digital/scanned PDFs through the live Python path. TXT behavior was not rerun live in Phase 2. |
| Whole-document ingest boundary | **IMPLEMENTED + PRODUCTION OFFLINE AND ISOLATED LIVE-PROVIDER E2E VERIFIED** | `test:rag-production-offline-e2e` verifies the production Node/adapter/callback boundary with deterministic providers. Phase 2 ran `test:remote` in an isolated project for one digital and one scanned PDF with the configured Google embedding/LLM and LlamaParse OCR providers; upload, exact-attempt active payload, query/citation and hide/unhide/delete passed. This is not canonical-corpus acceptance. |
| Chat, rich Markdown persistence, idempotency and usage | **IMPLEMENTED + CONTRACT/LOCAL TESTED; BASIC LIVE QUERY/CITATION VERIFIED** | Node preserves answer strings and citation/usage transactions. Python resolves valid prose/table markers independently, preserves code/index syntax and rejects unresolvable sources in offline tests. Phase 2 verified live answers with structured citations; rich Markdown formatting itself was not specifically asserted in the live run. |
| Citation snapshot and dynamic file URLs | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | Snapshot data is immutable; URLs are computed from current actor/state. Citation history authorization is separate from Library visibility. |
| `sourceLocator` Node boundary | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | Node validates/persists/maps nullable ordered normalized boxes. Python snapshot does not produce geometry. Baseline citation uses document name, `pageNumber` and `sourceText`; precise highlight is **OPTIONAL/LATER** and waits for Python. |
| OCR/parser selection | **IMPLEMENTED + OFFLINE AND ISOLATED LIVE-PROVIDER TESTED** | Python uses explicit `OFF|AUTO`; key presence alone does not enable OCR. Mock fixtures cover digital/scanned/mixed/blank and required OCR failure. Phase 2 verified a scanned PDF through LlamaParse OCR and the production ingest/query path. Mixed/blank remain offline-only; quota/cost policy remains operational. |
| Private corpus release/equivalence | **IMPLEMENTED + LIVE RELEASE ACCEPTED** | Pointer `v1-d07f526e059e53751402a4f3` was rebuilt only from the previous selected release, published create-only, read back, restored in a clean namespace and reset into local-current. The release has 3 READY/VISIBLE documents, 81 MySQL chunks = 81 Qdrant points, exact attempt keys, `is_active=true`, `is_hidden=false`, 3 verified originals and no missing/orphan point. Owner/non-owner citation and original-file RBAC smoke passed. |

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
2. Run mixed/blank live OCR only if Owner requires live evidence beyond their existing
   deterministic offline fixtures; digital and scanned live-provider paths are verified.
3. FE/Mobile teams can implement authenticated artifact fetching and locator-null
   fallback from the guidance; their implementation has not been audited here. Precise
   overlay is optional and waits for verified Python geometry.
4. Before the next schema migration, harden or document recovery for partially applied
   MySQL DDL (`DB-MIG-001`).

## Verification recorded by the documentation audit

| Command | Result | Evidence class |
|---|---|---|
| `npm run check` | PASS | Static Node syntax |
| `npm run test:docs` | PASS (`42` files, `145` relative links, `88` npm commands) | Documentation/link/command contract |
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
| `npm run test:remote` with digital PDF | PASS | Isolated production Node/Python/Qdrant with live Google embedding/LLM; OCR AUTO selected native extraction |
| `npm run test:remote` with scanned PDF | PASS | Isolated production Node/Python/Qdrant with live LlamaParse OCR and Google embedding/LLM |
| `npm run test:part2` in the app image | PASS | Current Node/MySQL/HTTP and LibreOffice regression against disposable MySQL |
| `npm run test:corpus:fresh` | PASS | Synthetic three-store restore, marker/no-op, one-command reset rerun, full-stack start and disposable cleanup |
| `npm run test:corpus:reset` | PASS | Reset orchestration failure matrix; preflight fail-closed and no false READY |
| `npm run test:corpus:partial` | PASS | Partial local state fails closed in disposable project |
| `npm run corpus:verify` | PASS | Selected release remote manifest/artifacts/checksums and local-current dynamic inventory are compatible |
| `npm run corpus:reset -- --yes` | PASS | Exact local-current three-store replacement, restore, health and READY marker for the selected release |
| Restored-corpus smoke (`RESTORED_CORPUS_VERIFY_EXISTING=true`) | PASS | Production health/login plus persisted chat-owner citation/source and role-aware original access without ingest/query mutation |
| `npm run test:document-schema` | BLOCKED (`ECONNREFUSED`) | MySQL runtime was not running; no schema mutation was attempted |
| Python container `compileall` | PASS | Syntax/import compilation in the built Python 3.11 image |
| `npm run corpus:inspect` | PASS | Local-only, read-only pointer inspection; remote/local stores not checked |

Phase 2 called the approved live providers only in disposable projects. Release
`v1-d07f526e059e53751402a4f3` was published create-only after lifecycle repair, verified by
remote read-back and clean restore, then selected and restored to local-current. The prior
immutable release was not overwritten or deleted. Provider usage rows recorded two calls
per live query, while the current SDK did not expose token counts (persisted values were
zero), so cost was not computed.

Historical Week 3/4 files remain for chronology only. They are not the current readiness
source and must not override this handoff or the canonical contracts above.
