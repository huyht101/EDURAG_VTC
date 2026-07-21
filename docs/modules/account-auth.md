# Account and authentication

## Scope

Student/Teacher registration, login, Admin OTP, password reset, profile, password change và Admin user status workflow.

## Rules

- STUDENT đăng ký thành `ACTIVE` và có `student_profiles` trong cùng transaction.
- TEACHER đăng ký thành `PENDING`; department/title/degree nullable.
- Admin review: `PENDING → ACTIVE|REJECTED`; mở lại `REJECTED → PENDING` chỉ Admin.
- Lock `ACTIVE → LOCKED` ghi actor/reason và tăng `auth_version`; unlock giữ document/chat/history.
- Login chỉ verify password cho ACTIVE user. Admin tiếp tục qua OTP trước khi nhận JWT.
- Change/reset password tăng `auth_version`; reset password và token `used_at` cùng transaction.

Access JWT khóa `HS256`, `issuer`, `audience`, purpose `access`, UUID `jti`, `sub`, `iat`, `exp` và `authVersion`. Middleware verify các claim, current account status và current `auth_version`; không cache. `POST /api/auth/logout` là logout-all: tăng version bằng conditional update dưới row lock, nên mọi JWT phát trước đó trên mọi thiết bị bị từ chối. Request đã authorize trước lúc logout vẫn có thể hoàn tất; client vẫn phải xóa token local.

Token/OTP dùng secure randomness và HMAC với server-side pepper. OTP ngắn vẫn dùng expiry/used/revoked/attempt count. Password-reset secret entropy cao được kiểm tra trước khi chạy bcrypt rồi kiểm tra lại dưới transaction/row lock; mismatch không tăng attempt hoặc revoke token hợp lệ. Cleanup token hết hạn chạy lazy theo batch tối đa 1.000 row khi phát OTP/reset token. Development secret delivery chỉ bật rõ trong local demo và chưa phải email provider production.

Register/login có configurable general limiter; Admin OTP/forgot/reset dùng limiter nghiêm ngặt hơn. Limiter hiện lưu memory riêng trong mỗi Node process, phù hợp demo/MVP nhưng không distributed-safe; production multi-instance cần shared rate-limit store. `TRUST_PROXY_HOPS` mặc định `0` và chỉ được đặt exact hop count khi có reverse proxy đã biết.

Password mới phải dài tối thiểu 8, gồm uppercase/lowercase/digit/special. Login chỉ yêu cầu non-empty password để tài khoản demo cũ/ngắn vẫn được bcrypt verify; policy tạo password không bị nới.

Xem OpenAPI cho payload/status cụ thể và [database account dictionary](../database/dictionary/account.md) cho schema.
