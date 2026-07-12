> **Historical draft — superseded by database schema 1.0.0 and current implementation.** Không dùng file này làm specification hiện hành.

# 11. Phạm vi sản phẩm khả thi tối thiểu (MVP Scope)

Tài liệu này xác định rõ ranh giới các tính năng được phát triển trong phiên bản MVP (Tuần 1 & Tuần 2) và các tính năng được hoãn lại ở các pha phát triển tiếp theo của Module Account.

---

## 1. Các tính năng Đã hoàn thành / Đang phát triển (In MVP Scope)

### 1.1. Xác thực & Phân quyền (Auth & Authz)
- [x] Đăng ký Sinh viên: Tài khoản tự động ở trạng thái `ACTIVE`.
- [x] Đăng ký Giảng viên: Tài khoản mặc định ở trạng thái `PENDING` chờ phê duyệt.
- [x] Đăng nhập & Đăng xuất: So khớp mật khẩu đã hash qua bcrypt, cấp token JWT.
- [x] Đăng nhập Admin: Sử dụng tài khoản mặc định được seed sẵn kết hợp OTP gửi qua email.
- [x] Xác thực Token: Middleware giải mã JWT và gán đối tượng `req.user` chuẩn.
- [x] Giả lập xác thực: Middleware `mockAuthMiddleware` hỗ trợ phát triển song song thông qua việc đọc các Mock Headers.
- [x] Phân quyền API: Middleware `roleMiddleware` chặn các truy cập trái quyền dựa trên Role.

### 1.2. Quản lý Hồ sơ (Profile)
- [x] Xem thông tin cá nhân: LEFT JOIN sang bảng profile tương ứng để trả dữ liệu.
- [x] Cập nhật profile: Giảng viên được phép cập nhật học hàm/học vị/khoa. Sinh viên cập nhật thông tin họ tên/sđt (không cho phép sửa MSV/ngày sinh).
- [x] Đổi mật khẩu: Yêu cầu mật khẩu cũ chính xác mới cho đổi mật khẩu mới.

### 1.3. Quản trị Tài khoản (Admin Control)
- [x] Danh sách tài khoản: Admin xem danh sách người dùng có bộ lọc role/status và phân trang.
- [x] Phê duyệt giảng viên: Admin cập nhật đơn đăng ký của giảng viên sang `ACTIVE` hoặc `REJECTED`.
- [x] Khóa/Mở khóa tài khoản: Admin đổi trạng thái người dùng sang `LOCKED` để chặn đăng nhập hoặc khôi phục về `ACTIVE`.

### 1.4. Thiết lập môi trường
- [x] Script cơ sở dữ liệu: File SQL khởi tạo schema tự động và chèn dữ liệu seed chuẩn.
- [x] Dockerization: Khởi chạy MySQL và Qdrant local thông qua Docker Compose.

---

## 2. Các tính năng Hoãn lại (Future / Out of MVP Scope)

### 2.1. Phân quyền nâng cao theo lớp / môn học
- *Mô tả:* Giảng viên chỉ được quản lý tài liệu của lớp mình dạy; Sinh viên chỉ được chat trên tài liệu thuộc lớp mình học.
- *Trạng thái:* Hoãn lại. Trong MVP, mọi tài liệu được upload ở trạng thái `VISIBLE` đều là công khai cho tất cả mọi người hoạt động trong hệ thống.

### 2.2. Nhập dữ liệu hàng loạt (Bulk Import)
- *Mô tả:* Admin tải lên file Excel chứa danh sách thông tin sinh viên để tự động tạo tài khoản hàng loạt.
- *Trạng thái:* Hoãn lại. Sinh viên tự thực hiện đăng ký tài khoản cá nhân.

### 2.3. Đăng ký qua bên thứ ba (OAuth2)
- *Mô tả:* Cho phép sinh viên và giảng viên đăng nhập trực tiếp bằng tài khoản Google (VTC mail) hoặc Microsoft.
- *Trạng thái:* Hoãn lại. Hệ thống chỉ hỗ trợ xác thực Email + Password truyền thống.

### 2.4. Nhật ký hoạt động chi tiết (Audit Log)
- *Mô tả:* Ghi nhận chi tiết từng hoạt động nhạy cảm của Admin hoặc Giảng viên (xóa tài liệu nào, khóa user nào, vào thời điểm nào).
- *Trạng thái:* Hoãn lại. Mới chỉ hỗ trợ lưu logs hoạt động thô ở console hệ thống.
