> **Historical draft — superseded by database schema 1.0.0 and current implementation.** Không dùng file này làm specification hiện hành.

# 07. Thiết kế Middleware (Middleware Design)

Tài liệu này đặc tả cơ chế hoạt động của các Express Middleware tùy chỉnh được sử dụng xuyên suốt hệ thống để đảm bảo tính an ninh, kiểm tra dữ liệu và chuẩn hóa thông tin phản hồi.

---

## 1. Middleware Xác thực JWT (`authMiddleware`)
* **Vai trò:** Kiểm tra tính hợp lệ của JSON Web Token gửi kèm theo mỗi request.
* **Cơ chế hoạt động:**
  1. Đọc giá trị từ Header `Authorization` có tiền tố `Bearer `. Nếu thiếu, trả lỗi `401 Unauthorized` (`UNAUTHORIZED`).
  2. Giải mã và verify token sử dụng khóa bí mật `JWT_SECRET`. Nếu token sai hoặc hết hạn, trả lỗi `401 Unauthorized` (`TOKEN_INVALID_OR_EXPIRED`).
  3. Truy vấn nhanh database bằng `user_id` để lấy trạng thái mới nhất của người dùng.
     - Nếu user không tồn tại hoặc có trạng thái khác `ACTIVE` (ví dụ: `LOCKED`), trả về `403 Forbidden` (`ACCOUNT_NOT_ACTIVE` hoặc `ACCOUNT_LOCKED`).
  4. Đính thông tin giải mã và trạng thái thực tế vào đối tượng request:
     ```javascript
     req.user = { id, email, role, status }
     ```
  5. Gọi hàm `next()` để chuyển sang middleware/controller tiếp theo.

---

## 2. Middleware Giả lập Xác thực (`mockAuthMiddleware`)
* **Vai trò:** Giả lập xác thực người dùng để hỗ trợ đội ngũ phát triển song song các tính năng (Document, Chat, Citation) mà không cần chờ tích hợp JWT hoàn chỉnh.
* **Cơ chế hoạt động:**
  1. Kiểm tra xem Client có gửi kèm thông tin tài khoản giả lập qua các Header tùy chỉnh hay không:
     - `X-Mock-Id` (Ví dụ: `2`)
     - `X-Mock-Email` (Ví dụ: `teacher@vtc.edu.vn`)
     - `X-Mock-Role` (Ví dụ: `TEACHER`)
     - `X-Mock-Status` (Ví dụ: `ACTIVE`)
  2. Nếu không có Header tùy chỉnh, hệ thống tự động gán tài khoản mặc định của một Giảng viên đang hoạt động:
     ```javascript
     req.user = {
       id: 2,
       email: "teacher@vtc.edu.vn",
       role: "TEACHER",
       status: "ACTIVE"
     };
     ```
  3. Nếu có Header tùy chỉnh, nạp giá trị từ header để tạo đối tượng `req.user` động. Điều này cho phép tester dễ dàng thay đổi quyền bằng cách đổi header (ví dụ đổi `X-Mock-Role` thành `STUDENT` hoặc `X-Mock-Status` thành `LOCKED`).
  4. Gọi hàm `next()`.

---

## 3. Middleware Phân quyền (`roleMiddleware`)
* **Vai trò:** Bảo vệ API, chỉ cho phép các Role được định nghĩa truy cập.
* **Cơ chế hoạt động:**
  1. Nhận danh sách các vai trò được phép (`allowedRoles`) dưới dạng tham số.
  2. Lấy role của user từ `req.user.role`.
  3. So khớp: Nếu `req.user.role` nằm trong mảng `allowedRoles`, cho phép đi tiếp (`next()`).
  4. Ngược lại, chặn yêu cầu và trả lỗi `403 Forbidden` (`PERMISSION_DENIED`).
* **Ví dụ sử dụng:**
  ```javascript
  router.get('/admin/users', authMiddleware, roleMiddleware(['ADMIN']), adminController.getUsers);
  ```

---

## 4. Middleware Kiểm tra dữ liệu đầu vào (`validateRequest`)
* **Vai trò:** Đảm bảo dữ liệu gửi lên khớp với schema định nghĩa trước khi đi vào Controller.
* **Cơ chế hoạt động:**
  1. Nhận một validator function (được viết tùy chỉnh bằng JS thuần) kiểm tra dữ liệu của `req.body`, `req.query` hoặc `req.params`.
  2. Nếu dữ liệu hợp lệ, gọi `next()`.
  3. Nếu dữ liệu không hợp lệ, gom danh sách lỗi và lập tức trả về `400 Bad Request` kèm theo mã lỗi `VALIDATION_ERROR` và mô tả cụ thể chi tiết từng trường bị lỗi.

---

## 5. Middleware Định dạng Response thành công (`responseHandler`)
* **Vai trò:** Chuẩn hóa cấu trúc dữ liệu trả về cho Client khi API xử lý thành công.
* **Cơ chế hoạt động:**
  - Cung cấp phương thức tiện ích `res.ok(message, data)` để Controller gọi trực tiếp.
  - Tự động map dữ liệu sang JSON format thống nhất:
    ```json
    {
      "success": true,
      "message": "Thông điệp thành công",
      "data": {}
    }
    ```

---

## 6. Middleware Xử lý Lỗi tập trung (`errorHandler`)
* **Vai trò:** Bắt toàn bộ các lỗi phát sinh trong hệ thống (lỗi cú pháp, lỗi kết nối DB, lỗi nghiệp vụ do service ném ra) để xử lý tập trung, bảo vệ server không bị crash và trả về cấu trúc lỗi chuẩn.
* **Cơ chế hoạt động:**
  1. Bất kỳ lỗi nào xảy ra trong controller/service được chuyển đến middleware xử lý lỗi thông qua `next(err)`.
  2. Định dạng lỗi trả về Client theo chuẩn:
     ```json
     {
       "success": false,
       "message": "Nội dung lỗi chi tiết",
       "errorCode": "MÃ_LỖI"
     }
     ```
  3. Nếu lỗi là do hệ thống (500 Internal Server Error), ẩn các chi tiết kỹ thuật nhạy cảm (stack trace) đối với môi trường production và ghi log chi tiết trên server để debug.

---

## 7. Middleware Lỗi Không tìm thấy Endpoint (`notFound`)
* **Vai trò:** Xử lý các request gọi đến các URL hoặc API Endpoints không tồn tại trên hệ thống.
* **Cơ chế hoạt động:**
  - Đóng vai trò là middleware cuối cùng trong chuỗi routing của Express.
  - Tạo một đối tượng Error với status `404 Not Found` và chuyển tiếp đến `errorHandler` để trả về JSON chuẩn:
    ```json
    {
      "success": false,
      "message": "API endpoint không tồn tại.",
      "errorCode": "ENDPOINT_NOT_FOUND"
    }
    ```
