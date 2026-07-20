# EDURAG NodeJS/Core

Backend MVP cho trợ lý học tập RAG. Repository root chứa NodeJS/Core và là project chính; [`python-service/`](python-service/) là integration snapshot từ repository riêng của team Python.

## Kiến trúc

- NodeJS/Express sở hữu public API, authorization, document/job lifecycle, chat, citation, usage và toàn bộ MySQL transaction.
- Python xử lý parsing, embedding, retrieval/generation và sở hữu Qdrant.
- NodeJS không truy cập Qdrant; Python không ghi MySQL.
- Original files dùng local shared volume. Portable corpus commit sanitized MySQL + Qdrant; exact-approved originals có thể restore từ private GCS bằng host-side tooling.

## Yêu cầu

- Node.js 20+
- Docker Desktop và Docker Compose
- Credential Gemini/LlamaParse khi chạy remote RAG

## Thiết lập lần đầu

```powershell
npm ci
Copy-Item .env.example .env
```

Mở root `.env` và thay các giá trị demo cần thiết. Remote stack cần tối thiểu `GOOGLE_API_KEY`, `LLAMA_CLOUD_API_KEY`, `RAG_INTERNAL_TOKEN`, database password và auth secrets. Private GCS original-file restore là optional; xem [Remote Docker RAG](docs/setup/remote-rag-e2e.md). Không commit `.env` hoặc credential trong `secrets/`.

## Chạy mock(test với mock data)

Đặt `RAG_MODE=mock` trong `.env`, sau đó:

```powershell
npm run docker:mock:config
npm run docker:mock:up
```

Mock mode không gọi Python, Qdrant hoặc paid provider. Hướng dẫn test local nằm tại [Local/mock development](docs/setup/local-development.md).

## Chạy full remote stack(flow thật + credentials)

```powershell
npm run docker:remote:config
npm run docker:remote:dev
```

Command khởi động MySQL, Qdrant, NodeJS và Python; chạy preflight rồi attach log `app`/`rag-service`. `Ctrl+C` dừng containers nhưng giữ named volumes. Lần chạy sau reuse data; `reset` là destructive.

- Swagger: <http://localhost:5001/api-docs>
- OpenAPI JSON: <http://localhost:5001/api-docs.json>
- Health: <http://localhost:5001/health>

Chi tiết cấu hình, lifecycle, corpus modes và test Swagger: [Remote Docker RAG](docs/setup/remote-rag-e2e.md).

## Demo Admin

Local/demo only:

```text
Email: admin@example.com
Password: 123456
```

Sau login, lấy `[DEV-ONLY ADMIN OTP]` từ app log rồi gọi `POST /api/auth/admin/verify-otp`. Đây không phải email delivery production.

## Tài liệu

- [Documentation index](docs/README.md)
- [System overview](docs/architecture/system-overview.md)
- [Public API conventions](docs/api/public-api.md)
- [Internal NodeJS-Python contract](docs/api/internal-rag-contract.md)
- [Current readiness](docs/status/week3-integration-readiness.md)
- [Independent test plan](docs/testing/week3-remote-test-plan.md)

Trạng thái hiện tại: **WEEK 3 NODEJS/CORE READY FOR INDEPENDENT TEST WITH PORTABLE CORPUS**. Đây là development/integration readiness, không phải production readiness.
