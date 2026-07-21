# Week 3 independent test plan

Checklist cho tester fresh-clone. Không sửa schema/Python runtime và không ghi credential vào evidence.

## 1. Setup

```powershell
npm ci
Copy-Item .env.example .env
```

Điền root `.env` qua kênh an toàn. Đặt reader-only key tại `secrets/gcs.json`; writer key không cần cho acceptance này. Không commit `.env`/credential.

## 2. Automated baseline

```powershell
npm run check
npm run test:node-consolidation
npm run test:openapi
npm run test:docs
npm run test:contract
npm run test:corpus
npm run docker:mock:config
npm run docker:remote:config
```

Các gate trên không gọi paid provider. Mock HTTP regression:

```powershell
npm run docker:mock:up
npm run test:part2
npm run docker:mock:down
```

## 3. Reader-only fresh restore

Giữ `CORPUS_BOOTSTRAP=auto`, dùng một `REMOTE_COMPOSE_PROJECT` mới và chạy:

```powershell
npm run corpus:inspect
npm run docker:remote:dev
```

Expected:

- full release download/verification;
- `CORPUS_RESTORE_OK` với 1 document, 1 job, 2 chunks, 2 citations và 2 Qdrant points;
- one original restored vào upload volume;
- `REMOTE_PREFLIGHT_OK`;
- không có ingest, LlamaParse hoặc document embedding trong bootstrap.

Nhấn `Ctrl+C`, chạy lại cùng project và xác nhận `CORPUS_ALREADY_RESTORED`, counts không duplicate, volumes được giữ.

## 4. Swagger acceptance

Mở `http://localhost:5001/api-docs`.

1. Login Demo Admin `admin@example.com` / `123456`.
2. Lấy OTP từ app log, verify và Authorize bằng user JWT.
3. Xem document/citation metadata: `originalAvailable=true`.
4. Xác nhận `GET /api/documents/{id}/file` và `GET /api/citations/{id}/file` stream original đúng MIME/content-disposition.
5. Xác nhận citation source snapshot không rỗng và không public GCS URL/path.
6. Optional paid check: tạo chat session, gửi một question chỉ có `content`, xác nhận UUID được sinh, answer/citation/usage được persist. Không assert exact LLM wording.

## 5. Negative modes

Không đổi/xóa key thật; trỏ `GCS_CREDENTIALS_FILE` tới explicit nonexistent test path trên một project disposable.

- `auto`: startup degraded/empty, không xóa volumes và không giả vờ corpus đã restore.
- `required`: orchestration fail, containers được stop best-effort và volumes được giữ.
- Local original khác checksum: restore fail, không overwrite.
- Partial/incompatible MySQL–Qdrant state: fail, không merge.

`npm run corpus:verify` phải verify remote release; khi services chạy còn reconcile local counts/mapping/originals. `npm run corpus:restore` lần hai phải idempotent.

## 6. Writer acceptance (manager only)

Manager trên exact-approved, quiescent source chạy `npm run corpus:publish` hai lần. Lần đầu upload data artifacts rồi manifest cuối; lần hai phải `uploaded=0`, không overwrite/delete. Reader-only tester không thực hiện bước này.

## 7. Cleanup và evidence

- `docker:remote:stop`/`down` giữ volumes; `reset` chỉ dùng với project disposable đã xác nhận.
- Không xóa project/volume của người khác.
- `git status --short` không được có `.env`, credential, downloaded dump/snapshot/original hoặc temp artifact.
- Báo branch/commit, command, PASS/FAIL, status/counts, HTTP status/error code và logs đã redact.

Setup canonical: [Remote Docker RAG](../setup/remote-rag-e2e.md). Endpoint semantics: Swagger và [Public API](../api/public-api.md).
