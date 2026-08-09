# EDURAG project handoff

Updated: 2026-08-09. This document is the canonical current-state handoff for the
NodeJS/Core repository. It summarizes evidence and remaining ownership; it does not
replace the runtime OpenAPI, database DDL, or the internal Node–Python contract.

Explicit Owner tasks newer than this file control intended scope. `AGENTS.md` controls
working constraints. When an intended decision differs from implementation, record the
gap; do not silently change either side to make the documentation agree.

## Repository checkpoint

- Branch: `main`.
- HEAD: `11c19aa45f59ea73b93641a401c6aaf6b3b441dc`.
- Parent/pre-patch checkpoint: `5f5eb9a290ba148c4eca312523a69c23d562db17`.
- Continuity audit: clean tracked/untracked worktree; local branch ahead of the locally
  known `origin/main` by one commit and behind by zero. No fetch was performed.
- HEAD changes only `package-lock.json` to resolve `js-yaml` 4.3.1. It does not change
  parser, Python dependencies or Python tests.

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
- **CURRENT TASK** is the only work authorized by the latest Owner scope.
- **DEFERRED FROM CURRENT TASK** remains open and is not completed, cancelled or
  automatically `OPTIONAL/LATER`.
- **UNRESOLVED** records a decision, ownership or evidence gap without choosing a side.
- **DECISION REQUIRED**, **BLOCKED**, **OPTIONAL/LATER**, **REJECTED/CANCELLED**, and
  **LEGACY LIMITATION** have their literal meanings. No status in this file means
  production-ready.

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

## State separation

| State | Items at this checkpoint |
|---|---|
| **COMPLETED / IMPLEMENTED EVIDENCE** | The `js-yaml` 4.3.1 lockfile patch is committed. Node wire validation/persistence and the tracked Python exact-attempt implementation exist at the checkpoint, subject to the evidence boundaries below. |
| **CURRENT TASK — INVESTIGATION ONLY** | Determine whether the installed LlamaParse/adapter surface provides trustworthy physical-page identity for canonical PDF pages, including sparse, blank or skipped provider output. |
| **DEFERRED FROM CURRENT TASK** | Stale hide/unhide ordering, bounded recovery/reconciliation, recovery ownership, Python upstream delivery, corpus exact-key guard, GCS/archive-key review and broader source provenance work. These items remain open. |
| **UNRESOLVED BEFORE OPERATIONAL ACCEPTANCE** | Visibility operation ordering, bounded recovery/reconciliation gate and ownership, exact Python upstream provenance, and any corpus/GCS review not backed by current evidence. |
| **OPTIONAL/LATER** | Precise geometry/PDF highlight and the product features explicitly listed below. Physical-page correctness is not optional when a page number is claimed. |
| **REJECTED/CANCELLED** | No current Owner-rejected or cancelled item is recorded. Exclusion from the current task is not rejection or cancellation. |

## Current task — investigation only

The current task is to verify whether the LlamaParse version and adapter in use expose a
trustworthy physical-page identity that can map provider output back to canonical PDF
pages, especially when provider output is sparse or omits blank/skipped pages. This is an
investigation checkpoint, not a parser repair in progress.

The current task does **not** authorize parser changes, corpus re-ingest, selection or
invention of a metadata field, positional/heuristic production mapping, API/service
contract changes, geometry/highlight implementation, or a live-provider call.

### Actual parser checkpoint

- The repository pins `llama-parse==0.6.4`.
- `llama-cloud-services==0.6.94` is **PREVIOUS_REPORT_ONLY**; the repository does not
  pin or lock it sufficiently to confirm that runtime version.
- `python-service/services/parser.py::_parse_with_llamaparse()` configures
  `split_by_page=True`, then
  numbers returned documents sequentially with `enumerate(..., start=1)`.
- The adapter does not currently read a canonical physical-page identity from provider
  metadata. Whether the SDK/provider offers one is **UNVERIFIED**.
- `python-service/tests/test_parser_ocr.py` mocks `_parse_with_llamaparse()` directly in
  the mixed-PDF case, so it does not verify adapter conversion when provider output is
  sparse.
- The file defines 10 test functions. A previous report said those tests passed; that
  result is **PREVIOUS_REPORT_ONLY**, not a current rerun.

## Current MVP state

| Area | Status | Evidence and limitation |
|---|---|---|
| Roles, registration, approval, lock, password lifecycle and JWT invalidation | **IMPLEMENTED + CONTRACT/LOCAL TESTED** | `src/services/auth-service.js`, `src/services/user-service.js`; Node consolidation and user-assets regressions. Rate limiting is process-local. |
| Avatar and Admin CSV export | **IMPLEMENTED + CONTRACT/LOCAL TESTED** | Authenticated self-only avatar and ADMIN-only CSV are in OpenAPI and `scripts/user-assets-test.js`; existing DBs require `20260801_user_avatar_storage.sql`. |
| Document Management and Student Library | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | Node tests cover ownership, `READY + VISIBLE`, search aliases, stable pagination and IDOR. No Web/Mobile implementation repository was audited. |
| PDF/DOCX/TXT artifacts | **IMPLEMENTED + CONTRACT/LOCAL TESTED; RECORDED ISOLATED EVIDENCE** | Node tests cover uploaded PDF/TXT and persistent DOCX-derived PDF mapping. Commit `23afbec` records a Phase 2 DOCX/LibreOffice run and digital/scanned live PDF ingest; this was not rerun for the current checkpoint and did not cover live TXT. |
| Whole-document ingest boundary | **IMPLEMENTED + PRODUCTION OFFLINE TESTED; RECORDED ISOLATED LIVE EVIDENCE** | The repository contains production offline lifecycle coverage. Commit `23afbec` records isolated digital/scanned provider E2E through exact-attempt activation, query/citation and hide/unhide/delete. It is not a current rerun, canonical-corpus acceptance or proof that operational gaps are resolved. |
| Chat, rich Markdown persistence, idempotency and usage | **IMPLEMENTED + CONTRACT/LOCAL TESTED; RECORDED ISOLATED EVIDENCE** | Node preserves answer strings and citation/usage transactions. Commit `23afbec` records basic live answers with structured citations; rich formatting was not specifically asserted and current provider state was not rechecked. |
| Citation snapshot and dynamic file URLs | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | Snapshot data is immutable; URLs are computed from current actor/state. Citation history authorization is separate from Library visibility. |
| `sourceLocator` Node boundary | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | Node validates/persists/maps nullable ordered normalized boxes; Python does not produce geometry. Precise highlight is **OPTIONAL/LATER**, but trustworthy physical-page provenance is a separate baseline requirement and is currently under investigation. |
| OCR/parser selection | **IMPLEMENTED + OFFLINE TESTED; RECORDED ISOLATED LIVE EVIDENCE; PAGE ALIGNMENT UNRESOLVED** | Python uses explicit `OFF|AUTO`. Commit `23afbec` records a scanned LlamaParse path, not a current rerun. Mixed/blank remain offline-only, and provider-output-to-physical-page alignment is not established by that run. |
| Private corpus release/equivalence | **RECORDED ACCEPTANCE AT `23afbec`; CURRENT REMOTE STATE NOT RE-VERIFIED** | The commit records create-only publish, read-back, clean restore and local reset for `v1-d07f526e059e53751402a4f3`. The pointer remains selected, but repository metadata alone does not prove current remote availability or close separate exact-key/GCS/archive-key reviews. |

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
Node upload/job → Python parse/chunk/embed → Qdrant retrieval-disabled upsert
→ complete-manifest → Node transaction/ACK → Python activate
```

The implementation represents pre-ACK retrieval disablement with `is_active=false`,
not `is_hidden=true`. `is_hidden` is a separate document-visibility flag.

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
  contains ordered normalized top-left boxes. Node never invents geometry. A nullable
  locator does not make an unverified page mapping trustworthy.
- Parser/OCR mode is explicit and defaults `OFF`; a provider key alone must not change it.
  OCR is required for MVP, with deterministic offline coverage for digital, scanned and
  mixed PDFs. Commit `23afbec` records an isolated provider run; current provider state,
  privacy/quota acceptance and physical-page alignment are still **NOT RE-VERIFIED**.
- Existing vectors remain query-compatible. Re-ingest is optional to gain future OCR or
  geometry; old citation snapshots must not be rewritten or given synthetic boxes.
- PPTX, subject/course/class scope, byte Range, public reprocess, image chat, object
  storage, full AI cost, and structured visualizations are **OPTIONAL/LATER**.
- Legacy DOCX ingested before the canonical-PDF flow must not be claimed page-aligned
  without a controlled reprocess.

## Safe next actions

1. Inspect the installed LlamaParse/adapter API and sanitized local evidence to determine
   whether a canonical physical-page identity exists for sparse/blank/skipped output.
2. Record the exact SDK surface and evidence without selecting a metadata convention or
   production mapping.
3. If no trustworthy identity can be established, return the gap for Owner/Python/Node
   decision. Do not begin parser repair, heuristic mapping, re-ingest or live-provider use
   under the current task.

## Unresolved and deferred register

| Item | State | Boundary |
|---|---|---|
| LlamaParse physical-page alignment | **CURRENT INVESTIGATION / UNRESOLVED** | No metadata field or page convention has been selected. |
| Stale hide/unhide ordering | **DEFERRED / UNRESOLVED** | Node prevents concurrent active jobs and rejects stale callbacks, while Python currently mutates Qdrant visibility document-wide; no wire/versioning repair is selected. |
| Bounded recovery/reconciliation | **DEFERRED / UNRESOLVED BEFORE OPERATIONAL ACCEPTANCE** | Offline exact-attempt retry, inspection and manual recovery exist; the acceptance gate remains open. |
| Recovery ownership | **DEFERRED / OWNER DECISION REQUIRED** | Do not assign Owner, Node, Python or operator ownership implicitly. |
| Python upstream provenance | **DEFERRED / UNVERIFIED** | Upstream branch and commit corresponding to the tracked snapshot are `Unknown`. |
| Corpus exact-key guard | **DEFERRED / UNRESOLVED** | Outside the parser task; no completion claim is made here. |
| GCS/archive-key review | **DEFERRED / UNRESOLVED** | Outside the parser task; recorded release acceptance does not close it automatically. |
| Source page provenance | **UNRESOLVED BASELINE REQUIREMENT** | A claimed physical page must be trustworthy even when geometry is null. |
| Precise geometry/highlight | **OPTIONAL/LATER** | Only trustworthy occurrence-specific boxes are allowed; fabricated/full-page boxes remain prohibited. |

## Current-task exclusions

Do not change parser/runtime code, re-ingest a corpus, call a live provider, modify the
wire/public API/schema, implement geometry/highlighting, choose page metadata, repair
visibility ordering, assign recovery ownership, upstream Python, or perform corpus/GCS
operations in the current investigation.

## Remaining Owner or cross-team decisions

- Whether and how stale visibility operations require additional identity/versioning.
- Who owns bounded recovery/reconciliation and whether it gates operational acceptance.
- Which exact Python upstream revision is accepted.
- Whether corpus exact-key and GCS/archive-key reviews are complete.
- Any future page identity convention, but only after investigation produces evidence.

## Historical verification recorded at `23afbec`

The following results were recorded in repository documentation at commit `23afbec`.
They were not rerun for HEAD `11c19aa`, do not describe current external/provider state,
and do not prove that all operational gaps are resolved.

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
| `npm run test:part2` in the app image | PASS | Recorded Node/MySQL/HTTP and LibreOffice regression against disposable MySQL |
| `npm run test:corpus:fresh` | PASS | Synthetic three-store restore, marker/no-op, one-command reset rerun, full-stack start and disposable cleanup |
| `npm run test:corpus:reset` | PASS | Reset orchestration failure matrix; preflight fail-closed and no false READY |
| `npm run test:corpus:partial` | PASS | Partial local state fails closed in disposable project |
| `npm run corpus:verify` | PASS | Selected release remote manifest/artifacts/checksums and local-current dynamic inventory are compatible |
| `npm run corpus:reset -- --yes` | PASS | Exact local-current three-store replacement, restore, health and READY marker for the selected release |
| Restored-corpus smoke (`RESTORED_CORPUS_VERIFY_EXISTING=true`) | PASS | Production health/login plus persisted chat-owner citation/source and role-aware original access without ingest/query mutation |
| `npm run test:document-schema` | BLOCKED (`ECONNREFUSED`) | MySQL runtime was not running; no schema mutation was attempted |
| Python container `compileall` | PASS | Syntax/import compilation in the built Python 3.11 image |
| `npm run corpus:inspect` | PASS | Local-only, read-only pointer inspection; remote/local stores not checked |

The recorded Phase 2 run called approved live providers only in disposable projects. Release
`v1-d07f526e059e53751402a4f3` was published create-only after lifecycle repair, verified by
remote read-back and clean restore, then selected and restored to local-current. The prior
immutable release was not overwritten or deleted. Provider usage rows recorded two calls
per live query, while the SDK in that recorded run did not expose token counts (persisted values were
zero), so cost was not computed.

Historical Week 3/4 files remain for chronology only. They are not the current readiness
source and must not override this handoff or the canonical contracts above.

## Continuation rules

1. Recheck branch, HEAD and worktree before continuing.
2. Read `AGENTS.md`, this handoff, then the specialized authority for the affected domain.
3. Treat newer explicit Owner scope as authoritative for intended work.
4. Preserve `CURRENT`, `DEFERRED`, `UNRESOLVED`, `OPTIONAL/LATER` and
   `REJECTED/CANCELLED` as distinct states.
5. Label report-only test/provider/corpus evidence with its recorded revision and scope.
6. Do not turn an implementation gap into a policy or contract decision without the
   required Owner/cross-team decision.
