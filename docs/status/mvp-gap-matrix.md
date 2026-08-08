# MVP gap matrix

Updated: 2026-08-02. Status vocabulary and current evidence boundaries are defined in
the [project handoff](../../PROJECT_HANDOFF.md). “Guidance ready” means a public contract
is documented; no FE or Mobile implementation repository was audited in this work.

| Requirement / decision | NodeJS/Core | Python/RAG | FE | Mobile | Tests/evidence | Status | Owner / next action |
|---|---|---|---|---|---|---|---|
| Roles, approval, lock and `auth_version` | Implemented | N/A | Guidance ready; implementation not audited | Same | Node consolidation/auth local tests | **IMPLEMENTED + CONTRACT/LOCAL TESTED** | Node: retain regression |
| Own avatar | Authenticated self-only API and private storage implemented | N/A | Bearer Blob guidance ready; not audited | Same profile guidance; not audited | `test:user-assets`, OpenAPI | **IMPLEMENTED + CONTRACT/LOCAL TESTED** | DevOps: migrate existing DB; FE/Mobile implement |
| Admin user CSV | ADMIN-only batched allowlist export implemented | N/A | Admin-Web guidance ready; not audited | N/A | `test:user-assets`, OpenAPI | **IMPLEMENTED + CONTRACT/LOCAL TESTED** | FE implement if required |
| Management and Student Library | Ownership and fixed `READY + VISIBLE` Library scope implemented | N/A | Contract/guidance ready; no integration evidence | Same | `test:documents`, `test:library` | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | FE/Mobile integration regression remains |
| PDF artifact lifecycle | Uploaded PDF is canonical preview/download/ingest artifact | PDF parse/embed path observed | Guidance ready; not audited | Same | Node document/library tests | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node; **LIVE CROSS-RUNTIME NOT VERIFIED** | Integration: current isolated E2E |
| DOCX canonical PDF | Node publishes persistent derived PDF before ingest | Must parse the received `.pdf` | Preview/download guidance ready; not audited | Same | Node contract/local tests; LibreOffice not rerun here | **IMPLEMENTED + CONTRACT/LOCAL TESTED; RUNTIME NOT RE-VERIFIED** | Integration: real conversion and current Python page provenance |
| TXT artifact lifecycle | Uploaded TXT used; no PDF semantics | TXT parser observed | Download/fallback guidance ready; not audited | Same | Node contract tests | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node; **LIVE CROSS-RUNTIME NOT VERIFIED** | Integration: current isolated E2E |
| Whole-document hidden/ACK/activate | Callback transaction/ACK implemented | Inactive upsert, exact ACK activation/replay/stale cleanup implemented | N/A | N/A | Contract tests; offline HTTP + disposable Qdrant E2E | **IMPLEMENTED + OFFLINE LIFECYCLE TESTED; LIVE PROVIDER NOT VERIFIED** | Integration: full current Node app/MySQL + provider acceptance |
| Restart/lost-callback recovery | Timeout preserves exact attempt | Bounded activation retry, residual log, consistency check and exact manual recovery; `BackgroundTasks` remains non-durable | N/A | N/A | Python unit + disposable Qdrant E2E | **MVP RECOVERY IMPLEMENTED; DURABLE EXECUTION LATER** | Operator verifies exact READY attempt; durable queue post-MVP |
| Rich Markdown answer persistence | String preserved, no HTML/chart transform | Markdown-aware marker resolution repaired | GFM/safe-render guidance ready; not audited | Same | Node regression/contract + Python offline citation tests | **IMPLEMENTED + CONTRACT/LOCAL TESTED; LIVE GENERATION NOT VERIFIED** | FE/Mobile implement; integration live test remains |
| Structured citations and usage | Fail-closed mapping, immutable snapshot, ordered usage rows | Shape/usage observed | Guidance ready; not audited | Same | Node/Python offline tests; no current live provider trace | **CONTRACT AGREED; LIVE CROSS-RUNTIME NOT VERIFIED** | P0 integration acceptance |
| Locator validation/persistence | Nullable ordered normalized boxes implemented | No geometry generation path in snapshot | `pageNumber + sourceText` fallback ready; implementation not audited | Same | Node contract/consolidation | **BASELINE MVP FALLBACK READY; PRECISE HIGHLIGHT OPTIONAL/LATER** | P2 Python/FE only if precise highlight is prioritized |
| Parser mode with cloud key | No API/schema change needed | Explicit `OFF|AUTO`; key presence alone leaves OFF | Do not advertise live OCR quality | Same | Config and mocked parser regression | **IMPLEMENTED + OFFLINE TESTED** | Live keyed environment remains acceptance gate |
| OCR AUTO quality | No baseline dependency | Per-page digital/scanned/mixed/blank behavior and fail-closed required OCR implemented | Fallback remains citation text/page | Same | Deterministic mocked fixtures; no live provider | **IMPLEMENTED + OFFLINE TESTED; LIVE PROVIDER NOT VERIFIED** | Python/Owner run approved live OCR acceptance |
| Hide/unhide/delete retrieval | Business jobs/authorization implemented | Active/hidden filter and document-scoped operations tested | Library fail-closed guidance ready; not audited | Same | Contract/mock + disposable Qdrant lifecycle | **IMPLEMENTED + OFFLINE TESTED; FULL E2E NOT VERIFIED** | Include in full current integration acceptance |
| Current Node → Python → Qdrant compatibility | Production adapter/callback transaction verified offline | Current snapshot verified with deterministic local providers | N/A | N/A | `test:rag-production-offline-e2e`: production Node + disposable MySQL/Python/Qdrant | **IMPLEMENTED + PRODUCTION OFFLINE E2E VERIFIED; LIVE PROVIDER NOT VERIFIED** | Phase 2: approved live OCR/embedding/LLM acceptance |
| Private corpus release/equivalence | Tooling, exact local marker and selected pointer exist | Qdrant snapshot is one store in bundle | N/A | N/A | Synthetic three-store fresh restore/no-op PASS; live GCS still not read | **LOCAL WORKFLOW VERIFIED; REMOTE EQUIVALENCE GAP** | P0 Corpus operator: verify selected remote release and MySQL–Qdrant–original equivalence |
| Release-ID history | Pointer is `v1-e7a8109f714792d4312713f5`; older evidence mentions `v1-7463f169257976a90e65ab7c` | N/A | N/A | N/A | Repository does not explain equivalence or succession | **NOT VERIFIED; DO NOT INFER ERROR** | Corpus operator: compare signed manifests/fingerprints read-only |
| Subject/course/class scope | Not in public API/schema | Compatibility subject shim only | Not promised | Not promised | Schema/OpenAPI | **OPTIONAL/LATER** | Owner decision before design |
| PPTX, byte Range, image chat, visualizations | Not CURRENT | Not CURRENT | No UI promise | Same | OpenAPI/code inspection | **OPTIONAL/LATER** | Product decision |
| Legacy DOCX page alignment | Snapshots retained, no synthetic backfill | Old vectors may use direct DOCX segments | `pageNumber + sourceText` fallback | Same | No controlled legacy re-ingest evidence | **LEGACY LIMITATION** | Optional explicit-ID reprocess later |

## Evidence boundaries

- Node syntax/unit/contract/local HTTP suites prove only their named boundary.
- `test:part2` uses real Node/MySQL/HTTP and deterministic RAG mock; it is not a live
  Node → Python → Qdrant test.
- The 2026-07-17 remote run is historical evidence for that snapshot/baseline. It does
  not verify later canonical-DOCX, locator, OCR or citation-parser changes.
- `corpus:inspect` reads the local pointer only. It does not verify private GCS objects,
  downloaded checksums or equivalence among MySQL, Qdrant and original files.
- No FE/Mobile repository, Docker conversion, live provider call or real corpus mutation was part
  of this documentation work.
