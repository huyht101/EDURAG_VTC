# EDURAG_VTC

Backend MVP cho trợ lý học tập RAG. NodeJS/Express sở hữu public API, authorization, file storage và toàn bộ dữ liệu nghiệp vụ MySQL; Python RAG là service nội bộ riêng và không ghi MySQL.

Stack chính: Node.js 20+, Express, JavaScript CommonJS, `mysql2/promise`, MySQL 8.4 và local file storage. Không dùng ORM, Redis hay message broker.

```text
src/             NodeJS/Core runtime
python-service/  Tracked integration snapshot from the Python team's upstream repository
docs/            Canonical architecture, contract, status and setup docs
tests/           NodeJS contract fixtures
```

NodeJS/Core tại repository root là project chính. Team Python/Data-RAG duy trì Python production source trong repository riêng; `python-service/` chỉ là snapshot gần nhất dùng để audit compatibility và có thể bị thay thế trong lần refresh sau.

## Chuẩn bị cấu hình Docker một lần

Docker Compose và các npm script chỉ đọc root `.env`. Không cần tạo env file riêng cho Python và không cần đặt `$env:`/`-p` trong terminal cho luồng chạy thông thường.

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Mở `.env` bằng editor. Với full remote RAG, bắt buộc điền:

- `GOOGLE_API_KEY`;
- `LLAMA_CLOUD_API_KEY`;
- `RAG_INTERNAL_TOKEN` tối thiểu 32 ký tự;
- `JWT_SECRET` và `TOKEN_HMAC_PEPPER` tối thiểu 32 ký tự;
- `DB_PASSWORD` và `MYSQL_ROOT_PASSWORD` giống nhau;
- giữ `GEMINI_EMBEDDING_MODEL=models/gemini-embedding-001` và `EMBEDDING_DIMENSION=768`;
- với live provider, dùng `RAG_REQUEST_TIMEOUT_MS=15000` và `RAG_QUERY_TIMEOUT_MS=180000`.

`COMPOSE_PROJECT_NAME` điều khiển mock stack; `REMOTE_COMPOSE_PROJECT` điều khiển full remote stack. Cả hai nằm trong `.env` và được Compose đọc trực tiếp.

## Docker mock nhanh

> **DEMO ONLY:** các credential dưới đây cố ý đơn giản cho máy local, tuyệt đối không dùng cho production.

```text
Admin: admin@example.com / 123456
MySQL: root / 123456
App:   http://localhost:5001
Docs(Swagger):  http://localhost:5001/api-docs
```

```powershell
npm run docker:mock:config
npm run docker:mock:up
npm run docker:mock:ps
npm run test:part2
```

`test:part2` tự đọc root `.env` và cố định `RAG_MODE=mock`, nên không cần export biến trong terminal và không gọi Python/provider. MySQL demo phải đang healthy trước khi chạy.

Fresh volume tự chạy theo thứ tự:

1. [`src/database/schema.sql`](src/database/schema.sql) — schema 1.0.0 và ba role.
2. [`src/database/demo_seed.sql`](src/database/demo_seed.sql) — Demo Admin idempotent.

Admin login vẫn verify bcrypt từ MySQL và yêu cầu OTP. Trong mock demo dùng `npm run docker:mock:logs:app`; trong remote stack dùng `npm run docker:remote:logs:app`; sau đó gọi `/api/auth/admin/verify-otp` để nhận JWT. Không có authentication bypass.

Nếu cổng `5001` bận, sửa `APP_HOST_PORT` trong `.env`, rồi chạy lại `npm run docker:mock:up`.

Mock mode không cần Python/Qdrant/provider key. Chat trả mock result; ingest mock chỉ xác nhận dispatch, không chạy parser/embedding/callback thật. Muốn test upload → `READY` → retrieval/citation, dùng full remote stack dưới đây.

## Full Docker RAG và Swagger

Giữ `REMOTE_E2E_CONFIRM_ISOLATED=false` trong `.env` khi test thủ công, sau đó chạy:

```powershell
npm run docker:remote:config
npm run docker:remote:up
npm run docker:remote:ps
npm run preflight:remote
```

Mở Swagger tại `http://localhost:5001/api-docs`, rồi test theo thứ tự:

1. `POST /api/auth/login` bằng Demo Admin `admin@example.com / 123456`.
2. Chạy `npm run docker:remote:logs:app`, lấy dòng `[DEV-ONLY ADMIN OTP]` mới nhất.
3. `POST /api/auth/admin/verify-otp`, copy `data.token`.
4. Nhấn `Authorize` trong Swagger và dán user JWT, không dán `RAG_INTERNAL_TOKEN`.
5. `POST /api/documents`, chọn PDF/DOCX/TXT; lưu `document.id` và `job.id` từ response `202`.
6. Poll `GET /api/documents/jobs/{jobId}` đến `SUCCEEDED`, rồi xác nhận document `READY + VISIBLE`.
7. `POST /api/chat/sessions`, sau đó `POST /api/chat/sessions/{id}/messages` với `clientRequestId` UUID mới.
8. Đọc `assistantMessage.citations[]`, rồi gọi `/api/citations/{id}` hoặc `/api/citations/{id}/source`.

Kiểm tra shared file từ cả hai container:

```powershell
npm run docker:remote:files:node
npm run docker:remote:files:rag
```

Node lưu file trong named volume dưới `/usr/src/app/uploads/documents/YYYY/MM/`; Python đọc cùng storage key tại `/shared/uploads/documents/YYYY/MM/` ở chế độ read-only.

Dừng nhưng giữ dữ liệu:

```powershell
npm run docker:remote:down
```

Reset project test, bao gồm MySQL/uploads/Qdrant volumes:

```powershell
npm run docker:remote:reset
```

Lệnh reset là destructive. Chỉ dùng khi `REMOTE_COMPOSE_PROJECT` trong `.env` là project test không có dữ liệu cần giữ. Hướng dẫn chi tiết từng request/response, hide/unhide/delete, MySQL query và troubleshooting nằm tại [Full Docker RAG setup](docs/setup/remote-rag-e2e.md).

## Trạng thái MVP

- Foundation/Auth/Profile/Admin User: implemented.
- Document/upload/jobs/internal callback: implemented.
- Chat/history/citation/usage/dashboard: implemented.
- RAG mock mode: implemented và dùng mặc định.
- Remote Python RAG: contract v0.1, mocked HTTP tests và isolated Compose topology đã có; live Node → Python → LlamaParse/Gemini → Qdrant → callback E2E đã PASS ngày 2026-07-17.
- PDF, DOCX, TXT: hỗ trợ; PPTX/OCR để sau.
- Local storage và offset/limit pagination: MVP only.

## Tài liệu

- [Documentation index](docs/README.md)
- [System overview](docs/architecture/system-overview.md)
- [Database source and bootstrap](docs/database/README.md)
- [Public API conventions](docs/api/public-api.md)
- [Internal NodeJS–Python contract](docs/api/internal-rag-contract.md)
- [NodeJS/Core flows](docs/flows/README.md)
- [Week 3 integration readiness](docs/status/week3-integration-readiness.md)
- [Remote RAG E2E setup](docs/setup/remote-rag-e2e.md)
- [Week 3 independent remote test plan](docs/testing/week3-remote-test-plan.md)
- [Python snapshot policy and observed capability](docs/architecture/python-rag.md)
- [Python snapshot provenance](docs/status/python-snapshot-source.md)
- [Refresh the Python snapshot](docs/setup/python-snapshot-refresh.md)
- OpenAPI runtime: `/api-docs` và `/api-docs.json`

## Chạy NodeJS local

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm ci
npm run check
npm run test:contract
npm start
```

Với local NodeJS, dùng MySQL demo trên `127.0.0.1:3306`. Xem [local development](docs/setup/local-development.md) và [Docker demo](docs/setup/docker-demo.md) để biết reset, test và giới hạn bảo mật.

`RAG_MODE=mock` vẫn là mặc định. Integrated remote mode dùng override [`docker-compose.remote.yml`](docker-compose.remote.yml) và chỉ đọc ignored root `.env`; Compose chỉ inject provider credentials và root `RAG_INTERNAL_TOKEN` vào Python. Xem [remote setup](docs/setup/remote-rag-e2e.md) và [contract v0.1](docs/api/internal-rag-contract.md). Live evidence hiện chỉ áp dụng cho isolated development topology, không phải production readiness.
