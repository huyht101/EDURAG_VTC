# Phát triển local và mock

## Chuẩn bị

```powershell
npm ci
Copy-Item .env.example .env
```

Root `.env` là cấu hình local duy nhất của Node/Compose. Không commit file này. `python-service/.env` chỉ dành cho Python chạy standalone và không được root Compose đọc.

## Luồng tích hợp chính

Remote là startup path canonical:

```powershell
npm run docker:remote:dev
```

Command resolve remote Compose override và recreate app khi cần. Không dùng `docker compose restart` để chuyển từ mock sang remote vì restart giữ environment của container cũ. Setup, preflight và troubleshooting canonical nằm tại [Remote Docker RAG](remote-rag-e2e.md).

Browser frontend khác origin phải nằm trong comma-separated `CORS_ALLOWED_ORIGINS`; Postman/server-to-server không có `Origin` vẫn được phép. `TRUST_PROXY_HOPS=0` là mặc định an toàn; chỉ đặt số hop chính xác khi deployment thực sự có reverse proxy. Auth limiter hiện dùng memory của từng Node process, cấu hình qua `AUTH_*_RATE_LIMIT_*`; nhiều replica cần shared store ở phase production.

JWT local/remote dùng cùng `JWT_ISSUER` và `JWT_AUDIENCE`; đổi hai giá trị này làm token cũ không còn hợp lệ. MySQL pool/queue/connect/query limits dùng `DB_CONNECTION_LIMIT`, `DB_QUEUE_LIMIT`, `DB_CONNECT_TIMEOUT_MS`, `DB_QUERY_TIMEOUT_MS`. `CHAT_PENDING_TIMEOUT_MS` chỉ terminalize stale assistant khi đúng idempotency key được retry; nó không tự gọi provider. `SHUTDOWN_TIMEOUT_MS` giới hạn graceful HTTP/MySQL drain.

`GET /health` là process liveness. `GET /ready` chạy một MySQL probe nhẹ; endpoint này không chứng minh Python/Qdrant/provider khỏe. Docker healthcheck tiếp tục dùng liveness để dependency DB gián đoạn không tự gây restart loop cho Node.

```powershell
npm run check
npm run test:openapi
npm run test:library
npm run test:contract
```

## Chạy Node trực tiếp trên host

Nếu chỉ muốn dùng MySQL trong Docker:

```powershell
docker compose up -d db
npm start
```

Node đọc `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` từ root `.env`. Với Node chạy trên host, `DB_HOST=localhost` và `DB_PORT` phải trùng host port của MySQL.

Full Node + Python + Qdrant dùng [Remote Docker RAG](remote-rag-e2e.md). Contract tests không phải live E2E.

---

## Phụ lục — Mock mode (REFERENCE ONLY)

Mock chỉ dành cho regression/quick test; nó không kiểm chứng remote và không phải fallback khi remote lỗi. Base `docker-compose.yml` ép app dùng mock để command này không thể vô tình gọi Python.

```powershell
npm run docker:mock:config
npm run docker:mock:up
npm run docker:mock:ps
npm run test:part2
npm run docker:mock:down
```

`test:part2` dùng HTTP thật với RAG mock và cần MySQL disposable đang healthy. `docker:mock:down` giữ named volumes; `docker:mock:reset` có tính phá hủy và chỉ dành cho project test đã xác nhận.
