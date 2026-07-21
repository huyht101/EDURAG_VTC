# Remote Docker RAG

Hướng dẫn canonical cho NodeJS, MySQL 8.4, Python RAG và Qdrant trên cùng Docker network, kèm cloud corpus bootstrap.

## 1. Chuẩn bị

- Node.js 20+, Docker Desktop và Docker Compose.
- Root `.env` tạo từ `.env.example`.
- Gemini/LlamaParse credentials cho live RAG.
- Reader-capable `secrets/gcs.json` để fresh machine restore canonical corpus. Writer key chỉ dành cho manager publish.

```powershell
npm ci
Copy-Item .env.example .env
```

Điền trong root `.env`:

- app/database/auth secrets;
- `RAG_MODE=remote`, `RAG_INTERNAL_TOKEN` tối thiểu 32 ký tự;
- `GOOGLE_API_KEY`, `LLAMA_CLOUD_API_KEY`;
- `GEMINI_LLM_MODEL=models/gemini-3.5-flash`;
- `GEMINI_EMBEDDING_MODEL=models/gemini-embedding-001`, `EMBEDDING_DIMENSION=768`;
- `CORPUS_BOOTSTRAP=auto`;
- `GCS_PROJECT_ID`, `GCS_BUCKET`, `GCS_OBJECT_PREFIX`, `GCS_CREDENTIALS_FILE`.

Không cần file env phụ, terminal `$env:...`, Compose `-f/-p` dài hoặc GCS key trong container. Root Compose chỉ inject provider/internal variables mà runtime cần; host corpus tooling tự đọc GCS config.

## 2. Start và bootstrap

```powershell
npm run docker:remote:config
npm run docker:remote:dev
```

Foreground orchestration:

1. validate root environment và Compose;
2. build Node/Python images;
3. start MySQL + Qdrant;
4. download, stage và verify cloud release nếu mode yêu cầu;
5. restore/skip MySQL, Qdrant và upload originals;
6. start Node + Python;
7. chạy remote preflight;
8. attach `app`/`rag-service` logs.

Node gọi `http://rag-service:8000`; Python callback `http://app:5000`; Qdrant là `http://qdrant:6333`. Node mount uploads read/write, Python mount cùng volume read-only. GCS key không được mount/inject.

Expected log trên fresh reader-enabled volumes:

```text
CORPUS_RESTORE_OK
REMOTE_PREFLIGHT_OK
```

Trên compatible retained volumes, expected `CORPUS_ALREADY_RESTORED`. `auto` + thiếu key báo `CORPUS_BOOTSTRAP_SKIPPED` và tiếp tục với local state hiện có hoặc empty state; không fallback sang dump/snapshot trong Git.

## 3. Corpus commands

```powershell
npm run corpus:inspect
npm run corpus:verify
npm run corpus:restore
```

Chỉ manager trên approved, quiescent source chạy:

```powershell
npm run corpus:publish
```

Publish/restore không ingest, parse hoặc document-embed. `publish` create-only; `restore` không overwrite incompatible stores/files. Xem [Cloud corpus portability](../architecture/corpus-portability.md).

## 4. Swagger

| Service | URL |
|---|---|
| Swagger | `http://localhost:5001/api-docs` |
| OpenAPI | `http://localhost:5001/api-docs.json` |
| Node health | `http://localhost:5001/health` |
| Python health | `http://localhost:8000/api/health` |
| Qdrant health | `http://localhost:6333/healthz` |

Demo Admin: `admin@example.com` / `123456` (local only).

1. Gọi `POST /api/auth/login`.
2. Lấy `[DEV-ONLY ADMIN OTP]` từ terminal hoặc `npm run docker:remote:logs:app`.
3. Gọi `POST /api/auth/admin/verify-otp`.
4. Dùng `data.token` tại Swagger **Authorize**. Không dùng internal token cho public API.

Corpus đã restore cho phép chat/citation ngay, không cần upload lại. Upload document mới vẫn là async: response `202`, sau đó poll `GET /api/documents/jobs/{jobId}` đến terminal status. Chat request đơn giản chỉ cần `content`; `clientRequestId` optional và server tự sinh UUID.

## 5. Lifecycle

| Command | Mục đích |
|---|---|
| `npm run docker:remote:ps` | Xem service state. |
| `npm run docker:remote:logs:app` | App log và development OTP. |
| `npm run docker:remote:logs:rag` | Python processing/callback log. |
| `npm run preflight:remote` | Health/auth/network/shared-volume checks. |
| `npm run docker:remote:stop` | Stop containers, giữ volumes. |
| `npm run docker:remote:down` | Xóa containers/network, giữ named volumes. |
| `npm run docker:remote:reset` | **Destructive:** xóa volumes của configured remote project. |

`Ctrl+C` best-effort stop containers và giữ volumes. Abrupt kill, Docker crash hoặc mất điện không bảo đảm signal cleanup; lần chạy sau reuse volumes và verify state. Đặt `REMOTE_DEV_ALL_LOGS=true` trong `.env` nếu cần attach cả MySQL/Qdrant logs.

## 6. Lỗi thường gặp

| Lỗi | Hướng xử lý |
|---|---|
| Port in use | Đổi host port trong root `.env`. |
| `GCS_CREDENTIAL_MISSING` | Với `auto`, stack chạy degraded; fresh canonical restore cần reader key. |
| `CORPUS_PARTIAL_STATE` / mismatch | Không overwrite; dùng project/volumes fresh sau khi xác nhận target disposable. |
| `401` public API | Dùng user JWT, không dùng internal token. |
| Original unavailable | Corpus/original chưa restore; citation snapshot vẫn dùng được nếu structured local data tồn tại. |
| Chat timeout | Kiểm tra Python/provider health và `RAG_QUERY_TIMEOUT_MS`. |

Quy trình kiểm thử đầy đủ: [Independent test plan](../testing/week3-remote-test-plan.md).
