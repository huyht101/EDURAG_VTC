> **Historical draft — superseded by database schema 1.0.0 and current implementation.** Không dùng file này làm specification hiện hành.

# 12. Danh sách Công việc cần làm (TODO / Task Checklist)

Tài liệu này đóng vai trò là bảng phân chia công việc chi tiết (TODO) dành cho lập trình viên để tiến hành hiện thực hóa mã nguồn hệ thống từ các bản thiết kế.

---

## 1. Giai đoạn 1: Chuẩn bị Môi trường & Cơ sở dữ liệu
- [ ] Thiết lập thư mục dự án Node.js (`npm init -y`).
- [ ] Cài đặt các thư viện bắt buộc trong file `package.json`:
  ```json
  "dependencies": {
    "bcrypt": "^5.1.1",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "jsonwebtoken": "^9.0.2",
    "mysql2": "^3.9.7"
  }
  ```
- [ ] Viết file [schema.sql](file:///c:/Users/admin/OneDrive/M%C3%A1y%20t%C3%ADnh/ProjectVTC/src/database/schema.sql) và [seed.sql](file:///c:/Users/admin/OneDrive/M%C3%A1y%20t%C3%ADnh/ProjectVTC/src/database/seed.sql).
- [ ] Tạo file [Dockerfile](file:///c:/Users/admin/OneDrive/M%C3%A1y%20t%C3%ADnh/ProjectVTC/Dockerfile), [docker-compose.yml](file:///c:/Users/admin/OneDrive/M%C3%A1y%20t%C3%ADnh/ProjectVTC/docker-compose.yml) và [.env.example](file:///c:/Users/admin/OneDrive/M%C3%A1y%20t%C3%ADnh/ProjectVTC/.env.example).
- [ ] Khởi chạy Docker Compose và kiểm tra kết nối DB.

---

## 2. Giai đoạn 2: Phát triển Tầng Cấu hình & Tiện ích (Config & Utils)
- [ ] Viết file cấu hình database [db.js](file:///c:/Users/admin/OneDrive/M%C3%A1y%20t%C3%ADnh/ProjectVTC/src/configs/db.js) (sử dụng connection pool).
- [ ] Định nghĩa các hằng số về Role và Status trong thư mục `src/constants/`.
- [ ] Viết hàm tiện ích mã hóa mật khẩu và tạo token JWT trong thư mục `src/utils/`.

---

## 3. Giai đoạn 3: Phát triển Lớp Truy xuất DB (Repositories)
- [ ] Hiện thực hóa [user-repository.js](file:///c:/Users/admin/OneDrive/M%C3%A1y%20t%C3%ADnh/ProjectVTC/src/repositories/user-repository.js) sử dụng truy vấn tham số hóa (Parameterized Query):
  - [ ] `findUserByEmail(email)`
  - [ ] `createUserAndStudentProfile(data)`
  - [ ] `createUserAndTeacherProfile(data)`
  - [ ] `findProfileDetail(id, role)`
  - [ ] `updateBasicInfo(...)`
  - [ ] `updateStatus(id, status)`
- [ ] Hiện thực hóa [token-repository.js](file:///c:/Users/admin/OneDrive/M%C3%A1y%20t%C3%ADnh/ProjectVTC/src/repositories/token-repository.js) để lưu và truy tìm token OTP/Reset password.

---

## 4. Giai đoạn 4: Phát triển Lớp Middleware (Middlewares)
- [ ] Viết bộ xử lý lỗi global [error-middleware.js](file:///c:/Users/admin/OneDrive/M%C3%A1y%20t%C3%ADnh/ProjectVTC/src/middlewares/error-middleware.js).
- [ ] Viết bộ định dạng response [response-middleware.js](file:///c:/Users/admin/OneDrive/M%C3%A1y%20t%C3%ADnh/ProjectVTC/src/middlewares/response-middleware.js).
- [ ] Viết Middleware xác thực JWT và giả lập xác thực trong [auth-middleware.js](file:///c:/Users/admin/OneDrive/M%C3%A1y%20t%C3%ADnh/ProjectVTC/src/middlewares/auth-middleware.js).
- [ ] Viết Middleware kiểm duyệt phân quyền truy cập [role-middleware.js](file:///c:/Users/admin/OneDrive/M%C3%A1y%20t%C3%ADnh/ProjectVTC/src/middlewares/role-middleware.js).

---

## 5. Giai đoạn 5: Phát triển Lớp Logic & Routing (Services, Controllers, Routes)
- [ ] Đăng ký & Đăng nhập:
  - [ ] Viết `AuthService` và `AuthController`.
  - [ ] Thiết lập định tuyến `/api/auth/*`.
- [ ] Quản lý Profile cá nhân:
  - [ ] Viết `UserService` và `UserController` liên quan đến profile.
  - [ ] Thiết lập định tuyến `/api/profile/*`.
- [ ] Quản trị Admin:
  - [ ] Viết các chức năng duyệt giảng viên, khóa/mở khóa tài khoản, xem danh sách user.
  - [ ] Thiết lập định tuyến `/api/admin/users/*`.

---

## 6. Giai đoạn 6: Kiểm thử & Nghiệm thu
- [ ] Chạy kiểm thử thủ công qua Postman các luồng:
  - [ ] Đăng ký Sinh viên -> Tự động ACTIVE -> Đăng nhập thành công lấy JWT.
  - [ ] Đăng ký Giảng viên -> Trạng thái PENDING -> Đăng nhập bị từ chối.
  - [ ] Admin đăng nhập -> Lấy mã OTP từ console log -> Xác thực thành công lấy JWT Admin.
  - [ ] Admin duyệt Giảng viên -> ACTIVE -> Giảng viên đăng nhập thành công.
  - [ ] Đổi mật khẩu, quên mật khẩu và reset mật khẩu.
  - [ ] Admin khóa Giảng viên/Sinh viên -> Thử đăng nhập lại -> Báo lỗi bị khóa.
- [ ] Chạy thử nghiệm Mock Middleware qua việc cấu hình Header `X-Mock-Role` để kiểm tra phân quyền.
