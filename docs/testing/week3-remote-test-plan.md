# Independent test plan

Checklist cho thành viên thứ hai kiểm tra fresh clone. Không sửa Python runtime/schema và không ghi credential vào evidence.

## 1. Chuẩn bị

```powershell
npm ci
Copy-Item .env.example .env
```

Điền provider credentials và secrets trong root `.env` qua kênh an toàn. Chọn `REMOTE_COMPOSE_PROJECT` riêng. Không tạo `PythonSevice.env` và không commit `.env`.

## 2. Automated baseline

```powershell
npm run check
npm run test:openapi
npm run test:contract
npm run test:corpus
npm run test:docs
npm run docker:mock:config
npm run docker:remote:config
```

Expected: syntax, OpenAPI, contract, corpus checksum/tamper và Markdown links đều PASS. Các test này không gọi paid provider.

Part 2 mock regression cần MySQL development:

```powershell
npm run docker:mock:up
npm run test:part2
npm run docker:mock:down
```

Đảm bảo `RAG_MODE=mock` khi chạy mock stack. `docker:mock:down` giữ volumes; chỉ dùng `docker:mock:reset` với project disposable.

## 3. Remote foreground và corpus restore

Giữ `CORPUS_BOOTSTRAP=auto`:

```powershell
npm run docker:remote:dev
```

Trên fresh volumes, xác nhận:

- `CORPUS_RESTORE_OK` với 1 document, 2 chunks, 2 Qdrant points;
- `REMOTE_PREFLIGHT_OK`;
- app/Python logs được attach;
- không có document ingest/LlamaParse trong bootstrap log.

Nếu volumes đã có data, expected là `CORPUS_BOOTSTRAP_SKIPPED` với `DATA_EXISTS`.

## 4. Manual Swagger checks

Mở `http://localhost:5001/api-docs`.

1. Login Demo Admin `admin@example.com / 123456`.
2. Lấy `[DEV-ONLY ADMIN OTP]` từ terminal.
3. Verify OTP và Authorize bằng user JWT.
4. Tạo chat session.
5. Gửi question chỉ có `content`, không gửi `clientRequestId`.
6. Xác nhận response trả UUID được server sinh.
7. Xác nhận assistant `COMPLETED`, citation tồn tại và `/api/citations/{id}/source` có snapshot.
8. Xác nhận original-file endpoint báo unavailable với restored corpus.
9. Nếu kiểm tra retry, gửi lại cùng UUID trong cùng session và xác nhận không duplicate; dùng UUID đó ở session khác phải trả `409`.

ADMIN chỉ đọc chat của chính mình. `no_answer=true` là success hợp lệ và không được có citation giả.

## 5. Optional paid live automation

Chỉ chạy khi project đã được xác nhận isolated và team cho phép provider call:

```powershell
npm run test:corpus:live
```

Expected: citation map restored chunk, usage được persist, còn ingest-job/chunk/Qdrant-point counts không tăng. Không chạy lại nếu một query đã đủ evidence. Full `npm run test:remote` có upload/ingest/hide/unhide/delete và chỉ dùng cho một disposable E2E project, không dùng trên corpus cần giữ.

Live wording và `no_answer` không deterministic; contract/mock tests chịu trách nhiệm cho các nhánh này.

## 6. Lifecycle và restart

Nhấn `Ctrl+C`:

- containers dừng;
- named volumes còn;
- không có orphan child process trong normal shutdown.

Chạy lại `npm run docker:remote:dev`; expected `DATA_EXISTS`, không restore lần hai và không duplicate counts. Abrupt kill/Docker crash không bảo đảm signal cleanup; dùng `npm run docker:remote:stop` nếu cần.

## 7. Cleanup

- Không xóa project/volume không do test tạo.
- `docker:remote:stop` hoặc `down` giữ volumes.
- `reset` chỉ dùng với project disposable đã xác nhận vì xóa MySQL/Qdrant/upload data.
- Xác nhận `git status --short` không có `.env`, upload, log, Qdrant data hoặc temp artifact.

## 8. Evidence và bug report

Ghi:

- branch/commit và timestamp;
- command + PASS/FAIL/BLOCKED;
- lifecycle/status/counts, không ghi content hoặc secret;
- expected/actual;
- endpoint, HTTP status và `errorCode`;
- request/response shape và logs đã redact;
- model name, không ghi API key.

Setup chi tiết nằm duy nhất tại [Remote Docker RAG](../setup/remote-rag-e2e.md); endpoint behavior nằm trong Swagger và [Public API](../api/public-api.md).
