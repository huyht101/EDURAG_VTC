# Part 1 — Foundation, Auth, Profile và Admin User

Tài liệu này mô tả implementation hiện hành sau compatibility gate. Database source of truth là `src/database/schema.sql` (schema 1.0.0).

## Convention

- Express + JavaScript CommonJS, `mysql2/promise`, không ORM.
- SQL chỉ nằm trong `src/repositories/`; repository nhận pool mặc định hoặc transaction connection.
- Multi-write operation dùng `withTransaction`; không giữ transaction khi gửi email hoặc gọi external service.
- Success: `{ success, message, data }`; error: `{ success: false, message, errorCode }`.

## User, role và profile

- Role: `STUDENT`, `TEACHER`, `ADMIN`; một role qua `users.role_id`.
- Status: `PENDING`, `ACTIVE`, `LOCKED`, `REJECTED`.
- Student đăng ký `ACTIVE`; user và `student_profiles` được tạo atomic.
- Teacher đăng ký `PENDING`; user và `teacher_profiles` được tạo atomic. `academic_title`, `degree`, `department` nullable.
- Student cập nhật `date_of_birth`; Teacher cập nhật các field chuyên môn nullable. Không có `teacher_code`.

## Review và lock workflow

- Teacher `PENDING -> ACTIVE`: Admin ghi `reviewed_by`, `reviewed_at`, `review_note` tùy chọn.
- Teacher `PENDING -> REJECTED`: Admin phải ghi `review_note`.
- Teacher `REJECTED -> PENDING`: chỉ Admin mở lại review.
- User `ACTIVE -> LOCKED`: ghi `locked_by`, `locked_at`, `lock_reason` và tăng `auth_version`.
- User `LOCKED -> ACTIVE`: giữ document/chat/history và metadata lần khóa gần nhất.
- Không có audit timeline/table trong MVP.

## JWT và req.user

Access JWT chứa `id`, `role`, `authVersion`. Middleware verify chữ ký, đọc trạng thái hiện tại từ DB, yêu cầu `ACTIVE` và so sánh version.

```js
req.user = { id, email, role, status, authVersion };
```

Change password, reset password và lock tăng `auth_version`; JWT cũ nhận `TOKEN_REVOKED`. Logout là client-side logout và không tăng version.

## Auth token lifecycle

`auth_tokens` dùng `token_type`, `expires_at`, `used_at`, `revoked_at`, `attempt_count`. Token mới revoke token cùng loại còn hiệu lực. OTP dùng `crypto.randomInt`; reset token dùng `crypto.randomBytes`. Giá trị được HMAC-SHA-256 bằng `TOKEN_HMAC_PEPPER`, bind với user id và token type. Sau 5 lần thử sai token bị revoke.

Email provider chưa tích hợp. Console delivery chỉ bật rõ bằng `NODE_ENV=development` và `AUTH_DEV_DELIVERY_LOG_SECRETS=true`.

## Transaction boundaries

- Registration: user + role-specific profile.
- Profile update: users + profile table.
- Change password: lock/read current hash + password + auth_version.
- Reset password: token row + password + auth_version + used_at.
- Review/lock/unlock: lock user row + validate transition + update metadata.
- Token issuance: revoke token active + insert replacement.

Endpoint thực tế được mô tả trong root README và OpenAPI. Admin CRUD đầy đủ, email production, rate limiting và Part 2 APIs chưa triển khai.
