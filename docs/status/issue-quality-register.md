# Issue và quality register

Cập nhật: 2026-08-12. Register chỉ giữ issue có evidence hoặc decision gap material.
`P0|P1|P2` là thứ tự xử lý, không phải severity. Historical/live result phải pin revision
và scope; mock/isolated evidence không được nâng thành current full-stack verification.

| ID | Loại | Evidence hiện có | Trạng thái/impact | Hành động tiếp theo |
|---|---|---|---|---|
| `PY-MD-001` | Verification gap | Snapshot citation parser bỏ marker trong inline/fenced code và array index; offline PASS được ghi nhưng không rerun trong closure | Medium; upstream SHA `UNKNOWN` | Chỉ review/upstream trong workstream Python riêng; giữ `answer` string và structured citation authority |
| `RAG-REC-001` | Maintainability/decision gap | Snapshot có bounded activation retry, residual log, consistency inspect và exact manual recovery; `BackgroundTasks` không durable | **UNRESOLVED trước operational acceptance** | Owner/Node/Python/operator chốt owner và gate; không tự bắt buộc queue |
| `INT-LIVE-001` | Verification gap | `23afbec` ghi isolated digital/scanned provider E2E; bounded page probe không phải cross-runtime E2E | `PREVIOUS_REPORT_ONLY`; current runtime/provider unverified | Rerun chỉ với Owner scope, pinned revisions và disposable namespace |
| `CORPUS-EQ-001` | Verification gap | Historical evidence nhắc `v1-7463...`; repository không chứng minh quan hệ với selected release | **UNRESOLVED** historical release equivalence | So manifest/fingerprint read-only khi được phép; không suy từ pointer hoặc `23afbec` |
| `CORPUS-ACC-001` | Verification gap | `23afbec` ghi isolated create-only publish/read-back/clean restore cho `v1-d07f...` | Recorded isolated evidence; không phải current remote verification | Giữ exact-key, GCS/archive-key và current-state review mở |
| `PY-OCR-001` | Verification gap | Explicit `OFF|AUTO` và deterministic fixtures trong snapshot; isolated scan tại `23afbec`; page probe quan sát blank/image OCR | Bounded evidence; general privacy/quota/failure acceptance unverified | Upstream/live acceptance riêng; không suy sparse-page guarantee |
| `PY-PAGE-001` | Contract/provenance gap | Adapter enumerate output; hai jobs cùng fixture trả đủ bốn item, metadata rỗng, không explicit page field | **FIXTURE DID NOT REPRODUCE — RESIDUAL RISK DOCUMENTED** | Không repair bằng ordinal/heuristic; báo limitation |
| `RAG-VIS-001` | Contract gap | Node reject stale callback nhưng Python mutate mọi point theo `doc_id` trước callback | High ordering risk; **UNRESOLVED** | Joint decision cho ordering/versioning/wire; không chọn trong docs |
| `PY-EVAL-001` | Verification gap | Snapshot evaluator có disposable-target guard/tests; Week 5 random simulation không phải metric | Upstream delivery `UNKNOWN`; not rerun | Chỉ dùng disposable collection, measured assertions và non-zero failure exit |
| `DB-MIG-001` | Defect | Runner execute MySQL DDL trước ledger insert; DDL auto-commit | High trước migration DDL kế tiếp | Có pre/postcondition hoặc explicit repair runbook; không blind rerun |
| `PY-LOC-001` | Contract gap | Node validate/persist locator; Python không có production geometry path | `P2 OPTIONAL-LATER`; không giải quyết page identity | Nếu promote, tạo occurrence-specific boxes; không full-page fabrication |
| `DOC-ART-001` | Redundancy | Download và ingest artifact resolver encode mapping riêng; tests đang giữ behavior | Medium future drift; `P2 POST-MVP` | Cân nhắc một internal resolver sau MVP, không đổi contract |
| `TEST-HARNESS-001` | Maintainability | `part2-smoke.js` bao phủ nhiều domain trong một scenario | Medium maintenance; chưa có contract failure | Tách helper/domain fixture sau MVP nhưng giữ một top-level acceptance command |
| `FE-CD-001` | Contract gap | `Content-Disposition` chưa được CORS expose cho browser JS | Low; download vẫn hoạt động | FE dùng metadata fallback; chỉ patch header nếu FE xác nhận cần |
| `CORPUS-SIG-001` | Maintainability | Signal handler resume writer best-effort nhưng direct exit không bảo đảm staging cleanup | Low; pointer-last bảo vệ selected release | Route signal qua normal cleanup khi corpus tooling được sửa tiếp |
| `CORPUS-QDRANT-001` | Verification gap | `f269334` giữ sanitized phase/method/target/status/cause; loopback test unavailable + 401; thiếu original member log/env | Diagnostics corrected; incident **PLAUSIBLE/UNVERIFIED** | Nếu tái diễn, thu exact command/exit/redacted target/Docker status; không blind retry |
| `TOOL-DEP-001` | Maintainability | `@google-cloud/storage → gaxios → node-fetch → whatwg-url → tr46` gây `DEP0040` | Low, non-blocking; `P2 POST-MVP` | Upgrade compatible direct dependency sau corpus regression, không suppress warning |

## Quy tắc đóng issue

- Không đóng `CORPUS-EQ-001` bằng acceptance của release khác.
- Không đóng `RAG-REC-001` hoặc `RAG-VIS-001` bằng isolated happy-path run.
- Không gọi `PY-PAGE-001` resolved vì fixture trả đủ page.
- Không dùng snapshot implementation để tuyên bố Python upstream delivery.
- Issue post-MVP có thể giữ deferred mà không bị hiểu là current task.
