# Ma trận phạm vi và gap MVP

Cập nhật: 2026-08-12. “Hướng dẫn sẵn sàng” chỉ nghĩa contract được tài liệu hóa; repository
FE/Mobile không được audit. `23afbec` là isolated historical evidence, không phải current
rerun. Bounded LlamaParse probe chỉ chứng minh fixture repeatability.

| Hạng mục | Trạng thái triển khai | Ranh giới bằng chứng | Trạng thái/hành động tiếp theo |
|---|---|---|---|
| Role, approval, lock, `auth_version` | Node đã triển khai | Local/contract tests | Đã triển khai + local tested; giữ regression |
| Avatar cá nhân | Self-only private storage/API | `test:user-assets`, OpenAPI | Đã triển khai; database hiện hữu cần migration, FE/Mobile chưa audit |
| Admin user CSV | ADMIN-only allowlist export | `test:user-assets`, OpenAPI | Đã triển khai; FE dùng nếu cần |
| Management và Library | Ownership + fixed `READY + VISIBLE` scope | `test:documents`, `test:library` | Node implemented; FE/Mobile integration unverified |
| PDF lifecycle | Uploaded PDF là preview/download/ingest artifact | Node tests; isolated run `23afbec`; bounded page probe | Đã triển khai; general page provenance còn rủi ro |
| DOCX canonical PDF | Node tạo persistent PDF trước ingest | Node tests; isolated conversion/ingest tại `23afbec` | Đã triển khai; live current/page provenance unverified |
| TXT lifecycle | Uploaded TXT, không PDF semantics | Contract tests | Node implemented; cross-runtime live unverified |
| Whole-document ACK/activate | Node transaction/machine ACK; Python `is_active=false` trước ACK | Contract/offline lifecycle; isolated path tại `23afbec` | Đã triển khai offline; không suy operational acceptance |
| Recovery | Exact attempt timeout preserved; bounded recovery helpers tồn tại | Repository-recorded offline evidence | Ownership/gate **UNRESOLVED**; queue không tự bắt buộc |
| Markdown answer | Node giữ string; snapshot parser bỏ false markers | Node contract + recorded Python offline tests | Boundary đã triển khai; live rich generation unverified |
| Structured citation/usage | Fail-closed mapping, immutable snapshot, ordered usage | Offline tests; basic isolated citation at `23afbec` | Contract agreed; current provider state unverified |
| Physical-page identity | Node nhận 1-based page khi trustworthy; adapter enumerate output | Hai probe trả đủ fixture, metadata rỗng | **FIXTURE DID NOT REPRODUCE — RESIDUAL RISK DOCUMENTED** |
| Source locator | Node validate/persist nullable normalized boxes | Node contract/local tests | Geometry `OPTIONAL-LATER`; page gap riêng |
| Parser/OCR mode | Snapshot có explicit `OFF|AUTO`; key không tự bật | Config/mock tests; bounded OCR observation | Đã triển khai offline; general live acceptance unverified |
| Hide/unhide/delete | Node active-job/stale callback guard; Python mutation document-wide | Offline + isolated flow at `23afbec` | `RAG-VIS-001` ordering gap unresolved |
| Node–Python–Qdrant hiện hành | Production boundary có deterministic offline providers | Offline E2E + isolated historical provider evidence | Chưa có current full-stack rerun |
| Private corpus acceptance | Selected pointer `v1-d07f...`; tooling/marker tồn tại | Isolated acceptance tại `23afbec` | Current remote/exact-key/GCS review unverified |
| Fresh corpus bootstrap | Data services bootstrap trước inspect | `8abff73`, local regressions | Đã triển khai local; không nâng Docker/live state |
| Qdrant diagnostics | Sanitized phase/method/target/status/cause | `f269334`, loopback regressions | Diagnostic fixed; member incident unverified |
| Historical release relation | `v1-7463...` còn trong provenance | Không có manifest comparison | `CORPUS-EQ-001` unresolved |
| Subject/course/class | Không có schema/public API | Schema/OpenAPI | `OPTIONAL-LATER` |
| PPTX, byte Range, image chat, chart protocol | Không thuộc CURRENT | Code/OpenAPI | `OPTIONAL-LATER`/product decision |
| Legacy DOCX page alignment | Snapshot cũ không được backfill/re-ingest tự động | Không có controlled legacy evidence | Legacy limitation; chỉ xử lý bằng workstream riêng |

## Ranh giới evidence

- Syntax/unit/contract/local HTTP suite chỉ chứng minh named boundary.
- `test:part2` dùng Node/MySQL/HTTP thật nhưng deterministic RAG mock.
- Isolated runs tại `23afbec` không đóng recovery, visibility hoặc current corpus gap.
- Page probe dùng hai submissions của một synthetic fixture; không có explicit page field.
- `corpus:inspect` không verify private GCS object/checksum/store equivalence.
- Documentation closure không chạy Docker/provider, không mutate corpus và không audit FE/
  Mobile implementation repository.
