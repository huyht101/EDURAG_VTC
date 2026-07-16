# Internal NodeJS–Python RAG contract v0.1

Trạng thái: NodeJS boundary implemented và contract-tested bằng mocked HTTP transport. Chưa chạy remote end-to-end với Python thật.

Canonical business schema vẫn là [`src/database/schema.sql`](../../src/database/schema.sql). Tài liệu này chỉ mô tả service boundary, không thêm subject scope, Qdrant mapping hoặc persistence mới.

## Status legend

- **Implemented in NodeJS:** code và contract test hiện có trong repository này.
- **Confirmed from Python code:** hành vi đã được đối chiếu từ FastAPI runtime findings.
- **NodeJS compatibility adapter:** chuyển đổi tại boundary; service/controller nội bộ vẫn dùng camelCase.
- **Required Python change:** Python hiện chưa cung cấp/kiểm tra điều contract bắt buộc.
- **Provisional/open:** cần team Python xác nhận chi tiết, nhưng không làm thay đổi public API/schema/business flow.

## Authentication and ownership

- NodeJS gửi `Authorization: Bearer <RAG_INTERNAL_TOKEN>` cho mọi request tới Python.
- Python callback `POST /api/internal/rag/processing-callback` dùng cùng internal Bearer.
- User JWT và internal token không dùng lẫn nhau.
- NodeJS là thành phần duy nhất ghi MySQL. Python sở hữu RAG/Qdrant và không ghi MySQL.
- Python inbound routes chưa verify internal Bearer: **Required Python change**. NodeJS vẫn gửi header; không có auth bypass.

## Operations

| Operation | Method/path | Python status | NodeJS v0.1 status |
|---|---|---|---|
| Ingest | `POST /api/ingest` | Confirmed route/input casing | Implemented serializer/parser |
| Visibility | `PATCH /api/docs/{doc_id}/visibility` | Confirmed route | Implemented; body/async callback detail is provisional |
| Delete vectors | `DELETE /api/ingest/{doc_id}` | Confirmed route | Implemented; body/async callback detail is provisional |
| Chat query | `POST /api/query` | Confirmed route/input casing | Implemented serializer/normalizer |
| Processing callback | `POST /api/internal/rag/processing-callback` | Python sender exists | Node receiver implemented |

Dispatch/operation timeout dùng `RAG_REQUEST_TIMEOUT_MS` (default 10 giây). Chat dùng `RAG_QUERY_TIMEOUT_MS` (default 60 giây). NodeJS không tự retry network call.

## Ingest request

Boundary JSON:

| Field | Required | Notes |
|---|---|---|
| `doc_id` | yes | `String(documents.id)` |
| `job_id` | yes | Processing job ID |
| `attempt_count` | yes | Processing attempt bất biến |
| `subject_id` | yes | `RAG_DEFAULT_SUBJECT_ID`, default `mvp-global`; compatibility shim only |
| `file_path` | yes | Absolute Python-visible path derived from generated `storage_key` |
| `callback_url` | yes | `RAG_CALLBACK_URL` |
| `teacher_metadata` | optional | Non-authoritative uploader context; inner fields are provisional |

Python hiện yêu cầu `subject_id` và absolute `file_path`: **Confirmed from Python code**.

NodeJS v0.1 sends `teacher_metadata.user_id/email/role`. Exact inner fields are **Provisional/open** and may be ignored by Python; they never grant authorization.

Shared volume là phương án MVP. `RAG_SHARED_UPLOAD_DIR` phải là absolute path nhìn thấy từ Python; NodeJS ghép path từ generated relative `storage_key` sau containment validation. Raw user filename và Windows host path cố định không được gửi. Khi chạy hai container, cả hai phải mount cùng upload volume tại path tương ứng.

`subject_id=mvp-global` không tạo subject trong database/public API và không thay retrieval scope MVP.

Accepted response có thể trả `job_id`; nếu có và không khớp dispatched job, NodeJS trả `RAG_JOB_ID_MISMATCH`.

## Visibility and delete requests

NodeJS v0.1 gửi:

- visibility: `PATCH /api/docs/{doc_id}/visibility` với `job_id`, `attempt_count`, `visible`, `callback_url`;
- delete: `DELETE /api/ingest/{doc_id}` với `job_id`, `attempt_count`, `callback_url`.

Method/path là contract đã khóa theo Python findings. Exact request body, accepted response và async callback behavior của hai operation là **Provisional/open** vì Python schema chi tiết chưa được xác nhận. NodeJS lifecycle vẫn giữ operation job `RUNNING` đến terminal callback trong remote mode.

## Processing callback

Boundary dùng snake_case:

- `job_id`;
- optional `doc_id`/`document_id`;
- `attempt_count`;
- `event_type`: `PROGRESS`, `SUCCEEDED`, `FAILED`, `CANCELLED`;
- optional `stage`, `result`, `error`;
- complete `chunks` manifest cho successful ingest/reprocess.

Mỗi chunk bắt buộc:

- `chunk_index`;
- UUID `vector_node_id`, hoặc Python alias `chunk_id`;
- full `chunk_text`;
- 64-character SHA-256 `content_hash`.

Optional: `token_count`, `page_number`, `section_title`, `source_locator`. Adapter nhận `chapter`/`section` như alias section title. `page_number <= 0` được normalize thành `null`, phù hợp DOCX/TXT không có physical page.

NodeJS không chấp nhận `text_preview` thay full `chunk_text`, không tự hash preview và không sinh fake vector ID. Alias `chunk_id` chỉ hợp lệ khi full text/hash cùng có mặt.

Receiver khóa job/document rows trong transaction, so `jobId + attemptCount`, ACK duplicate idempotently và ACK stale callback mà không mutate. `attempt_count` là processing job attempt, không phải callback HTTP delivery retry.

Python hiện còn hai blocker:

1. `services/callback.py::send_callback` ghi đè `attempt_count` bằng HTTP delivery retry: **Required Python change**.
2. Manifest chỉ có `text_preview`, thiếu full `chunk_text` và `content_hash`: **Required Python change**.

## Chat request and response

Request snake_case:

- `request_id`;
- `user_id`;
- `conversation_id`;
- `question`;
- bounded `history[]` với role lowercase `user|assistant`.

Python route/input casing và lowercase roles: **Confirmed from Python code**. MySQL vẫn là durable chat history.

Response:

- `answer`;
- `no_answer`;
- optional `confidence`;
- `citations[]`;
- optional `usage`;
- optional future `usage_calls[]`.

Citation bắt buộc có UUID `vector_node_id` và `source_text`; adapter nhận `snippet` làm alias source text, và `chapter`/`section` làm alias section title. NodeJS không suy đoán vector ID bằng document/page/text matching và không parse `[1]`, `[2]`.

Python hiện chưa trả Qdrant point ID/`vector_node_id` trong citation: **Required Python change**.

Python single `usage` được normalize thành một usage call:

- `callIndex=1`;
- `operationType=ANSWER_GENERATION`;
- `provider=GOOGLE`;
- `status=SUCCEEDED`;
- cost `null`, currency `USD`;
- model/tokens/latency lấy từ Python.

`no_answer=true` là success và luôn tạo zero citations.

## Upstream errors

NodeJS adapter xử lý:

- custom `{error_code, message, timestamp}`;
- FastAPI `{detail: ...}`;
- non-JSON response;
- abort/timeout;
- connection failure.

Public error không chứa stack trace hoặc raw internal token. Không có automatic query retry trong MVP.

## Compatibility evidence

- Boundary implementation: [`src/clients/rag-contract.js`](../../src/clients/rag-contract.js), [`src/clients/rag-client.js`](../../src/clients/rag-client.js).
- Callback normalization: [`src/middlewares/rag-callback-normalization-middleware.js`](../../src/middlewares/rag-callback-normalization-middleware.js).
- Shared path helper: [`src/storage/shared-upload-path.js`](../../src/storage/shared-upload-path.js).
- Fixtures: [`tests/fixtures/rag-contract/v0.1`](../../tests/fixtures/rag-contract/v0.1).
- Contract tests: [`scripts/rag-contract-test.js`](../../scripts/rag-contract-test.js), chạy bằng `npm run test:contract`.

Fixtures mô tả contract v0.1 bắt buộc, không phải bằng chứng Python hiện đã trả complete manifest/citation vector ID.

## Limitations

- FastAPI `BackgroundTasks` không phải durable queue; NodeJS không hứa retry tự động.
- Remote E2E với Python thật chưa được chứng minh trong phase này.
- Visibility/delete request DTO và callback support cần team Python xác nhận.
- Không có OCR, PPTX, reprocess API, retry worker, object storage hoặc production infrastructure trong contract v0.1.
