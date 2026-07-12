# EDURAG_VTC

NodeJS/Core backend của EduRAG, dùng Express, JavaScript CommonJS, `mysql2/promise` và SQL thuần trong repository layer. NodeJS là thành phần duy nhất ghi MySQL. Python RAG Service là service riêng và chưa được tích hợp trong compatibility gate này.

## Trạng thái hiện tại

- Foundation/Auth/Profile/Admin User tương thích database schema 1.0.0.
- Database bootstrap có đủ 12 bảng tại `src/database/schema.sql`.
- Document, upload, processing callback, Chat, Citation và Dashboard: **planned / not implemented**.
- Admin OTP và password reset có persistence/security foundation nhưng chưa có email provider.
- Không có refresh-token table, ORM, Redis, BullMQ hoặc NodeJS client truy cập Qdrant.

Tài liệu Part 1 hiện hành: [docs/account/README.md](docs/account/README.md). Các tài liệu cũ nằm dưới `docs/history/` và không phải specification hiện hành.

## Yêu cầu

- Node.js 20 trở lên.
- Docker và Docker Compose nếu chạy bằng container.
- MySQL 8.4, timezone UTC, database `edurag`.

## Cài đặt và chạy

```powershell
npm.cmd ci
Copy-Item .env.example .env
```

Thay tất cả giá trị `replace_with_...` trong `.env` bằng secret riêng. Không commit `.env`.

```powershell
# Chỉ dùng cho development; xóa database volume hiện tại.
docker compose down -v
docker compose up -d db qdrant

# Seed Admin idempotent từ env
npm.cmd run seed:admin

# Chạy NodeJS local
npm.cmd run dev
```

MySQL tự chạy `src/database/schema.sql` khi volume mới được tạo. Schema dùng `CREATE TABLE IF NOT EXISTS`; chạy lần hai chỉ kiểm tra bootstrap không phá dữ liệu, không phải migration mechanism.

Chạy lại bootstrap schema đã tích hợp từ `week2_nodejs_core_ref/database_setup.sql`:

```powershell
Get-Content -Raw src/database/schema.sql | docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
```

Chạy toàn bộ stack container:

```powershell
docker compose up --build
docker compose run --rm app npm run seed:admin
```

Swagger UI: `http://localhost:5000/api-docs`
OpenAPI JSON: `http://localhost:5000/api-docs.json`

## Endpoint Part 1 đã triển khai

| Method | Route | Trạng thái |
|---|---|---|
| GET | `/health` | Hoạt động |
| POST | `/api/auth/register` | Student ACTIVE; Teacher PENDING; user/profile atomic |
| POST | `/api/auth/login` | Chỉ ACTIVE; Admin cần OTP |
| POST | `/api/auth/admin/verify-otp` | Hoạt động; email delivery chưa tích hợp |
| POST | `/api/auth/logout` | Stateless client-side logout |
| POST | `/api/auth/forgot-password` | Tạo token an toàn; email delivery chưa tích hợp |
| POST | `/api/auth/reset-password` | Atomic password/auth_version/token update |
| GET | `/api/profile` | Hoạt động |
| PUT | `/api/profile` | Student date_of_birth; Teacher fields nullable |
| PUT | `/api/profile/password` | Tăng auth_version; JWT cũ mất hiệu lực |
| GET | `/api/admin/users` | ADMIN list/filter/pagination |
| GET | `/api/admin/users/:id` | ADMIN detail |
| PUT | `/api/admin/users/:id/status` | Approve/reject/reopen/lock/unlock theo transition |

Admin CRUD đầy đủ chưa được triển khai; hiện chỉ có list, detail và status workflow.

## Development-only token delivery

Project chưa có email provider. Để smoke-test OTP/reset token trên development, đặt:

```dotenv
NODE_ENV=development
AUTH_DEV_DELIVERY_LOG_SECRETS=true
```

Không bật adapter này trong production. Plaintext OTP/reset token không được log khi adapter tắt.

## Kiểm tra tĩnh

```powershell
npm.cmd run check
docker compose --env-file .env config
git diff --check
```

Không có test framework tại thời điểm compatibility gate; `npm run check` chỉ kiểm tra cú pháp JavaScript.
