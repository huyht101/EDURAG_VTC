# Cloud corpus bootstrap metadata

Git chỉ giữ:

- `corpus-release.json`: pointer nhỏ tới immutable release mặc định trên private GCS;
- `corpus-approved-documents.json`: exact-checksum approvals cho tài liệu được phép publish.

MySQL dump, Qdrant snapshot và original files không nằm trong Git. Không sửa pointer hoặc approval thủ công để bypass validation. Manager dùng `npm run corpus:publish`; thành viên dùng `npm run corpus:restore` hoặc `npm run docker:remote:dev`.

Thiết kế, security gate và lifecycle: [Corpus portability](../docs/architecture/corpus-portability.md).
