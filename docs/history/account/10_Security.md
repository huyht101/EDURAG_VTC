> **Historical draft — superseded by database schema 1.0.0 and current implementation.** Không dùng file này làm specification hiện hành.

# 10. Giải pháp An ninh bảo mật (Security Design)

Tài liệu này tổng hợp các giải pháp, kỹ thuật và cấu hình bảo mật được thiết kế cho Module Account để bảo vệ dữ liệu người dùng và hệ thống trước các mối đe dọa an ninh phổ biến.

---

## 1. Cơ chế mã hóa và Hash mật khẩu (`bcrypt`)
- **Mô tả:** Mật khẩu của người dùng không bao giờ được phép lưu trữ dưới dạng văn bản thô (plain text).
- **Giải pháp:** Sử dụng thuật toán băm mật khẩu mạnh **bcrypt** với cấu hình **Salt Rounds = 10**.
- **Cách áp dụng:** Khi đăng ký hoặc đổi mật khẩu, hệ thống băm mật khẩu thô và lưu chuỗi băm dạng `$2b$10$...` vào DB. Khi đăng nhập, sử dụng `bcrypt.compare()` để đối sánh.

---

## 2. Bảo mật Token xác thực (`JWT`)
- **Mô tả:** Đảm bảo JWT stateless được ký và xác thực an toàn.
- **Giải pháp:**
  - JWT được ký bằng thuật toán mã hóa đối xứng **HS256** sử dụng khóa bí mật dài và phức tạp (`JWT_SECRET`) được lưu ngoài mã nguồn (trong biến môi trường `.env`).
  - Thời hạn hiệu lực của Token (Expiration) được thiết lập tối giản (ví dụ: `7d` - 7 ngày cho môi trường phát triển học thuật và rút ngắn cho production).
  - Khi thu hồi quyền của người dùng (bị Admin khóa tài khoản đột xuất), middleware xác thực sẽ luôn truy vấn trạng thái thực tế từ MySQL thay vì chỉ giải mã JWT đơn thuần để phát hiện và thu hồi quyền ngay lập tức.

---

## 3. Phòng chống tấn công SQL Injection
- **Mô tả:** Ngăn chặn tin tặc chèn mã SQL trái phép vào dữ liệu đầu vào.
- **Giải pháp:** Bắt buộc áp dụng kỹ thuật **Parameterized Query** (truy vấn tham số hóa) của thư viện `mysql2/promise` tại mọi câu lệnh SQL trong tầng Repository.
- **Quy định nghiêm ngặt:** Tuyệt đối không viết nối chuỗi hoặc sử dụng template literal để chèn biến trực tiếp vào câu lệnh SQL.
  - *Đúng:* `db.execute("SELECT * FROM users WHERE email = ?", [email])`
  - *Sai:* `db.execute(\`SELECT * FROM users WHERE email = '${email}'\`)`

---

## 4. Bảo vệ Headers và cấu hình chia sẻ tài nguyên (`Helmet` & `CORS`)
- **Mô tả:** Ngăn chặn các vụ tấn công Clickjacking, XSS và phân quyền truy cập chéo tên miền.
- **Giải pháp:**
  - Tích hợp middleware **Helmet** để cấu hình và thiết lập các HTTP headers an toàn (ví dụ: ẩn header `X-Powered-By: Express` tránh lộ tech stack, kích hoạt X-XSS-Protection, thiết lập Content-Security-Policy).
  - Cấu hình thư viện **CORS** giới hạn phạm vi các nguồn gốc (origins) được phép gửi yêu cầu API đến Backend. Trong môi trường production, chỉ cho phép tên miền chính thức của Web Frontend truy cập.

---

## 5. Chống Spam và DoS (`Rate Limit`)
- **Mô tả:** Ngăn chặn người dùng gửi yêu cầu liên tiếp trong thời gian ngắn gây nghẽn hệ thống hoặc spam dò tìm mật khẩu (brute-force).
- **Giải pháp:** Áp dụng thư viện giới hạn tần suất yêu cầu (ví dụ: `express-rate-limit`).
- **Cấu hình cụ thể:**
  - Nhóm API đăng ký/đăng nhập (`/api/auth/*`): Giới hạn tối đa **5 yêu cầu / 1 phút** đối với một địa chỉ IP.
  - Nhóm API thông thường: Giới hạn tối đa **100 yêu cầu / 15 phút** cho một IP.

---

## 6. Chính sách Mật khẩu (Password Policy)
- **Mô tả:** Buộc người dùng thiết lập mật khẩu có độ phức tạp an toàn cao.
- **Chính sách áp dụng:** Mật khẩu khi đăng ký hoặc thay đổi bắt buộc phải thỏa mãn:
  - Độ dài tối thiểu 8 ký tự.
  - Chứa ít nhất một chữ viết hoa (A-Z).
  - Chứa ít nhất một chữ viết thường (a-z).
  - Chứa ít nhất một ký số (0-9).
  - Chứa ít nhất một ký tự đặc biệt (ví dụ: `@`, `$`, `!`, `%`, `*`, `?`, `&`).

---

## 7. Kiểm tra hợp lệ dữ liệu đầu vào (Validation)
- **Mô tả:** Chặn dữ liệu rác, mã độc XSS hoặc dữ liệu phá hoại hệ thống ngay từ tầng cổng vào.
- **Giải pháp:** Sử dụng Middleware `validateRequest` kiểm duyệt chặt chẽ định dạng email, ngày sinh, tên không chứa ký tự HTML đặc biệt để phòng ngừa lưu trữ mã độc vào database (Stored XSS).
