# Full Docker RAG setup và kiểm thử Swagger

Đây là hướng dẫn chuẩn để chạy toàn bộ development stack:

- NodeJS/Core và MySQL 8.4;
- Python RAG snapshot;
- Qdrant do Python sở hữu;
- Gemini và LlamaParse;
- shared upload volume: Node đọc/ghi, Python chỉ đọc.

Integrated stack chỉ đọc cấu hình từ root `.env`. Không tạo credential env file thứ hai, không truyền credential qua command line và không mount `.env` vào container.

## 1. Yêu cầu

- Docker Desktop đang chạy;
- Node.js 20+ và npm;
- Gemini API key;
- LlamaParse/LlamaCloud API key;
- chạy lệnh tại repository root.

```powershell
docker info
node --version
npm --version
npm ci
```

## 2. Tạo cấu hình local một lần

Nếu root `.env` chưa tồn tại:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Mở `.env` bằng editor và điền các biến sau. Không commit file này.

```dotenv
# Hai password phải giống nhau trong development topology hiện tại.
DB_PASSWORD=<local database password>
MYSQL_ROOT_PASSWORD=<same local database password>

# User JWT/HMAC và internal service auth phải được thay ngoài demo.
JWT_SECRET=<local JWT secret, tối thiểu 32 ký tự>
TOKEN_HMAC_PEPPER=<local HMAC pepper, tối thiểu 32 ký tự>
RAG_INTERNAL_TOKEN=<local internal token, tối thiểu 32 ký tự>

# Provider credentials.
GOOGLE_API_KEY=<Gemini API key>
LLAMA_CLOUD_API_KEY=<LlamaParse API key>

# Contract model đã kiểm thử.
GEMINI_LLM_MODEL=models/gemini-3.5-flash
GEMINI_EMBEDDING_MODEL=models/gemini-embedding-001
EMBEDDING_DIMENSION=768

# Timeout phù hợp live provider; đơn vị milliseconds.
RAG_REQUEST_TIMEOUT_MS=15000
RAG_QUERY_TIMEOUT_MS=180000

# Compose đọc trực tiếp tên project này; không cần nhập `-p` trong terminal.
REMOTE_COMPOSE_PROJECT=edurag_remote_e2e

# Giữ false khi test thủ công bằng Swagger để tránh automated cleanup.
REMOTE_E2E_CONFIRM_ISOLATED=false
REMOTE_E2E_CLEANUP=true
```

Các URL nội bộ giữa container đã được khai báo trong `docker-compose.remote.yml`:

- Node gọi Python: `http://rag-service:8000`;
- Python callback Node: `http://app:5000/api/internal/rag/processing-callback`;
- Python gọi Qdrant: `http://qdrant:6333`;
- shared file path phía Python: `/shared/uploads`.

Không thay các URL này thành `localhost` khi cả hai service chạy trong Docker.

## 3. Validate và khởi động

Các npm script đã chứa đầy đủ Compose file/profile. Không cần đặt biến PowerShell hoặc lặp lại `-f`/`-p`.

```powershell
npm run docker:remote:config
npm run docker:remote:up
npm run docker:remote:ps
```

Phải thấy bốn service:

- `db` healthy;
- `app` healthy;
- `rag-service` healthy;
- `qdrant` running.

Chạy preflight:

```powershell
npm run preflight:remote
```

Kết quả mong đợi:

```text
REMOTE_PREFLIGHT_OK generation=models/gemini-3.5-flash embedding=models/gemini-embedding-001
```

Preflight kiểm tra Docker, bốn health endpoint, Bearer hai chiều, Node → Python, Python → Node/Qdrant và shared-volume write/read probe. Nó chỉ báo tên biến bị thiếu, không in giá trị secret.

## 4. URL sử dụng

Với port mặc định trong `.env`:

| Thành phần | URL |
|---|---|
| Swagger NodeJS | `http://localhost:5001/api-docs` |
| OpenAPI JSON | `http://localhost:5001/api-docs.json` |
| Node health | `http://localhost:5001/health` |
| Python health | `http://localhost:8000/api/health` |
| Qdrant health | `http://localhost:6333/healthz` |

Nếu port bận, sửa `APP_HOST_PORT`, `MYSQL_HOST_PORT`, `PYTHON_HOST_PORT`, `QDRANT_HTTP_HOST_PORT` hoặc `QDRANT_GRPC_HOST_PORT` trong root `.env`, sau đó chạy lại `npm run docker:remote:up`.

## 5. Lấy JWT Admin trong Swagger

Fresh development volume có Demo Admin:

```text
email: admin@example.com
password: 123456
```

Credential này chỉ dành cho local demo.

### 5.1 Login

Trong Swagger, chạy `POST /api/auth/login`:

```json
{
  "email": "admin@example.com",
  "password": "123456"
}
```

Admin login thành công sẽ trả `requireOtp=true`.

### 5.2 Đọc OTP development-only

```powershell
npm run docker:remote:logs:app
```

Tìm dòng mới nhất có `[DEV-ONLY ADMIN OTP]`. Không gửi log/OTP chưa redact cho người khác.

### 5.3 Verify OTP

Chạy `POST /api/auth/admin/verify-otp`:

```json
{
  "email": "admin@example.com",
  "otpCode": "<OTP 6 chữ số>"
}
```

Copy `data.token`, nhấn `Authorize` ở đầu Swagger và dán JWT. Swagger tự tạo `Authorization: Bearer <JWT>`; không dùng `RAG_INTERNAL_TOKEN` cho public API.

## 6. Upload và theo dõi xử lý

Chạy `POST /api/documents`:

- chọn `file`: PDF, DOCX hoặc TXT;
- nhập `title` nếu cần;
- mặc định tối đa 20 MiB.

Response đúng là `202`, chứa:

- `data.document.id`;
- `data.job.id`;
- document `processingStatus=PROCESSING`;
- job `status=RUNNING`.

Lưu `documentId` và `jobId`, sau đó gọi lặp lại:

```text
GET /api/documents/jobs/{jobId}
```

Kết quả hoàn tất:

```text
job.status = SUCCEEDED
job.currentStage = COMPLETED
document.processingStatus = READY
document.visibilityStatus = VISIBLE
```

Kiểm tra document bằng `GET /api/documents/{documentId}`.

Luồng thực tế:

1. Node validate extension, MIME, signature và size.
2. Node lưu file bằng generated storage key.
3. Node transaction tạo `documents` và `document_processing_jobs`.
4. Sau commit, Node dispatch ingest cho Python bằng internal Bearer.
5. Python đọc shared file, parse/chunk/embed và upsert Qdrant.
6. Python callback complete manifest cho Node.
7. Node transaction lưu `document_chunks`, hoàn tất job và chuyển document sang `READY`.

Theo dõi Python log khi cần:

```powershell
npm run docker:remote:logs:rag
```

## 7. Xác minh shared file

Node nhìn thấy file tại `/usr/src/app/uploads`, Python nhìn thấy cùng named volume tại `/shared/uploads` ở chế độ read-only.

```powershell
npm run docker:remote:files:node
npm run docker:remote:files:rag
```

Hai lệnh phải liệt kê cùng storage key dưới `documents/YYYY/MM/`. Public API không trả storage key/path nội bộ.

Mở file qua quyền nghiệp vụ:

```text
GET /api/documents/{documentId}/file
```

## 8. Tạo chat và hỏi tài liệu

### 8.1 Tạo session

Chạy `POST /api/chat/sessions`:

```json
{
  "title": "Kiểm thử tài liệu vừa upload"
}
```

Lưu `data.id` làm `sessionId`.

### 8.2 Gửi câu hỏi

Tạo UUID mới bằng Swagger-compatible UUID generator bất kỳ; với PowerShell có thể dùng lệnh ngắn sau khi thật sự cần một request ID:

```powershell
[guid]::NewGuid().ToString()
```

Chạy `POST /api/chat/sessions/{sessionId}/messages`:

```json
{
  "content": "Câu hỏi có cụm từ đặc trưng trong tài liệu vừa upload",
  "clientRequestId": "<UUID mới>"
}
```

Response thành công có:

```text
data.assistantMessage.status = COMPLETED
data.assistantMessage.content = câu trả lời
data.assistantMessage.noAnswer = false hoặc true
data.assistantMessage.citations = structured citation snapshots
```

Không assert chính xác câu chữ LLM. Kiểm tra status, response shape, citation mapping và source snapshot.

### 8.3 Xem history và citation

```text
GET /api/chat/sessions/{sessionId}/messages?offset=0&limit=20
GET /api/citations/{citationId}
GET /api/citations/{citationId}/source
GET /api/citations/{citationId}/file
```

`citationId` nằm trong `data.assistantMessage.citations[].id`. Citation snapshot vẫn đọc được sau hide/delete; file gốc chỉ mở được nếu authorization và trạng thái cho phép.

## 9. Hide, unhide và delete

Mỗi operation trả `202` kèm job. Sau mỗi lệnh, poll `GET /api/documents/jobs/{jobId}` đến `SUCCEEDED`.

```text
POST   /api/documents/{documentId}/hide
POST   /api/documents/{documentId}/unhide
DELETE /api/documents/{documentId}
```

- Hide: document thành `HIDDEN`, không còn retrieval nhưng vector không bị xóa.
- Unhide: document trở lại `READY + VISIBLE` và có thể retrieval.
- Delete: Python xóa/deactivate vector, MySQL soft-delete document; chat/citation/usage không bị hard-delete.

Khi hỏi lại để kiểm tra retrieval, dùng `clientRequestId` mới và câu hỏi có nội dung độc nhất trong tài liệu.

## 10. Xem dữ liệu MySQL

Lệnh sau mở MySQL CLI và hỏi password tương tác; password không nằm trong command history:

```powershell
npm run docker:remote:mysql
```

Một số query kiểm tra:

```sql
SELECT id, title, processing_status, visibility_status
FROM documents ORDER BY id DESC LIMIT 10;

SELECT id, document_id, job_type, status, current_stage,
       attempt_count, total_chunks, error_code
FROM document_processing_jobs ORDER BY id DESC LIMIT 20;

SELECT document_id, chunk_index, vector_node_id,
       CHAR_LENGTH(chunk_text) AS text_length
FROM document_chunks ORDER BY id DESC LIMIT 20;

SELECT id, session_id, sender_type, message_order, status, no_answer
FROM chat_messages ORDER BY id DESC LIMIT 20;

SELECT id, message_id, document_id, chunk_id, document_title_snapshot
FROM citations ORDER BY id DESC LIMIT 20;

SELECT message_id, provider, model, operation_type,
       prompt_tokens, completion_tokens, status
FROM llm_usage_logs ORDER BY id DESC LIMIT 20;
```

## 11. Automated live smoke

Không chạy smoke trên project có dữ liệu cần giữ. Dành một project/volume test riêng bằng cách sửa trong root `.env`:

```dotenv
REMOTE_COMPOSE_PROJECT=edurag_remote_e2e
REMOTE_E2E_CONFIRM_ISOLATED=true
REMOTE_E2E_CLEANUP=true
```

Sau đó:

```powershell
npm run docker:remote:up
npm run preflight:remote
npm run test:remote
```

`test:remote` gọi public/internal HTTP thật, kiểm tra ingest/callback/manifest/chat/citation/usage/hide/unhide/delete/failure cases và tự `down -v` project đã xác nhận isolated trong `finally`.

Để quay lại test Swagger thủ công, đặt `REMOTE_E2E_CONFIRM_ISOLATED=false` và chạy `npm run docker:remote:up`.

## 12. Dừng và reset

Dừng nhưng giữ MySQL/uploads/Qdrant volumes:

```powershell
npm run docker:remote:down
```

Reset toàn bộ development project hiện được đặt trong `REMOTE_COMPOSE_PROJECT`:

```powershell
npm run docker:remote:reset
```

`docker:remote:reset` xóa database, upload và Qdrant volumes. Chỉ chạy khi đã xác nhận project trong root `.env` là project test và không chứa dữ liệu cần giữ.

## 13. Lỗi thường gặp

| Hiện tượng | Kiểm tra |
|---|---|
| `401` public API | Swagger đã Authorize bằng user JWT, không phải internal token |
| Admin không có JWT | Hoàn tất bước OTP development-only |
| Teacher `403` | Teacher còn `PENDING`, Admin cần chuyển sang `ACTIVE` |
| `INVALID_FILE_SIGNATURE` | Extension, MIME và nội dung file không khớp |
| `FILE_TOO_LARGE` | Kiểm tra `FILE_MAX_SIZE_BYTES` trong root `.env` |
| `RAG_SERVICE_UNAVAILABLE` | `npm run docker:remote:ps`, preflight và Python logs |
| Job `FAILED` | Xem `errorCode`, `errorMessage`, app/Python logs |
| Chat không có citation | Chờ document `READY + VISIBLE`, hỏi nội dung có trong tài liệu |
| Chat timeout | Tăng `RAG_QUERY_TIMEOUT_MS` trong `.env`, recreate app |
| Port đã được dùng | Đổi host port trong `.env`, không truyền `$env:` tạm thời |

Contract nội bộ canonical: [Internal NodeJS–Python RAG contract](../api/internal-rag-contract.md). Checklist kiểm thử độc lập: [Week 3 remote test plan](../testing/week3-remote-test-plan.md).
