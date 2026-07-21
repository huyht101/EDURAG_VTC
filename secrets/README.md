# Local GCS credentials

Host-side corpus tooling mặc định đọc service-account key tại `secrets/gcs.json`.

- Reader credential đủ cho `corpus:inspect`, `corpus:verify` và `corpus:restore`.
- Chỉ manager giữ writer credential để chạy `corpus:publish`.
- Không commit, mount vào container, copy vào image hoặc gửi writer key cho tester.
- Theo quyết định explicit của owner, hai archive mã hóa `EDURAG Corpus reader key.rar` và `EDURAG Corpus RW key.rar` tiếp tục được track; mật khẩu được phân phối ngoài repository. Codex không mở archive nên không xác minh nội dung, thuật toán mã hóa hoặc mật khẩu. Quyết định này không phải wildcard cho archive/credential mới.
- Revoke/rotate ngay khi nghi ngờ key bị lộ.

Root `.env` chỉ khai báo project/bucket/prefix/path. NodeJS, Python, MySQL và Qdrant containers không nhận credential hoặc GCS configuration.
