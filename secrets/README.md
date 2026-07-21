# Local GCS credentials

Host-side corpus tooling mặc định đọc service-account key tại `secrets/gcs.json`.

- Reader credential đủ cho `corpus:inspect`, `corpus:verify` và `corpus:restore`.
- Chỉ manager giữ writer credential để chạy `corpus:publish`.
- Không commit, mount vào container, copy vào image hoặc gửi writer key cho tester.
- Không lưu credential archive (`.zip`, `.rar`, v.v.) trong Git; ignore không thể bảo vệ file đã được track từ trước.
- Revoke/rotate ngay khi nghi ngờ key bị lộ.

Root `.env` chỉ khai báo project/bucket/prefix/path. NodeJS, Python, MySQL và Qdrant containers không nhận credential hoặc GCS configuration.
