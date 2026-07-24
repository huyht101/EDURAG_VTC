# EDURAG_VTC — Project handoff

> Continuity snapshot, không phải quyền tự động thay đổi repository. Khi có mâu thuẫn, runtime và tests hiện tại được ưu tiên hơn file này.

## 1. Snapshot

- [VERIFIED] Kiểm tra lúc `2026-07-23T21:48:53+07:00` (Asia/Saigon; cùng UTC+7 với Asia/Bangkok trong capsule).
- [VERIFIED] Repository: `EDURAG_VTC`; remote `origin`: `https://github.com/huyht101/EDURAG_VTC.git`.
- [VERIFIED] Branch `main`; HEAD `15c042b1c642174c062baa3f582f261eaba46fb8`.
- [VERIFIED] `git ls-remote origin refs/heads/main` trả đúng `15c042b1c642174c062baa3f582f261eaba46fb8`; local HEAD và remote `main` trùng nhau tại thời điểm kiểm tra. Không fetch/pull/merge/rebase.
- [VERIFIED] Commit gần nhất:
  1. `15c042b` — `Đừng chạy nhầm mock`;
  2. `6ffd8b5` — `doc`;
  3. `2de8711` — `update corpus(snapshot+doc)`;
  4. `aa98b20` — `Hot fix`;
  5. `8a6e88f` — `Consolidation+bảo mật(cors, rate limit,...)`.

## 2. Dirty worktree

- [VERIFIED] Baseline trước handoff sạch: staged `NONE`, unstaged `NONE`, untracked `NONE`; `git diff --stat` và cached diff đều rỗng.
- [VERIFIED] `docs/handoff/PROJECT_HANDOFF.md` chưa tồn tại trước lượt này, nên không có nội dung không rõ nguồn gốc bị ghi đè.
- [DECISION] Thay đổi duy nhất của lượt handoff là file này. Sau lượt này file dự kiến ở trạng thái untracked; không stage/commit/push.
- [VERIFIED] Không có dirty changes có sẵn cần bảo toàn tại baseline này. Quy tắc không reset/ghi đè vẫn áp dụng cho session sau nếu worktree thay đổi.

## 3. Scope, architecture và quyết định đã chốt

- [DECISION] NodeJS/Core sở hữu public API, auth/authorization, MySQL, document/job lifecycle, chat, citation snapshot và usage. Node dùng `mysql2/promise`, không ORM.
- [DECISION] `python-service/` là snapshot read-only từ repository Python/Data-RAG. Python sở hữu parsing/chunking/embedding/retrieval/generation và Qdrant. Python không ghi MySQL; Node runtime không truy cập Qdrant.
- [DECISION] Ba role: `ADMIN`, `TEACHER`, `STUDENT`. TEACHER cần ADMIN approve; ADMIN được seed. Account lock/unlock, không hard delete.
- [DECISION] TEACHER chỉ quản lý document mình upload; ADMIN quản lý mọi document; STUDENT không dùng Document Management API. Retrieval dùng toàn bộ document `READY + VISIBLE`, không có per-document selection/course/class/group permission trong MVP.
- [DECISION] PDF/DOCX/TXT; file gốc local. Không edit/version content in-place; thay nội dung bằng upload mới. Processing theo job, Python callback một complete manifest. Không public reprocess hoặc auto retry.
- [DECISION] Chat session thuộc owner và soft-delete. `clientRequestId` là idempotency key; citation là immutable snapshot; usage có thể có nhiều row cho một message.
- [DECISION] Base Compose và `.env.example` dùng `RAG_MODE=mock`; remote Python là integration path chính và chỉ bật chủ động bằng remote Compose. Mock là deterministic regression stub, không được dùng làm bằng chứng live Python.
- [DECISION] Portable Corpus là coordinated release của scoped MySQL + Qdrant + originals; GCS chỉ do host-side tooling dùng. Đây không phải bidirectional sync hay distributed transaction.

## 4. Verified current state

### Runtime/API và security

- [VERIFIED] Mounted document router áp dụng auth + role `TEACHER|ADMIN` cho toàn bộ `/api/documents`; STUDENT bị `403`, đúng với ownership contract hiện tại.
- [VERIFIED] Upload document trả accepted async flow; job cần được poll. Hide khác delete; citation snapshot được giữ theo chat/session policy.
- [VERIFIED] Chat mới tạo USER + ASSISTANT `PENDING`, gọi RAG ngoài DB transaction và success trả assistant `COMPLETED` trong cùng HTTP request. Duplicate ID có thể trả `PENDING|COMPLETED|FAILED`; cross-session ID trả `409`.
- [VERIFIED] Normal answer (`noAnswer=false`) phải có structured citation được map tới chunk/document `READY + VISIBLE`; Node fail closed khi citation không xác minh được. `noAnswer=true` dùng citations rỗng.
- [VERIFIED] Logout hiện là logout-all bằng concurrency-safe `auth_version`. JWT khóa algorithm/issuer/audience/purpose/sub/jti/version/expiry; password reset/change và lock invalidate JWT theo code hiện tại.
- [VERIFIED] `/health` là liveness; `/ready` chỉ probe Node + MySQL, không chứng minh Python/Qdrant/provider khỏe.

### NodeJS–Python–Qdrant

- [VERIFIED] Internal contract dùng Bearer riêng; remote Compose map `RAG_INTERNAL_TOKEN` sang Python `INTERNAL_SECRET`, shared upload read/write ở Node và read-only ở Python.
- [VERIFIED] Contract hiện có `attempt_count`, complete chunk manifest, full text/hash, `vector_node_id`, citation và usage. Embedding là `gemini-embedding-001`, dimension 768; Qdrant server pin `1.18.2`, Python client pin `1.17.1`.
- [REPORTED] Live Node → Python → LlamaParse/Gemini → Qdrant → callback → Node/MySQL và Reader-only Corpus restore từng PASS trong các lượt trước. Không chạy lại ở lượt handoff; không coi đây là fresh evidence cho HEAD hiện tại.
- [OPEN] Python vẫn có handoff về activation trước Node ACK, random point identity/partial ingest cleanup, durable queue và đầy đủ `usage_calls[]`. Không đánh dấu các invariant này đã hoàn tất upstream.

### Corpus

- [VERIFIED] Local release pointer là `v1-ea667ac6e11d1d348a956591` trong `bootstrap/corpus-release.json`.
- [VERIFIED] Corpus tooling hiện phân biệt `EMPTY|PRESENT|UNKNOWN|ERROR`; `auto` chỉ restore empty, `required` strict, `off` không truy cập cloud. Dry-run được thiết kế read-only; publish create-only và pointer chỉ đổi sau verify.
- [OUTDATED] `docs/architecture/corpus-portability.md` vẫn ghi release `v1-be5f3fc5669b25984d2333ca`. Không sửa trong lượt handoff.
- [UNVERIFIED] Cloud `current` pointer, manifest/artifact của release mới và counts thực tế chưa được đọc lại vì lượt này không thực hiện cloud operation.

### Contract FE/Mobile mới nhất

- [VERIFIED] Chat text: `POST /api/chat/sessions/{id}/messages`; history: `GET /api/chat/sessions/{id}/messages`; shape dùng `data.messages`, `senderType`, citations array. Request mới thường không cần poll; duplicate `PENDING` mới cần reload/poll history.
- [VERIFIED] Image chat chưa implement. Không multipart/image field hay vision path.
- [VERIFIED] Original endpoints stream attachment: `/api/documents/{id}/file` cho uploader/Admin và `/api/citations/{id}/file` theo session + source authorization. Không derived DOCX/PDF preview, Range/206 hoặc coordinate boxes.
- [VERIFIED] `sourceLocator` optional/opaque; Python snapshot không tạo locator/boxes. DOCX/TXT page có thể là synthetic fragment; FE dùng `sourceText` fallback.
- [VERIFIED] CORS dùng exact allowlist, Bearer header, không cookie credentials. `Content-Disposition` chưa expose cross-origin.
- [VERIFIED] Email chỉ enforce format chung; không có server rule `@student.edu.vn`. BA/Owner chưa chốt domain.

## 5. Test evidence

Không chạy test application/Docker/cloud trong lượt handoff.

| Evidence | Trạng thái và phạm vi |
|---|---|
| `npm run check` | [REPORTED] PASS ở session trước trên worktree sau đó được commit thành `6ffd8b5`; HEAD hiện chỉ thêm thay đổi README. |
| `npm run test:openapi` | [REPORTED] PASS, `34` operations/`11` tags; không chứng minh runtime Python. |
| `npm run test:docs` | [REPORTED] PASS, link/command inventory; không chứng minh API behavior. |
| `npm run test:contract` | [REPORTED] PASS với Node boundary fixtures/fake transport; không phải live Python. |
| `npm run test:node-consolidation` | [REPORTED] PASS targeted Node units/local HTTP. |
| `npm run test:part2` | [REPORTED] PASS trên disposable Node + MySQL với deterministic RAG mock; không phải remote RAG. |
| Live remote/GCS/Qdrant | [REPORTED] historical PASS; [UNVERIFIED] tại HEAD/release hiện tại vì không chạy lại. |

## 6. Current task

- [OPEN] Mục tiêu: `NONE / CHƯA CHỐT`. Tạo handoff không phải current task.
- [OPEN] Trạng thái: không có yêu cầu triển khai kỹ thuật mới đã được xác nhận.
- [OPEN] Blocker: không có blocker kỹ thuật; cần yêu cầu cụ thể của Owner/BA trước khi sửa.
- [DECISION] Bước tiếp theo chính xác: session mới đọc file này, kiểm tra lại `git status`/HEAD, sau đó chờ hoặc xử lý yêu cầu mới theo đúng scope. Không tự chọn các open item làm task.

## 7. CURRENT/MVP và OPTIONAL/LATER

- [VERIFIED] CURRENT/MVP: auth/profile/password, teacher approval và user lock; document management + jobs/callback; chat/history/idempotency; citation/source snapshot; usage/dashboard; Swagger; mock/remote Docker; portable Corpus tooling.
- [LATER] PPTX/OCR, image/vision chat, coordinate highlight, generated preview, byte Range, advanced search, object-storage runtime, public retry/reprocess, per-document selection, course/class/group permissions, document versioning, billing/LMS và Mobile management UX.

## 8. Mâu thuẫn và việc cần kiểm chứng lại

- [OUTDATED] Capsule nói OpenAPI lịch sử `26 paths/33 operations`; evidence gần nhất báo `34 operations`. Dùng spec/runtime hiện tại.
- [OUTDATED] Capsule nói chưa có live E2E đủ; repository báo historical live integration PASS, nhưng vẫn chỉ là [REPORTED] cho đến khi chạy lại trên topology/release được chỉ định.
- [OUTDATED] Corpus architecture ghi release cũ `v1-be…`; local pointer là `v1-ea…`.
- [OPEN] Pagination unsafe integer/`limit=0`, CORS expose filename, timeout ordering, email domain, image/highlight/preview/Range và Python activation/retry vẫn cần task/decision riêng.
- [UNVERIFIED] Giá trị deployment env, cloud state và runtime containers không được kiểm tra; không suy đoán từ `.env`.

## 9. Working constraints

- [DECISION] Không reset, checkout đè, clean, stash hoặc ghi đè dirty worktree.
- [DECISION] Không stage/commit/push/open PR nếu chưa được yêu cầu rõ.
- [DECISION] Không tự sửa schema, public ownership hoặc mở rộng MVP/scope.
- [DECISION] Runtime/tests là nguồn chính; docs/handoff/report chỉ là context.
- [DECISION] Review/diagnose không tự cấp quyền implement. Không gọi paid provider, mutate cloud/Corpus hoặc destructive volumes nếu chưa được phép.
