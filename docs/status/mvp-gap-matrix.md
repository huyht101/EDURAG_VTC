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
| Whole-document hidden/ACK/activate | Callback transaction/ACK implemented | Hidden upsert/activate observed in snapshot | N/A | N/A | Contract/mock tests; historical live evidence only | **LIVE CROSS-RUNTIME NOT VERIFIED** | P0 Node + Python: current isolated lifecycle acceptance |
| Restart/lost-callback recovery | Timeout preserves exact attempt | `BackgroundTasks` is not durable | N/A | N/A | Code inspection | **CONTRACT_GAP** | P0 Node + Python: bounded recovery/reconciliation; queue later |
| Rich Markdown answer persistence | String preserved, no HTML/chart transform | Prompt can emit Markdown; marker parser defect remains | GFM/safe-render guidance ready; not audited | Same | Node regression/contract | **IMPLEMENTED + CONTRACT/LOCAL TESTED** on Node | P0 Python: `PY-MD-001`; FE/Mobile implement |
| Structured citations and usage | Fail-closed mapping, immutable snapshot, ordered usage rows | Shape/usage observed | Guidance ready; not audited | Same | Node/Python offline tests; no current live provider trace | **CONTRACT AGREED; LIVE CROSS-RUNTIME NOT VERIFIED** | P0 integration acceptance |
| Locator validation/persistence | Nullable ordered normalized boxes implemented | No geometry generation path in snapshot | `pageNumber + sourceText` fallback ready; implementation not audited | Same | Node contract/consolidation | **BASELINE MVP FALLBACK READY; PRECISE HIGHLIGHT OPTIONAL/LATER** | P2 Python/FE only if precise highlight is prioritized |
| Parser mode with cloud key | No API/schema change needed | Key presence can select premium parser without explicit mode | Do not advertise OCR quality | Same | Static snapshot audit only | **CONTRACT_GAP BEFORE KEYED ENVIRONMENT** | P1 Python: explicit default-OFF parser mode |
| OCR AUTO/FORCE quality | No baseline dependency | Threshold/provider/rotation/quality policy not finalized | Fallback remains citation text/page | Same | No current OCR runtime evidence | **OPTIONAL/LATER** | Owner/Python decide only if OCR is promoted |
| Hide/unhide/delete retrieval | Business jobs/authorization implemented | Qdrant operations observed | Library fail-closed guidance ready; not audited | Same | Contract/mock; historical live only | **LIVE CROSS-RUNTIME NOT VERIFIED** | P0 included in current isolated lifecycle acceptance |
| Current Node → Python → Qdrant/provider compatibility | Runner/topology implemented | Snapshot available, upstream revision unknown | N/A | N/A | 2026-07-17 run belongs to older baseline; mocks are not live evidence | **VERIFICATION_GAP** | P0 Integration team: run exact HEAD/snapshot in isolated namespace |
| Private corpus release/equivalence | Tooling and local pointer exist | Qdrant snapshot is one store in bundle | N/A | N/A | `corpus:inspect` local-only; no GCS/download/cross-store check in this audit | **VERIFICATION_GAP** | P0 Corpus operator: verify selected remote release and MySQL–Qdrant–original equivalence |
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
- No FE/Mobile repository, Docker conversion, provider call or corpus mutation was part
  of this documentation work.
