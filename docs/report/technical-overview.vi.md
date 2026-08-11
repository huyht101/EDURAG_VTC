# Tổng quan kỹ thuật EDURAG phục vụ viết báo cáo

Tài liệu này là entry point bằng tiếng Việt cho giai đoạn viết báo cáo. Nó tóm tắt phạm
vi, kiến trúc, business rules, dữ liệu và mức evidence; chi tiết vẫn thuộc các nguồn
canonical được liên kết. Không dùng bản tóm tắt này để thay OpenAPI runtime,
[`schema.sql`](../../src/database/schema.sql) hoặc
[internal RAG contract](../api/internal-rag-contract.md).

## 1. Mục tiêu và trạng thái project

EDURAG là backend MVP cho trợ lý học tập dùng Retrieval-Augmented Generation. Repository
gốc chứa NodeJS/Core; [`python-service/`](../../python-service/) là integration snapshot
từ upstream riêng của team Python/Data-RAG.

| Nhãn | Trạng thái report-ready |
|---|---|
| **DECISION** | Node sở hữu public API, business state và MySQL; Python sở hữu RAG/Qdrant; client không gọi Python trực tiếp. |
| **CURRENT_VERIFIED** | Runtime/schema/contracts hiện hành đã được đối chiếu trong final cleanup. Fresh corpus bootstrap ordering và Qdrant diagnostics có code/regression local ở baseline `f269334`. |
| **CURRENT_VERIFIED — bounded probe** | Hai LlamaParse jobs cùng fixture bốn trang cho output nhất quán; blank page có sentinel và image-only page được OCR. Fixture không tái hiện lệch trang. |
| **PREVIOUS_REPORT_ONLY** | Live provider/corpus acceptance tại commit `23afbec` là isolated evidence của revision/scope đó, không phải current rerun. |
| **UNVERIFIED / UNKNOWN** | Live Node→Python→Qdrant hiện hành, FE/Mobile implementation, general sparse-output page identity, current remote corpus/GCS state và exact Python upstream revision. |
| **OPTIONAL-LATER** | Precise geometry/highlight, subject/course/class, PPTX, image chat, byte Range, object storage, full AI-cost accounting và durable queue redesign. |

Project phù hợp integration/demo và chuẩn bị báo cáo; chưa được gọi là production-ready.
Trạng thái chi tiết: [project handoff](../../PROJECT_HANDOFF.md),
[MVP gap matrix](../status/mvp-gap-matrix.md) và
[issue register](../status/issue-quality-register.md).

## 2. Phạm vi CURRENT/MVP

- Account/Auth: Student/Teacher registration, Teacher approval, lock/unlock, Admin OTP,
  password reset/change, profile/avatar và global JWT invalidation bằng `auth_version`.
- Document Management: Teacher quản lý document của mình; Admin quản lý toàn bộ; upload
  PDF/DOCX/TXT, metadata, preview, hide/unhide/delete và processing jobs.
- Document Library: mọi account `ACTIVE` đọc document cố định `READY + VISIBLE`; API
  không trả owner/storage/job internals.
- Chat/RAG: durable session/history trong MySQL, idempotent `clientRequestId`, structured
  answer/citation/usage và fail-closed khi answer có nguồn không xác minh được.
- Citation/source: immutable snapshot, authenticated file routes, canonical PDF preview
  cho PDF và DOCX mới.
- Admin dashboard: aggregate document/chat/citation và `LLM_CALLS_ONLY` usage.
- Portable corpus: host-side immutable private release cho MySQL scoped data, Qdrant
  snapshot và originals; không phải runtime synchronization.

Business/module detail: [Account/Auth](../modules/account-auth.md),
[Documents](../modules/documents.md), [Chat/Citations](../modules/chat-citations.md) và
[Usage/Dashboard](../modules/usage-dashboard.md).

## 3. Kiến trúc và trách nhiệm

```text
Web/Mobile
   │ user JWT
   ▼
NodeJS/Core ───────► MySQL + local original/preview files
   │ internal Bearer + shared file path
   ▼
Python RAG ────────► Qdrant + approved AI/parser providers
```

- NodeJS/Express chịu trách nhiệm authentication, authorization, lifecycle, transaction,
  public DTO/error và immutable business history.
- Python/FastAPI chịu trách nhiệm parse, chunk, embed, retrieval/generation và Qdrant.
- MySQL là nguồn chuẩn cho identity, document/job/chunk mapping, chat, citation snapshot
  và usage. Python không ghi MySQL; Node không truy cập Qdrant.
- File storage giữ original và canonical preview artifact. GCS chỉ được host-side corpus
  tooling dùng để phân phối immutable release; runtime app/RAG không đọc GCS.
- MySQL–Qdrant không có distributed transaction; lifecycle dùng exact attempt,
  fail-closed state, complete manifest và idempotent callback.

Xem [system overview](../architecture/system-overview.md),
[Node architecture](../architecture/nodejs-core.md) và
[RAG boundary](../architecture/rag-boundary.md).

## 4. Business rules cốt lõi

- Một user có đúng một role: `STUDENT`, `TEACHER` hoặc `ADMIN`.
- Student đăng ký `ACTIVE`; Teacher đăng ký `PENDING` và cần Admin review. Chỉ account
  `ACTIVE` với `auth_version` hiện hành dùng chức năng chính.
- Teacher chỉ quản lý document do mình upload; Admin quản lý mọi document. Library là
  read-only scope riêng cho mọi role `ACTIVE` và luôn cố định `READY + VISIBLE`.
- Thay file tạo document row mới; metadata title/description/author không tự re-ingest.
- Delete document là soft delete business state và xóa vector qua Python; original và
  MySQL/citation history được giữ. Chat session dùng `deleted_at`, không xóa message.
- Citation snapshot giữ title/page/section/source/locator tại thời điểm trả lời. Session
  owner mới đọc được; Admin không có public bypass cho chat history.
- `no_answer=true` là success hợp lệ và không có citation giả. `no_answer=false` phải có
  ít nhất một structured source map được về chunk/document hợp lệ.
- Subject/course/class access scope chưa có trong schema/API và không được suy ra từ
  compatibility field phía Python.

## 5. Database và data lifecycle

Executable schema authority là [`src/database/schema.sql`](../../src/database/schema.sql):
Docker fresh bootstrap mount file này trước
[`demo_seed.sql`](../../src/database/demo_seed.sql); database hiện hữu dùng các migration
versioned trong [`src/database/migrations/`](../../src/database/migrations/).

Schema có 12 business tables thuộc Identity, Documents, Chat và Observability, cùng
`schema_migrations`. Node là write owner duy nhất. ERD, lifecycle, FK/cardinality và
dictionary hiện hành nằm tại [database index](../database/README.md),
[design/ERD](../database/design.md) và [data dictionary](../database/data-dictionary.md).

Demo seed chỉ tạo `admin@example.com` idempotently cho local/demo. Nó không phải dữ liệu
production. MySQL DDL auto-commit khiến migration nhiều statement bị ngắt có thể để schema
partial trước ledger row; `DB-MIG-001` yêu cầu inspection/repair plan, không blind rerun.

## 6. Artifact, ingest và retrieval lifecycle

| Upload | Original | Canonical preview / Student download / Python ingest |
|---|---|---|
| PDF | Uploaded PDF | Cùng validated PDF bytes |
| DOCX | Uploaded DOCX, chỉ owner Teacher/Admin | Persistent PDF do Node tạo trước ingest |
| TXT | Uploaded TXT | Uploaded TXT; không có PDF/page geometry semantics |

Whole-document ingest contract:

```text
Node upload/job
→ Python parse/chunk/embed
→ Qdrant upsert retrieval-disabled (`is_active=false`)
→ complete manifest
→ Node transaction + machine-readable ACK
→ Python activate exact attempt
```

`is_hidden` là visibility state riêng, không đồng nghĩa với retrieval-disabled pre-ACK.
Node chỉ chuyển business state sau boundary phù hợp. `BackgroundTasks` phía Python không
phải durable queue; bounded exact-attempt recovery có implementation offline nhưng owner
và operational acceptance gate vẫn chưa chốt. Hide/unhide mutation hiện document-wide;
stale callback rejection phía Node không tự chứng minh Qdrant mutation ordering an toàn.

Flow sources: [flow index](../flows/README.md) và
[Python handoff](../architecture/python-rag-handoff.md).

## 7. Chat, retrieval và citation

Node commit cặp USER/ASSISTANT `PENDING` trước RAG call, gửi bounded history rồi persist
completion/citations/usage transactionally. `clientRequestId` bảo đảm retry không tạo paid
call/message pair thứ hai. Retrieval chỉ dùng corpus hợp lệ theo Python payload và Node
chỉ chấp nhận citation map được về chunk của document `READY + VISIBLE` tại thời điểm trả
lời.

Page provenance là residual risk riêng:

- Hai live runs 2026-08-11 với cùng fixture bốn trang, package versions/method/options
  trả đủ bốn output nhất quán; blank page có `NO_CONTENT_HERE`, image-only page được OCR.
- Legacy `aload_data(split_by_page=True)` trả metadata rỗng, không có explicit canonical
  physical-page field. Adapter vẫn enumerate output ordinal.
- Kết luận đúng mức:
  **FIXTURE DID NOT REPRODUCE — RESIDUAL RISK DOCUMENTED**. Repeatability của fixture
  không phải provider guarantee khi output bị bỏ/gộp.
- `sourceLocator` nullable. Geometry/precise highlight là **OPTIONAL-LATER** và không thể
  sửa page identity. Source text vẫn hiển thị như immutable snapshot; điều hướng PDF chỉ
  đáng tin khi page identity đáng tin.

Authority: [source locator](../architecture/source-locator-handoff.md) và
[frontend integration](../api/frontend-integration.md).

## 8. API và contract

- Public request/response/status/error authority: runtime `/api-docs.json`; human overview
  ở [Public API](../api/public-api.md).
- Node–Python JSON/file boundary: [internal RAG contract v0.1](../api/internal-rag-contract.md).
- Web/Mobile consumption, protected Blob/file viewer và fallback:
  [Frontend integration](../api/frontend-integration.md).
- Database shape không được suy từ OpenAPI và RAG payload không được suy từ handoff.

Node dùng camelCase public/internal code; boundary Python dùng snake_case. User JWT và
`RAG_INTERNAL_TOKEN` là hai trust domain khác nhau. Storage key, internal vector ID,
credential và raw provider diagnostic không thuộc public response.

## 9. Setup, demo và deployment

Canonical setup bắt đầu tại [root README](../../README.md). Full remote topology dùng:

```powershell
npm ci
Copy-Item .env.example .env
npm run docker:remote:dev
```

Mock mode chỉ là regression/reference, không phải fallback khi remote lỗi. Existing DB
phải migrate có backup; fresh container chạy schema+demo seed. Corpus `auto` chỉ restore
selected immutable release khi local MySQL/Qdrant/uploads được xác nhận empty; partial,
unknown, mismatch hoặc integrity failure fail closed.

Commit `8abff73` sửa fresh-state ordering để data services được bootstrap trước local
inspection trong default path. Commit `f269334` giữ phase/method/sanitized target/status/
cause cho Qdrant request errors. Lỗi member lịch sử chưa có original log/environment nên
vẫn **PLAUSIBLE/UNVERIFIED**, không được gọi là reproduced/closed.

Setup chi tiết: [local development](../setup/local-development.md),
[remote RAG](../setup/remote-rag-e2e.md),
[corpus portability](../architecture/corpus-portability.md). Phase 2 live runbook là
Owner-run và không tự cấp quyền dùng provider/canonical data.

## 10. Evidence và mức hoàn thành

### Đã triển khai và xác minh ở boundary local/contract

- Node auth/account/avatar/Admin CSV, document/library/preview, callback/manifest,
  chat/idempotency/citation/usage và OpenAPI/contract boundaries.
- Database DDL/migrations/data dictionary được đối chiếu tĩnh; executable schema vẫn là
  authority.
- Corpus validation/identity/recovery logic và fresh-order/Qdrant diagnostic regressions
  có local/offline coverage; điều này không chứng minh GCS hay canonical stores hiện tại.

### Đã triển khai nhưng chưa current live E2E

- Current Node→Python→Qdrant/provider topology và full digital/scanned/mixed/TXT paths.
- FE/Mobile behavior: repository này chỉ có contract/guidance, không có implementation
  repository để audit.
- Python snapshot overlays chưa có exact accepted upstream branch/commit.

### Chỉ xác minh mock/isolated hoặc historical

- `test:part2` và các deterministic provider paths là local/mock boundary.
- Commit `23afbec` lưu isolated provider/corpus acceptance cho exact revisions/release tại
  thời điểm đó: **PREVIOUS_REPORT_ONLY**, không chứng minh current external state.
- Week 3/4 files và Week 5 evaluation note là
  **HISTORICAL — NOT CURRENT AUTHORITY**. Random simulation không phải quality metric.

## 11. Security và data practices

- Không commit `.env`, plaintext key/token, upload thật, DB dump, Qdrant data hoặc raw
  provider response. Public errors/logs phải sanitize secrets và internal paths.
- File/Blob route luôn authenticated; storage directory không được public static mount.
- Corpus release dùng private target, create-only artifact, checksum/inventory/
  compatibility validation, manifest-last và verify-before-pointer.
- Hai encrypted credential archives đang track dưới `secrets/` được giữ theo explicit
  Owner decision ghi tại [`secrets/README.md`](../../secrets/README.md); đây không phải
  quyền thêm credential/archive mới và nội dung archive không được coi là verified.
- Demo/evaluation fixtures là test input, không phải canonical user/corpus data.

## 12. Current limitations và residual risks

- `PY-PAGE-001`: general canonical physical-page identity vẫn unverified khi LlamaParse
  output khác cardinality/order của PDF.
- `RAG-VIS-001`: stale hide/unhide ordering chưa có wire/version strategy.
- `RAG-REC-001`: recovery/reconciliation ownership và operational acceptance gate chưa chốt.
- Python upstream branch/commit: **UNKNOWN**.
- `CORPUS-EQ-001`: relationship/equivalence của historical `v1-7463...` chưa có evidence.
- `CORPUS-ACC-001`: selected-release acceptance tại `23afbec` là isolated historical;
  current exact-key, GCS/archive-key và remote-state review chưa đóng.
- `DB-MIG-001`: interrupted multi-statement DDL cần explicit inspection/repair.
- Durable queue, precise geometry, full OCR quality acceptance, FE/Mobile integration và
  production hardening còn ngoài current verified boundary.

Các limitation này không được tự đổi thành completed/cancelled chỉ để hoàn thiện báo cáo.
Nếu cần quyết định hoặc evidence mới, dùng [issue register](../status/issue-quality-register.md)
và tạo workstream riêng có Owner scope.
