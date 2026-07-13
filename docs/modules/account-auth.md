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

JWT middleware verify chữ ký, current status và current `auth_version`; không cache. Logout là stateless client-side logout, không tăng version.

Token/OTP dùng secure randomness. Password-reset token entropy cao và OTP được HMAC với server-side pepper; lifecycle dùng expiry/used/revoked/attempt count. Development secret delivery chỉ bật rõ trong local demo và chưa phải email provider production.

Password mới phải dài tối thiểu 8, gồm uppercase/lowercase/digit/special. Login chỉ yêu cầu non-empty password để tài khoản demo cũ/ngắn vẫn được bcrypt verify; policy tạo password không bị nới.

Xem OpenAPI cho payload/status cụ thể và [database account dictionary](../database/dictionary/account.md) cho schema.
