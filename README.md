# EDURAG NodeJS/Core

Backend MVP cho trợ lý học tập RAG. Repository root là NodeJS/Core; [`python-service/`](python-service/) chỉ là integration snapshot từ repository riêng của team Python.

## Kiến trúc ngắn

- NodeJS/Express sở hữu public API, authorization, document/job lifecycle, chat, citation, usage và MySQL transaction.
- Python sở hữu parsing, embedding, retrieval/generation và Qdrant.
- MySQL, Qdrant và upload volume chạy local trong Docker. Private GCS chỉ phân phối immutable portable corpus release; runtime Node/Python không đọc GCS.

## Bắt đầu

Yêu cầu Node.js 20+, Docker Desktop và Docker Compose. Docker image đã gồm LibreOffice cho DOCX PDF preview; chạy Node trực tiếp trên host cần `soffice` trong `PATH` hoặc cấu hình `LIBREOFFICE_COMMAND`.

```powershell
npm ci
Copy-Item .env.example .env
```

Điền các biến bắt buộc trong root `.env`; không commit `.env` hoặc credential trong `secrets/`.

Database hiện hữu chạy `npm run db:migrate`; page/preview cũ kiểm tra trước bằng `npm run documents:backfill -- --dry-run`. Chi tiết và recovery nằm tại [Documents](docs/modules/documents.md).

Remote Python là integration path chính. Full remote stack và optional selected-release bootstrap dùng đúng một command canonical:

```powershell
npm run docker:remote:dev
```

Remote MySQL dành loopback `REMOTE_MYSQL_HOST_PORT` (mặc định `13306`) cho
host-side E2E tooling; containers luôn dùng `db:3306`, nên dịch vụ khác đang
giữ host port `3306` không chặn remote startup.

Command này resolve remote Compose override và force-recreate app để áp dụng `RAG_MODE=remote`; không dùng `docker compose restart` khi chuyển mode vì restart giữ nguyên environment của container cũ. `Ctrl+C` dừng containers nhưng giữ named volumes. Fresh volumes cần reader-capable GCS credential để restore release được pointer chọn; pointer không phải bằng chứng source data đã được phê duyệt. `CORPUS_BOOTSTRAP=auto` chỉ tiếp tục ở trạng thái `DEGRADED` khi local đã được xác nhận `EMPTY` và remote read/configuration thất bại trước mọi local mutation; local `UNKNOWN`, integrity/manifest/apply/rollback failure vẫn fail closed. Live corpus acceptance chỉ chạy sau explicit data approval.

`auto` restores only when MySQL/Qdrant/originals are all empty. A dynamically verified
local release is retained without replacement: exact selected release is a no-op; a valid
different release returns `CORPUS_LOCAL_RELEASE_RETAINED`. Partial/busy/unknown,
invalid-marker and cross-store mismatch states fail closed. The immutable target for an empty restore still comes only from
[`bootstrap/corpus-release.json`](bootstrap/corpus-release.json). Clone/giải nén source mới không xóa Docker volumes cũ; explicit reinstall xem
[Remote Docker RAG](docs/setup/remote-rag-e2e.md#5-lifecycle).

Explicit local reinstall is one command. It pre-verifies the selected release, shows the
exact project/volumes/inventory, asks once, resets only those stores, restores and starts
the stack, then writes READY only after health and consistency pass:

```powershell
npm run corpus:reset
# automation/disposable CI only
npm run corpus:reset -- --yes
```

- Swagger: <http://localhost:5001/api-docs>
- OpenAPI: <http://localhost:5001/api-docs.json>
- Health: <http://localhost:5001/health>
- Readiness (Node + MySQL): <http://localhost:5001/ready>

Demo Admin local: `admin@example.com` / `123456`. Sau login, lấy `[DEV-ONLY ADMIN OTP]` từ app log rồi gọi `POST /api/auth/admin/verify-otp`.

Xem [documentation index](docs/README.md), [project handoff](PROJECT_HANDOFF.md),
[Remote Docker RAG](docs/setup/remote-rag-e2e.md) và
[MVP gap matrix](docs/status/mvp-gap-matrix.md). Các file Week 3/4 là bằng chứng lịch
sử, không phải readiness hiện hành. Project ở mức integration/demo, chưa
production-ready.

---

## Phụ lục — Mock mode (REFERENCE ONLY)

Mock chỉ dành cho regression/quick test; nó không kiểm chứng remote và không phải fallback khi remote lỗi.

```powershell
npm run docker:mock:up
```
