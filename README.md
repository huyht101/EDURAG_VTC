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

## Docker demo nhanh

> **DEMO ONLY:** các credential dưới đây cố ý đơn giản cho máy local, tuyệt đối không dùng cho production.

```text
Admin: admin@example.com / 123456
MySQL: root / 123456
App:   http://localhost:5001
Docs(Swagger):  http://localhost:5001/api-docs
```

```powershell
docker compose down -v
docker compose up --build
```

Fresh volume tự chạy theo thứ tự:

1. [`src/database/schema.sql`](src/database/schema.sql) — schema 1.0.0 và ba role.
2. [`src/database/demo_seed.sql`](src/database/demo_seed.sql) — Demo Admin idempotent.

Admin login vẫn verify bcrypt từ MySQL và yêu cầu OTP. Trong Docker demo, OTP development-only xuất hiện trong `docker compose logs app`; sau đó gọi `/api/auth/admin/verify-otp` để nhận JWT. Không có authentication bypass.

Nếu cổng `5001` bận:

```powershell
$env:APP_HOST_PORT=55001
docker compose up --build
```

Qdrant không cần cho mock demo. Team RAG có thể bật riêng bằng `docker compose --profile rag up`.

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
Copy-Item .env.example .env
npm ci
npm run check
npm run test:contract
npm start
```

Với local NodeJS, dùng MySQL demo trên `127.0.0.1:3306`. Xem [local development](docs/setup/local-development.md) và [Docker demo](docs/setup/docker-demo.md) để biết reset, test và giới hạn bảo mật.

`RAG_MODE=mock` vẫn là mặc định. Integrated remote mode dùng override [`docker-compose.remote.yml`](docker-compose.remote.yml) và chỉ đọc ignored root `.env`; Compose chỉ inject provider credentials và root `RAG_INTERNAL_TOKEN` vào Python. Xem [remote setup](docs/setup/remote-rag-e2e.md) và [contract v0.1](docs/api/internal-rag-contract.md). Live evidence hiện chỉ áp dụng cho isolated development topology, không phải production readiness.
