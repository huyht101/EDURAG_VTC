# Cloud corpus bootstrap metadata

Git chỉ giữ [`corpus-release.json`](corpus-release.json), là pointer nhỏ tới immutable release mặc định trên private GCS.

MySQL dump, Qdrant snapshot và original files không nằm trong Git. Không sửa pointer thủ công. Manager phải xem plan bằng `npm run corpus:publish -- --dry-run`, tự review dữ liệu rồi publish bằng `npm run corpus:publish -- --confirm-reviewed`.

Thiết kế, safety gate và lifecycle: [Corpus portability](../docs/architecture/corpus-portability.md).
