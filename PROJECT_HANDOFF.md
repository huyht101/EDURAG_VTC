# EDURAG project handoff

Updated: 2026-08-11. This document is the canonical current-state handoff for the
NodeJS/Core repository. It summarizes evidence and remaining ownership; it does not
replace the runtime OpenAPI, database DDL, or the internal Node–Python contract.

Explicit Owner tasks newer than this file control intended scope. `AGENTS.md` controls
working constraints. When an intended decision differs from implementation, record the
gap; do not silently change either side to make the documentation agree.

## Repository baseline

- Branch: `main`.
- Code/data baseline reviewed for this handoff:
  `f2693346246114895f3c0371aeb2fca3062d2dd3` (`Sửa corpus Qdrant defect/failure`).
- History includes `8abff73` (fresh corpus bootstrap creates/starts missing local data
  services before inspection) and `f269334` (sanitized Qdrant request diagnostics).
- `python-service/` remains a frozen integration snapshot. Its upstream branch and commit
  are `Unknown`; no Python runtime, dependency, configuration, test or fixture change is
  part of the final documentation/data cleanup.

## Evidence vocabulary

- **DECISION**: an Owner-approved scope, invariant or operating rule.
- **CURRENT_VERIFIED**: verified against current repository code or by evidence explicitly
  captured for this baseline. The named boundary still applies.
- **PREVIOUS_REPORT_ONLY**: recorded at a pinned earlier revision; not rerun here and not
  evidence of current external state.
- **UNKNOWN**: repository evidence cannot establish the fact.
- **UNVERIFIED**: a claim or implementation exists but has not been verified at the needed
  boundary.
- **OPTIONAL-LATER**: outside the MVP or explicitly postponed.
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
- **UNRESOLVED** records a decision, ownership or evidence gap without choosing a side.
- **DECISION REQUIRED**, **BLOCKED**, **REJECTED/CANCELLED**, and
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
| Report-writing overview | [Technical overview (Vietnamese)](docs/report/technical-overview.vi.md) |
| Current requirement coverage | [MVP gap matrix](docs/status/mvp-gap-matrix.md) |
| Defects and quality debt | [Issue/quality register](docs/status/issue-quality-register.md) |
| Portable private corpus | [Corpus portability](docs/architecture/corpus-portability.md) and [`bootstrap/corpus-release.json`](bootstrap/corpus-release.json) |

`python-service/` is an integration snapshot, not the canonical Python upstream.
Node is the only MySQL writer; Python owns Qdrant; neither service crosses that
persistence boundary.

## State separation

| State | Items at this checkpoint |
|---|---|
| **CURRENT PHASE — REPORT PREPARATION / CODE FROZEN** | Documentation, data references and evidence labels are being consolidated. No feature, parser, schema, API or contract work is in scope. |
| **COMPLETED / IMPLEMENTED EVIDENCE** | Node business/API boundaries and the tracked Python exact-attempt implementation exist, subject to the evidence boundaries below. Fresh corpus bootstrap ordering is corrected at `8abff73`; Qdrant diagnostics are corrected at `f269334`. |
| **CURRENT_VERIFIED — BOUNDED PAGE PROBE** | Two successful LlamaParse jobs used the same four-page synthetic PDF, versions, method and options. The fixture kept all four outputs, so it did not reproduce misalignment; no explicit page field was returned. |
| **UNRESOLVED BEFORE OPERATIONAL ACCEPTANCE** | Visibility operation ordering, bounded recovery/reconciliation gate and ownership, exact Python upstream provenance, and any corpus/GCS review not backed by current evidence. |
| **UNVERIFIED / RESIDUAL RISK** | General LlamaParse physical-page identity when provider output is omitted, merged or sparse; current remote provider/corpus state; live FE/Mobile integration. |
| **OPTIONAL-LATER** | Precise geometry/PDF highlight and the product features explicitly listed below. Physical-page correctness is not optional when a page number is claimed. |
| **REJECTED/CANCELLED** | No current Owner-rejected or cancelled item is recorded. Exclusion from a workstream is not rejection or cancellation. |

## Bounded LlamaParse physical-page probe

**CURRENT_VERIFIED for this fixture only:** two live submissions on 2026-08-11 used the
same synthetic PDF bytes (SHA-256
`26c48289921665384e8455ca5435c634f403a9f0465ecb04cc1528ef38e174bc`). The four
physical pages were selectable marker `PHYSICAL_PAGE_1`, blank, image-only marker
`PHYSICAL_PAGE_3`, and selectable marker `PHYSICAL_PAGE_4`.

- Repository pin: `llama-parse==0.6.4`.
- Probe environment: `llama-parse==0.6.4`, transitive
  `llama-cloud-services==0.6.94`, `pypdf==5.6.0`. The transitive version is probe
  environment evidence, not a repository lock guarantee.
- Exact repository path: `LlamaParse.aload_data(file_path)` with
  `split_by_page=True`, Markdown output, Vietnamese language, premium mode, errors not
  ignored, no progress display and the existing 120-second bounds.
- Both jobs returned four ordered items: page-1 marker, `NO_CONTENT_HERE` sentinel for
  the blank page, OCR text for the image-only page, then page-4 marker.
- Every legacy `Document.metadata` object was empty. No `page`, `page_number`,
  `pageNumber` or equivalent explicit physical-page identity was available through this
  supported legacy result path.
- The adapter still numbers returned documents with `enumerate(..., start=1)`. The
  fixture did not exercise a missing/merged output, so the observed ordinal agreement is
  not a provider contract for sparse output.

The two matching runs prove observed repeatability for this fixture/options only. They do
not prove a documented provider guarantee. Status:
**FIXTURE DID NOT REPRODUCE — RESIDUAL RISK DOCUMENTED**. No parser change, metadata
convention, heuristic, re-ingest or geometry implementation resulted. Full evidence and
the citation rule are in the
[source-locator authority](docs/architecture/source-locator-handoff.md).

The mixed-PDF unit test still mocks `_parse_with_llamaparse()` directly and therefore does
not verify provider behavior or sparse-output conversion. Its 10 test functions and their
reported PASS remain **PREVIOUS_REPORT_ONLY** unless separately rerun.

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
| `sourceLocator` Node boundary | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | Node validates/persists/maps nullable ordered normalized boxes; Python does not produce geometry. Precise highlight is **OPTIONAL-LATER**. The bounded probe did not reproduce a page shift, but general physical-page identity remains a separate residual risk. |
| OCR/parser selection | **IMPLEMENTED + OFFLINE TESTED; CURRENT_VERIFIED BOUNDED PROBE; GENERAL ALIGNMENT UNVERIFIED** | Python uses explicit `OFF|AUTO`. The two-run fixture kept a blank sentinel and OCR'd the image-only page, but the legacy result exposed no canonical page field. Commit `23afbec` remains separate recorded isolated E2E evidence. |
| Private corpus release/equivalence | **RECORDED ACCEPTANCE AT `23afbec`; CURRENT REMOTE STATE NOT RE-VERIFIED** | The commit records create-only publish, read-back, clean restore and local reset for `v1-d07f526e059e53751402a4f3`. The pointer remains selected, but repository metadata alone does not prove current remote availability or close separate exact-key/GCS/archive-key reviews. |
| Corpus local bootstrap and Qdrant diagnostics | **IMPLEMENTED + LOCAL REGRESSION COVERED** | `8abff73` moves default data-service bootstrap before local inspection so a fresh state can complete in one invocation. `f269334` retains sanitized phase/method/target/status/cause details. The historical member incident itself was not reproduced and is not declared closed. |

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
  mixed PDFs. The bounded 2026-08-11 probe observed repeatable blank/image handling but
  no explicit page identity. Broader provider state, privacy/quota acceptance and sparse
  physical-page alignment remain **UNVERIFIED**.
- Existing vectors remain query-compatible. Re-ingest is optional to gain future OCR or
  geometry; old citation snapshots must not be rewritten or given synthetic boxes.
- PPTX, subject/course/class scope, byte Range, public reprocess, image chat, object
  storage, full AI cost, and structured visualizations are **OPTIONAL/LATER**.
- Legacy DOCX ingested before the canonical-PDF flow must not be claimed page-aligned
  without a controlled reprocess.

## Report-phase operating posture

1. Use the [Vietnamese technical overview](docs/report/technical-overview.vi.md) as the
   report-writing entry point and follow links to canonical contracts rather than copying
   them.
2. Describe the page probe as fixture-bounded repeatability, not a provider guarantee;
   keep citation page accuracy as a residual risk.
3. Keep operational gaps open until a separately authorized implementation or acceptance
   task provides evidence. Do not infer closure from documentation, pointer metadata or
   historical reports.

## Unresolved and deferred register

| Item | State | Boundary |
|---|---|---|
| LlamaParse physical-page alignment | **FIXTURE DID NOT REPRODUCE / RESIDUAL RISK** | Two matching jobs returned all four fixture pages but no explicit page field. General sparse/omitted-output identity remains unverified; no mapping convention is selected. |
| Stale hide/unhide ordering | **UNRESOLVED** | Node prevents concurrent active jobs and rejects stale callbacks, while Python currently mutates Qdrant visibility document-wide; no wire/versioning repair is selected. |
| Bounded recovery/reconciliation | **UNRESOLVED BEFORE OPERATIONAL ACCEPTANCE** | Offline exact-attempt retry, inspection and manual recovery exist; the acceptance gate remains open. |
| Recovery ownership | **OWNER DECISION REQUIRED** | Do not assign Owner, Node, Python or operator ownership implicitly. |
| Python upstream provenance | **UNKNOWN** | Upstream branch and commit corresponding to the tracked snapshot are `Unknown`. |
| Corpus exact-key guard | **UNRESOLVED** | No completion claim is supported by the current repository evidence. |
| GCS/archive-key review | **UNRESOLVED** | Recorded selected-release acceptance does not close it automatically. |
| Historical `v1-7463...` relationship | **UNRESOLVED (`CORPUS-EQ-001`)** | Repository evidence does not establish predecessor/equivalence/different-state semantics relative to the selected release. |
| Source page provenance | **UNVERIFIED FOR GENERAL LLAMAPARSE OUTPUT** | A claimed physical page must be trustworthy even when geometry is null. |
| Precise geometry/highlight | **OPTIONAL/LATER** | Only trustworthy occurrence-specific boxes are allowed; fabricated/full-page boxes remain prohibited. |

## Final-phase guardrails

Documentation cleanup/report preparation does not authorize parser/runtime changes,
re-ingest, provider or GCS calls, public/wire API or schema changes, geometry/highlight,
page heuristics, visibility repair, implicit recovery ownership or Python upstream work.

## Remaining Owner or cross-team decisions

- Whether and how stale visibility operations require additional identity/versioning.
- Who owns bounded recovery/reconciliation and whether it gates operational acceptance.
- Which exact Python upstream revision is accepted.
- Whether corpus exact-key and GCS/archive-key reviews are complete.
- Whether a future provider/client migration is justified to obtain explicit canonical
  page identity; the current legacy result path does not expose it.

## Historical verification recorded at `23afbec`

The following table reproduces results recorded in repository documentation at commit
`23afbec`. A subset of offline checks may be rerun for final documentation validation,
but that does not update the live/provider/corpus-operation rows below. The recorded
results do not describe current external state or prove that operational gaps are resolved.

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
remote read-back and clean restore, then selected and restored to local-current. The
create-only workflow did not overwrite or delete pre-existing immutable objects; this
does not establish the relationship/equivalence of historical `v1-7463...`. Provider usage rows recorded two calls
per live query, while the SDK in that recorded run did not expose token counts (persisted values were
zero), so cost was not computed.

Historical Week 3/4 files remain for chronology only. They are not the current readiness
source and must not override this handoff or the canonical contracts above.

## Continuation rules

1. Recheck branch, HEAD and worktree before continuing.
2. Read `AGENTS.md`, this handoff, then the specialized authority for the affected domain.
3. Treat newer explicit Owner scope as authoritative for intended work.
4. Preserve `CURRENT_VERIFIED`, `PREVIOUS_REPORT_ONLY`, `UNKNOWN`, `UNVERIFIED`,
   `UNRESOLVED`, `OPTIONAL/LATER` and `REJECTED/CANCELLED` as distinct states.
5. Pin historical test/provider/corpus evidence to its revision and scope.
6. Do not turn an implementation gap into a policy or contract decision without the
   required Owner/cross-team decision.
