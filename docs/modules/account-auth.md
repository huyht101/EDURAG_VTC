# Account and authentication

## Scope

Student/Teacher registration, login, Admin OTP, password reset, profile, password change và Admin user status workflow.

## Rules

### Avatar và Admin CSV export

Avatar là resource riêng của user đã xác thực qua `POST|GET|DELETE /api/profile/avatar`. Node decode nội dung, chỉ nhận JPEG/PNG/WebP một frame tối đa `AVATAR_MAX_SIZE_BYTES` (mặc định 5 MiB), từ chối ảnh động/multi-page, tạo storage key ngẫu nhiên và không mount upload directory thành static/public URL. Profile chỉ trả `avatarAvailable`, authenticated relative `avatarUrl` và `avatarMimeType`; không trả storage key. Replace commit database trước khi best-effort cleanup file cũ, còn DELETE clear database reference trước cleanup và gọi lặp lại an toàn.

`GET /api/admin/users/export` chỉ dành cho ADMIN, dùng cùng `search`/`role`/`status` như list nhưng đọc toàn bộ kết quả theo batch. CSV chỉ chứa `id`, `fullName`, `email`, `role`, `status`, `createdAt`; có UTF-8 BOM, CSV escaping và formula-injection neutralization. Password hash, token, OTP và `auth_version` không được xuất.

### Delivery handoff

- FE và Mobile dùng Bearer-authenticated Blob cho `avatarUrl`; Mobile không tích hợp Admin CSV. Filename download lấy từ `Content-Disposition`/RFC 5987, không tự dựng storage URL.
- BA/Tester kiểm tra self-only avatar, JPEG/PNG/WebP một frame, fake/SVG/animated/oversize rejection, CSV ADMIN-only/allowlist/formula neutralization và filename Unicode. Dữ liệu mojibake cũ và citation snapshot bất biến không được tự rewrite.
- NodeJS/DevOps phải backup DB hiện hữu rồi chạy `npm run db:migrate`; migration bắt buộc cho capability này là `20260801_user_avatar_storage.sql`. Corpus private sau migration phải đi qua workflow `corpus:publish`, không upload backup thô hoặc tạo release song song.
- Python/RAG không đổi runtime contract, embedding hoặc Qdrant payload trong capability
  này. Node `sourceLocator` boundary đã implement; Python geometry và precise FE highlight
  vẫn **OPTIONAL/LATER / NOT VERIFIED**, độc lập với avatar/CSV.

- STUDENT đăng ký thành `ACTIVE` và có `student_profiles` trong cùng transaction.
- TEACHER đăng ký thành `PENDING`; department/title/degree nullable.
- `dateOfBirth` của STUDENT là ngày lịch thực theo đúng `YYYY-MM-DD`; ngày không tồn tại bị validation `400`.
- Admin review: `PENDING → ACTIVE|REJECTED`; mở lại `REJECTED → PENDING` chỉ Admin.
- Lock `ACTIVE → LOCKED` ghi actor/reason và tăng `auth_version`; unlock giữ document/chat/history.
- Login chỉ verify password cho ACTIVE user. Admin tiếp tục qua OTP trước khi nhận JWT.
- Change/reset password tăng `auth_version`; reset password và token `used_at` cùng transaction.

Access JWT khóa `HS256`, `issuer`, `audience`, purpose `access`, UUID `jti`, `sub`, `iat`, `exp` và `authVersion`. Middleware verify các claim, current account status và current `auth_version`; không cache. `POST /api/auth/logout` là logout-all: tăng version bằng conditional update dưới row lock, nên mọi JWT phát trước đó trên mọi thiết bị bị từ chối. Request đã authorize trước lúc logout vẫn có thể hoàn tất; client vẫn phải xóa token local.

Token/OTP dùng secure randomness và HMAC với server-side pepper. OTP ngắn vẫn dùng expiry/used/revoked/attempt count. Password-reset secret entropy cao được kiểm tra trước khi chạy bcrypt rồi kiểm tra lại dưới transaction/row lock; mismatch không tăng attempt hoặc revoke token hợp lệ. Cleanup token hết hạn chạy lazy theo batch tối đa 1.000 row khi phát OTP/reset token. Development secret delivery chỉ bật rõ trong local demo và chưa phải email provider production.

Register/login có configurable general limiter; Admin OTP/forgot/reset dùng limiter nghiêm ngặt hơn. Limiter hiện lưu memory riêng trong mỗi Node process, phù hợp demo/MVP nhưng không distributed-safe; production multi-instance cần shared rate-limit store. `TRUST_PROXY_HOPS` mặc định `0` và chỉ được đặt exact hop count khi có reverse proxy đã biết.

Password mới phải dài tối thiểu 8, gồm uppercase/lowercase/digit/special. Login chỉ yêu cầu non-empty password để tài khoản demo cũ/ngắn vẫn được bcrypt verify; policy tạo password không bị nới.

Xem OpenAPI cho payload/status cụ thể và [database account dictionary](../database/dictionary/account.md) cho schema.
