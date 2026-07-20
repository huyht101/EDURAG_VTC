# Corpus bootstrap

Portable corpus được tạo vào `bootstrap/corpus/` bằng `npm run corpus:export`. Không tạo hoặc sửa bundle thủ công.

Export chỉ thành công khi source data qua sanitization và MySQL–Qdrant reconciliation. Xem [portable corpus architecture](../docs/architecture/corpus-portability.md) để biết format, restore và giới hạn file gốc.

Fixture files được Git track tự động được xem là demo-approved. Với một document demo không thể/không nên commit file gốc, data owner phải review nội dung rồi thêm SHA-256 vào `corpus-approved-documents.json`; không thêm checksum chỉ để bypass lỗi export.

Original binaries không được commit. Host-side `corpus:files:*` tooling publish/restore exact-approved files qua private GCS; mapping canonical nằm trong `corpus/original-files.json` khi đã publish thành công.
