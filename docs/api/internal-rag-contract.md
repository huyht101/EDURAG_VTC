# Internal NodeJS–Python RAG contract v0.1

Canonical boundary giữa NodeJS/Core và Python RAG. Business persistence vẫn lấy [`src/database/schema.sql`](../../src/database/schema.sql) làm nguồn chuẩn.

Trạng thái: NodeJS adapter và contract tests đã triển khai. Python runtime đã được audit trực tiếp tại [`python-service/`](../../python-service/). Remote end-to-end chưa chạy.

## Ownership và authentication

- Client chỉ gọi public NodeJS API bằng user JWT.
- NodeJS gọi Python bằng `Authorization: Bearer <RAG_INTERNAL_TOKEN>`.
- Python callback NodeJS bằng cùng secret, phía Python đặt tên `INTERNAL_SECRET`.
- Hai giá trị phải giống nhau và có ít nhất 32 ký tự.
- NodeJS là thành phần duy nhất ghi MySQL.
- Python sở hữu parsing, embedding, RAG và Qdrant; NodeJS không gọi Qdrant.
- Python callback sender đã gửi Bearer. Python inbound routes chưa verify Bearer: **Required Python change**.

Boundary JSON dùng `snake_case`; internal NodeJS code giữ `camelCase`.

## Operations

| Operation | Method/path | Runtime Python | NodeJS adapter |
|---|---|---|---|
| Ingest | `POST /api/ingest` | Implemented | Implemented |
| Visibility | `PATCH /api/docs/{doc_id}/visibility` | Implemented with `action` | Implemented |
| Delete vectors | `DELETE /api/ingest/{doc_id}` | Implemented | Implemented |
| Query | `POST /api/query` | Implemented | Implemented |
| Processing callback | `POST /api/internal/rag/processing-callback` | Sender implemented | Receiver implemented |

Dispatch/operation timeout dùng `RAG_REQUEST_TIMEOUT_MS`; query dùng `RAG_QUERY_TIMEOUT_MS`. NodeJS không tự retry network request.

## Ingest

NodeJS gửi:

| Field | Status | Notes |
|---|---|---|
| `doc_id` | required | `String(documents.id)` |
| `job_id` | required | Processing job ID |
| `attempt_count` | target-required | Processing attempt; Python schema hiện chưa khai báo |
| `subject_id` | required by Python | `RAG_DEFAULT_SUBJECT_ID=mvp-global` compatibility shim |
| `file_path` | required | Absolute Python-visible path từ generated `storage_key` |
| `callback_url` | required | Node internal callback URL |
| `teacher_metadata` | optional | NodeJS luôn gửi `{}` |

Python runtime đưa mọi key trong `teacher_metadata` vào Qdrant payload với prefix `teacher_`. Vì authorization/PII không thuộc vector contract, NodeJS không gửi email, role, user ID hoặc owner metadata.

`file_path` phải nằm trong shared upload root. NodeJS kiểm tra containment trước khi tạo path; không gửi raw filename hoặc host Windows path cố định.

Python trả `202` với `status`, `job_id`, `message`. NodeJS từ chối response có `job_id` không khớp.

Python cần nhận và bảo toàn `attempt_count` từ ingest request để dùng cho mọi callback của processing attempt đó.

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

Python runtime hiện khai báo `job_id`, `action`, `callback_url`; `attempt_count` vẫn là target-required field cần Python preserve.

## Delete vectors

`DELETE /api/ingest/{doc_id}` với body:

```json
{
  "job_id": "103",
  "attempt_count": 1,
  "callback_url": "http://node:5000/api/internal/rag/processing-callback"
}
```

Python runtime hiện khai báo `job_id`, `callback_url`; `attempt_count` vẫn là target-required field.

## Processing callback

Common fields:

- `job_id`;
- processing `attempt_count`;
- `event_type`: `PROGRESS`, `SUCCEEDED`, `FAILED`, `CANCELLED`;
- optional `stage`, `error`, result counters.

Successful ingest ưu tiên field Python runtime `chunk_manifest`. NodeJS cũng nhận compatibility alias `chunks`. Nếu cả hai xuất hiện và normalize thành dữ liệu khác nhau, NodeJS trả `RAG_CALLBACK_MANIFEST_CONFLICT`.

Mỗi chunk bắt buộc:

- `chunk_index`;
- UUID `chunk_id` hoặc `vector_node_id`;
- full `chunk_text`;
- SHA-256 `content_hash` khớp chính xác `chunk_text`.

Optional: `token_count`, `page_number`, `section_title`, `chapter`, `section`, `source_locator`. `page_number <= 0` được normalize thành `null`.

NodeJS không nhận `text_preview` thay full text, không tự hash preview và không sinh fake vector ID.

NodeJS khóa job/document rows trong transaction, so processing attempt, ACK duplicate idempotently và ignore stale callback mà không mutate.

Python runtime hiện:

- ghi đè `attempt_count` bằng HTTP delivery retry;
- chỉ gửi `text_preview`;
- không gửi `content_hash`.

Ba điểm này là **Required Python changes**.

## Query

NodeJS gửi:

- `request_id`;
- `user_id`;
- `conversation_id`;
- `question`;
- bounded `history[]` với role lowercase `user|assistant`.

Python runtime hiện khai báo `question`, `conversation_id`, `history`; Pydantic bỏ qua `request_id` và `user_id`. Đây là correlation extension phía NodeJS, không cấp authorization cho Python.

Python response hiện có:

- `answer`: string, kể cả no-answer;
- `citations[]`;
- `confidence`: string `high|medium|low`;
- `no_answer`: boolean;
- optional `usage`.

Python `usage` hỗ trợ `prompt_tokens`, `completion_tokens`, `total_tokens`, `model`. NodeJS persist một normalized `ANSWER_GENERATION/GOOGLE/SUCCEEDED` usage row; `total_tokens` là derived field và không có cột riêng.

Python citation hiện có `doc_id`, `page_number`, `snippet`, optional `chapter`, `section`. Target contract bắt buộc bổ sung UUID `vector_node_id`. NodeJS nhận `snippet` làm source fragment alias nhưng không suy đoán vector ID và không parse marker `[1]`.

`no_answer=true` là success; NodeJS không tạo citation dù response có citation data.

## Errors

NodeJS xử lý:

- Python `{error_code, message, timestamp}`;
- FastAPI `{detail: ...}`;
- non-JSON upstream response;
- timeout/abort;
- connection failure.

NodeJS không expose raw internal token hoặc multiline upstream stack ra public response.

## Compatibility evidence

- Node boundary: [`src/clients/rag-contract.js`](../../src/clients/rag-contract.js).
- HTTP client: [`src/clients/rag-client.js`](../../src/clients/rag-client.js).
- Callback normalization: [`src/middlewares/rag-callback-normalization-middleware.js`](../../src/middlewares/rag-callback-normalization-middleware.js).
- Fixtures: [`tests/fixtures/rag-contract/v0.1/`](../../tests/fixtures/rag-contract/v0.1/).
- Tests: [`scripts/rag-contract-test.js`](../../scripts/rag-contract-test.js).
- Integration readiness: [`docs/status/week3-integration-readiness.md`](../status/week3-integration-readiness.md).

Fixtures mô tả target v0.1. Các field Python chưa hỗ trợ vẫn được ghi rõ là required change, không phải runtime capability hiện tại.

## Out of scope

Remote E2E, OCR, PPTX, public reprocess, durable queue/retry worker, object storage, combined production Compose và RAG quality changes không thuộc v0.1.
