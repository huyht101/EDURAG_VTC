# Cloud corpus bootstrap metadata

Git chỉ giữ [`corpus-release.json`](corpus-release.json), là pointer nhỏ tới immutable release được chọn trên private GCS. Pointer là metadata transport, không phải bằng chứng source documents/release đã được owner phê duyệt và không tự cấp trạng thái canonical.

MySQL dump, Qdrant snapshot và original files không nằm trong Git. Không sửa pointer thủ công. Manager chỉ được publish sau khi source data đã được phê duyệt độc lập, xem plan bằng `npm run corpus:publish -- --dry-run`, rồi xác nhận review bằng `--confirm-reviewed`. Unit fixture hoặc document local tự chọn không phải approved corpus.

Thiết kế, safety gate và lifecycle: [Corpus portability](../docs/architecture/corpus-portability.md).
