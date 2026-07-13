# Documents

## Actors và API

ADMIN quản lý toàn bộ document; TEACHER chỉ document mình upload; STUDENT không dùng management API. Route nằm dưới `/api/documents`, chi tiết trong OpenAPI.

Upload hỗ trợ PDF/DOCX/TXT, giới hạn bằng `FILE_MAX_SIZE_BYTES`, kiểm tra extension/MIME/signature và lưu generated relative storage key. Public DTO không chứa storage key. Original file immutable; thay nội dung bằng upload document mới.

Transaction đầu tạo `documents` và `document_processing_jobs`; dispatch Python diễn ra sau commit. DB failure xóa file vừa lưu. Remote dispatch failure giữ document/file, đánh dấu job/document `FAILED` để kiểm tra hoặc retry thủ công; không hứa durable retry.

Callback complete manifest dùng internal Bearer, job/attempt stale guard và transaction. Hide không xóa vectors; unhide chỉ cho `READY + HIDDEN`; delete soft-delete và giữ file/chunks/jobs/chat/citation/usage.

Mock mode vẫn giữ upload ở `PROCESSING` cho tới callback, nhưng hoàn tất hide/unhide/delete synchronously để test orchestration. Remote integration chưa được xác minh với Python thật.

Flows: [document flow notes](../flows/notes/document-flows.md).
