// Vanilla JavaScript Validation for Authentication Requests
const ROLES = require('../constants/roles');

// Helper to check email format
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Helper to check password complexity
// Tối thiểu 8 ký tự, ít nhất 1 chữ hoa, 1 chữ thường, 1 số và 1 ký tự đặc biệt
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

/**
 * Validate Register Body
 */
function validateRegister(body) {
  if (!body) return { error: 'Dữ liệu yêu cầu trống.' };

  const { email, password, fullName, role, studentCode, dateOfBirth } = body;

  if (!email || !emailRegex.test(email)) {
    return { error: 'Email không hợp lệ.' };
  }

  if (!password || !passwordRegex.test(password)) {
    return { error: 'Mật khẩu phải chứa tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt.' };
  }

  if (!fullName || fullName.trim() === '') {
    return { error: 'Họ và tên không được để trống.' };
  }

  if (!role || (role !== ROLES.STUDENT && role !== ROLES.TEACHER)) {
    return { error: 'Vai trò phải là STUDENT hoặc TEACHER.' };
  }

  if (role === ROLES.STUDENT) {
    if (!studentCode || studentCode.trim() === '') {
      return { error: 'Mã sinh viên là bắt buộc đối với Sinh viên.' };
    }
    if (!dateOfBirth || isNaN(Date.parse(dateOfBirth))) {
      return { error: 'Ngày sinh không hợp lệ (Định dạng mẫu YYYY-MM-DD).' };
    }
  }

  return null; // Validated successfully
}

function validateForgotPassword(body) {
  if (!body?.email || !emailRegex.test(body.email)) {
    return { error: 'Email không hợp lệ.' };
  }
  return null;
}

/**
 * Validate Login Body
 */
function validateLogin(body) {
  if (!body) return { error: 'Dữ liệu yêu cầu trống.' };
  const { email, password } = body;

  if (!email || email.trim() === '') {
    return { error: 'Email không được để trống.' };
  }
  if (!password || password.trim() === '') {
    return { error: 'Mật khẩu không được để trống.' };
  }
  return null;
}

/**
 * Validate OTP Verification Body
 */
function validateVerifyOtp(body) {
  if (!body) return { error: 'Dữ liệu yêu cầu trống.' };
  const { email, otpCode } = body;

  if (!email || !emailRegex.test(email)) {
    return { error: 'Email không hợp lệ.' };
  }
  if (!otpCode || !/^\d{6}$/.test(otpCode)) {
    return { error: 'Mã OTP phải là chuỗi gồm 6 chữ số.' };
  }
  return null;
}

/**
 * Validate Password Change Body
 */
function validateChangePassword(body) {
  if (!body) return { error: 'Dữ liệu yêu cầu trống.' };
  const { oldPassword, newPassword } = body;

  if (!oldPassword || oldPassword.trim() === '') {
    return { error: 'Mật khẩu cũ là bắt buộc.' };
  }
  if (!newPassword || !passwordRegex.test(newPassword)) {
    return { error: 'Mật khẩu mới không đủ độ phức tạp an toàn.' };
  }
  return null;
}

/**
 * Validate Password Reset Body
 */
function validateResetPassword(body) {
  if (!body) return { error: 'Dữ liệu yêu cầu trống.' };
  const { token, newPassword } = body;

  if (!token || token.trim() === '') {
    return { error: 'Token khôi phục mật khẩu là bắt buộc.' };
  }
  if (!newPassword || !passwordRegex.test(newPassword)) {
    return { error: 'Mật khẩu mới không đủ độ phức tạp an toàn.' };
  }
  return null;
}

module.exports = {
  validateRegister,
  validateLogin,
  validateForgotPassword,
  validateVerifyOtp,
  validateChangePassword,
  validateResetPassword
};
