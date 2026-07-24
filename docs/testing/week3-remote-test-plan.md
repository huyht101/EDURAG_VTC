# Week 3 independent test plan

Checklist cho tester fresh-clone. Không sửa schema/Python runtime và không ghi credential vào evidence.

## 1. Setup

```powershell
npm ci
Copy-Item .env.example .env
```

Điền root `.env` qua kênh an toàn. Baseline/unit tests không cần reader/writer key. Chỉ đặt reader-only key tại `secrets/gcs.json` khi chạy live lifecycle với bundle đã được phê duyệt. Không commit `.env`/credential.

## 2. Automated baseline

```powershell
npm run check
npm run test:node-consolidation
npm run test:openapi
npm run test:library
npm run test:docs
npm run test:contract
npm run test:corpus
npm run docker:mock:config
npm run docker:remote:config
```

Các gate trên không gọi paid provider. `test:corpus` là unit/local simulation bằng fake object store và fixture tạm; PASS chỉ chứng minh validation/identity/rollback/zero external mutation, không chứng minh live export/restore/query. Mock HTTP regression:

```powershell
npm run docker:mock:up
npm run test:part2
npm run docker:mock:down
```

## 3. Partial-failure isolation

Chỉ chạy với project mới, prefix bắt buộc và explicit confirmation:

```powershell
$env:REMOTE_COMPOSE_PROJECT='edurag_corpus_partial_<unique-run-id>'
$env:REMOTE_E2E_CONFIRM_ISOLATED='true'
npm run test:corpus:partial
```

Script từ chối nếu container/volume/network của project đã tồn tại, dùng random host ports, chỉ start MySQL/Qdrant của project đó, mô phỏng upload volume rỗng để không build/start app/Python, và cleanup đúng namespace trong `finally`. Không chạy với default/development project.

## 4. Live corpus lifecycle — approved bundle only

Nếu chưa có approved source bundle, ghi `BLOCKED BY DATA APPROVAL` và không chạy phần này. Pointer trong `bootstrap/` không tự chứng minh approval. Khi đã có approval, giữ `CORPUS_BOOTSTRAP=auto`, dùng một `REMOTE_COMPOSE_PROJECT` mới và cấu hình:

```powershell
$env:CORPUS_APPROVED_BUNDLE_CONFIRMED='true'
$env:CORPUS_APPROVED_RELEASE_ID='<reviewed release matching bootstrap pointer>'
$env:CORPUS_APPROVED_DOCUMENT_ID='<reviewed document id>'
$env:CORPUS_APPROVED_QUERY='<question answerable by reviewed document>'
npm run docker:remote:dev
# In a second terminal with the same approved variables:
npm run test:corpus:live
```

Expected:

- full selected-release download/verification;
- `CORPUS_RESTORE_OK` với counts khớp reviewed manifest;
- reviewed originals restored vào upload volume;
- `REMOTE_PREFLIGHT_OK`;
- `RESTORED_CORPUS_LIVE_OK` với citation/usage và không tạo ingest job;
- không có ingest, LlamaParse hoặc document embedding trong bootstrap.

Nhấn `Ctrl+C`, chạy lại cùng project và xác nhận `CORPUS_RESTORE_SKIPPED_LOCAL_PRESENT`, không restore lần hai, counts không duplicate và volumes được giữ. Nếu upload thêm document đến `READY`, lần chạy `auto` tiếp theo vẫn giữ local divergence.

## 5. Swagger acceptance

Mở `http://localhost:5001/api-docs`.

1. Login Demo Admin `admin@example.com` / `123456`.
2. Lấy OTP từ app log, verify và Authorize bằng user JWT.
3. Xem document/citation metadata: `originalAvailable=true`.
4. Xác nhận `GET /api/documents/{id}/file` và `GET /api/citations/{id}/file` stream original đúng MIME/content-disposition.
5. Xác nhận citation source snapshot không rỗng và không public GCS URL/path.
6. Optional paid check: tạo chat session, gửi một question chỉ có `content`, xác nhận UUID được sinh, answer/citation/usage được persist. Không assert exact LLM wording.

## 6. Negative modes

Không đổi/xóa key thật; trỏ `GCS_CREDENTIALS_FILE` tới explicit nonexistent test path trên một project disposable.

- `auto` + local empty: startup degraded/empty, không xóa volumes và không giả vờ corpus đã restore.
- `auto` + local existing: không cần cloud comparison; giữ local, không restore đè.
- `required`: orchestration fail, containers được stop best-effort và volumes được giữ.
- Local original khác checksum: restore fail, không overwrite.
- Partial rõ ràng như Qdrant points không có MySQL corpus hoặc completed chunks không có Qdrant là local `PRESENT`: `auto` cảnh báo/skip và tuyệt đối không merge/overwrite; `required`/explicit restore fail. Job đang xử lý không bị coi là cloud fingerprint corruption.

`npm run corpus:verify` phải verify remote release; khi services chạy còn reconcile local counts/mapping/originals. `npm run corpus:restore` lần hai phải idempotent.

## 7. Writer acceptance (manager + approved source only)

Manager trên private/internal bucket và quiescent source đã được owner phê duyệt:

```powershell
npm run corpus:publish -- --dry-run
npm run corpus:publish -- --confirm-reviewed
npm run corpus:verify
```

Trước dry-run, giữ MySQL/Qdrant chạy. Dry-run không được start/stop writer, tạo snapshot/staging, đọc credential, gọi GCS hay đổi pointer; plan phải liệt kê ID, title/filename, trạng thái, visibility, checksum, size và provisional identity. Operator review PII/personal data, secret, quyền chia sẻ và project scope trước confirmation. Publish lần hai cùng source phải `uploaded=0`, không overwrite/delete. Reader-only tester không thực hiện bước này.

## 8. Cleanup và evidence

- `docker:remote:stop`/`down` giữ volumes; `reset` chỉ dùng với project disposable đã xác nhận.
- Không xóa project/volume của người khác.
- `git status --short` không được có `.env`, credential, downloaded dump/snapshot/original hoặc temp artifact.
- Báo branch/commit, command, PASS/FAIL, status/counts, HTTP status/error code và logs đã redact.

Setup canonical: [Remote Docker RAG](../setup/remote-rag-e2e.md). Endpoint semantics: Swagger và [Public API](../api/public-api.md).
