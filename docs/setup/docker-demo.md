# Docker demo

## Cảnh báo

Toàn bộ credential trong tài liệu này là **DEMO ONLY**:

- MySQL: `root / 123456`
- Admin: `admin@example.com / 123456`
- Host app mặc định: `127.0.0.1:5001`

Không triển khai cấu hình này lên production. Production cần user MySQL riêng, secret manager, tắt secret delivery log và thay mọi JWT/HMAC/internal token.

## Fresh bootstrap

```powershell
docker compose down -v
docker compose up --build
```

MySQL init tự chạy `01_schema.sql`, rồi `02_demo_seed.sql`. Không cần `.env` hoặc lệnh seed thủ công. App chờ MySQL healthy, chạy RAG `mock` mặc định và ghi upload vào named volume bằng non-root user.

```powershell
docker compose ps
Invoke-RestMethod http://localhost:5001/health
docker compose logs app
```

Admin login là hai bước:

1. `POST /api/auth/login` với email/password demo; server verify bcrypt và phát OTP.
2. Đọc OTP development-only trong `docker compose logs app`, rồi gọi `POST /api/auth/admin/verify-otp` để nhận JWT.

OTP chỉ được log vì Compose đặt `NODE_ENV=development` và bật development delivery adapter. Không có email provider production.

## Port và Qdrant

Override host port mà không đổi cổng container:

```powershell
$env:APP_HOST_PORT=55001
docker compose up --build
```

Qdrant nằm trong optional profile cho team Python, không được NodeJS truy cập trực tiếp:

```powershell
docker compose --profile rag up
```

## Reset và cleanup

`docker compose down -v` xóa database/upload development volumes của project. Không dùng lệnh này nếu volume chứa dữ liệu cần giữ. Schema hiện tại là initial bootstrap, chưa phải migration framework.
