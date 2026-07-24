# Database design 1.0.0

## Mục tiêu và ownership

MySQL là nguồn chuẩn cho identity, document metadata/job/chunk source, chat, citation snapshot và LLM usage. NodeJS là thành phần duy nhất ghi MySQL. File storage giữ file gốc. Python/LlamaIndex ghi Qdrant và callback dữ liệu có cấu trúc về NodeJS; NodeJS không truy cập Qdrant.

## 12 bảng

- Identity: `roles`, `users`, `student_profiles`, `teacher_profiles`, `auth_tokens`.
- Documents: `documents`, `document_processing_jobs`, `document_chunks`.
- Chat: `chat_sessions`, `chat_messages`, `citations`.
- Observability: `llm_usage_logs`.

Một user có đúng một role qua `users.role_id`. Không có `user_roles`, refresh-token/session, subject/course/class, document versions, vector-mapping hoặc audit-event table trong MVP.

## Quan hệ chính

`users` sở hữu profile, tokens, uploaded documents và chat sessions. Document có nhiều processing jobs và chunks. Job sinh chunks. Session có ordered messages. Assistant message có citation snapshots và có thể có nhiều usage rows.

User/profile token FK dùng CASCADE khi hard-delete user, nhưng MVP không hard-delete user. Document/job/chunk/message dùng RESTRICT để tránh mất lịch sử. Citation references tới document/chunk và usage references tới user/message dùng SET NULL; snapshot/usage vẫn tồn tại.

## Document và job lifecycle

- Upload: document `UPLOADED`, job `INGEST/QUEUED`; dispatch chuyển job `RUNNING`, document `PROCESSING`.
- Callback success: persist complete manifest, mark job `SUCCEEDED`, rồi document `READY` trong một transaction.
- Callback failure/cancel: job và document chuyển terminal state phù hợp.
- Hide/unhide: `SET_RETRIEVAL`; chỉ đổi MySQL visibility sau RAG ACK.
- Delete: `DELETE_VECTORS`, rồi soft-delete `DELETED/deleted_at`; giữ file và MySQL history.

Callback mang `jobId + attemptCount`. Duplicate terminal callback idempotent; attempt cũ không mutate. Không có distributed transaction MySQL–Qdrant hoặc durable retry scheduler.

## Chunk và Qdrant mapping

`document_chunks.vector_node_id` là UUID bằng LlamaIndex `node_id` và Qdrant point ID. Python nhận document reference dưới dạng `String(documents.id)`. `chunk_index`, page/section/locator và content hash hỗ trợ reconciliation/citation.

Retrieval phải fail closed trên `READY + VISIBLE`. Qdrant payload keys và filter implementation thuộc Python; NodeJS không hard-code chúng. MySQL lưu source text có chủ ý để citation/history không phụ thuộc vector index.

## Citation, chat và usage

Citation trỏ parent chunk nhưng `source_text_snapshot` có thể chỉ là fragment do citation engine tách lần hai. Snapshot title/page/section/locator/score là immutable; document/chunk FK có thể null mà lịch sử vẫn đọc được.

MySQL là chat memory duy nhất. `message_order` unique trong session; service khóa session row khi cấp số. `client_request_id` chống client retry. Assistant đi `PENDING → COMPLETED|FAILED`.

`llm_usage_logs` có một row mỗi LLM call và unique `(request_id, call_index)`. Dashboard chỉ gọi đây là `LLM_CALLS_ONLY`; schema không tuyên bố embedding/rerank/OCR cost.

## Index strategy

Index tập trung vào role/status, token state/expiry, document owner/retrieval state, job status/history, session history, citation references và usage time range. JSON locator/config không index trong MVP. Danh sách đầy đủ nằm trong [data dictionary](data-dictionary.md) và DDL.

## Giới hạn và hướng mở rộng

MVP dùng local storage, một vector mapping/chunk, PDF/DOCX/TXT và offset/limit. Subject scope, document versions, multi-model mapping, object storage, OCR/PPTX, refresh sessions, audit logs và full AI pricing chỉ được thêm bằng migration khi có nghiệp vụ thật. DDL minh họa subject/course được giữ riêng tại [`optional-subject-course-schema.sql`](../examples/optional-subject-course-schema.sql) dưới dạng OPTIONAL/LATER reference; file này không thuộc bootstrap hoặc contract canonical.
