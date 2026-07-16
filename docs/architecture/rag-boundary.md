# NodeJS–Python RAG boundary

NodeJS là orchestrator và thành phần duy nhất ghi MySQL. Python sở hữu parsing/chunking/embedding/retrieval/generation và Qdrant; Python không giữ chat history bền vững.

## NodeJS gửi

- Start ingest/reprocess với `documentId = String(documents.id)`, job và attempt.
- Set retrieval state cho hide/unhide.
- Delete vectors cho soft delete.
- Chat query với câu hỏi và bounded history window.

NodeJS không hard-code Qdrant payload key. Mapping `ref_doc_id`/`retrieval_enabled` và nội bộ LlamaIndex thuộc Python contract.

## Python trả

- Progress hoặc terminal complete-manifest callback.
- Structured answer, sources và LLM usage calls.
- Source dùng `vectorNodeId`; NodeJS resolve qua `document_chunks`, hydrate metadata và persist immutable citation snapshot.

Internal requests dùng `Authorization: Bearer <RAG_INTERNAL_TOKEN>`. Remote adapter dùng contract v0.1 snake_case tại HTTP boundary và giữ normalized camelCase bên trong NodeJS. Contract tests với mocked transport đã có; remote end-to-end với service Python thật chưa chạy.

Shared file path được tạo từ generated `storage_key` và `RAG_SHARED_UPLOAD_DIR` sau containment validation. `RAG_DEFAULT_SUBJECT_ID=mvp-global` chỉ là compatibility shim cho Python hiện tại, không thêm subject scope vào MySQL/public API.

Complete manifest vẫn bắt buộc full chunk text/hash; citation vẫn bắt buộc `vector_node_id`. Các thiếu hụt Python hiện tại được theo dõi tại [internal contract v0.1](../api/internal-rag-contract.md), không được NodeJS che bằng preview/fake mapping.

Không có durable scheduler, callback batching, public reprocess hoặc zero-downtime generation trong MVP.
