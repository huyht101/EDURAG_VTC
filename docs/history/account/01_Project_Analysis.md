> **Historical draft — superseded by database schema 1.0.0 and current implementation.** Không dùng file này làm specification hiện hành.

# 01. Phân tích nghiệp vụ Account (Project Analysis)

Tài liệu này phân tích chi tiết về Actor, Vai trò (Role), Trạng thái tài khoản (Status) và Quy tắc nghiệp vụ (Business Rules) áp dụng cho Module Account thuộc hệ thống Trợ lý học tập RAG.

---

## 1. Actor & Role (Vai trò)
Hệ thống quản lý 3 nhóm đối tượng người dùng chính với các quyền hạn nghiệp vụ phân lớp:

1. **Sinh viên (STUDENT)**:
   - Là đối tượng học tập chính trong hệ thống.
   - Quyền hạn: Gửi câu hỏi cho AI trợ lý học tập, xem lại lịch sử trò chuyện cá nhân, xem nguồn trích dẫn tài liệu học tập.
2. **Giảng viên (TEACHER)**:
   - Là người cung cấp và quản lý học liệu.
   - Quyền hạn: Tải lên tài liệu giảng dạy, quản lý (ẩn/hiện/xóa) tài liệu do mình tải lên, đặt câu hỏi trò chuyện với AI trên tài liệu.
3. **Quản trị viên (ADMIN)**:
   - Là người quản trị vận hành toàn hệ thống.
   - Quyền hạn: Quản lý danh sách tài khoản người dùng, duyệt đăng ký của giảng viên, khóa/mở khóa tài khoản, quản lý toàn bộ kho tài liệu hệ thống, xem bảng thống kê sử dụng (dashboard).

---

## 2. Trạng thái người dùng (User Status)
Mỗi tài khoản người dùng trong hệ thống bắt buộc phải nằm ở một trong các trạng thái sau:

* **PENDING (Chờ duyệt)**: Trạng thái mặc định khi Giảng viên đăng ký tài khoản. Giảng viên ở trạng thái này chưa được phép đăng nhập.
* **ACTIVE (Đang hoạt động)**: Tài khoản ở trạng thái này được phép đăng nhập và sử dụng đầy đủ chức năng tương ứng với Role của mình. Sinh viên sau khi đăng ký thành công sẽ ở trạng thái ACTIVE ngay. Giảng viên sau khi được Admin phê duyệt sẽ chuyển sang ACTIVE.
* **LOCKED (Đã khóa)**: Tài khoản bị Admin khóa tạm thời hoặc vĩnh viễn do vi phạm quy định. Người dùng bị LOCKED sẽ không thể đăng nhập.
* **REJECTED (Bị từ chối)**: Đơn đăng ký giảng viên bị Admin từ chối. Tài khoản này không được đăng nhập.

---

## 3. Quy tắc nghiệp vụ (Business Rules)

### Đăng ký tài khoản (Registration)
* **Sinh viên**: Đăng ký thông qua cung cấp email, họ tên, mã sinh viên (student_code), ngày sinh và mật khẩu. Đăng ký thành công tài khoản sẽ tự động chuyển sang trạng thái `ACTIVE`.
* **Giảng viên**: Đăng ký thông qua cung cấp email, họ tên, học hàm (academic_title), học vị (degree), khoa/bộ môn (department) và mật khẩu. Đăng ký thành công tài khoản nằm ở trạng thái `PENDING` và cần Admin phê duyệt.

### Đăng nhập (Authentication)
* Hệ thống chỉ cấp mã JWT (JSON Web Token) cho các tài khoản có trạng thái là `ACTIVE`.
* Các tài khoản thuộc trạng thái `PENDING`, `LOCKED`, hoặc `REJECTED` khi thực hiện đăng nhập sẽ bị hệ thống từ chối và trả về mã lỗi cụ thể (ví dụ: `ACCOUNT_NOT_ACTIVE`, `ACCOUNT_LOCKED`).
* Mật khẩu lưu trữ bắt buộc được băm bằng thuật toán **bcrypt** trước khi lưu vào database.
* Admin đăng nhập sử dụng tài khoản được seed mặc định kết hợp mã OTP gửi qua email (xác thực 2 lớp tối giản).

### Phân quyền (Authorization)
* Hệ thống sử dụng Middleware xác thực JWT để giải mã thông tin token và gán đối tượng người dùng vào `req.user` theo định dạng chuẩn:
  ```json
  {
    "id": 1,
    "email": "user@example.com",
    "role": "STUDENT",
    "status": "ACTIVE"
  }
  ```
* Phân quyền gọi API (Role Permission) được kiểm soát bởi các Middleware phân quyền. MVP hiện chưa áp dụng phân quyền theo môn học hoặc lớp học của từng giảng viên hay sinh viên (tài liệu giảng viên tải lên là public trong hệ thống cho toàn bộ sinh viên ACTIVE tra cứu).

---

## 4. Bảng ma trận vai trò và quyền hạn (Role-Permission Matrix)

| Chức năng / API | STUDENT | TEACHER | ADMIN | Điều kiện trạng thái |
| :--- | :---: | :---: | :---: | :--- |
| **Đăng ký tài khoản** | Cho phép | Cho phép | Không áp dụng | Public |
| **Đăng nhập** | Cho phép | Cho phép | Cho phép | Chỉ áp dụng cho `ACTIVE` |
| **Quên & Đặt lại mật khẩu** | Cho phép | Cho phép | Cho phép | Mọi trạng thái |
| **Xem Profile cá nhân** | Cho phép | Cho phép | Cho phép | Chỉ `ACTIVE` |
| **Cập nhật Profile cá nhân** | Cho phép | Cho phép | Cho phép | Chỉ `ACTIVE` |
| **Trò chuyện AI (Chat)** | Cho phép | Cho phép | Không (Out of MVP)| Chỉ `ACTIVE` |
| **Xem trích dẫn (Citations)** | Cho phép | Cho phép | Không (Out of MVP)| Chỉ `ACTIVE` |
| **Upload tài liệu** | Từ chối | Cho phép | Cho phép | Chỉ `ACTIVE` |
| **Quản lý tài liệu cá nhân** | Từ chối | Cho phép | Cho phép | Chỉ `ACTIVE` |
| **Quản lý toàn bộ tài liệu** | Từ chối | Từ chối | Cho phép | Chỉ `ACTIVE` |
| **Duyệt giảng viên** | Từ chối | Từ chối | Cho phép | Chỉ `ACTIVE` (ADMIN) |
| **Khóa / Mở khóa tài khoản** | Từ chối | Từ chối | Cho phép | Chỉ `ACTIVE` (ADMIN) |
| **Xem danh sách User** | Từ chối | Từ chối | Cho phép | Chỉ `ACTIVE` (ADMIN) |
| **Dashboard & FinOps Logs** | Từ chối | Từ chối | Cho phép | Chỉ `ACTIVE` (ADMIN) |
