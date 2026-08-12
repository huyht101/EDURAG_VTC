# Trạng thái bàn giao project EDURAG

Cập nhật: 2026-08-12. Đây là authority diễn giải trạng thái project hiện hành, không thay
thế OpenAPI runtime, executable database schema hoặc exact Node–Python contract.

Baseline được rà soát: `main@84776170790cb4b869b61a970029819cec5c071b`
(`Hoàn thiện doc`). Yêu cầu Owner mới hơn tài liệu này quyết định intended scope.

## Nguồn có thẩm quyền

| Nội dung | Authority |
|---|---|
| Intended scope, business rule và MVP boundary | Owner decision và tài liệu domain được [docs index](docs/README.md) định tuyến |
| Public endpoint/request/response | OpenAPI runtime `/api-docs.json` |
| Database hiện hành | [`src/database/schema.sql`](src/database/schema.sql), sau đó là migrations versioned |
| Node–Python JSON/file boundary | [Internal RAG contract v0.1](docs/api/internal-rag-contract.md) |
| Python implementation/delivery | Python upstream; [Python handoff](docs/architecture/python-rag-handoff.md) quản lý gap/acceptance |
| Mức bao phủ yêu cầu hiện hành | [MVP gap matrix](docs/status/mvp-gap-matrix.md) |
| Defect và quality debt | [Issue register](docs/status/issue-quality-register.md) |

Khi intended và implemented state khác nhau, phải ghi gap; không âm thầm sửa một phía để
tài liệu trông nhất quán.

## Trạng thái cuối trước giai đoạn viết báo cáo

- **CURRENT_VERIFIED ở repository boundary:** Node business/API behavior, schema,
  contract fixtures và corpus guards có implementation/test evidence được nêu tại đúng
  domain. Điều này không tự chứng minh deployment/live external state.
- **Python snapshot:** code tích hợp được track, nhưng upstream branch/commit tương ứng
  vẫn `UNKNOWN`; snapshot không phải Python source of truth.
- **PREVIOUS_REPORT_ONLY:** isolated provider/corpus acceptance tại commit `23afbec` chỉ
  có giá trị cho revision/release/scope của lần đó, không phải current rerun.
- **UNVERIFIED:** current full Node → Python → Qdrant/provider E2E, FE/Mobile
  implementation, current remote corpus/GCS state và các operational acceptance gate.
- **OPTIONAL-LATER:** precise geometry/highlight, image chat, subject/course/class,
  billing đầy đủ, mobile admin, object-storage runtime và durable queue redesign.

Project phù hợp integration/demo và viết báo cáo; chưa được gọi là production-ready.

## Quyết định và bất biến đang áp dụng

- Node là thành phần duy nhất ghi MySQL; Python sở hữu Qdrant; client chỉ gọi Node.
- Teacher quản lý document mình upload, Admin quản lý mọi document; Library cho mọi user
  `ACTIVE` nhưng cố định `READY + VISIBLE`.
- PDF/DOCX/TXT thuộc CURRENT. DOCX mới được Node tạo persistent canonical PDF trước khi
  Python ingest; TXT không có physical-PDF semantics.
- Ingest là whole-document lifecycle: retrieval-disabled `is_active=false` → complete
  manifest → Node transaction/machine ACK → activate exact attempt. `is_hidden` là
  visibility state riêng.
- Citation là immutable source snapshot; normal answer phải có structured source map
  được về chunk/document hợp lệ. Node không parse marker trong answer để tạo citation.
- Corpus release là immutable coordinated package của scoped MySQL, Qdrant và originals;
  GCS không phải bidirectional/runtime sync.

## Rủi ro tồn dư và gap chưa đóng

| ID/chủ đề | Trạng thái hiện hành |
|---|---|
| `PY-PAGE-001` | Hai probe cùng fixture trả đủ bốn page ổn định nhưng legacy result không có explicit physical-page field. **FIXTURE DID NOT REPRODUCE — RESIDUAL RISK DOCUMENTED**; không suy ordinal thành provider guarantee. |
| `RAG-VIS-001` | Stale hide/unhide có thể mutate Qdrant trước khi Node từ chối callback; chưa chọn versioning/wire/ordering strategy. |
| `RAG-REC-001` | Bounded exact-attempt recovery có offline implementation evidence; recovery ownership và operational acceptance gate chưa chốt. |
| Python provenance | Exact upstream branch/commit của tracked snapshot là `UNKNOWN`. |
| `CORPUS-EQ-001` | Quan hệ/equivalence của historical `v1-7463...` chưa được repository evidence giải quyết. |
| `CORPUS-ACC-001` | Acceptance của `v1-d07f...` tại `23afbec` là recorded isolated evidence; không đóng exact-key, GCS/archive-key hoặc current remote-state review. |
| `CORPUS-QDRANT-001` | Mobile log và synthetic socket-close regression xác nhận equivalent startup-readiness defect. Shared `/readyz` deadline/backoff đã test local; member rerun vẫn chưa có. |
| `DB-MIG-001` | Interrupted multi-statement MySQL DDL cần inspect/repair plan; thiếu ledger row không chứng minh chưa có statement nào apply. |
| Live E2E | Tích hợp Node–Python–Qdrant/provider và FE/Mobile hiện hành chưa được xác minh end-to-end. |

Chi tiết page/geometry nằm tại [source locator](docs/architecture/source-locator-handoff.md);
corpus tại [corpus portability](docs/architecture/corpus-portability.md); Python delivery
tại [Python handoff](docs/architecture/python-rag-handoff.md).

## Bằng chứng LlamaParse có giới hạn

Hai successful jobs ngày 2026-08-11 dùng cùng synthetic PDF bốn trang, cùng bytes,
`llama-parse==0.6.4`, method/options của repository. Cả hai trả marker trang 1, blank
sentinel, OCR marker trang 3 và marker trang 4 theo cùng thứ tự; metadata của mọi legacy
Document là `{}`. Evidence này chỉ chứng minh repeatability của fixture, không phải
documented provider contract cho output sparse/omitted/merged. Parser không sửa và dữ
liệu cũ không re-ingest.

## Tiếp tục project

1. Đọc `AGENTS.md`, file này và authority domain liên quan.
2. Ghi branch/HEAD/index/worktree, bảo toàn user changes.
3. Không dùng historical/mock/isolated evidence để nâng current state.
4. Không chọn metadata convention, recovery owner, queue hoặc wire strategy nếu chưa có
   Owner decision và evidence phù hợp.
5. Giai đoạn hiện tại ưu tiên demo, bàn giao và viết báo cáo; mọi runtime workstream mới
   cần scope riêng.
