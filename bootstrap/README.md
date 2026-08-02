# Cloud corpus bootstrap metadata

Git chỉ giữ [`corpus-release.json`](corpus-release.json), là pointer nhỏ tới immutable release được chọn trên private GCS. Pointer là metadata transport: nó không tự chứng minh remote object/checksum còn hợp lệ hoặc local stores đang khớp release.

MySQL dump, Qdrant snapshot và original files không nằm trong Git. Không sửa pointer thủ công. Publish release mới vẫn yêu cầu owner approval, private-target verification, dry-run và `--confirm-reviewed`; unit fixture hoặc document local tự chọn không tự tạo approval.

Thiết kế, safety gate và lifecycle: [Corpus portability](../docs/architecture/corpus-portability.md).
