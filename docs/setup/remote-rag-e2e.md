# Remote Docker RAG

Hướng dẫn canonical để chạy NodeJS, MySQL 8.4, Python RAG và Qdrant trên cùng Docker network. Không cần `PythonSevice.env`, `$env:...`, `-f` hoặc `-p` cho workflow thông thường.

## 1. Chuẩn bị

- Node.js 20+
- Docker Desktop đang chạy
- Root `.env` tạo từ `.env.example`
- Gemini và LlamaParse credentials hợp lệ

```powershell
npm ci
Copy-Item .env.example .env
```

Điền trong root `.env`:

- `GOOGLE_API_KEY`, `LLAMA_CLOUD_API_KEY`;
- `RAG_INTERNAL_TOKEN` tối thiểu 32 ký tự;
- `JWT_SECRET`, `TOKEN_HMAC_PEPPER`;
- `DB_PASSWORD` và `MYSQL_ROOT_PASSWORD` giống nhau trong local topology;
- `REMOTE_COMPOSE_PROJECT` và các host port nếu default đang bận.

Giữ contract đã kiểm thử:

```dotenv
GEMINI_LLM_MODEL=models/gemini-3.5-flash
GEMINI_EMBEDDING_MODEL=models/gemini-embedding-001
EMBEDDING_DIMENSION=768
CORPUS_BOOTSTRAP=auto
```

Root Compose inject `RAG_INTERNAL_TOKEN` sang Python dưới tên `INTERNAL_SECRET`. Provider keys chỉ được inject vào Python. Không commit `.env`.

## 2. Start foreground

```powershell
npm run docker:remote:config
npm run docker:remote:dev
```

`docker:remote:dev` thực hiện:

1. validate root environment và Compose;
2. start MySQL + Qdrant;
3. auto-bootstrap corpus theo `CORPUS_BOOTSTRAP`;
4. build/start Node + Python;
5. chạy remote preflight;
6. follow log `app` và `rag-service`.

Kết quả preflight mong đợi:

```text
REMOTE_PREFLIGHT_OK generation=models/gemini-3.5-flash embedding=models/gemini-embedding-001
```

Node gọi `http://rag-service:8000`; Python callback `http://app:5000`; Python gọi `http://qdrant:6333`. Không dùng `localhost` giữa containers. Node mount upload read/write, Python mount cùng volume read-only.

## 3. URL và login Swagger

Với port mặc định:

| Service | URL |
|---|---|
| Swagger | `http://localhost:5001/api-docs` |
| OpenAPI | `http://localhost:5001/api-docs.json` |
| Node health | `http://localhost:5001/health` |
| Python health | `http://localhost:8000/api/health` |
| Qdrant health | `http://localhost:6333/healthz` |

Demo Admin local only: `admin@example.com / 123456`.

1. Gọi `POST /api/auth/login`.
2. Đọc `[DEV-ONLY ADMIN OTP]` ngay trong terminal đang attach log; hoặc dùng `npm run docker:remote:logs:app`.
3. Gọi `POST /api/auth/admin/verify-otp`.
4. Copy `data.token`, nhấn **Authorize** trong Swagger và dán user JWT.

Không dán internal token vào Swagger public routes.

## 4. Workflow kiểm tra

### Corpus đã restore

Với fresh volumes và `CORPUS_BOOTSTRAP=auto`, canonical corpus được restore trước khi app start. Có thể tạo chat session và hỏi ngay mà không upload/parse/embed lại document. Citation/source hoạt động; original-file có thể unavailable vì bundle không chứa upload files.

### Upload document mới

1. `POST /api/documents` với PDF/DOCX/TXT.
2. Lưu `data.document.id` và `data.job.id` từ response `202`.
3. Poll `GET /api/documents/jobs/{jobId}` đến `SUCCEEDED`.
4. Xác nhận document `READY + VISIBLE`.
5. Tạo session bằng `POST /api/chat/sessions`.
6. Gửi question qua `POST /api/chat/sessions/{id}/messages`.
7. Đọc citation qua `/api/citations/{id}` hoặc `/source`.

Simple chat request chỉ cần `content`; server tự sinh `clientRequestId`. Chỉ gửi UUID ổn định khi retry cùng logical request. Không assert chính xác wording của LLM.

Endpoint-level payload/status/error nằm trong Swagger. Role/workflow tổng quan: [Public API](../api/public-api.md).

## 5. Corpus bootstrap modes

| `CORPUS_BOOTSTRAP` | Hành vi |
|---|---|
| `off` | Không xét bundle. |
| `auto` | Restore bundle valid khi cả MySQL và Qdrant bootstrap-empty; skip khi đã có data. |
| `required` | Fail startup nếu bundle thiếu, tampered hoặc incompatible. |

Partial/non-empty stores không bị overwrite. Restore không gọi document ingest, LlamaParse hoặc document embedding. Query vẫn dùng query embedding và LLM.

Các command quản trị bundle:

```powershell
npm run corpus:inspect
npm run corpus:verify
npm run corpus:restore
```

`corpus:restore` chỉ dùng với bootstrap-empty target. Quy trình export và exact approval nằm tại [Corpus portability](../architecture/corpus-portability.md).

## 6. Lifecycle và logs

Nhấn `Ctrl+C` để best-effort stop containers và giữ MySQL/Qdrant/upload named volumes. Abrupt process kill, Docker Desktop crash hoặc mất điện không bảo đảm signal cleanup; chạy `npm run docker:remote:stop` trước khi start lại nếu cần.

| Command | Mục đích |
|---|---|
| `npm run docker:remote:ps` | Xem service state. |
| `npm run docker:remote:logs:app` | App log và development OTP. |
| `npm run docker:remote:logs:rag` | Python processing/callback log. |
| `npm run preflight:remote` | Health/auth/network/shared-volume checks. |
| `npm run docker:remote:stop` | Stop containers, giữ volumes. |
| `npm run docker:remote:down` | Xóa containers/network, giữ named volumes. |
| `npm run docker:remote:reset` | **Destructive:** xóa volumes của remote project. |

Mặc định chỉ app/Python logs được attach. Đặt `REMOTE_DEV_ALL_LOGS=true` trong `.env` nếu cần xem cả MySQL/Qdrant.

## 7. Lỗi thường gặp

| Lỗi | Kiểm tra |
|---|---|
| Port in use | Đổi host port trong root `.env`, không dùng biến terminal tạm. |
| `401` public API | Dùng user JWT, không dùng internal token. |
| Admin chưa có JWT | Hoàn tất OTP step. |
| Job `FAILED` | Xem job detail và app/Python logs. |
| Chat timeout | Kiểm tra `RAG_QUERY_TIMEOUT_MS`, Python health và provider. |
| Original unavailable | Portable corpus không chứa original files; dùng citation/source snapshot. |
| `CORPUS_PARTIAL_STATE` | Không overwrite; kiểm tra/reset đúng isolated target rồi restore lại. |

Kiểm thử tự động và cleanup project cô lập: [Independent test plan](../testing/week3-remote-test-plan.md).
