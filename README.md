# EDURAG NodeJS/Core

Backend MVP cho trợ lý học tập RAG. Repository root là NodeJS/Core; [`python-service/`](python-service/) chỉ là integration snapshot từ repository riêng của team Python.

## Kiến trúc ngắn

- NodeJS/Express sở hữu public API, authorization, document/job lifecycle, chat, citation, usage và MySQL transaction.
- Python sở hữu parsing, embedding, retrieval/generation và Qdrant.
- MySQL, Qdrant và upload volume chạy local trong Docker. Private GCS chỉ phân phối immutable portable corpus release; runtime Node/Python không đọc GCS.

## Bắt đầu

Yêu cầu Node.js 20+, Docker Desktop và Docker Compose.

```powershell
npm ci
Copy-Item .env.example .env
```

Điền các biến bắt buộc trong root `.env`; không commit `.env` hoặc credential trong `secrets/`.

Mock NodeJS + MySQL, không gọi Python/provider:

```powershell
npm run docker:mock:up
```

Full remote stack và cloud corpus bootstrap:

```powershell
npm run docker:remote:dev
```

`Ctrl+C` dừng containers nhưng giữ named volumes. Fresh volumes cần reader-capable GCS credential để restore canonical corpus; `CORPUS_BOOTSTRAP=auto` vẫn cho stack khởi động rỗng khi thiếu key.

- Swagger: <http://localhost:5001/api-docs>
- OpenAPI: <http://localhost:5001/api-docs.json>
- Health: <http://localhost:5001/health>

Demo Admin local: `admin@example.com` / `123456`. Sau login, lấy `[DEV-ONLY ADMIN OTP]` từ app log rồi gọi `POST /api/auth/admin/verify-otp`.

Xem [documentation index](docs/README.md), đặc biệt [Remote Docker RAG](docs/setup/remote-rag-e2e.md) và [independent test plan](docs/testing/week3-remote-test-plan.md).

Trạng thái: **POST-MIGRATION HARDENING COMPLETE — READY FOR INDEPENDENT RETEST**. Reader-only restore, Qdrant startup race và canonical cloud release đã được kiểm chứng; đây vẫn là integration readiness, không phải production readiness.
