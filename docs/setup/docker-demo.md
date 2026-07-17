# Docker demo

## Cảnh báo

Toàn bộ credential trong tài liệu này là **DEMO ONLY**:

- MySQL: `root / 123456`
- Admin: `admin@example.com / 123456`
- Host app mặc định: `127.0.0.1:5001`

Không triển khai cấu hình này lên production. Production cần user MySQL riêng, secret manager, tắt secret delivery log và thay mọi JWT/HMAC/internal token.

## Fresh bootstrap

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm ci
npm run docker:mock:config
npm run docker:mock:up
```

Compose đọc root `.env`; default trong `.env.example` chỉ dành cho local demo. MySQL init tự chạy `01_schema.sql`, rồi `02_demo_seed.sql`. Không cần lệnh seed thủ công. App chờ MySQL healthy, chạy RAG `mock` mặc định và ghi upload vào named volume bằng non-root user.

```powershell
npm run docker:mock:ps
Invoke-RestMethod http://localhost:5001/health
npm run docker:mock:logs:app
```

Admin login là hai bước:

1. `POST /api/auth/login` với email/password demo; server verify bcrypt và phát OTP.
2. Đọc OTP development-only trong `docker compose logs app`, rồi gọi `POST /api/auth/admin/verify-otp` để nhận JWT.

OTP chỉ được log vì Compose đặt `NODE_ENV=development` và bật development delivery adapter. Không có email provider production.

## Port và Qdrant

Đổi host port trong root `.env`, không cần đặt biến terminal:

```dotenv
APP_HOST_PORT=55001
```

Sau đó chạy lại:

```powershell
npm run docker:mock:up
```

Muốn chạy Python/Qdrant và xử lý thật, không bật Qdrant riêng trên mock stack; dùng [full Docker RAG setup](remote-rag-e2e.md).

## Reset và cleanup

`npm run docker:mock:reset` xóa database/upload development volumes của project `COMPOSE_PROJECT_NAME` trong `.env`. Không dùng lệnh này nếu volume chứa dữ liệu cần giữ. Schema hiện tại là initial bootstrap, chưa phải migration framework.
