# Internal NodeJS–Python RAG contract

Trạng thái: MVP implemented ở NodeJS adapter; remote service chưa integration-test. Tên path/payload cần khóa cùng team Python trước production.

Mọi request hai chiều dùng `Authorization: Bearer <RAG_INTERNAL_TOKEN>`. User JWT không hợp lệ cho callback, internal token không hợp lệ cho public API.

## NodeJS → Python

| Operation | Provisional path | Required semantic data |
|---|---|---|
| Start ingest | `POST /internal/documents/ingest` | string document ID, job ID, attempt, storage metadata/checksum |
| Set retrieval | `POST /internal/documents/retrieval` | document/job/attempt, enabled boolean |
| Delete vectors | `POST /internal/documents/vectors/delete` | document/job/attempt |
| Chat query | `POST /internal/chat/query` | request/user/session IDs, question, bounded history |

NodeJS gọi sau MySQL commit, có timeout và không retry tự động trong MVP. Python không được ghi MySQL. NodeJS không gửi/hard-code Qdrant payload key; document reference value luôn là `String(documents.id)`.

## Python → NodeJS callback

`POST /api/internal/rag/processing-callback`

Common fields: `eventType`, `jobId`, `attemptCount`, optional `documentId`. Event là `PROGRESS`, `SUCCEEDED`, `FAILED` hoặc `CANCELLED`.

- Progress có optional high-level `stage`.
- Successful ingest/reprocess gửi một complete `chunks` manifest (1–5000 rows) và optional result metadata.
- Chunk tối thiểu: `chunkIndex`, UUID `vectorNodeId`, `chunkText`, SHA-256 `contentHash`; page/section/locator/token count optional.
- Failure/cancel có optional structured `error.code/message`.

NodeJS khóa job/document row, so attempt, validate manifest và persist chunks. Duplicate terminal callback được ACK idempotent; stale/terminal-conflict callback được ACK ignored, không mutate. `READY` chỉ sau khi manifest commit.

## Chat result

Normalized result gồm `answer`, `noAnswer`, `sources[]`, `usageCalls[]`. Source bắt buộc map bằng UUID `vectorNodeId` tới chunk `READY + VISIBLE`; citation lưu actual source fragment, không parse marker `[1]`. Usage có operation/provider/model/tokens/status và optional cost/latency.

Mock và remote client trả cùng shape. Mock không giả lập parser/Qdrant internals.
