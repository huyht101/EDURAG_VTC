> **Historical draft — superseded by database schema 1.0.0 and current implementation.** Không dùng file này làm specification hiện hành.

# 04. Thiết kế Cơ sở dữ liệu (Database Design)

Tài liệu này trình bày thiết kế chi tiết cơ sở dữ liệu MySQL phục vụ Module Account, bao gồm sơ đồ quan hệ thực thể (ERD), định nghĩa các thuộc tính, khóa ngoại, ràng buộc và các chỉ mục (indexes) để tối ưu hóa truy vấn.

---

## 1. Sơ đồ thực thể quan hệ (Mermaid ERD)

Dưới đây là sơ đồ quan hệ giữa các bảng thuộc module Account:

```mermaid
erDiagram
    roles {
        int id PK
        varchar code UK
        varchar name
        varchar description
    }
    users {
        int id PK
        int role_id FK
        varchar full_name
        varchar email UK
        varchar password_hash
        varchar phone
        varchar status
        timestamp email_verified_at
        int approved_by FK
        timestamp approved_at
        timestamp created_at
        timestamp updated_at
    }
    student_profiles {
        int user_id PK_FK
        varchar student_code UK
        date date_of_birth
        timestamp created_at
        timestamp updated_at
    }
    teacher_profiles {
        int user_id PK_FK
        varchar academic_title
        varchar degree
        varchar department
        timestamp created_at
        timestamp updated_at
    }
    auth_tokens {
        int id PK
        int user_id FK
        varchar type
        varchar token_hash
        timestamp expires_at
        timestamp used_at
        timestamp created_at
    }

    roles ||--o{ users : "defines_role_for"
    users ||--o| student_profiles : "has_student_profile"
    users ||--o| teacher_profiles : "has_teacher_profile"
    users ||--o{ auth_tokens : "requests_tokens"
    users ||--o{ users : "approves (Admin -> Teacher)"
```

---

## 2. Chi tiết các thực thể (Entity Definitions)

### 2.1. Bảng `roles`
*Lưu các vai trò quyền hạn được định nghĩa trong hệ thống.*
* **id**: `INT AUTO_INCREMENT` (PK) - Khóa chính tự tăng.
* **code**: `VARCHAR(50) UNIQUE` (NOT NULL) - Mã định danh vai trò (VD: `'STUDENT'`, `'TEACHER'`, `'ADMIN'`).
* **name**: `VARCHAR(100)` (NOT NULL) - Tên hiển thị của vai trò.
* **description**: `VARCHAR(255)` (NULL) - Mô tả chi tiết về quyền hạn vai trò.

### 2.2. Bảng `users`
*Lưu thông tin tài khoản người dùng cơ bản.*
* **id**: `INT AUTO_INCREMENT` (PK) - Khóa chính tự tăng.
* **role_id**: `INT` (FK, NOT NULL) - Liên kết tới `roles(id)`.
* **full_name**: `VARCHAR(255)` (NOT NULL) - Họ và tên đầy đủ.
* **email**: `VARCHAR(255) UNIQUE` (NOT NULL) - Email đăng nhập và giao tiếp.
* **password_hash**: `VARCHAR(255)` (NOT NULL) - Mật khẩu đã mã hóa bằng bcrypt.
* **phone**: `VARCHAR(20)` (NULL) - Số điện thoại liên hệ.
* **status**: `VARCHAR(50)` (NOT NULL, DEFAULT `'PENDING'`) - Trạng thái hoạt động (`'PENDING'`, `'ACTIVE'`, `'LOCKED'`, `'REJECTED'`).
* **email_verified_at**: `TIMESTAMP` (NULL) - Thời điểm hoàn tất xác thực email.
* **approved_by**: `INT` (FK, NULL) - ID của Admin thực hiện duyệt tài khoản giảng viên (Self-reference tới `users(id)`).
* **approved_at**: `TIMESTAMP` (NULL) - Thời điểm Admin phê duyệt đơn đăng ký giảng viên.
* **created_at**: `TIMESTAMP` (DEFAULT `CURRENT_TIMESTAMP`) - Thời điểm đăng ký.
* **updated_at**: `TIMESTAMP` (DEFAULT `CURRENT_TIMESTAMP` ON UPDATE `CURRENT_TIMESTAMP`) - Thời điểm cập nhật thông tin tài khoản gần nhất.

### 2.3. Bảng `student_profiles`
*Lưu thông tin mở rộng đặc thù của Sinh viên. Quan hệ 1-1 với `users`.*
* **user_id**: `INT PRIMARY KEY` (PK, FK) - Vừa là khóa chính vừa là khóa ngoại liên kết tới `users(id)` (ON DELETE CASCADE).
* **student_code**: `VARCHAR(50) UNIQUE` (NOT NULL) - Mã số sinh viên (MSV), không cho phép sửa sau khi đăng ký thành công.
* **date_of_birth**: `DATE` (NOT NULL) - Ngày sinh của sinh viên (phục vụ validate danh tính).
* **created_at**: `TIMESTAMP` (DEFAULT `CURRENT_TIMESTAMP`) - Thời điểm tạo profile.
* **updated_at**: `TIMESTAMP` (DEFAULT `CURRENT_TIMESTAMP` ON UPDATE `CURRENT_TIMESTAMP`) - Thời điểm cập nhật gần nhất.

### 2.4. Bảng `teacher_profiles`
*Lưu thông tin mở rộng đặc thù của Giảng viên. Quan hệ 1-1 với `users`.*
* **user_id**: `INT PRIMARY KEY` (PK, FK) - Vừa là khóa chính vừa là khóa ngoại liên kết tới `users(id)` (ON DELETE CASCADE).
* **academic_title**: `VARCHAR(100)` (NULL) - Học hàm (ví dụ: Phó Giáo sư, Giáo sư).
* **degree**: `VARCHAR(100)` (NULL) - Học vị (Thạc sĩ, Tiến sĩ).
* **department**: `VARCHAR(255)` (NOT NULL) - Khoa/Bộ môn trực thuộc giảng dạy.
* **created_at**: `TIMESTAMP` (DEFAULT `CURRENT_TIMESTAMP`) - Thời điểm tạo profile.
* **updated_at**: `TIMESTAMP` (DEFAULT `CURRENT_TIMESTAMP` ON UPDATE `CURRENT_TIMESTAMP`) - Thời điểm cập nhật gần nhất.

### 2.5. Bảng `auth_tokens`
*Lưu trữ các token xác thực một lần (OTP, Reset pass, Email verification).*
* **id**: `INT AUTO_INCREMENT` (PK) - Khóa chính tự tăng.
* **user_id**: `INT` (FK, NOT NULL) - Liên kết tới `users(id)` (ON DELETE CASCADE).
* **type**: `VARCHAR(50)` (NOT NULL) - Loại token (`'PASSWORD_RESET'`, `'ADMIN_OTP'`, `'EMAIL_VERIFY'`).
* **token_hash**: `VARCHAR(255)` (NOT NULL) - Giá trị mã hóa của token/OTP để so khớp.
* **expires_at**: `TIMESTAMP` (NOT NULL) - Hạn sử dụng của token.
* **used_at**: `TIMESTAMP` (NULL) - Thời điểm token đã được sử dụng thành công.
* **created_at**: `TIMESTAMP` (DEFAULT `CURRENT_TIMESTAMP`) - Thời điểm sinh token.

---

## 3. Ràng buộc & Chỉ mục tối ưu hóa (Constraints & Indexes)

### 3.1. Các khóa ngoại (Foreign Keys)
* `users.role_id` -> `roles.id`: Chặn xóa vai trò nếu vẫn đang được gán cho người dùng (`RESTRICT`).
* `users.approved_by` -> `users.id`: Thiết lập `SET NULL` khi Admin duyệt bị xóa khỏi hệ thống.
* `student_profiles.user_id` -> `users.id`: Xóa tài khoản `users` sẽ tự động xóa bản ghi profile tương ứng (`CASCADE`).
* `teacher_profiles.user_id` -> `users.id`: Tương tự (`CASCADE`).
* `auth_tokens.user_id` -> `users.id`: Xóa tài khoản `users` tự động hủy bỏ mọi token liên quan (`CASCADE`).

### 3.2. Ràng buộc Unique
* `roles.code` (Đảm bảo mã vai trò không trùng lặp).
* `users.email` (Đảm bảo một email chỉ đăng ký được 1 tài khoản).
* `student_profiles.student_code` (Đảm bảo mã số sinh viên là duy nhất).

### 3.3. Tối ưu hóa truy vấn bằng Index (Query Optimization)
Để tối ưu hóa hiệu năng tìm kiếm và kết nối dữ liệu thô, các index sau được thiết lập:

* Bảng `users`:
  - `idx_users_email` trên cột `email` (Tối ưu hóa luồng Đăng nhập, Quên mật khẩu).
  - `idx_users_status_role` trên cột (`status`, `role_id`) (Tối ưu hóa các câu lệnh Admin tìm kiếm và lọc danh sách tài khoản).
* Bảng `student_profiles`:
  - `idx_student_code` trên cột `student_code` (Tối ưu hóa tìm kiếm theo MSV).
* Bảng `auth_tokens`:
  - `idx_tokens_hash_type` trên cặp cột (`token_hash`, `type`) (Tối ưu hóa kiểm tra hợp lệ của token Reset mật khẩu hoặc OTP Admin).
