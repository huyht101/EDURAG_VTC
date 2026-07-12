> **Historical draft — superseded by database schema 1.0.0 and current implementation.** Không dùng file này làm specification hiện hành.

# 09. Hướng dẫn chạy môi trường Local (Local Setup Guide)

Tài liệu này hướng dẫn chi tiết các bước thiết lập và khởi chạy dự án tại máy phát triển cá nhân (Local Environment) cho các thành viên trong đội ngũ phát triển.

---

## 1. Yêu cầu hệ thống tối thiểu (Prerequisites)
Đảm bảo máy tính của bạn đã cài đặt các công cụ sau:
- **Node.js**: Phiên bản 20.x trở lên.
- **Docker** và **Docker Compose**: Để chạy cơ sở dữ liệu MySQL và Qdrant local.
- **Git**: Để quản lý mã nguồn.

---

## 2. Các bước khởi chạy dự án

### Bước 2.1. Cài đặt các gói phụ thuộc (Dependencies)
Tại thư mục gốc của dự án, mở Terminal và chạy lệnh cài đặt:
```bash
npm install
```
*Lưu ý: Hệ thống chỉ cài đặt các thư viện được phê duyệt trong stack: `express`, `mysql2`, `jsonwebtoken`, `bcrypt`, `dotenv`.*

### Bước 2.2. Thiết lập cấu hình biến môi trường
Tạo bản sao từ file `.env.example` để tạo file chạy thực tế `.env`:
```bash
cp .env.example .env
```
Mở file `.env` vừa tạo và cập nhật các tham số kết nối MySQL hoặc khóa bảo mật JWT nếu cần.

### Bước 2.3. Khởi chạy Docker Compose (MySQL & Qdrant)
Bật các dịch vụ cơ sở dữ liệu bằng Docker ở chế độ chạy ngầm (detach):
```bash
docker compose up -d
```
Lệnh này sẽ tải về các image cần thiết, chạy container và tự động kích hoạt quá trình ánh xạ cấu trúc bảng (schema) cùng dữ liệu mẫu (seed) từ thư mục `docker-entrypoint-initdb.d/` của MySQL container.

Kiểm tra trạng thái hoạt động của các container:
```bash
docker compose ps
```

---

## 3. Quá trình Seed Dữ liệu tự động

### 3.1. Tạo bảng và Ràng buộc (schema.sql)
Khi container `db` khởi chạy lần đầu, Docker sẽ thực thi tệp `1_schema.sql` (được mount từ `src/database/schema.sql`). Quá trình này tự động tạo lập 5 bảng nghiệp vụ: `roles`, `users`, `student_profiles`, `teacher_profiles`, và `auth_tokens`.

### 3.2. Chèn dữ liệu mẫu (seed.sql)
Sau khi tạo bảng, Docker thực thi tiếp tệp `2_seed.sql` (được mount từ `src/database/seed.sql`) để:
1. Chèn 3 vai trò: `STUDENT`, `TEACHER`, và `ADMIN`.
2. Tạo tài khoản Admin mặc định:
   - **Email:** `admin@gmail.com`
   - **Mật khẩu:** `123456`
3. Tạo tài khoản Giảng viên thử nghiệm:
   - **Email:** `teacher@gmail.com`
   - **Mật khẩu:** `123456`
4. Tạo tài khoản Sinh viên thử nghiệm:
   - **Email:** `student@gmail.com`
   - **Mật khẩu:** `123456`

---

## 4. Khởi chạy Node.js Server
Sau khi cơ sở dữ liệu đã sẵn sàng, khởi chạy Server Node.js bằng một trong các lệnh:

* Chạy ở chế độ phát triển (Development) có tự động tải lại (hot reload):
  ```bash
  npm run dev
  ```
* Chạy ở chế độ thông thường (Production Mode):
  ```bash
  npm start
  ```

Hệ thống sẽ chạy tại cổng được cấu hình trong file `.env` (mặc định: `http://localhost:5000`). Bạn có thể thử nghiệm gọi các API xác thực như `POST /api/auth/login` để lấy JWT token.
