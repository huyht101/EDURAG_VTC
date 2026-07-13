# Public API conventions

OpenAPI runtime (`/api-docs`, `/api-docs.json`) là nguồn endpoint/request/response chi tiết. File này chỉ ghi conventions và nhóm route.

## Authentication và response

Public protected routes dùng `Authorization: Bearer <user JWT>`. JWT chứa `id`, `role`, `authVersion`; middleware đọc trạng thái/version hiện tại từ MySQL và chỉ cho `ACTIVE` user.

Success:

```json
{ "success": true, "message": "OK", "data": {} }
```

Error:

```json
{ "success": false, "message": "...", "errorCode": "STABLE_CODE" }
```

## Route groups

- `/api/auth`: register, login, Admin OTP, logout, forgot/reset password.
- `/api/profile`: read/update/change password.
- `/api/admin/users`: list/detail/status transitions.
- `/api/documents`: upload/list/detail/title/file/job/hide/unhide/delete.
- `/api/chat/sessions`: create/list/history/send/soft-delete.
- `/api/citations`: immutable snapshot và authorized original source.
- `/api/admin/dashboard/summary`: Admin aggregate, scope `LLM_CALLS_ONLY`.

Document management chỉ dành cho TEACHER owner và ADMIN. Chat/citation kiểm tra session ownership. Pagination dùng `offset`/`limit` với server-side maximum.

Upload là `multipart/form-data`, field `file`, optional `title`; hỗ trợ PDF/DOCX/TXT. File content immutable, thay file bằng document mới. `storage_key`, password/token hash và internal config không xuất hiện trong public response.
