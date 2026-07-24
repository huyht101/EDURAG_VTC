# Local và mock development

## Chuẩn bị

```powershell
npm ci
Copy-Item .env.example .env
```

Root `.env` là cấu hình local duy nhất của Node/Compose. Không commit file này. `python-service/.env` chỉ dành cho Python chạy standalone và không được root Compose đọc.

## Mock stack

`.env.example` mặc định `RAG_MODE=mock`, và base `docker-compose.yml` ép app dùng mock để lệnh có tên `docker:mock:*` không thể vô tình gọi Python. Remote Compose override mới chuyển app sang `remote`.

```powershell
npm run docker:mock:config
npm run docker:mock:up
npm run docker:mock:ps
```

Browser frontend khác origin phải nằm trong comma-separated `CORS_ALLOWED_ORIGINS`; Postman/server-to-server không có `Origin` vẫn được phép. `TRUST_PROXY_HOPS=0` là mặc định an toàn; chỉ đặt số hop chính xác khi deployment thực sự có reverse proxy. Auth limiter hiện dùng memory của từng Node process, cấu hình qua `AUTH_*_RATE_LIMIT_*`; nhiều replica cần shared store ở phase production.

JWT local/remote dùng cùng `JWT_ISSUER` và `JWT_AUDIENCE`; đổi hai giá trị này làm token cũ không còn hợp lệ. MySQL pool/queue/connect/query limits dùng `DB_CONNECTION_LIMIT`, `DB_QUEUE_LIMIT`, `DB_CONNECT_TIMEOUT_MS`, `DB_QUERY_TIMEOUT_MS`. `CHAT_PENDING_TIMEOUT_MS` chỉ terminalize stale assistant khi đúng idempotency key được retry; nó không tự gọi provider. `SHUTDOWN_TIMEOUT_MS` giới hạn graceful HTTP/MySQL drain.

`GET /health` là process liveness. `GET /ready` chạy một MySQL probe nhẹ; endpoint này không chứng minh Python/Qdrant/provider khỏe. Docker healthcheck tiếp tục dùng liveness để dependency DB gián đoạn không tự gây restart loop cho Node.

Mock stack chạy NodeJS + MySQL, không gọi Python/Qdrant/provider. Fresh volume tự chạy `schema.sql` rồi `demo_seed.sql`.

Disposition: **RUNTIME RETAINED WITH EVIDENCE** vì `docker:mock:*` và `test:part2` là consumer thực tế. Stub chỉ mô phỏng accepted operations, deterministic no-answer/failure và sourced answer khi test cung cấp một `vector_node_id` đã tồn tại; nó không tự tạo citation giả. Remote error không bao giờ silently fallback sang mock, và mock PASS không được gọi là Python/live E2E PASS.

```powershell
npm run check
npm run test:openapi
npm run test:library
npm run test:contract
npm run test:part2
```

`test:part2` dùng HTTP thật với RAG mock và cần MySQL development đang healthy. Test tạo dữ liệu tạm; không chạy trên database cần giữ.

## Chạy Node trực tiếp

Nếu chỉ muốn dùng MySQL trong Docker:

```powershell
docker compose up -d db
npm start
```

Node đọc `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` từ root `.env`. Với Node chạy trên host, `DB_HOST=localhost` và `DB_PORT` phải trùng host port của MySQL.

## Dừng và reset mock

```powershell
npm run docker:mock:down
```

`docker:mock:down` giữ named volumes. `npm run docker:mock:reset` xóa database/upload volumes của `COMPOSE_PROJECT_NAME`; chỉ dùng với project test.

Full Node + Python + Qdrant dùng [Remote Docker RAG](remote-rag-e2e.md). Contract tests không phải live E2E.
