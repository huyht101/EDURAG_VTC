# System overview

EDURAG gồm ba ownership boundary:

1. Client gọi public NodeJS API.
2. NodeJS/Core quản lý identity, authorization, document/job lifecycle, file metadata, chat, citation snapshots, usage và MySQL transactions.
3. Python RAG quản lý parsing, embeddings, retrieval/generation và Qdrant.

NodeJS là thành phần duy nhất ghi MySQL. Python không giữ durable chat history. NodeJS không truy cập Qdrant.

Team Python/Data-RAG sở hữu repository Python upstream riêng. `python-service/` trong repository này là tracked integration snapshot phục vụ audit/debug, không phải canonical Python implementation và không bảo đảm luôn là upstream mới nhất.

## Data flow

- Upload: Node lưu file, tạo document/job, rồi dispatch Python sau commit.
- Processing: Python đọc file từ shared volume, cập nhật Qdrant và callback manifest về Node.
- Chat: Node lưu message/history, gọi Python với bounded history, rồi persist answer/citation/usage.
- Hide/delete: Node điều phối business job; Python thay đổi retrieval index và callback terminal result.

MySQL và Qdrant không có distributed transaction. Lifecycle dùng fail-closed state, job ID, processing attempt và idempotent callback.

## Canonical sources

- Database: [`src/database/schema.sql`](../../src/database/schema.sql).
- Public API: runtime OpenAPI `/api-docs.json`.
- Internal boundary: [`docs/api/internal-rag-contract.md`](../api/internal-rag-contract.md).
- Current readiness: [`docs/status/week3-integration-readiness.md`](../status/week3-integration-readiness.md).
- Python source of truth: repository upstream của team Python, được ghi tại [Python snapshot provenance](../status/python-snapshot-source.md).
- Current audit evidence: periodically refreshed [`python-service/`](../../python-service/) snapshot.
