# NodeJS–Python RAG boundary

## Direction

- Client → NodeJS: public user JWT.
- NodeJS → Python: internal Bearer, snake_case JSON.
- Python → NodeJS callback: internal Bearer, snake_case JSON.
- NodeJS → MySQL: business persistence.
- Python → Qdrant: vector/retrieval persistence.

Không có Client → Python, NodeJS → Qdrant hoặc Python → MySQL.

## Shared file boundary

NodeJS lưu generated relative `storage_key`. Remote ingest chuyển key thành absolute path nhìn thấy từ Python qua `RAG_SHARED_UPLOAD_DIR`, sau containment validation.

Python cần read-only access tới cùng file root. Original filename không dùng làm storage path.

## Normalization

NodeJS service/controller dùng camelCase. [`rag-contract.js`](../../src/clients/rag-contract.js) chịu trách nhiệm:

- exact method/path;
- snake_case serialization;
- `action=hide|unhide`;
- empty `teacher_metadata`;
- `chunk_manifest`/`chunks` normalization;
- citation and usage normalization;
- upstream error mapping.

## Consistency

Network call không nằm trong MySQL transaction. Callback dùng processing attempt để chống stale, terminal callback idempotent và complete manifest transaction để chỉ chuyển document sang `READY` sau persist.

Contract chi tiết nằm duy nhất tại [internal RAG contract](../api/internal-rag-contract.md). Deployment topology nằm tại [Python handoff deployment guide](../handoffs/python-rag-v0.1/03_deployment-and-env.md).
