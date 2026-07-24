# Documents

## Actors và API

ADMIN quản lý toàn bộ document; TEACHER chỉ document mình upload; STUDENT không dùng management API. Route nằm dưới `/api/documents`, chi tiết trong OpenAPI.

STUDENT có Student Document Library read-only riêng dưới `/api/library/documents`. List/detail/source chỉ resolve document `READY + VISIBLE`; filter này do repository cố định, không lấy từ query client. List chỉ nhận offset/limit và optional title search. DTO library là allowlist gồm `id`, `title`, `fileType`, `fileSize`, nullable `pageCount`, `createdAt`, `originalAvailable`; không trả owner, storage path, stored filename, checksum, lifecycle hoặc processing-job metadata. Teacher/Admin không dùng namespace này.

Upload hỗ trợ PDF/DOCX/TXT, giới hạn bằng `FILE_MAX_SIZE_BYTES`, kiểm tra extension/MIME/signature và lưu generated relative storage key. Public DTO không chứa storage key. Original file immutable; thay nội dung bằng upload document mới.

File endpoint trả original dạng `attachment` với `Content-Length` và filesystem stream. Runtime không convert DOCX/TXT thành preview, chưa hỗ trợ byte Range/`206` và dùng cùng upload-size limit cho ba định dạng. Chi tiết FE: [Frontend integration contract](../api/frontend-integration.md).

Library source dùng `GET /api/library/documents/{id}/source`: record không tồn tại hoặc không còn `READY + VISIBLE` trả `404`; record đủ điều kiện nhưng thiếu original trả `409 ORIGINAL_SOURCE_UNAVAILABLE`.

Transaction đầu tạo `documents` và `document_processing_jobs`; dispatch Python diễn ra sau commit. DB failure xóa file vừa lưu. Remote dispatch failure giữ document/file, đánh dấu job/document `FAILED` để kiểm tra hoặc retry thủ công; không hứa durable retry.

Callback complete manifest dùng internal Bearer, job/attempt stale guard và transaction. Hide không xóa vectors; unhide chỉ cho `READY + HIDDEN`; delete soft-delete và giữ file/chunks/jobs/chat/citation/usage.

Mock mode vẫn giữ upload ở `PROCESSING` cho tới callback, nhưng hoàn tất hide/unhide/delete synchronously để test orchestration. Remote upload/callback/hide/unhide/delete đã PASS trên isolated development topology; đây không phải production-readiness claim.

Flows: [document flow notes](../flows/notes/document-flows.md).
