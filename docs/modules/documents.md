# Documents

## Actors và API

ADMIN quản lý toàn bộ document; TEACHER chỉ document mình upload; STUDENT không dùng management API. Route nằm dưới `/api/documents`, chi tiết trong OpenAPI.

STUDENT, TEACHER và ADMIN có Document Library read-only chung dưới `/api/library/documents`. Ba role nhận cùng public DTO và có thể đọc tài liệu đủ điều kiện của người khác. List/detail/source/preview chỉ resolve document `READY + VISIBLE`, chưa deleted; filter này do repository cố định, không lấy từ query client. DTO library là allowlist gồm metadata người dùng, file type/size, Node-owned `pageCount`, preview/original availability và authenticated relative URLs; không trả owner, storage path, stored filename, checksum, lifecycle hoặc processing-job metadata.

Library list hỗ trợ `q` trên title/description/author, partial `author`, `fileType`, page/limit và stable sort. Management list hỗ trợ `q` thêm original filename, file/processing/visibility/preview status; ADMIN được lọc `ownerId`, TEACHER luôn bị server cố định vào chính mình và gửi `ownerId` nhận `403`. Các filter kết hợp AND, các field trong `q` kết hợp OR. LIKE pattern được parameterize và escape bằng literal semantics cho `%`, `_`, `\`; title sort có `id` tie-breaker. Response giữ `offset/limit/total/documents` và bổ sung `page/totalPages`.

`q`/`page` là canonical; `search`/`offset` là legacy aliases. Cặp `q+search` chỉ hợp lệ khi hai giá trị sau trim giống nhau. Cặp `page+offset` chỉ hợp lệ khi `offset=(page-1)*limit`. Offset gửi riêng luôn được giữ chính xác và metadata page là `floor(offset/limit)+1`; alias conflict trả validation `400`.

Upload multipart hỗ trợ PDF/DOCX/TXT với `file` và optional `title`, `description`, `author`. Title rỗng dùng basename của original filename. Node kiểm tra extension/MIME/signature, parse PDF và lưu số trang vật lý trước response; public client không được ghi đè checksum, page count, preview/status, owner hoặc storage metadata. Teacher chỉ sửa metadata document mình; Admin sửa mọi document; update không tạo RAG job, không re-ingest và không thay citation snapshot.

Preview states là `PENDING`, `READY`, `FAILED`, `NOT_APPLICABLE`. PDF dùng original làm preview (`READY`) và `pageCount` là số trang vật lý, kể cả trang trắng. DOCX giữ original, tạo PDF bằng LibreOffice trong DB-backed `GENERATE_PDF_PREVIEW` job; upload không chờ conversion, và chỉ khi publish atomic thành công mới cập nhật preview path/MIME/page count. TXT `NOT_APPLICABLE`, `pageCount=null`. Preview failure không thay đổi RAG processing status. PPTX chưa được upload/RAG trong CURRENT; worker/adapter chỉ được thiết kế để thêm converter sau này.

Original endpoint trả `attachment`; preview endpoint trả authenticated PDF `inline`; cả hai stream server-side, chưa hỗ trợ byte Range/`206`. Library source/preview trả `404` khi document không còn `READY + VISIBLE`; original hợp lệ nhưng thiếu file trả `409 ORIGINAL_SOURCE_UNAVAILABLE`, preview pending/failed/missing trả `409 PREVIEW_UNAVAILABLE`. Relative URL không phải public URL và client phải gửi Bearer.

Transaction đầu tạo `documents`, INGEST job và DOCX preview job khi cần; dispatch Python diễn ra sau commit. Invalid PDF/metadata không lưu file; DB failure xóa đúng file vừa lưu. Remote dispatch failure giữ document/file, đánh dấu INGEST/document `FAILED`; preview lifecycle độc lập.

Callback complete manifest dùng internal Bearer, job/attempt stale guard và transaction. ACK có `outcome` và `canActivate`: current accepted manifest và exact idempotent replay được activate; stale/terminal conflict/manifest conflict không được activate. Hide không xóa vectors; unhide chỉ cho `READY + HIDDEN`; delete soft-delete và giữ file/chunks/jobs/chat/citation/usage.

Migration append-only: `npm run db:migrate`. Backfill không chạy khi app start: `npm run documents:backfill -- --dry-run`, sau đó bỏ `--dry-run`; PDF được đếm trực tiếp, DOCX chỉ enqueue/reuse preview job qua cùng worker. Lệnh báo `scanned/updated/skipped/failed`; file cũ thiếu/hỏng giữ `pageCount=null`. Không xem dry-run hoặc disposable DB là production backfill.

Mock mode vẫn giữ upload ở `PROCESSING` cho tới callback, nhưng hoàn tất hide/unhide/delete synchronously để test orchestration. Mock/isolated regression không phải bằng chứng live Python/provider hoặc production readiness; trạng thái live phải được báo theo lần chạy thực tế.

Flows: [document flow notes](../flows/notes/document-flows.md).
