# Local credentials

Corpus tooling mặc định đọc Google service-account key tại `secrets/gcs.json`.

- Giữ credential ở local và không commit.
- Reader credential được inspect/verify/download approved original files.
- Chỉ manager writer credential được publish approved original.
- Không chia sẻ writer key; revoke/rotate ngay khi nghi ngờ bị lộ.
- Docker image/container không nhận thư mục hoặc nội dung này.

Integrated stack đọc cấu hình GCS không bí mật từ root `.env`. Python standalone configuration là luồng riêng.
