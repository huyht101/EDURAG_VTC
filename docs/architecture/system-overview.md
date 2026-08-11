# Tổng quan kiến trúc hệ thống

Đây là nguồn diễn giải kiến trúc và ownership hiện hành. Exact API, database và
Node–Python payload vẫn thuộc OpenAPI, executable schema và internal contract.

## Thành phần và quyền sở hữu

```text
Web/Mobile
   │ user JWT
   ▼
NodeJS/Core ─────────► MySQL + local original/preview files
   │ internal Bearer + shared read-only file path
   ▼
Python RAG ──────────► Qdrant + approved parser/AI providers
```

- **NodeJS/Core:** public API, auth/authorization, document/job lifecycle, persistent
  artifact, chat, citation snapshot, usage và MySQL transaction.
- **Python RAG:** parse/OCR, chunk, embedding, retrieval/generation, Qdrant point/payload
  và exact-attempt vector operations.
- **Web/Mobile:** chỉ gọi public Node API; không gọi Python hoặc storage trực tiếp.
- **Host corpus tooling:** đóng gói/khôi phục immutable release; runtime Node/Python không
  đọc GCS.

Node không truy cập Qdrant. Python không ghi MySQL và không giữ durable chat history.
`python-service/` chỉ là snapshot tích hợp; Python upstream riêng mới là source of truth.

## Cấu trúc NodeJS/Core

- `routes`: middleware, validator và controller.
- `controllers`: chuyển đổi HTTP input/output.
- `services`: business rule, ownership và transaction boundary.
- `repositories`: SQL parameterized; pagination number được normalize trước khi nội suy.
- `clients`: adapter RAG normalized cho `mock` và `remote`.
- `storage`: local adapter dùng relative generated key; public DTO không lộ storage key.

Public API dùng user JWT. Internal Node–Python callback dùng Bearer secret riêng; hai
trust domain không dùng lẫn. File I/O và HTTP tới Python không nằm trong MySQL transaction.

## Luồng dữ liệu chính

- **Upload:** Node validate/lưu file, tạo document/job trong MySQL rồi dispatch Python sau
  commit.
- **Ingest:** Python parse/chunk/embed, upsert retrieval-disabled, gửi complete manifest;
  Node persist/ACK rồi Python mới activate exact attempt.
- **Chat:** Node persist message pair và bounded history, gọi Python, sau đó lưu answer,
  citation snapshots và usage trong một transaction.
- **Hide/unhide/delete:** Node tạo business job; Python đổi Qdrant state rồi callback.
- **Corpus:** host tooling freeze/verify/export hoặc restore scoped MySQL + Qdrant +
  originals; không phải runtime synchronization.

MySQL và Qdrant không có distributed transaction. Hệ thống dùng exact attempt,
fail-closed state, idempotent callback và compensating recovery. Recovery ownership và
stale visibility ordering vẫn là gap được [project handoff](../../PROJECT_HANDOFF.md) giữ.

## Phân quyền cốt lõi

- Admin quản lý mọi document và dashboard.
- Teacher quản lý document do mình upload.
- Student không dùng Document Management.
- Mọi user `ACTIVE` dùng Library read-only cho document `READY + VISIBLE`.
- Chat/citation thuộc session owner; Admin không có public bypass cho session người khác.
- CURRENT không có subject/course/class permission hoặc per-document retrieval selection.

## Nguồn xác nhận implementation

- Public behavior: runtime OpenAPI `/api-docs.json`.
- Database: [`src/database/schema.sql`](../../src/database/schema.sql) và migrations.
- Node–Python boundary: [internal RAG contract](../api/internal-rag-contract.md).
- Python provenance/actions: [snapshot metadata](python-rag.md) và
  [Python handoff](python-rag-handoff.md).
- Coverage/status: [MVP gap matrix](../status/mvp-gap-matrix.md).
