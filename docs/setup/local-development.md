# Local và mock development

## Chuẩn bị

```powershell
npm ci
Copy-Item .env.example .env
```

Root `.env` là cấu hình local duy nhất của Node/Compose. Không commit file này. `python-service/.env` chỉ dành cho Python chạy standalone và không được root Compose đọc.

## Mock stack

Đặt `RAG_MODE=mock` trong `.env`:

```powershell
npm run docker:mock:config
npm run docker:mock:up
npm run docker:mock:ps
```

Mock stack chạy NodeJS + MySQL, không gọi Python/Qdrant/provider. Fresh volume tự chạy `schema.sql` rồi `demo_seed.sql`.

```powershell
npm run check
npm run test:openapi
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
