> **Historical draft — superseded by database schema 1.0.0 and current implementation.** Không dùng file này làm specification hiện hành.

# 05. Script SQL Khởi tạo Cơ sở dữ liệu (SQL Script)

Tài liệu này cung cấp toàn bộ mã nguồn SQL thô dùng để thiết lập cấu trúc bảng (schema) và chèn dữ liệu mặc định ban đầu (seed) cho cơ sở dữ liệu MySQL của hệ thống.

---

## 1. SQL Script Khởi tạo Cấu trúc Bảng (schema.sql)

```sql
-- Hủy các bảng cũ nếu đã tồn tại để tránh xung đột (Thứ tự từ bảng phụ thuộc trước)
DROP TABLE IF EXISTS auth_tokens;
DROP TABLE IF EXISTS teacher_profiles;
DROP TABLE IF EXISTS student_profiles;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;

-- =========================================================================
-- 1. BẢNG roles (Vai trò hệ thống)
-- =========================================================================
CREATE TABLE roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================================
-- 2. BẢNG users (Tài khoản người dùng)
-- =========================================================================
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_id INT NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  email_verified_at TIMESTAMP NULL,
  approved_by INT NULL,
  approved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Thêm chỉ mục tăng tốc độ tìm kiếm đăng nhập và phân lọc danh sách admin
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status_role ON users(status, role_id);

-- =========================================================================
-- 3. BẢNG student_profiles (Thông tin chi tiết Sinh viên)
-- =========================================================================
CREATE TABLE student_profiles (
  user_id INT PRIMARY KEY,
  student_code VARCHAR(50) UNIQUE NOT NULL,
  date_of_birth DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Thêm chỉ mục tìm kiếm theo mã số sinh viên
CREATE INDEX idx_student_code ON student_profiles(student_code);

-- =========================================================================
-- 4. BẢNG teacher_profiles (Thông tin chi tiết Giảng viên)
-- =========================================================================
CREATE TABLE teacher_profiles (
  user_id INT PRIMARY KEY,
  academic_title VARCHAR(100) NULL,
  degree VARCHAR(100) NULL,
  department VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =========================================================================
-- 5. BẢNG auth_tokens (Các mã xác thực và OTP)
-- =========================================================================
CREATE TABLE auth_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Thêm chỉ mục kiểm tra token đăng nhập và reset password
CREATE INDEX idx_tokens_hash_type ON auth_tokens(token_hash, type);
```

---

## 2. SQL Script Chèn Dữ liệu Mặc định (seed.sql)

*Mật khẩu mặc định cho các tài khoản được seed dưới đây đều là: `123456` (đã được hash bằng bcrypt với salt rounds = 10: `$2b$10$IpmC.Rf/MgxphoxaTxuVleOmCU1hDxPwjWJRKef85FWylmkQmhKWq`)*.

```sql
-- =========================================================================
-- 1. CHÈN DỮ LIỆU BẢNG roles
-- =========================================================================
INSERT INTO roles (id, code, name, description) VALUES
(1, 'STUDENT', 'Sinh viên', 'Người học trong hệ thống, thực hiện chat và xem citation.'),
(2, 'TEACHER', 'Giảng viên', 'Người dạy, upload quản lý tài liệu và chat.'),
(3, 'ADMIN', 'Quản trị viên', 'Quản lý tài khoản, quản lý tài liệu hệ thống và dashboard.');

-- =========================================================================
-- 2. SEED TÀI KHOẢN ADMIN MẶC ĐỊNH (status = 'ACTIVE')
-- =========================================================================
INSERT INTO users (id, role_id, full_name, email, password_hash, status, email_verified_at) VALUES
(1, 3, 'Hệ thống Admin', 'admin@gmail.com', '$2b$10$IpmC.Rf/MgxphoxaTxuVleOmCU1hDxPwjWJRKef85FWylmkQmhKWq', 'ACTIVE', NOW());

-- =========================================================================
-- 3. SEED TÀI KHOẢN GIẢNG VIÊN MẪU (status = 'ACTIVE' - Dùng để test)
-- =========================================================================
INSERT INTO users (id, role_id, full_name, email, password_hash, status, email_verified_at, approved_by, approved_at) VALUES
(2, 2, 'Nguyễn Văn A', 'teacher@gmail.com', '$2b$10$IpmC.Rf/MgxphoxaTxuVleOmCU1hDxPwjWJRKef85FWylmkQmhKWq', 'ACTIVE', NOW(), 1, NOW());

INSERT INTO teacher_profiles (user_id, academic_title, degree, department) VALUES
(2, 'Phó Giáo sư', 'Tiến sĩ', 'Khoa Công nghệ thông tin');

-- =========================================================================
-- 4. SEED TÀI KHOẢN SINH VIÊN MẪU (status = 'ACTIVE' - Dùng để test)
-- =========================================================================
INSERT INTO users (id, role_id, full_name, email, password_hash, status, email_verified_at) VALUES
(3, 1, 'Trần Minh B', 'student@gmail.com', '$2b$10$IpmC.Rf/MgxphoxaTxuVleOmCU1hDxPwjWJRKef85FWylmkQmhKWq', 'ACTIVE', NOW());

INSERT INTO student_profiles (user_id, student_code, date_of_birth) VALUES
(3, 'SV123456', '2004-09-15');
```
