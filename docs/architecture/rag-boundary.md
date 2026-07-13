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

Internal requests dùng `Authorization: Bearer <RAG_INTERNAL_TOKEN>`. Remote paths/payload hiện là MVP contract và chưa integration-test với service Python thật. Mock và remote adapter trả cùng normalized result để controller/service không chứa mock branch.

Không có durable scheduler, callback batching, public reprocess hoặc zero-downtime generation trong MVP.
