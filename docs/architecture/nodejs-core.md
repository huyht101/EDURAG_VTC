# NodeJS/Core architecture

## Layering

- `routes`: mount middleware, validator và controller.
- `controllers`: chuyển HTTP input/output, không chứa nghiệp vụ.
- `services`: authorization theo ownership, lifecycle và transaction boundary.
- `repositories`: toàn bộ SQL runtime; nhận pool hoặc transaction connection.
- `clients`: normalized RAG adapter cho `mock` và `remote`.
- `storage`: local storage adapter với relative generated key.

Mọi SQL input được parameterize. `LIMIT/OFFSET` là ngoại lệ kỹ thuật của `mysql2`: service normalize, `utils/pagination` xác nhận safe integer và repository mới nội suy giá trị số.

## Authentication

Public API dùng user JWT. Middleware verify chữ ký, đọc lại user/role/status/auth_version từ MySQL, yêu cầu `ACTIVE` và từ chối JWT có version cũ. `req.user` thống nhất `{ id, email, role, status, authVersion }`.

Internal callback dùng Bearer `RAG_INTERNAL_TOKEN` qua middleware riêng và constant-time digest comparison. Hai loại token không dùng lẫn.

Public auth routes có configurable per-process rate limit. CORS dùng exact allowlist; request không có `Origin` vẫn được phép. `TRUST_PROXY_HOPS=0` là mặc định và chỉ đổi theo số reverse-proxy hop đã biết. Unknown internal errors trả generic `500` trong khi server log giữ diagnostic detail.

## Transactions

`withTransaction` lấy connection, begin, commit/rollback và release trong `finally`. Registration, reset password, status transitions, document/job creation, callback manifest và chat completion đều dùng transaction phù hợp.

File I/O và HTTP tới Python không nằm trong MySQL transaction. MySQL và Qdrant không có distributed transaction; lifecycle dùng fail-closed state và explicit failure.

## Authorization

- ADMIN: quản lý mọi document và xem dashboard.
- TEACHER: quản lý document có `uploaded_by` là chính mình.
- STUDENT: không dùng Document Management; có Student Library read-only riêng cho document `READY + VISIBLE`, được chat và xem citation/source thuộc session của mình.
- Citation snapshot/source luôn thuộc session owner; ADMIN không bypass public chat ownership.
- Mọi ACTIVE user có thể chat trên kho retrieval `READY + VISIBLE`; chưa có subject/course/class scope.
