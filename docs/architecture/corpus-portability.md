# Portable corpus architecture

Portable corpus là một bản export phối hợp của hai nguồn dữ liệu, không phải cơ chế đồng bộ MySQL–Qdrant hai chiều.

## Thành phần và ownership

- MySQL giữ business state: document/job/chunk mapping, chat history, immutable citation snapshot và LLM usage.
- Qdrant giữ vectors cùng retrieval payload do Python sở hữu.
- Upload volume giữ PDF/DOCX/TXT gốc nhưng **không nằm trong bundle**.

Chỉ Qdrant snapshot là không đủ vì Node cần `documents`, `document_chunks.vector_node_id`, authorization, chat/citation/usage trong MySQL. Chỉ MySQL dump cũng không đủ vì retrieval cần vectors và payload tương ứng trong Qdrant.

## Bundle format

Sau một export hợp lệ, `bootstrap/corpus/` chứa:

```text
README.md
manifest.json
checksums.sha256
inventory.json
mysql/edurag.sql
qdrant/<collection>.snapshot
```

`manifest.json` tách `bundleFormatVersion` (package/tooling format) và `databaseSchemaVersion` (MySQL business schema). Nó còn khóa MySQL/Qdrant version, collection, embedding model/dimension, counts, filenames và SHA-256. `inventory.json` là mapping kiểm tra chéo, không chứa vector float. Bundle chỉ được đánh dấu valid khi:

- không có processing job `QUEUED`/`RUNNING`;
- source qua policy demo/sanitization và secret/PII/path scan;
- mọi active MySQL `vector_node_id` có Qdrant point tương ứng;
- `doc_id`, text hash, visibility, UUID, collection và vector dimension khớp;
- Qdrant không có point thừa ngoài active MySQL chunks.

Canonical bundle hiện tại đã được data owner duyệt riêng cho document `1` với exact checksum `5309194ee4c531b914258094fec5ba80c730dd423a56841dd4baf069eefd47b0`. Approval lưu tại `bootstrap/corpus-approved-documents.json` và không phải wildcard: content/checksum thay đổi hoặc document mới sẽ bắt buộc review lại. Bundle có 1 document, 1 job, 2 chunks, 2 Qdrant points; on-disk 445,838 bytes (checksummed file set 445,421 bytes), snapshot 411,136 bytes, không cần Git LFS.

MySQL dump là full schema 1.0.0 + sanitized data, nhưng không export dòng `auth_tokens`. Restore chỉ được phép trên bootstrap-empty stores; dump trở thành source của schema/data cho corpus đó. Qdrant dùng collection snapshot API chính thức, không copy live storage directory. Qdrant mô tả collection snapshots là bản chứa collection configuration và points; MySQL cũng khuyến nghị `mysqldump` cho logical backup/transfer ([Qdrant snapshots](https://qdrant.tech/documentation/operations/snapshots/), [MySQL 8.4 mysqldump](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)).

## Export và restore

```powershell
npm run corpus:inspect
npm run corpus:export
npm run corpus:verify
npm run corpus:restore
```

`corpus:export` dừng tạm `app`/`rag-service` nếu chúng đang chạy, export trong trạng thái không có writer, verify bundle rồi khôi phục trạng thái service trước đó. Nếu gặp document không phải fixture demo đã được track hoặc checksum đã được data owner review trong `bootstrap/corpus-approved-documents.json`, export fail closed; không thêm checksum chỉ để bypass review và tool không tự đọc source document vào Git.

`corpus:restore` kiểm checksum/version, yêu cầu MySQL và Qdrant đều bootstrap-empty, restore cả hai store rồi reconcile lại counts/mapping. Nó không gọi ingest, LlamaParse hoặc document embedding.

Restore không phải distributed transaction. Nếu một store restore xong rồi store còn lại lỗi, tooling để trạng thái partial ở chế độ fail-closed và lần chạy sau sẽ từ chối overwrite; chỉ reset **isolated target volumes** sau khi điều tra rồi restore lại. Không dùng quy trình này trên source volumes cần giữ.

`CORPUS_BOOTSTRAP` được dùng bởi `npm run docker:remote:dev`:

- `off`: không xét bundle;
- `auto` (mặc định): restore bundle valid chỉ khi cả hai store trống; có data hoặc không có bundle thì skip;
- `required`: thiếu/incompatible bundle hoặc store không phù hợp thì fail closed.

Auto-bootstrap không chạy lại trên volumes đã có dữ liệu và không overwrite partial state.

Các gate đã được chạy trên Docker project cô lập: empty stores được restore; restart trả `DATA_EXISTS` và không duplicate; partial MySQL/Qdrant state bị chặn; `required` từ chối bundle thiếu hoặc sai checksum. Một live query sau restore đã map citation vào restored chunk và ghi usage mà không tăng ingest job, chunk hoặc Qdrant point.

## Sau restore

Chat/retrieval và citation snapshot có thể hoạt động mà không parse/embed lại document. Tuy vậy mỗi query vẫn cần query embedding và, khi trả lời, LLM generation. Endpoint original-file có thể báo unavailable; reprocess cần người dùng upload document mới. Không tạo file giả và không sửa schema để che việc file gốc vắng mặt.

Đổi embedding model, dimension hoặc pipeline semantics không tương thích có thể buộc re-embed. Contract hiện khóa `gemini-embedding-001`, dimension `768`, collection được cấu hình bằng `QDRANT_COLLECTION_NAME`.

## Nhiều máy và Git

Mô hình đã chọn là restore cùng một copy trên từng máy. Các máy không merge hoặc đồng bộ thay đổi mới theo hai chiều. Muốn phát hành corpus mới phải chọn một source quiescent, export một bundle canonical mới rồi phân phối lại.

Tool chặn bất kỳ bundle file nào từ 100 MiB, cảnh báo file từ 50 MiB và cảnh báo khi tổng bundle làm repository tăng đáng kể. GitHub cảnh báo file trên 50 MiB và chặn file lớn hơn 100 MiB trong regular Git; binary history cũng làm repository tăng vĩnh viễn ([GitHub large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)).

## Future options

Khi corpus không còn phù hợp regular Git, có thể nghiên cứu private release/artifact, object storage, persistent cloud disk, central Qdrant hoặc Qdrant Cloud. Chưa có phương án cloud nào được triển khai.
