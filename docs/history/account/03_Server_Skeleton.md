> **Historical draft — superseded by database schema 1.0.0 and current implementation.** Không dùng file này làm specification hiện hành.

# 03. Cấu trúc thư mục Server (Server Skeleton)

Tài liệu này định nghĩa cấu trúc thư mục của NodeJS Backend cho dự án và làm rõ nhiệm vụ của từng lớp (layer) trong kiến trúc phân tầng.

---

## 1. Cấu trúc thư mục đề xuất (Project Structure)

Toàn bộ mã nguồn ứng dụng sẽ được lưu giữ trong thư mục `src/` để đảm bảo tính gọn gàng và dễ phân vùng đóng gói:

```text
ProjectVTC/
├── docs/                      # Thư mục lưu trữ tài liệu kỹ thuật
│   └── account/               # Tài liệu thiết kế module Account
├── src/                       # Mã nguồn NodeJS Backend
│   ├── configs/               # Cấu hình hệ thống (DB, JWT, Port,...)
│   ├── constants/             # Khai báo các hằng số (Roles, Statuses, Error Codes)
│   ├── controllers/           # Tầng điều khiển: tiếp nhận request, gọi service, trả response
│   ├── database/              # SQL scripts cho schema và seed
│   ├── middlewares/           # Bộ lọc trung gian (Auth, Role, Error Handler, Validator)
│   ├── repositories/          # Tầng truy xuất DB: Viết SQL Query thô và Parameterized Query
│   ├── routes/                # Khai báo các API Route
│   ├── services/              # Tầng xử lý logic nghiệp vụ chính (Business Logic)
│   ├── utils/                 # Các hàm tiện ích dùng chung (Bcrypt, JWT helpers)
│   ├── validators/            # Các schema hoặc hàm kiểm tra hợp lệ dữ liệu
│   ├── app.js                 # Cấu hình Express App
│   └── server.js              # Điểm khởi chạy (Entry Point) của Server
├── Dockerfile                 # Cấu hình Docker image cho NodeJS App
├── docker-compose.yml         # Compose file khởi chạy MySQL và Qdrant
├── .env.example               # Khai báo các biến môi trường mẫu
└── README.md                  # Hướng dẫn khởi chạy dự án
```

---

## 2. Giải thích vai trò của từng thư mục (Directory Responsibilities)

### 2.1. Tầng Routing (`src/routes/`)
* **Vai trò:** Khai báo các endpoint URL và phương thức HTTP (GET, POST, PUT, DELETE).
* **Nhiệm vụ:** Áp dụng các Middleware xác thực, kiểm tra quyền và middleware kiểm tra dữ liệu trước khi chuyển tiếp dữ liệu đến Controller tương ứng.

### 2.2. Tầng Controller (`src/controllers/`)
* **Vai trò:** Đóng vai trò là điểm giao tiếp trực tiếp với Client (giao thức HTTP).
* **Nhiệm vụ:**
  - Lấy dữ liệu từ Request (params, query, body).
  - Gọi các hàm nghiệp vụ ở tầng Service.
  - Sử dụng middleware hoặc helper response để định dạng câu trả lời trả về Client (success/error format).
  - **Quy tắc bắt buộc:** Nghiêm cấm viết câu lệnh SQL hoặc xử lý nghiệp vụ phức tạp trực tiếp trong Controller.

### 2.3. Tầng Service (`src/services/`)
* **Vai trò:** Nơi chứa toàn bộ mã nguồn xử lý logic nghiệp vụ của dự án (Business Logic Layer).
* **Nhiệm vụ:**
  - Nhận tham số đầu vào từ Controller.
  - Gọi các hàm truy vấn dữ liệu từ Repository Layer.
  - Xử lý các phép tính toán nghiệp vụ, so khớp mật khẩu, sinh token JWT, gửi email.
  - Ném ra các lỗi nghiệp vụ (ví dụ: `Email đã tồn tại`, `Mật khẩu cũ không chính xác`) để controller bắt và trả về.
  - **Quy tắc bắt buộc:** Tầng Service độc lập với giao thức HTTP (không chứa các đối tượng `req`, `res`).

### 2.4. Tầng Repository (`src/repositories/`)
* **Vai trò:** Tầng làm việc trực tiếp với Cơ sở dữ liệu (Database Access Layer).
* **Nhiệm vụ:**
  - Nhận yêu cầu và các tham số truy vấn từ tầng Service.
  - Viết các câu lệnh SQL thô (Raw SQL) có sử dụng tham số hóa (**Parameterized Query**: `?`) để thực hiện các thao tác CRUD.
  - **Quy tắc bắt buộc:** Đây là nơi duy nhất được phép viết các câu lệnh SQL. Không sử dụng bất kỳ thư viện ORM nào.

### 2.5. Tầng Middleware (`src/middlewares/`)
* **Vai trò:** Bộ lọc trung gian xử lý request trước khi vào controller hoặc sau khi controller ném ra lỗi.
* **Nhiệm vụ:**
  - `auth-middleware.js`: Kiểm tra token JWT và lấy thông tin user đính vào `req.user`.
  - `role-middleware.js`: Phân quyền truy cập tài nguyên.
  - `validate-middleware.js`: Validate dữ liệu đầu vào.
  - `error-middleware.js`: Xử lý tập trung các lỗi phát sinh (Global Error Handler) để tránh crash ứng dụng.

### 2.6. Tầng Cấu hình (`src/configs/`)
* **Vai trò:** Quản lý cấu hình toàn bộ hệ thống.
* **Nhiệm vụ:** Khởi tạo kết nối MySQL Connection Pool (`db.js`), cấu hình các tham số JWT (`auth.js`), và lấy các biến từ file `.env` qua thư viện `dotenv`.

### 2.7. Tầng Database (`src/database/`)
* **Vai trò:** Quản lý cấu trúc bảng dữ liệu.
* **Nhiệm vụ:** Lưu trữ file `schema.sql` (câu lệnh khởi tạo bảng, khóa ngoại, index) và file `seed.sql` (chèn dữ liệu mẫu cho Roles và tài khoản Admin mặc định).
