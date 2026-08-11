# Contract nội bộ NodeJS–Python RAG v0.1

Canonical boundary giữa NodeJS/Core và Python RAG. Business persistence vẫn lấy [`src/database/schema.sql`](../../src/database/schema.sql) làm nguồn chuẩn.

Team Python/Data-RAG sở hữu repository Python upstream riêng. [`python-service/`](../../python-service/) chỉ là tracked audit snapshot tại lần refresh gần nhất và có thể không trùng upstream hiện tại.

Các mức trạng thái:

- **Đã triển khai ở NodeJS:** có code/test trong repository này.
- **Quan sát trong Python snapshot:** được đọc từ snapshot hiện có, không bảo đảm upstream mới nhất.
- **Target contract:** boundary hai team cần đạt trước remote E2E.
- **Python cần thay đổi:** cần chuyển/upstream cho nhóm Python.
- **Chưa integration-tested:** chưa được chứng minh với hai service thật.
- **E2E verified:** chỉ dùng sau khi NodeJS, Python và Qdrant thật chạy qua flow tương ứng.

Trạng thái hiện tại: NodeJS adapter, contract tests, isolated remote Compose và repeatable
live runner đã triển khai. Live provider E2E ngày 2026-07-17 là **historical evidence**
cho snapshot/baseline `b348728c55bd42be35ec23c352dd379749adfbe2`; nó không
chứng minh các thay đổi canonical-DOCX, locator, OCR hoặc citation parser về sau. Trạng
thái cross-runtime hiện hành nằm tại [project handoff](../../PROJECT_HANDOFF.md).

## Ownership và xác thực

- Client chỉ gọi public NodeJS API bằng user JWT.
- NodeJS gọi Python bằng `Authorization: Bearer <RAG_INTERNAL_TOKEN>`.
- Python callback NodeJS bằng cùng secret, phía Python đặt tên `INTERNAL_SECRET`.
- Hai giá trị phải giống nhau và có ít nhất 32 ký tự.
- NodeJS là thành phần duy nhất ghi MySQL.
- Python sở hữu parsing, embedding, RAG và Qdrant; NodeJS không gọi Qdrant.
- Snapshot hiện tại gửi callback bằng Bearer; `api/dependencies.py::verify_internal_token`
  bảo vệ ingest/query/visibility/delete bằng explicit secret, `secrets.compare_digest`
  và thống nhất `401` cho missing/malformed/incorrect Bearer. Health vẫn public. Patch này
  cần upstream cho nhóm Python.

Boundary JSON dùng `snake_case`; internal NodeJS code giữ `camelCase`.

## Operations hiện hành

| Operation | Method/path | Quan sát trong Python snapshot | NodeJS adapter |
|---|---|---|---|
| Ingest | `POST /api/ingest` | Đã triển khai | Đã triển khai |
| Visibility | `PATCH /api/docs/{doc_id}/visibility` | Đã triển khai với `action` | Đã triển khai |
| Delete vectors | `DELETE /api/ingest/{doc_id}` | Đã triển khai | Đã triển khai |
| Query | `POST /api/query` | Đã triển khai | Đã triển khai |
| Processing callback | `POST /api/internal/rag/processing-callback` | Sender đã triển khai | Receiver đã triển khai |

Dispatch/operation timeout dùng `RAG_REQUEST_TIMEOUT_MS`; query dùng `RAG_QUERY_TIMEOUT_MS`. `RAG_CALLBACK_BODY_LIMIT` chỉ áp dụng cho internal complete-manifest callback. NodeJS không tự retry network request. Riêng ingest dispatch timeout là kết quả vận chuyển chưa xác định: Node trả `503` nhưng giữ exact attempt `RUNNING` để complete-manifest hợp lệ đến sau vẫn có thể được xử lý; rejection/failure xác định mới chuyển job/document sang `FAILED`.

## Ingest

NodeJS gửi:

| Field | Status | Notes |
|---|---|---|
| `doc_id` | required | `String(documents.id)` |
| `job_id` | required | Processing job ID |
| `attempt_count` | required | Processing attempt; current snapshot preserves it through background work and callbacks |
| `subject_id` | required by Python | `RAG_DEFAULT_SUBJECT_ID=mvp-global` compatibility shim |
| `file_path` | required | Absolute Python-visible path từ generated `storage_key` |
| `callback_url` | required | Node internal callback URL |
| `teacher_metadata` | optional | NodeJS luôn gửi `{}` |

Snapshot hiện tại đưa mọi key trong `teacher_metadata` vào Qdrant payload với prefix
`teacher_`. Vì authorization/PII không thuộc vector contract, NodeJS không gửi email,
role, user ID hoặc owner metadata.

`file_path` phải nằm trong shared upload root. NodeJS kiểm tra containment trước khi tạo path; không gửi raw filename hoặc host Windows path cố định.

Snapshot hiện tại trả `202` với `status`, `job_id`, `message`. NodeJS yêu cầu `job_id`,
accepted/rejected status rõ ràng và từ chối response có `job_id` không khớp.

Snapshot hiện tại nhận và bảo toàn `attempt_count` từ ingest request cho mọi callback của
processing attempt đó.

## Visibility

`PATCH /api/docs/{doc_id}/visibility`

```json
{
  "job_id": "102",
  "attempt_count": 1,
  "action": "hide",
  "callback_url": "http://node:5000/api/internal/rag/processing-callback"
}
```

`action` là `hide` hoặc `unhide`. NodeJS mapping:

- `enabled=false` → `hide`;
- `enabled=true` → `unhide`.

Snapshot hiện tại khai báo đủ `job_id`, `attempt_count`, `action`, `callback_url` và
callback matching attempt.

## Xóa vector

`DELETE /api/ingest/{doc_id}` với body:

```json
{
  "job_id": "103",
  "attempt_count": 1,
  "callback_url": "http://node:5000/api/internal/rag/processing-callback"
}
```

Snapshot hiện tại khai báo đủ `job_id`, `attempt_count`, `callback_url` và callback
matching attempt.

## Callback xử lý

Common fields:

- `job_id`;
- processing `attempt_count`;
- `event_type`: `PROGRESS`, `SUCCEEDED`, `FAILED`, `CANCELLED`;
- optional `stage`, `error`, result counters.

Successful ingest target ưu tiên field `chunk_manifest`, cũng là field observed trong current snapshot. NodeJS nhận compatibility alias `chunks`. Nếu cả hai xuất hiện và normalize thành dữ liệu khác nhau, NodeJS trả `RAG_CALLBACK_MANIFEST_CONFLICT`.

Mỗi chunk bắt buộc:

- `chunk_index`;
- UUID `chunk_id` hoặc `vector_node_id`;
- full `chunk_text`;
- SHA-256 `content_hash` khớp chính xác `chunk_text`.

Optional: `token_count`, `page_number`, `section_title`, `chapter`, `section`, `source_locator`. `page_number` là 1-based khi có và phải quy chiếu trustworthy canonical physical PDF page; nếu identity không đáng tin thì phải để null, không suy từ output ordinal. `source_locator` là `null` hoặc `{boxes:[{x,y,width,height}, ...]}` với finite normalized 0–1 coordinates, top-left origin, positive size và box nằm trọn trong trang; Node reject locator sai thay vì sửa. Với DOCX upload mới, Python nhận canonical PDF do Node publish nên page/locator phải theo PDF đó. TXT có thể giữ synthetic segment nội bộ; `page_number <= 0` được normalize thành `null`.

NodeJS không nhận `text_preview` thay full text, không tự hash preview và không sinh fake vector ID.

NodeJS khóa job/document rows trong transaction, so processing attempt và trả ACK JSON:

- `jobId`, `attemptCount`;
- `outcome`: `ACCEPTED`, `IDEMPOTENT_REPLAY`, `IGNORED`, `REJECTED`;
- `canActivate`;
- nullable `reason` và terminal/current `status`.

Python chỉ activate Qdrant point khi `jobId/attemptCount` khớp, `status=SUCCEEDED`, `canActivate=true` và outcome là accepted hoặc exact replay. Replay cùng attempt chỉ được activate nếu complete manifest khớp dữ liệu Node đã persist; stale, terminal conflict, manifest conflict và malformed ACK không activate. HTTP `200` một mình không phải activation permission.

MVP không dùng full two-phase callback. Nếu activation Qdrant thất bại sau ACK, Python cleanup point của attempt và gửi `FAILED` với `ACTIVATION_FAILED`; nếu ACK không thể đọc sau retry, dùng `ACTIVATION_ACK_UNAVAILABLE`. Node chỉ cho phép hai mã compensation này chuyển exact current ingest/reprocess attempt từ `SUCCEEDED` sang `FAILED`; stale attempt và failure code khác không được ghi đè terminal state.

Snapshot hiện tại dùng deterministic RFC-4122 UUID5 từ document/job/attempt/chunk index
cho cả Qdrant point ID và `chunk_id`, gửi full `chunk_text`, lowercase SHA-256
`content_hash`, optional page/heading và giữ nguyên `attempt_count` khi callback HTTP
retry. Retry cùng attempt overwrite cùng point; attempt khác có point identity khác.
`source_locator` chưa được Python tạo nhưng vẫn optional.

`page_count`/`pageCount` không đi qua RAG callback: Node tự đếm original PDF hoặc canonical DOCX-derived PDF. Ingest body không đổi: Node gửi `doc_id`, `job_id`, `attempt_count`, `file_path`, `callback_url`; DOCX `file_path` trỏ tới persistent derived `.pdf`, không phải original `.docx`. Complete-manifest/ACK/activate lifecycle không đổi.

`gemini-embedding-001` trả 3072 chiều theo SDK mặc định. Snapshot integration overlay cấu hình `embedding_config.output_dimensionality=EMBEDDING_DIMENSION` để giữ agreed dimension `768`; Qdrant đã từ chối upsert trước patch và live ingest đã PASS sau patch. Thay đổi này cần upstream về Python repository.

## Query

NodeJS gửi:

- `request_id`;
- `user_id`;
- `conversation_id`;
- `question`;
- bounded `history[]` với role lowercase `user|assistant`.

Snapshot hiện tại khai báo `question`, `conversation_id`, `history`, optional `request_id`
và optional `user_id`. Hai field cuối chỉ là correlation context, không cấp authorization
cho Python.

Response của snapshot hiện tại có:

- `answer`: string, kể cả no-answer. String có thể chứa Markdown subset/GFM-compatible
  (đoạn văn, heading nhẹ, emphasis, list, table và inline/fenced code); Node lưu và
  trả nguyên văn, không parse thành HTML/JSON. Raw HTML, `edurag-chart`, chart JSON
  và `visualizations` không thuộc CURRENT contract;
- `citations[]`;
- `confidence`: string `high|medium|low`;
- `no_answer`: boolean;
- ordered `usage_calls[]`;
- legacy aggregate `usage`.

Mỗi `usage_calls[]` item bắt buộc có unique contiguous `call_index` 1-based, `operation_type`, provider/model, non-negative token fields, status và nullable machine-readable `error_code`. Node không mặc định operation bị thiếu thành answer generation. `total_tokens` trong MySQL là derived field; legacy aggregate chỉ là compatibility fallback khi `usage_calls` không được gửi.

Citation của snapshot hiện tại có `vector_node_id=str(result.id)`, `doc_id`, relevant
`snippet`, optional 1-based PDF `page_number`, `chapter`, `section`. NodeJS nhận
`snippet` làm source fragment alias, resolve ID qua `document_chunks`, không suy đoán
vector ID. Node boundary cho nullable `source_locator` đã implement, nhưng snapshot chưa
sinh geometry. Snapshot marker parser hiện loại marker trong inline/fenced code và array
index khỏi citation parsing, giữ mixed valid markers và chỉ resolve citable results. Đây
là behavior quan sát trong snapshot; upstream revision vẫn `Unknown` và live rich-output
generation chưa được xác minh. Xem [Python handoff](../architecture/python-rag-handoff.md).

`no_answer=true` là success; NodeJS không tạo citation dù response có citation data.

Target bắt buộc: `no_answer=false` phải có ít nhất một citation structured với `vector_node_id` và source fragment hợp lệ. Node resolve mọi citation tới MySQL chunk/document `READY + VISIBLE`; mảng rỗng hoặc source không xác minh được trả `502`, và assistant không được complete. Snapshot overlay hiện đổi CHIT_CHAT và RAG answer không có citation marker thành `no_answer=true`; patch nhỏ này phải upstream về Python repository. Node validation vẫn fail closed để không phụ thuộc vào overlay.

## Lỗi

NodeJS fail closed khi accepted/query response thiếu field bắt buộc và xử lý:

- Python `{error_code, message, timestamp}`;
- FastAPI `{detail: ...}`;
- non-JSON upstream response;
- timeout/abort;
- connection failure.

NodeJS không expose raw internal token hoặc multiline upstream stack ra public response.

## Evidence tương thích

- Node boundary: [`src/clients/rag-contract.js`](../../src/clients/rag-contract.js).
- HTTP client: [`src/clients/rag-client.js`](../../src/clients/rag-client.js).
- Chuẩn hóa callback: [`src/middlewares/rag-callback-normalization-middleware.js`](../../src/middlewares/rag-callback-normalization-middleware.js).
- Fixtures: [`tests/fixtures/rag-contract/v0.1/`](../../tests/fixtures/rag-contract/v0.1/).
- Tests: [`scripts/rag-contract-test.js`](../../scripts/rag-contract-test.js).
- Metadata snapshot: [Python RAG snapshot](../architecture/python-rag.md).
- Trạng thái tích hợp hiện hành: [project handoff](../../PROJECT_HANDOFF.md) và
  [MVP gap matrix](../status/mvp-gap-matrix.md).

Fixtures mô tả target v0.1 hiện đã quan sát được trong snapshot refresh mới. Chúng vẫn là mocked contract evidence, không phải bằng chứng remote E2E.

Remote topology và runner: [`docker-compose.remote.yml`](../../docker-compose.remote.yml), [`scripts/remote-preflight.js`](../../scripts/remote-preflight.js) và [`scripts/remote-e2e-smoke.js`](../../scripts/remote-e2e-smoke.js). Xem [remote setup](../setup/remote-rag-e2e.md). `REMOTE_E2E_SMOKE_OK` là live evidence; preflight hoặc mocked transport riêng lẻ không đủ.

## Ngoài phạm vi

OCR provider/policy, PPTX, public reprocess, durable queue/retry worker, object storage,
production infrastructure và RAG quality tuning không thuộc v0.1. Nếu OCR hoặc geometry
được triển khai, output vẫn phải tuân page/chunk/locator và whole-document boundary ở
trên. Historical remote E2E không thay đổi contract semantics.
