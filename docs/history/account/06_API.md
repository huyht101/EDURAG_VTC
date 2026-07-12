> **Historical draft — superseded by database schema 1.0.0 and current implementation.** Không dùng file này làm specification hiện hành.

# 06. Thiết kế REST API (API Design)

Tài liệu này cung cấp chi tiết đặc tả kỹ thuật cho từng API endpoint thuộc Module Account, bao gồm đường dẫn, phương thức, phân quyền, cấu trúc request/response, validation dữ liệu đầu vào và các mã lỗi trả về.

---

## 1. Nhóm API Xác thực (`/api/auth`)

### 1.1. Đăng ký tài khoản (Register)
* **URL:** `/api/auth/register`
* **Method:** `POST`
* **Authentication:** No (Public)
* **Role:** Public
* **Request Body:**
  ```json
  {
    "email": "student@vtc.edu.vn",
    "password": "Password123!",
    "fullName": "Trần Văn A",
    "role": "STUDENT",
    "studentCode": "SV001",
    "dateOfBirth": "2005-08-25"
  }
  ```
  *(Đối với Giảng viên)*:
  ```json
  {
    "email": "teacher@vtc.edu.vn",
    "password": "Password123!",
    "fullName": "Nguyễn Văn B",
    "role": "TEACHER",
    "academicTitle": "Phó Giáo sư",
    "degree": "Tiến sĩ",
    "department": "Công nghệ thông tin"
  }
  ```
* **Response (Thành công - 201 Created):**
  ```json
  {
    "success": true,
    "message": "Đăng ký tài khoản thành công.",
    "data": {
      "id": 4,
      "email": "student@vtc.edu.vn",
      "role": "STUDENT",
      "status": "ACTIVE"
    }
  }
  ```
* **Validation Rules:**
  - `email`: Bắt buộc, định dạng email chuẩn.
  - `password`: Bắt buộc, tối thiểu 8 ký tự, chứa chữ hoa, chữ thường và chữ số.
  - `fullName`: Bắt buộc, không để trống.
  - `role`: Bắt buộc, chỉ nhận `'STUDENT'` hoặc `'TEACHER'`.
  - `studentCode` và `dateOfBirth`: Bắt buộc nếu role là `'STUDENT'`.
  - `department`: Bắt buộc nếu role là `'TEACHER'`.
* **Errors:**
  - `400 Bad Request` (`VALIDATION_ERROR`): Thiếu trường bắt buộc hoặc dữ liệu sai định dạng.
  - `409 Conflict` (`EMAIL_ALREADY_EXISTS`): Email đã được đăng ký.
  - `409 Conflict` (`STUDENT_CODE_ALREADY_EXISTS`): Mã sinh viên đã tồn tại.

---

### 1.2. Đăng nhập (Login)
* **URL:** `/api/auth/login`
* **Method:** `POST`
* **Authentication:** No
* **Role:** Public
* **Request Body:**
  ```json
  {
    "email": "student@vtc.edu.vn",
    "password": "Password123!"
  }
  ```
* **Response (Thành công - 200 OK):**
  ```json
  {
    "success": true,
    "message": "Đăng nhập thành công.",
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": 4,
        "fullName": "Trần Văn A",
        "email": "student@vtc.edu.vn",
        "role": "STUDENT",
        "status": "ACTIVE"
      }
    }
  }
  ```
* **Response (Đăng nhập Admin - 200 OK - Yêu cầu OTP):**
  ```json
  {
    "success": true,
    "message": "Mã xác thực OTP đã được gửi đến email của bạn.",
    "data": {
      "requireOtp": true,
      "email": "admin@vtc.edu.vn"
    }
  }
  ```
* **Validation Rules:**
  - `email`: Bắt buộc.
  - `password`: Bắt buộc.
* **Errors:**
  - `401 Unauthorized` (`INVALID_CREDENTIALS`): Sai tài khoản hoặc mật khẩu.
  - `403 Forbidden` (`ACCOUNT_PENDING`): Giảng viên chưa được Admin duyệt.
  - `403 Forbidden` (`ACCOUNT_LOCKED`): Tài khoản đã bị khóa.
  - `403 Forbidden` (`ACCOUNT_REJECTED`): Tài khoản bị từ chối phê duyệt.

---

### 1.3. Xác thực OTP Admin (Admin Verify OTP)
* **URL:** `/api/auth/admin/verify-otp`
* **Method:** `POST`
* **Authentication:** No
* **Role:** ADMIN
* **Request Body:**
  ```json
  {
    "email": "admin@vtc.edu.vn",
    "otpCode": "123456"
  }
  ```
* **Response (Thành công - 200 OK):**
  ```json
  {
    "success": true,
    "message": "Xác thực OTP thành công.",
    "data": {
      "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "user": {
        "id": 1,
        "fullName": "Hệ thống Admin",
        "email": "admin@vtc.edu.vn",
        "role": "ADMIN",
        "status": "ACTIVE"
      }
    }
  }
  ```
* **Validation Rules:**
  - `email`: Bắt buộc.
  - `otpCode`: Bắt buộc, chuỗi 6 số.
* **Errors:**
  - `400 Bad Request` (`INVALID_OR_EXPIRED_OTP`): Mã OTP không chính xác hoặc đã hết hạn.

---

### 1.4. Yêu cầu Quên mật khẩu (Forgot Password)
* **URL:** `/api/auth/forgot-password`
* **Method:** `POST`
* **Authentication:** No
* **Role:** Public
* **Request Body:**
  ```json
  {
    "email": "student@vtc.edu.vn"
  }
  ```
* **Response (Thành công - 200 OK):**
  ```json
  {
    "success": true,
    "message": "Liên kết đặt lại mật khẩu đã được gửi đến email của bạn.",
    "data": {}
  }
  ```
* **Errors:**
  - `404 Not Found` (`EMAIL_NOT_FOUND`): Email chưa được đăng ký trong hệ thống.

---

### 1.5. Đặt lại mật khẩu mới (Reset Password)
* **URL:** `/api/auth/reset-password`
* **Method:** `POST`
* **Authentication:** No
* **Role:** Public
* **Request Body:**
  ```json
  {
    "token": "raw_reset_token_from_email",
    "newPassword": "NewPassword123!"
  }
  ```
* **Response (Thành công - 200 OK):**
  ```json
  {
    "success": true,
    "message": "Đặt lại mật khẩu thành công. Hãy đăng nhập bằng mật khẩu mới.",
    "data": {}
  }
  ```
* **Errors:**
  - `400 Bad Request` (`INVALID_OR_EXPIRED_TOKEN`): Token không đúng hoặc hết hạn.

---

## 2. Nhóm API Cá nhân (`/api/profile`)

### 2.1. Xem Profile hiện tại
* **URL:** `/api/profile`
* **Method:** `GET`
* **Authentication:** Yes (JWT)
* **Role:** STUDENT, TEACHER, ADMIN
* **Response (Thành công - 200 OK - Student):**
  ```json
  {
    "success": true,
    "message": "OK",
    "data": {
      "id": 3,
      "email": "student@vtc.edu.vn",
      "fullName": "Trần Minh B",
      "phone": "0987654321",
      "role": "STUDENT",
      "status": "ACTIVE",
      "profile": {
        "studentCode": "SV123456",
        "dateOfBirth": "2004-09-15"
      }
    }
  }
  ```
* **Response (Thành công - 200 OK - Teacher):**
  ```json
  {
    "success": true,
    "message": "OK",
    "data": {
      "id": 2,
      "email": "teacher@vtc.edu.vn",
      "fullName": "Nguyễn Văn A",
      "phone": "0912345678",
      "role": "TEACHER",
      "status": "ACTIVE",
      "profile": {
        "academicTitle": "Phó Giáo sư",
        "degree": "Tiến sĩ",
        "department": "Khoa Công nghệ thông tin"
      }
    }
  }
  ```

---

### 2.2. Cập nhật Profile cá nhân
* **URL:** `/api/profile`
* **Method:** `PUT`
* **Authentication:** Yes (JWT)
* **Role:** STUDENT, TEACHER, ADMIN
* **Request Body (Teacher):**
  ```json
  {
    "fullName": "Nguyễn Văn A (Đã cập nhật)",
    "phone": "0911223344",
    "academicTitle": "Giáo sư",
    "degree": "Tiến sĩ khoa học",
    "department": "Khoa CNTT"
  }
  ```
* **Response (Thành công - 200 OK):**
  ```json
  {
    "success": true,
    "message": "Cập nhật profile thành công.",
    "data": {}
  }
  ```
* **Validation Rules:**
  - `fullName`: Bắt buộc, không trống.

---

### 2.3. Đổi mật khẩu
* **URL:** `/api/profile/password`
* **Method:** `PUT`
* **Authentication:** Yes (JWT)
* **Role:** STUDENT, TEACHER, ADMIN
* **Request Body:**
  ```json
  {
    "oldPassword": "Password123!",
    "newPassword": "NewPassword123!"
  }
  ```
* **Response (Thành công - 200 OK):**
  ```json
  {
    "success": true,
    "message": "Thay đổi mật khẩu thành công.",
    "data": {}
  }
  ```
* **Errors:**
  - `400 Bad Request` (`INCORRECT_OLD_PASSWORD`): Mật khẩu cũ không chính xác.

---

## 3. Nhóm API Quản trị (`/api/admin/users`)

### 3.1. Danh sách người dùng
* **URL:** `/api/admin/users`
* **Method:** `GET`
* **Authentication:** Yes (JWT)
* **Role:** ADMIN
* **Query Params:** `page` (default 1), `limit` (default 10), `search` (name or email), `role` (STUDENT/TEACHER), `status` (PENDING/ACTIVE/LOCKED/REJECTED).
* **Response (Thành công - 200 OK):**
  ```json
  {
    "success": true,
    "message": "OK",
    "data": {
      "total": 25,
      "page": 1,
      "limit": 10,
      "users": [
        {
          "id": 2,
          "email": "teacher@vtc.edu.vn",
          "fullName": "Nguyễn Văn A",
          "role": "TEACHER",
          "status": "ACTIVE",
          "createdAt": "2026-07-01T10:00:00.000Z"
        }
      ]
    }
  }
  ```

---

### 3.2. Phê duyệt trạng thái (Duyệt, Khóa, Mở khóa)
* **URL:** `/api/admin/users/:id/status`
* **Method:** `PUT`
* **Authentication:** Yes (JWT)
* **Role:** ADMIN
* **Request Body:**
  ```json
  {
    "status": "ACTIVE"
  }
  ```
  *(Để khóa tài khoản)*:
  ```json
  {
    "status": "LOCKED"
  }
  ```
* **Response (Thành công - 200 OK):**
  ```json
  {
    "success": true,
    "message": "Cập nhật trạng thái người dùng thành công.",
    "data": {}
  }
  ```
* **Validation Rules:**
  - `status`: Bắt buộc, chỉ nhận một trong: `'ACTIVE'`, `'LOCKED'`, `'REJECTED'`.
* **Errors:**
  - `400 Bad Request` (`CANNOT_CHANGE_SELF_STATUS`): Tự thay đổi trạng thái của chính mình.
  - `404 Not Found` (`USER_NOT_FOUND`): Không tìm thấy người dùng có ID tương ứng.
