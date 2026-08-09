# MVP gap matrix

Updated: 2026-08-09. Status vocabulary and current evidence boundaries are defined in
the [project handoff](../../PROJECT_HANDOFF.md). “Guidance ready” means a public contract
is documented; no FE or Mobile implementation repository was audited in this work.
Live-provider and corpus results below are recorded isolated evidence at commit
`23afbec`, not a current rerun or proof that operational gaps are closed.
Other test-result language is likewise repository-recorded evidence unless a later
handoff explicitly records a rerun; this consolidation did not rerun application tests.

| Requirement / decision | NodeJS/Core | Python/RAG | FE | Mobile | Tests/evidence | Status | Owner / next action |
|---|---|---|---|---|---|---|---|
| Roles, approval, lock and `auth_version` | Implemented | N/A | Guidance ready; implementation not audited | Same | Node consolidation/auth local tests | **IMPLEMENTED + CONTRACT/LOCAL TESTED** | Node: retain regression |
| Own avatar | Authenticated self-only API and private storage implemented | N/A | Bearer Blob guidance ready; not audited | Same profile guidance; not audited | `test:user-assets`, OpenAPI | **IMPLEMENTED + CONTRACT/LOCAL TESTED** | DevOps: migrate existing DB; FE/Mobile implement |
| Admin user CSV | ADMIN-only batched allowlist export implemented | N/A | Admin-Web guidance ready; not audited | N/A | `test:user-assets`, OpenAPI | **IMPLEMENTED + CONTRACT/LOCAL TESTED** | FE implement if required |
| Management and Student Library | Ownership and fixed `READY + VISIBLE` Library scope implemented | N/A | Contract/guidance ready; no integration evidence | Same | `test:documents`, `test:library` | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | FE/Mobile integration regression remains |
| PDF artifact lifecycle | Uploaded PDF is canonical preview/download/ingest artifact | PDF parse/embed path observed; physical-page mapping under investigation | Guidance ready; not audited | Same | Node tests; isolated digital/scanned run recorded at `23afbec` | **IMPLEMENTED + CONTRACT/LOCAL TESTED; RECORDED ISOLATED EVIDENCE; PAGE ALIGNMENT UNRESOLVED** | Current: page-identity investigation only |
| DOCX canonical PDF | Node publishes persistent derived PDF before ingest | Must parse the received `.pdf`; physical page identity remains required | Preview/download guidance ready; not audited | Same | Node tests; conversion/live ingest recorded at `23afbec`, not rerun | **IMPLEMENTED + CONTRACT/LOCAL TESTED; RECORDED ISOLATED EVIDENCE; PAGE PROVENANCE UNRESOLVED** | Keep page investigation separate from re-ingest/repair |
| TXT artifact lifecycle | Uploaded TXT used; no PDF semantics | TXT parser observed | Download/fallback guidance ready; not audited | Same | Node contract tests | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node; **LIVE CROSS-RUNTIME NOT VERIFIED** | Integration: current isolated E2E |
| Whole-document retrieval-disabled/ACK/activate | Callback transaction/ACK implemented | `is_active=false` upsert, exact ACK activation/replay/cleanup implemented; `is_hidden` is separate visibility state | N/A | N/A | Contract/offline lifecycle tests; isolated provider path recorded at `23afbec` | **IMPLEMENTED + OFFLINE LIFECYCLE TESTED; RECORDED ISOLATED EVIDENCE** | Do not infer operational acceptance |
| Restart/lost-callback recovery | Timeout preserves exact attempt | Bounded activation retry, residual log, consistency check and exact manual recovery; `BackgroundTasks` remains non-durable | N/A | N/A | Python unit + disposable Qdrant evidence recorded in repository | **OFFLINE IMPLEMENTATION PRESENT; ACCEPTANCE GATE AND OWNERSHIP UNRESOLVED** | Owner/Node/Python/operator ownership remains undecided |
| Rich Markdown answer persistence | String preserved, no HTML/chart transform | Markdown-aware marker resolution repaired | GFM/safe-render guidance ready; not audited | Same | Node regression/contract + Python offline citation tests | **IMPLEMENTED + CONTRACT/LOCAL TESTED; LIVE GENERATION NOT VERIFIED** | FE/Mobile implement; integration live test remains |
| Structured citations and usage | Fail-closed mapping, immutable snapshot, ordered usage rows | Shape/usage observed | Guidance ready; not audited | Same | Offline tests; basic live citation recorded at `23afbec` | **CONTRACT AGREED; RECORDED ISOLATED EVIDENCE; CURRENT PROVIDER STATE NOT RE-VERIFIED** | Preserve exact evidence scope |
| Canonical physical-page identity | Node accepts 1-based page only when supplied; no mapping heuristic | Adapter enumerates LlamaParse output order and does not use canonical metadata identity | Page/source-text fallback requires a trustworthy page | Same | Mixed-PDF test mocks below the adapter boundary; 10 tests defined, PASS previous-report only | **CURRENT INVESTIGATION / UNVERIFIED** | Do not choose metadata or mapping in consolidation |
| Locator validation/persistence | Nullable ordered normalized boxes implemented | No geometry generation path in snapshot | `pageNumber + sourceText` fallback only when page is trustworthy | Same | Node contract/consolidation | **GEOMETRY OPTIONAL/LATER; PAGE ALIGNMENT SEPARATELY UNRESOLVED** | Never fabricate full-page boxes |
| Parser mode with cloud key | No API/schema change needed | Explicit `OFF|AUTO`; key presence alone leaves OFF | Do not advertise live OCR quality | Same | Config and mocked parser regression | **IMPLEMENTED + OFFLINE TESTED** | Live keyed environment remains acceptance gate |
| OCR AUTO quality | No baseline dependency | Per-page digital/scanned/mixed/blank behavior exists offline; adapter page alignment unverified | Fallback remains citation text/page only when page is trustworthy | Same | Deterministic fixtures; scanned provider run recorded at `23afbec` | **IMPLEMENTED + OFFLINE TESTED; RECORDED ISOLATED EVIDENCE; ALIGNMENT UNRESOLVED** | Current task is investigation, not live rerun |
| Hide/unhide/delete retrieval | Active-job protection and stale callback rejection implemented | Current mutation is document-wide by `doc_id` | Library fail-closed guidance ready; not audited | Same | Offline lifecycle plus isolated flow recorded at `23afbec` | **ORDERING GAP UNRESOLVED** | Do not select wire/versioning repair or owner here |
| Current Node → Python → Qdrant compatibility | Production adapter/callback transaction verified offline | Current snapshot verified with deterministic local providers | N/A | N/A | Production offline E2E plus isolated provider evidence recorded at `23afbec` | **OFFLINE VERIFIED; RECORDED ISOLATED LIVE EVIDENCE; NOT CURRENT RERUN** | Operational acceptance gaps remain |
| Private corpus release/equivalence | Tooling, exact local marker and selected pointer exist | Qdrant snapshot is one store in bundle | N/A | N/A | Acceptance for `v1-d07f526e059e53751402a4f3` recorded at `23afbec` | **RECORDED ACCEPTANCE; CURRENT REMOTE STATE NOT RE-VERIFIED** | Exact-key and GCS/archive-key reviews remain separately unresolved |
| Release-ID history | Pointer is `v1-d07f526e059e53751402a4f3`; recorded workflow superseded the selected legacy lifecycle-incompatible release without overwriting it | N/A | N/A | N/A | Distinct source fingerprint and immutable predecessor recorded at `23afbec` | **RECORDED VERIFIED SUCCESSION AT `23afbec`** | Corpus operator: preserve create-only/pointer-last workflow |
| Subject/course/class scope | Not in public API/schema | Compatibility subject shim only | Not promised | Not promised | Schema/OpenAPI | **OPTIONAL/LATER** | Owner decision before design |
| PPTX, byte Range, image chat, visualizations | Not CURRENT | Not CURRENT | No UI promise | Same | OpenAPI/code inspection | **OPTIONAL/LATER** | Product decision |
| Legacy DOCX page alignment | Snapshots retained, no synthetic backfill | Old vectors may use direct DOCX segments | `pageNumber + sourceText` fallback | Same | No controlled legacy re-ingest evidence | **LEGACY LIMITATION** | Optional explicit-ID reprocess later |

## Evidence boundaries

- Node syntax/unit/contract/local HTTP suites prove only their named boundary.
- `test:part2` uses real Node/MySQL/HTTP and deterministic RAG mock; it is not a live
  Node → Python → Qdrant test.
- The 2026-07-17 remote run is historical evidence for that snapshot/baseline. It does
  not verify later canonical-DOCX, locator, OCR or citation-parser changes.
- Commit `23afbec` records later isolated digital/scanned provider and selected-release
  evidence. It was not rerun for the current checkpoint and does not close page alignment,
  stale visibility ordering, recovery ownership or corpus/GCS review gaps.
- `corpus:inspect` reads the local pointer only. It does not verify private GCS objects,
  downloaded checksums or equivalence among MySQL, Qdrant and original files.
- No FE/Mobile repository, Docker conversion, live provider call or real corpus mutation was part
  of this documentation work.
