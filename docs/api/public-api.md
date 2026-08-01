# Public API conventions

Swagger `/api-docs` và OpenAPI `/api-docs.json` là nguồn endpoint/request/response chi tiết. File này chỉ mô tả actor, ownership và workflow. Web/Mobile dùng [Frontend integration contract](frontend-integration.md) cho chat response, source viewer, CORS và các limitation hiện tại.

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
| Document Library | Read-only `READY + VISIBLE` | Read-only `READY + VISIBLE` | Read-only `READY + VISIBLE` |
| Chat | Session của mình | Session của mình | Session của mình |
| Citation/source | Citation thuộc session của mình | Citation thuộc session của mình | Citation thuộc session của mình |
| Dashboard | Không | Không | Basic `LLM_CALLS_ONLY` summary |

ADMIN không tự động đọc chat session của user khác. Document Library/Management dùng `page` (mặc định 1), `limit` (mặc định 20, tối đa 100) và trả thêm `offset`, `total`, `totalPages`; `offset` vẫn là alias legacy. Các API history hiện hữu tiếp tục dùng `offset`/`limit` theo OpenAPI.

## Workflow chính

### Authentication

Student đăng ký thành `ACTIVE`; Teacher thành `PENDING` và cần Admin review. Admin login đúng password vẫn cần OTP trước khi nhận JWT. Change/reset password, lock account và logout làm JWT cũ mất hiệu lực qua `auth_version`. Logout hiện là logout-all cho mọi token/thiết bị phát trước request; client vẫn xóa token local.

### Document ingest

`POST /api/documents` nhận `multipart/form-data` với `file` và optional `title`, `description`, `author`; hỗ trợ PDF/DOCX/TXT. Blank title dùng filename bỏ extension. Node sở hữu `pageCount`: original PDF physical pages; DOCX generated-PDF preview pages sau conversion; TXT null. DOCX phải là bounded OOXML ZIP có core members, không chỉ mang ZIP magic bytes. Response `202` chỉ xác nhận document/jobs đã được tạo và dispatch, chưa có nghĩa RAG hoặc preview đã hoàn tất.

Client poll `GET /api/documents/jobs/{jobId}`. Chỉ khi job `SUCCEEDED` và document `READY + VISIBLE` thì document mới thuộc retrieval corpus. Hide tắt retrieval nhưng giữ vectors; delete soft-delete và giữ chat/citation history. Original file không immutable-update: thay nội dung bằng upload document mới.

### Document Library

Student, Teacher và Admin dùng cùng namespace read-only: list/detail, `/{id}/source` và `/{id}/preview`. Ba role nhận cùng public DTO và có thể đọc tài liệu đủ điều kiện của người khác; server luôn khóa scope vào document `READY + VISIBLE`, chưa deleted. Student vẫn bị cấm toàn bộ `/api/documents`; Teacher management theo `uploaded_by`, Admin quản lý toàn bộ. DTO chứa metadata người dùng, page/preview/original availability và authenticated relative URLs, không chứa owner/storage/checksum/lifecycle/job metadata. Original là attachment; preview là inline PDF. Record đủ điều kiện nhưng file thiếu/pending/failed trả canonical `409`; hidden/deleted/processing/failed RAG state trả `404`.

Library list nhận `q`, `fileType`, `author`, `page`, `limit`, `sort`. `q` tìm partial theo OR trên `title`, `description`, `author`; các filter còn lại kết hợp bằng AND. Management list nhận `q` trên các field đó cộng original filename, cùng `fileType`, `processingStatus`, `visibilityStatus`, `previewStatus`; riêng ADMIN có `ownerId`, còn TEACHER gửi `ownerId` nhận `403`. `sort` là `newest`, `oldest`, `title_asc` hoặc `title_desc`, luôn có `id` tie-breaker để phân trang ổn định. Input được trim; `%`, `_`, `\` là ký tự literal, không phải wildcard. Unicode tiếng Việt và dấu nháy đi qua parameterized SQL.

`q` là canonical; `search` là alias legacy với cùng validation/semantics. Nếu cả hai có giá trị sau trim, chúng phải giống nhau; khác nhau trả `400`, còn whitespace được xem như không truyền. `page` là canonical 1-based; `offset` là alias legacy nhưng luôn là số record bỏ qua chính xác. Chỉ có `offset` thì response dùng `page=floor(offset/limit)+1`, kể cả offset không chia hết. Nếu gửi cả hai, `offset` phải bằng `(page-1)*limit`; không nhất quán trả `400`.

### Chat

Client tạo session, sau đó gửi question vào session do mình sở hữu. Node persist USER + ASSISTANT `PENDING` trước network call; completion lưu answer, citations và usage. `no_answer=true` là HTTP success hợp lệ.

Assistant `content` vẫn là string và có thể chứa Markdown subset/GFM-compatible: đoạn văn, heading nhẹ, bold/italic, danh sách, bảng và inline/fenced code. Node lưu/trả nguyên văn, không chuyển Markdown thành HTML/JSON và không parse `[N]` trong answer để tạo citation. Raw HTML, generated chart, `edurag-chart` và field `visualizations` không thuộc CURRENT contract.

Với `no_answer=false`, answer bắt buộc có ít nhất một structured citation map được tới chunk/document `READY + VISIBLE` tại thời điểm completion. Response thiếu hoặc không xác minh được nguồn trả lỗi upstream và assistant chuyển `FAILED`; Node không tạo citation giả hay parse marker `[1]`.

Không có breaking public API change: `clientRequestId` được nới từ required thành optional theo hướng backward-compatible.

- Omit, `null`, empty hoặc whitespace: server sinh UUID và trả lại trong response.
- UUID hợp lệ do client gửi: idempotency key cho retry.
- Cùng ID + cùng session: trả message pair hiện có, không tạo duplicate.
- Cùng ID + session khác: `409 Conflict`.

Swagger simple example không cần `clientRequestId`; frontend chỉ nên giữ ID khi cần retry đúng logical request.

### Citation và original file

Citation là immutable snapshot từ structured source, không phải parsing ký hiệu `[1]`. `GET /api/citations/{id}/source` trả snapshot và `originalAvailable`; endpoint `/file` stream file vật lý khi còn tồn tại và được phép. Repository không commit original binary. Pointer trong `bootstrap/` chỉ chọn release transport và không tự chứng minh dữ liệu đã được phê duyệt; khi chưa có approved corpus bundle, live restore/query/citation phải được báo `BLOCKED` hoặc `NOT RUN`. Khi không có file restore, citation snapshot vẫn dùng được và file endpoint có thể trả unavailable.

Mọi citation endpoint trước hết yêu cầu owner của chat session chứa citation; ADMIN không bypass ownership này. Sau đó file stream còn áp dụng current source authorization. Truy cập citation ngoài session của mình trả `404` để hạn chế enumeration.

Business behavior sâu hơn: [Documents](../modules/documents.md) và [Chat/Citations](../modules/chat-citations.md).
