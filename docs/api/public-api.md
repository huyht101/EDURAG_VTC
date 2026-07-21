# Public API conventions

Swagger `/api-docs` và OpenAPI `/api-docs.json` là nguồn endpoint/request/response chi tiết. File này chỉ mô tả actor, ownership và workflow.

## Authentication và response

Protected public routes dùng `Authorization: Bearer <user JWT>`. Middleware verify JWT, đọc lại user/status/role/`auth_version` từ MySQL và chỉ chấp nhận `ACTIVE` user.

Các endpoint register/login/OTP/forgot/reset có per-process in-memory rate limit và trả `429 RATE_LIMIT_EXCEEDED` với standard `RateLimit` headers. Forgot-password vẫn trả cùng response cho email có hoặc không tồn tại. Cross-origin browser access chỉ nhận CORS headers cho exact origin trong `CORS_ALLOWED_ORIGINS`; request không có `Origin` vẫn dùng được.

```json
{ "success": true, "message": "OK", "data": {} }
```

```json
{ "success": false, "message": "...", "errorCode": "STABLE_CODE" }
```

`Internal RAG` là service-to-service API dùng internal Bearer riêng. Web/Mobile/Swagger tester thông thường không gọi nhóm này và không dùng `RAG_INTERNAL_TOKEN` thay user JWT.

## Role và ownership

| Domain | STUDENT | TEACHER | ADMIN |
|---|---|---|---|
| Auth/Profile | Own account | Own account | Own account + OTP login |
| Admin users | Không | Không | List/detail/status workflow |
| Document management | Không | Document do mình upload | Mọi document |
| Chat | Session của mình | Session của mình | Session của mình |
| Citation/source | Citation thuộc session của mình | Citation thuộc session của mình | Citation thuộc session của mình |
| Dashboard | Không | Không | Basic `LLM_CALLS_ONLY` summary |

ADMIN không tự động đọc chat session của user khác. Pagination dùng `offset`/`limit` với server-side maximum.

## Workflow chính

### Authentication

Student đăng ký thành `ACTIVE`; Teacher thành `PENDING` và cần Admin review. Admin login đúng password vẫn cần OTP trước khi nhận JWT. Change/reset password và lock account làm JWT cũ mất hiệu lực qua `auth_version`.

### Document ingest

`POST /api/documents` nhận `multipart/form-data` với `file` và optional `title`; hỗ trợ PDF/DOCX/TXT. Response `202` chỉ xác nhận document/job đã được tạo và dispatch, chưa có nghĩa document `READY`.

Client poll `GET /api/documents/jobs/{jobId}`. Chỉ khi job `SUCCEEDED` và document `READY + VISIBLE` thì document mới thuộc retrieval corpus. Hide tắt retrieval nhưng giữ vectors; delete soft-delete và giữ chat/citation history. Original file không immutable-update: thay nội dung bằng upload document mới.

### Chat

Client tạo session, sau đó gửi question vào session do mình sở hữu. Node persist USER + ASSISTANT `PENDING` trước network call; completion lưu answer, citations và usage. `no_answer=true` là HTTP success hợp lệ.

Với `no_answer=false`, answer bắt buộc có ít nhất một structured citation map được tới chunk/document `READY + VISIBLE` tại thời điểm completion. Response thiếu hoặc không xác minh được nguồn trả lỗi upstream và assistant chuyển `FAILED`; Node không tạo citation giả hay parse marker `[1]`.

Không có breaking public API change: `clientRequestId` được nới từ required thành optional theo hướng backward-compatible.

- Omit, `null`, empty hoặc whitespace: server sinh UUID và trả lại trong response.
- UUID hợp lệ do client gửi: idempotency key cho retry.
- Cùng ID + cùng session: trả message pair hiện có, không tạo duplicate.
- Cùng ID + session khác: `409 Conflict`.

Swagger simple example không cần `clientRequestId`; frontend chỉ nên giữ ID khi cần retry đúng logical request.

### Citation và original file

Citation là immutable snapshot từ structured source, không phải parsing ký hiệu `[1]`. `GET /api/citations/{id}/source` trả snapshot và `originalAvailable`; endpoint `/file` stream file vật lý khi còn tồn tại và được phép. Repository bundle không commit original binary; canonical cloud release hiện có một exact-approved original có thể materialize vào local upload volume. Khi không có credential/file restore, citation snapshot vẫn dùng được và file endpoint có thể trả unavailable.

Mọi citation endpoint trước hết yêu cầu owner của chat session chứa citation; ADMIN không bypass ownership này. Sau đó file stream còn áp dụng current source authorization. Truy cập citation ngoài session của mình trả `404` để hạn chế enumeration.

Business behavior sâu hơn: [Documents](../modules/documents.md) và [Chat/Citations](../modules/chat-citations.md).
