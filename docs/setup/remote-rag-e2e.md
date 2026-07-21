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
- `RAG_INTERNAL_TOKEN` tối thiểu 32 ký tự; remote Compose override tự đặt `RAG_MODE=remote`, không cần đổi mock default trong `.env`;
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
4. probe local MySQL, Qdrant và upload volume;
5. với `auto`, chỉ download/restore selected cloud release khi local thực sự empty; local đã có dữ liệu được giữ nguyên;
6. start Node + Python;
7. chạy remote preflight;
8. attach `app`/`rag-service` logs.

Node gọi `http://rag-service:8000`; Python callback `http://app:5000`; Qdrant là `http://qdrant:6333`. Node mount uploads read/write, Python mount cùng volume read-only. GCS key không được mount/inject.

Expected log trên fresh reader-enabled volumes:

```text
CORPUS_RESTORE_OK
REMOTE_PREFLIGHT_OK
```

Trên retained volumes, expected `CORPUS_RESTORE_SKIPPED_LOCAL_PRESENT ... exactRelease=NOT_CHECKED`; `auto` không chạy deep exact-release comparison. Partial/in-progress local state cũng được coi là `PRESENT`, giữ nguyên và cảnh báo. Nếu probe trả `UNKNOWN/ERROR`, tool không restore và báo `CORPUS_RESTORE_SKIPPED_LOCAL_UNKNOWN`. `auto` + local empty nhưng thiếu key báo `CORPUS_BOOTSTRAP_SKIPPED` rồi tiếp tục empty; không fallback sang dump/snapshot trong Git.

Chọn mode theo mục đích:

- `auto`: development; bootstrap khi empty, ưu tiên local khi đã có dữ liệu;
- `required`: acceptance strict; selected release và local non-empty phải khớp exact;
- `off`: không đọc/restore/so sánh cloud release.

## 3. Corpus commands

```powershell
npm run corpus:inspect
npm run corpus:verify
npm run corpus:restore
```

Manager dùng writer credential trên source quiescent. Xem plan trước:

```powershell
npm run corpus:publish -- --dry-run
npm run corpus:publish -- --confirm-reviewed
npm run corpus:verify
```

`--confirm-reviewed` xác nhận operator đã kiểm tra PII/personal data, secret, quyền chia sẻ và project scope; không phải automated PII scanner. Policy đơn giản này chỉ dùng với private/internal bucket. Publish/restore không ingest, parse hoặc document-embed. `publish` create-only và pointer-last; `restore` không overwrite incompatible stores/files. Xem [Cloud corpus portability](../architecture/corpus-portability.md).

Dry-run là read-only và yêu cầu MySQL/Qdrant đã chạy: không start/stop writer, không tạo snapshot/staging, không đọc cloud credential và không gọi GCS. Publish thật pause app/Python xuyên suốt frozen export + upload/read-back/pointer update, rồi resume trong `finally`; `Ctrl+C` có signal guard best-effort. Restore stage/verify trước apply và có recovery về empty state; không có implicit replace-local.

Workflow manager chuẩn:

1. Dùng viewer credential và chạy `npm run docker:remote:dev`.
2. `auto` restore selected release nếu local empty; nếu local existing thì giữ local.
3. Upload/process document mới và poll đến `READY`.
4. Nhấn `Ctrl+C`; containers dừng, volumes được giữ.
5. Chuyển sang writer credential qua kênh an toàn.
6. Chạy dry-run, review exact originals/PII/secret/quyền chia sẻ/project scope.
7. Chạy publish với `--confirm-reviewed`, sau đó `npm run corpus:verify`.

Local divergence trong development là hợp lệ. Public corpus hoặc compliance audit cần policy riêng; không dùng confirmation flag này để hạ guard cho public bucket.

## 4. Swagger

| Service | URL |
|---|---|
| Swagger | `http://localhost:5001/api-docs` |
| OpenAPI | `http://localhost:5001/api-docs.json` |
| Node health | `http://localhost:5001/health` |
| Node readiness | `http://localhost:5001/ready` |
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
| `CORPUS_RESTORE_SKIPPED_LOCAL_PRESENT` | `auto` phát hiện local data/partial/in-progress và giữ nguyên; dùng inspect/diagnostic thay vì restore đè. |
| `CORPUS_RESTORE_SKIPPED_LOCAL_UNKNOWN` | Không xác định an toàn emptiness; `auto` không restore. Kiểm tra MySQL/Qdrant/upload probe. `required` sẽ fail. |
| `CORPUS_RESTORE_ROLLBACK_FAILED` | Apply thất bại và không thể phục hồi exact empty pre-state; dừng, không chạy replace/merge tự động. |
| `CORPUS_EXISTING_STATE_MISMATCH` | Chỉ strict `required`/restore/verify: local không khớp selected release. Development `auto` không ép exact match. |
| `CORPUS_REVIEW_CONFIRMATION_REQUIRED` | Chạy dry-run, review plan rồi dùng đúng `--confirm-reviewed`. |
| `401` public API | Dùng user JWT, không dùng internal token. |
| Original unavailable | Corpus/original chưa restore; citation snapshot vẫn dùng được nếu structured local data tồn tại. |
| Chat timeout | Kiểm tra Python/provider health và `RAG_QUERY_TIMEOUT_MS`. |

Quy trình kiểm thử đầy đủ: [Independent test plan](../testing/week3-remote-test-plan.md).
