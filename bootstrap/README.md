# Metadata bootstrap cloud corpus

Git chỉ giữ [`corpus-release.json`](corpus-release.json), là pointer nhỏ tới immutable
release được chọn trên private GCS. Pointer chỉ là metadata vận chuyển: nó không tự chứng
minh remote object/checksum còn hợp lệ hoặc local stores đang khớp release.

MySQL dump, Qdrant snapshot và file gốc không nằm trong Git. Không sửa pointer thủ công.
Publish release mới vẫn cần Owner phê duyệt, xác minh private target, dry-run và
`--confirm-reviewed`; unit fixture hoặc document local tự chọn không tự tạo approval.

Thiết kế, safety gate và lifecycle: [Corpus portability](../docs/architecture/corpus-portability.md).
