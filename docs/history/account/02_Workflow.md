> **Historical draft — superseded by database schema 1.0.0 and current implementation.** Không dùng file này làm specification hiện hành.

# 02. Quy trình nghiệp vụ (Workflow)

Tài liệu này chi tiết hóa các luồng nghiệp vụ (Workflows) thuộc Module Account. Mỗi quy trình bao gồm mô tả, dữ liệu đầu vào (Input), đầu ra (Output), quy tắc nghiệp vụ (Business Rules), lưu đồ (Flowchart) và sơ đồ tuần tự (Sequence Diagram).

---

## 1. Đăng ký tài khoản Sinh viên (Student Register)

### Mô tả
Sinh viên đăng ký tài khoản mới để tham gia học tập và tương tác với AI.

* **Input:** `email` (string), `password` (string), `fullName` (string), `studentCode` (string, MSV), `dateOfBirth` (date: YYYY-MM-DD).
* **Output:** Tài khoản được tạo thành công với trạng thái `ACTIVE` kèm profile Sinh viên.
* **Quy tắc nghiệp vụ:**
  - `email` và `studentCode` phải là duy nhất (unique) trong hệ thống.
  - Tài khoản tự động ở trạng thái `ACTIVE` ngay sau khi tạo thành công.
  - Mật khẩu phải được hash bằng bcrypt trước khi lưu trữ.

### Lưu đồ (Flowchart)
```mermaid
graph TD
    A[Bắt đầu] --> B[Nhận Request Đăng ký]
    B --> C{Validate dữ liệu?}
    C -- Không --> D[Trả về lỗi Validation]
    C -- Có --> E{Kiểm tra Email & MSV đã tồn tại?}
    E -- Có --> F[Trả về lỗi Trùng lặp dữ liệu]
    E -- Không --> G[Mã hóa mật khẩu bằng bcrypt]
    G --> H[Thêm User mới vào MySQL status='ACTIVE']
    H --> I[Thêm thông tin Profile Sinh viên]
    I --> J[Trả về kết quả Thành công]
```

### Sơ đồ tuần tự (Sequence Diagram)
```mermaid
sequenceDiagram
    actor Student as Sinh viên
    participant Ctrl as AuthController
    participant Svc as AuthService
    participant Repo as UserRepository
    participant DB as MySQL DB

    Student->>Ctrl: POST /api/auth/register (role="STUDENT")
    Ctrl->>Ctrl: Kiểm tra tính hợp lệ của dữ liệu đầu vào
    Ctrl->>Svc: registerStudent(data)
    Svc->>Repo: findByEmailOrCode(email, studentCode)
    Repo->>DB: SELECT check
    DB-->>Repo: Kết quả
    Repo-->>Svc: Tồn tại/Không tồn tại
    alt Đã tồn tại
        Svc-->>Ctrl: Throw Error (DUPLICATE_DATA)
        Ctrl-->>Student: Trả về 409 Conflict
    else Chưa tồn tại
        Svc->>Svc: Hash password (bcrypt)
        Svc->>Repo: createUserAndStudentProfile(data)
        Repo->>DB: INSERT into users & student_profiles
        DB-->>Repo: OK
        Repo-->>Svc: OK
        Svc-->>Ctrl: OK
        Ctrl-->>Student: Trả về 201 Created (success: true)
    end
```

---

## 2. Đăng ký tài khoản Giảng viên (Teacher Register)

### Mô tả
Giảng viên đăng ký tài khoản mới để tải học liệu lên hệ thống.

* **Input:** `email` (string), `password` (string), `fullName` (string), `academicTitle` (string, optional), `degree` (string, optional), `department` (string).
* **Output:** Tài khoản được tạo ở trạng thái `PENDING` và gửi yêu cầu phê duyệt đến Admin.
* **Quy tắc nghiệp vụ:**
  - `email` phải là duy nhất.
  - Tài khoản ở trạng thái `PENDING`. Giảng viên chưa thể đăng nhập cho đến khi được Admin phê duyệt.

### Lưu đồ (Flowchart)
```mermaid
graph TD
    A[Bắt đầu] --> B[Nhận Request Đăng ký]
    B --> C{Validate dữ liệu?}
    C -- Không --> D[Trả về lỗi Validation]
    C -- Có --> E{Kiểm tra Email đã tồn tại?}
    E -- Có --> F[Trả về lỗi Trùng lặp email]
    E -- Không --> G[Mã hóa mật khẩu bằng bcrypt]
    G --> H[Thêm User mới vào MySQL status='PENDING']
    H --> I[Thêm thông tin Profile Giảng viên]
    I --> J[Trả về thành công - Chờ phê duyệt]
```

### Sơ đồ tuần tự (Sequence Diagram)
```mermaid
sequenceDiagram
    actor Teacher as Giảng viên
    participant Ctrl as AuthController
    participant Svc as AuthService
    participant Repo as UserRepository
    participant DB as MySQL DB

    Teacher->>Ctrl: POST /api/auth/register (role="TEACHER")
    Ctrl->>Ctrl: Kiểm tra tính hợp lệ dữ liệu
    Ctrl->>Svc: registerTeacher(data)
    Svc->>Repo: findUserByEmail(email)
    Repo->>DB: SELECT check email
    DB-->>Repo: Kết quả
    Repo-->>Svc: Tồn tại/Không tồn tại
    alt Đã tồn tại
        Svc-->>Ctrl: Throw Error (EMAIL_ALREADY_EXISTS)
        Ctrl-->>Teacher: Trả về 409 Conflict
    else Chưa tồn tại
        Svc->>Svc: Hash password (bcrypt)
        Svc->>Repo: createUserAndTeacherProfile(data)
        Repo->>DB: INSERT into users (status='PENDING') & teacher_profiles
        DB-->>Repo: OK
        Repo-->>Svc: OK
        Svc-->>Ctrl: OK
        Ctrl-->>Teacher: Trả về 201 Created (success: true, status="PENDING")
    end
```

---

## 3. Đăng nhập (Login)

### Mô tả
Đăng nhập vào hệ thống để lấy mã xác thực JWT.

* **Input:** `email` (string), `password` (string).
* **Output:** JWT Token (nếu thành công).
* **Quy tắc nghiệp vụ:**
  - Tài khoản đăng nhập phải ở trạng thái `ACTIVE`.
  - Nếu trạng thái là `PENDING`, `LOCKED` hoặc `REJECTED`, từ chối đăng nhập và báo lỗi tương ứng.
  - So khớp mật khẩu đã hash qua `bcrypt.compare`.

### Lưu đồ (Flowchart)
```mermaid
graph TD
    A[Bắt đầu] --> B[Nhận Request Login]
    B --> C[Kiểm tra Email trong DB]
    C --> D{User tồn tại?}
    D -- Không --> E[Trả về lỗi Sai tài khoản/mật khẩu]
    D -- Có --> F{bcrypt.compare đúng?}
    F -- Không --> E
    F -- Có --> G{Trạng thái == ACTIVE?}
    G -- Không (PENDING) --> H[Trả lỗi Tài khoản chưa được duyệt]
    G -- Không (LOCKED) --> I[Trả lỗi Tài khoản bị khóa]
    G -- Không (REJECTED) --> J[Trả lỗi Yêu cầu đăng ký bị từ chối]
    G -- Có (ACTIVE) --> K[Tạo và trả về JWT token]
```

### Sơ đồ tuần tự (Sequence Diagram)
```mermaid
sequenceDiagram
    actor User as Người dùng
    participant Ctrl as AuthController
    participant Svc as AuthService
    participant Repo as UserRepository
    participant DB as MySQL DB

    User->>Ctrl: POST /api/auth/login
    Ctrl->>Svc: login(email, password)
    Svc->>Repo: findUserByEmail(email)
    Repo->>DB: SELECT users
    DB-->>Repo: User record
    Repo-->>Svc: User record
    alt User không tồn tại
        Svc-->>Ctrl: Throw Error (INVALID_CREDENTIALS)
        Ctrl-->>User: Trả về 401 Unauthorized
    else User tồn tại
        Svc->>Svc: bcrypt.compare(password, password_hash)
        alt Mật khẩu sai
            Svc-->>Ctrl: Throw Error (INVALID_CREDENTIALS)
            Ctrl-->>User: Trả về 401 Unauthorized
        else Mật khẩu đúng
            alt Trạng thái không phải ACTIVE
                Svc-->>Ctrl: Throw Error (ACCOUNT_NOT_ACTIVE / LOCKED)
                Ctrl-->>User: Trả về 403 Forbidden
            else Trạng thái ACTIVE
                Svc->>Svc: Sinh JWT token
                Svc-->>Ctrl: Return JWT Token & User Info
                Ctrl-->>User: Trả về 200 OK (Token)
            end
        end
    end
```

---

## 4. Đăng xuất (Logout)

### Mô tả
Đăng xuất tài khoản người dùng và hủy phiên đăng nhập ở Client.

* **Input:** JWT token gửi kèm trong HTTP Header.
* **Output:** Trả về thông báo đăng xuất thành công.
* **Quy tắc nghiệp vụ:**
  - Vì JWT là stateless, Client chỉ cần tự xóa token ở local storage.
  - Về phía server, ghi nhận nhật ký (nếu có) hoặc phản hồi thành công trực tiếp.

### Sơ đồ tuần tự (Sequence Diagram)
```mermaid
sequenceDiagram
    actor User as Người dùng
    participant BE as Node.js Backend

    User->>BE: POST /api/auth/logout (JWT Header)
    BE->>BE: Xác thực token hợp lệ
    BE-->>User: Trả về 200 OK (Xóa Token thành công)
    Note over User: Xóa JWT khỏi bộ nhớ local
```

---

## 5. Xác thực JWT (JWT Authentication)

### Mô tả
Middleware kiểm tra tính hợp lệ của JWT gửi kèm trong mỗi request cần bảo mật.

* **Input:** Header `Authorization: Bearer <token>`.
* **Output:** `req.user` chứa dữ liệu người dùng giải mã được, hoặc từ chối request.
* **Quy tắc nghiệp vụ:**
  - Giải mã và kiểm tra hạn dùng của token.
  - Truy vấn database để đảm bảo user đó vẫn tồn tại và vẫn có trạng thái `ACTIVE` (phòng trường hợp tài khoản bị khóa đột xuất).
  - Gán dữ liệu vào `req.user` theo format: `{ id, email, role, status }`.

### Sơ đồ tuần tự (Sequence Diagram)
```mermaid
sequenceDiagram
    actor Client as Người dùng
    participant Mid as AuthMiddleware
    participant Repo as UserRepository
    participant DB as MySQL DB
    participant API as API Handler

    Client->>Mid: Gọi API cần bảo mật (JWT Header)
    alt Token không hợp lệ / Thiếu
        Mid-->>Client: Trả về 401 Unauthorized
    else Token hợp lệ
        Mid->>Mid: Giải mã Token lấy user_id
        Mid->>Repo: findUserById(user_id)
        Repo->>DB: SELECT status, role
        DB-->>Repo: User record
        Repo-->>Mid: User record
        alt User không tồn tại hoặc status != 'ACTIVE'
            Mid-->>Client: Trả về 403 Forbidden (Tài khoản bị khóa)
        else Hợp lệ
            Mid->>Mid: Gán req.user = { id, email, role, status }
            Mid->>API: Next() sang API Handler
            API-->>Client: Trả về kết quả API
        end
    end
```

---

## 6. Phân quyền truy cập (Authorization)

### Mô tả
Middleware kiểm tra quyền hạn của người dùng đối với API endpoint.

* **Input:** `req.user.role` (từ Auth Middleware), danh sách các roles được phép truy cập endpoint.
* **Output:** Cho phép xử lý tiếp hoặc trả về lỗi phân quyền.
* **Quy tắc nghiệp vụ:**
  - Nếu `req.user.role` nằm trong danh sách được phép -> đi tiếp.
  - Ngược lại -> Trả lỗi 403 Forbidden (`PERMISSION_DENIED`).

### Sơ đồ tuần tự (Sequence Diagram)
```mermaid
sequenceDiagram
    participant Ctrl as Express Route
    participant Mid as RoleMiddleware
    participant API as API Handler

    Ctrl->>Mid: req.user (role) + Allowed Roles (e.g. ['ADMIN'])
    alt role có trong Allowed Roles
        Mid->>API: Next() sang API Handler
    else role không có quyền
        Mid-->>Ctrl: Trả về 403 Forbidden (PERMISSION_DENIED)
    end
```

---

## 7. Quên mật khẩu (Forgot Password)

### Mô tả
Yêu cầu cấp lại mật khẩu thông qua Email xác thực.

* **Input:** `email` (string).
* **Output:** Tạo token reset password và gửi email cho người dùng.
* **Quy tắc nghiệp vụ:**
  - Kiểm tra email có tồn tại trong hệ thống.
  - Tạo một mã token ngẫu nhiên, lưu hash vào bảng `auth_tokens` (type `PASSWORD_RESET`), cài đặt thời gian hết hạn (ví dụ: 15 phút).
  - Mô phỏng gửi email chứa liên kết dạng `/reset-password?token=<raw_token>`.

### Sơ đồ tuần tự (Sequence Diagram)
```mermaid
sequenceDiagram
    actor User as Người dùng
    participant Ctrl as AuthController
    participant Svc as AuthService
    participant TokenRepo as TokenRepository
    participant DB as MySQL DB

    User->>Ctrl: POST /api/auth/forgot-password (email)
    Ctrl->>Svc: requestPasswordReset(email)
    Svc->>DB: SELECT check email
    alt Email không tồn tại
        Svc-->>Ctrl: Throw Error (EMAIL_NOT_FOUND)
        Ctrl-->>User: Trả về 404 Not Found
    else Email hợp lệ
        Svc->>Svc: Sinh token ngẫu nhiên (crypto.randomBytes)
        Svc->>TokenRepo: saveToken(user_id, token_hash, 'PASSWORD_RESET', expires_at)
        TokenRepo->>DB: INSERT into auth_tokens
        DB-->>TokenRepo: OK
        Svc->>Svc: Gửi email link chứa token (Mock Email Service)
        Svc-->>Ctrl: OK
        Ctrl-->>User: Trả về 200 OK (Đã gửi link reset)
    end
```

---

## 8. Đặt lại mật khẩu (Reset Password)

### Mô tả
Đặt lại mật khẩu mới sử dụng token được cung cấp từ email.

* **Input:** `token` (string), `newPassword` (string).
* **Output:** Mật khẩu được cập nhật thành công.
* **Quy tắc nghiệp vụ:**
  - Token phải khớp với dữ liệu lưu trong `auth_tokens`, chưa được sử dụng (`used_at IS NULL`) và chưa hết hạn (`expires_at > NOW()`).
  - Hash mật khẩu mới bằng bcrypt, cập nhật cột `password_hash` của user.
  - Đánh dấu token đã được sử dụng (`used_at = NOW()`).

### Sơ đồ tuần tự (Sequence Diagram)
```mermaid
sequenceDiagram
    actor User as Người dùng
    participant Ctrl as AuthController
    participant Svc as AuthService
    participant TokenRepo as TokenRepository
    participant UserRepo as UserRepository
    participant DB as MySQL DB

    User->>Ctrl: POST /api/auth/reset-password
    Ctrl->>Svc: resetPassword(token, newPassword)
    Svc->>TokenRepo: findValidToken(token, 'PASSWORD_RESET')
    TokenRepo->>DB: SELECT from auth_tokens
    DB-->>TokenRepo: Token record
    TokenRepo-->>Svc: Token record
    alt Token không tìm thấy / Hết hạn / Đã dùng
        Svc-->>Ctrl: Throw Error (INVALID_OR_EXPIRED_TOKEN)
        Ctrl-->>User: Trả về 400 Bad Request
    else Token hợp lệ
        Svc->>Svc: Hash mật khẩu mới
        Svc->>UserRepo: updatePassword(user_id, new_password_hash)
        UserRepo->>DB: UPDATE users SET password_hash
        Svc->>TokenRepo: markTokenAsUsed(token_id)
        TokenRepo->>DB: UPDATE auth_tokens SET used_at = NOW()
        Svc-->>Ctrl: OK
        Ctrl-->>User: Trả về 200 OK (Đặt lại mật khẩu thành công)
    end
```

---

## 9. Đổi mật khẩu (Change Password)

### Mô tả
Đổi mật khẩu khi đang đăng nhập hệ thống.

* **Input:** `oldPassword` (string), `newPassword` (string) kèm theo JWT xác thực.
* **Output:** Mật khẩu được cập nhật thành công.
* **Quy tắc nghiệp vụ:**
  - So khớp `oldPassword` với mật khẩu hiện tại trong database.
  - Hash mật khẩu mới và lưu vào bảng `users`.

### Sơ đồ tuần tự (Sequence Diagram)
```mermaid
sequenceDiagram
    actor User as Người dùng
    participant Ctrl as ProfileController
    participant Svc as UserService
    participant Repo as UserRepository
    participant DB as MySQL DB

    User->>Ctrl: PUT /api/profile/password (JWT Header)
    Ctrl->>Svc: changePassword(user_id, oldPassword, newPassword)
    Svc->>Repo: findPasswordHashById(user_id)
    Repo->>DB: SELECT password_hash
    DB-->>Repo: Hash
    alt oldPassword không khớp hash
        Svc-->>Ctrl: Throw Error (INCORRECT_OLD_PASSWORD)
        Ctrl-->>User: Trả về 400 Bad Request
    else Khớp hash
        Svc->>Svc: Hash newPassword
        Svc->>Repo: updatePassword(user_id, new_hash)
        Repo->>DB: UPDATE users SET password_hash
        Svc-->>Ctrl: OK
        Ctrl-->>User: Trả về 200 OK (Cập nhật thành công)
    end
```

---

## 10. Xem Profile cá nhân (View Profile)

### Mô tả
Xem thông tin chi tiết của tài khoản hiện tại.

* **Input:** JWT Token xác thực.
* **Output:** Thông tin User cơ bản cùng thông tin Profile chi tiết (Sinh viên hoặc Giảng viên).
* **Quy tắc nghiệp vụ:**
  - Dựa vào role của user trong token để LEFT JOIN sang bảng profile tương ứng (`student_profiles` hoặc `teacher_profiles`).

### Sơ đồ tuần tự (Sequence Diagram)
```mermaid
sequenceDiagram
    actor User as Người dùng
    participant Ctrl as ProfileController
    participant Svc as UserService
    participant Repo as UserRepository
    participant DB as MySQL DB

    User->>Ctrl: GET /api/profile (JWT Header)
    Ctrl->>Svc: getUserProfile(user_id, role)
    Svc->>Repo: findProfileDetail(user_id, role)
    Repo->>DB: SELECT users LEFT JOIN student/teacher profile
    DB-->>Repo: Kết quả
    Repo-->>Svc: Dữ liệu Profile
    Svc-->>Ctrl: Dữ liệu Profile
    Ctrl-->>User: Trả về 200 OK (Dữ liệu profile)
```

---

## 11. Cập nhật Profile cá nhân (Update Profile)

### Mô tả
Cập nhật các thông tin cá nhân.

* **Input:** `fullName` (string), `phone` (string), `academicTitle` (string, optional - đối với GV), `degree` (string, optional - đối với GV), `department` (string, optional - đối với GV).
* **Output:** Trả về thông tin profile mới nhất.
* **Quy tắc nghiệp vụ:**
  - Sinh viên không được phép sửa mã sinh viên (`student_code`) hay ngày sinh (`date_of_birth`) trong MVP.
  - Giảng viên được phép cập nhật chức danh học hàm, học vị, khoa bộ môn.

### Sơ đồ tuần tự (Sequence Diagram)
```mermaid
sequenceDiagram
    actor User as Người dùng
    participant Ctrl as ProfileController
    participant Svc as UserService
    participant Repo as UserRepository
    participant DB as MySQL DB

    User->>Ctrl: PUT /api/profile (JWT Header)
    Ctrl->>Svc: updateProfile(user_id, role, data)
    alt Cập nhật bảng users
        Svc->>Repo: updateBasicInfo(user_id, fullName, phone)
        Repo->>DB: UPDATE users
    end
    alt Là Giảng viên -> Cập nhật bảng teacher_profiles
        Svc->>Repo: updateTeacherProfile(user_id, title, degree, dept)
        Repo->>DB: UPDATE teacher_profiles
    end
    Svc-->>Ctrl: OK
    Ctrl-->>User: Trả về 200 OK (Cập nhật thành công)
```

---

## 12. Duyệt giảng viên (Teacher Approval)

### Mô tả
Admin phê duyệt hoặc từ chối đơn đăng ký tài khoản của Giảng viên.

* **Input:** `userId` (int), `status` (string: 'ACTIVE' hoặc 'REJECTED') kèm theo token Admin.
* **Output:** Tài khoản giảng viên được cập nhật trạng thái.
* **Quy tắc nghiệp vụ:**
  - Chỉ Admin mới gọi được API này.
  - Tài khoản đích phải ở trạng thái `PENDING` và có vai trò là `TEACHER`.
  - Cập nhật thêm trường `approved_by` (ID của Admin duyệt) và `approved_at` (thời điểm duyệt).

### Lưu đồ (Flowchart)
```mermaid
graph TD
    A[Bắt đầu] --> B[Admin gửi lệnh phê duyệt userId + status]
    B --> C{Kiểm tra quyền Admin?}
    C -- Không --> D[Trả về lỗi 403 Forbidden]
    C -- Có --> E[Kiểm tra User trong DB]
    E --> F{Tồn tại & có role=TEACHER & status=PENDING?}
    F -- Không --> G[Trả về lỗi Bad Request]
    F -- Có --> H[Cập nhật status=ACTIVE hoặc REJECTED]
    H --> I[Lưu approved_by=admin_id và approved_at=NOW]
    I --> J[Trả về thành công]
```

### Sơ đồ tuần tự (Sequence Diagram)
```mermaid
sequenceDiagram
    actor Admin as Quản trị viên
    participant Ctrl as AdminController
    participant Svc as UserService
    participant Repo as UserRepository
    participant DB as MySQL DB

    Admin->>Ctrl: PUT /api/admin/users/:id/status (Duyệt/Từ chối)
    Ctrl->>Svc: approveTeacher(teacher_id, status, admin_id)
    Svc->>Repo: findUserById(teacher_id)
    Repo->>DB: SELECT user
    DB-->>Repo: User record
    alt User không tồn tại / Không phải TEACHER / Không phải PENDING
        Svc-->>Ctrl: Throw Error (INVALID_TARGET)
        Ctrl-->>Admin: Trả về 400 Bad Request
    else Hợp lệ
        Svc->>Repo: updateTeacherStatus(teacher_id, status, admin_id)
        Repo->>DB: UPDATE users SET status, approved_by, approved_at
        DB-->>Repo: OK
        Svc-->>Ctrl: OK
        Ctrl-->>Admin: Trả về 200 OK (Thành công)
    end
```

---

## 13. Khóa tài khoản người dùng (Lock User)

### Mô tả
Admin thực hiện khóa tài khoản của người dùng (Sinh viên hoặc Giảng viên).

* **Input:** `userId` (int) của tài khoản cần khóa.
* **Output:** Tài khoản được khóa thành công (`status` = `LOCKED`).
* **Quy tắc nghiệp vụ:**
  - Chỉ Admin mới có quyền gọi.
  - Không thể tự khóa chính mình (Admin tự khóa).
  - Tài khoản sau khi bị khóa sẽ không thể đăng nhập hoặc thực hiện bất kỳ thao tác nào cần JWT xác thực.

### Sơ đồ tuần tự (Sequence Diagram)
```mermaid
sequenceDiagram
    actor Admin as Quản trị viên
    participant Ctrl as AdminController
    participant Svc as UserService
    participant Repo as UserRepository
    participant DB as MySQL DB

    Admin->>Ctrl: PUT /api/admin/users/:id/status (status="LOCKED")
    Ctrl->>Svc: lockUser(target_id, admin_id)
    alt target_id == admin_id
        Svc-->>Ctrl: Throw Error (CANNOT_LOCK_SELF)
        Ctrl-->>Admin: Trả về 400 Bad Request
    else Hợp lệ
        Svc->>Repo: updateStatus(target_id, 'LOCKED')
        Repo->>DB: UPDATE users SET status = 'LOCKED'
        DB-->>Repo: OK
        Svc-->>Ctrl: OK
        Ctrl-->>Admin: Trả về 200 OK (Đã khóa tài khoản)
    end
```

---

## 14. Mở khóa tài khoản người dùng (Unlock User)

### Mô tả
Admin thực hiện mở khóa cho một tài khoản bị khóa trước đó.

* **Input:** `userId` (int) của tài khoản cần mở khóa.
* **Output:** Tài khoản được kích hoạt lại (`status` = `ACTIVE`).
* **Quy tắc nghiệp vụ:**
  - Chỉ Admin mới có quyền gọi.
  - Cập nhật trạng thái tài khoản đích về `ACTIVE`.

### Sơ đồ tuần tự (Sequence Diagram)
```mermaid
sequenceDiagram
    actor Admin as Quản trị viên
    participant Ctrl as AdminController
    participant Svc as UserService
    participant Repo as UserRepository
    participant DB as MySQL DB

    Admin->>Ctrl: PUT /api/admin/users/:id/status (status="ACTIVE")
    Ctrl->>Svc: unlockUser(target_id)
    Svc->>Repo: updateStatus(target_id, 'ACTIVE')
    Repo->>DB: UPDATE users SET status = 'ACTIVE'
    DB-->>Repo: OK
    Svc-->>Ctrl: OK
    Ctrl-->>Admin: Trả về 200 OK (Đã mở khóa tài khoản)
```

---

## 15. Quản lý danh sách người dùng (CRUD User - Admin perspective)

### Mô tả
Admin xem danh sách, chi tiết, cập nhật thông tin hoặc xóa tài khoản người dùng.

* **Input:** Các query parameters (page, limit, search, role, status).
* **Output:** Danh sách người dùng được lọc và phân trang.
* **Quy tắc nghiệp vụ:**
  - Phân trang chuẩn (trả về `total`, `page`, `limit`, `data`).
  - Hỗ trợ tìm kiếm theo họ tên hoặc email.
  - Hỗ trợ lọc theo `role` (STUDENT/TEACHER) và `status` (PENDING/ACTIVE/LOCKED/REJECTED).
