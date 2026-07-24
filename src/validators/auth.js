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

  const {
    email, password, fullName, phone, role, studentCode, dateOfBirth,
    academicTitle, degree, department
  } = body;

  if (typeof email !== 'string' || email.length > 254 || !emailRegex.test(email)) {
    return { error: 'Email không hợp lệ.' };
  }

  if (typeof password !== 'string' || password.length > 128 || !passwordRegex.test(password)) {
    return { error: 'Mật khẩu phải chứa tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt.' };
  }

  if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 150) {
    return { error: 'Họ và tên không được để trống.' };
  }

  if (!role || (role !== ROLES.STUDENT && role !== ROLES.TEACHER)) {
    return { error: 'Vai trò phải là STUDENT hoặc TEACHER.' };
  }

  if (phone !== undefined && phone !== null
    && (typeof phone !== 'string' || phone.length > 20)) {
    return { error: 'Số điện thoại không hợp lệ.' };
  }
  for (const [field, value, maxLength] of [
    ['academicTitle', academicTitle, 100], ['degree', degree, 100], ['department', department, 150]
  ]) {
    if (value !== undefined && value !== null
      && (typeof value !== 'string' || value.length > maxLength)) {
      return { error: `${field} không hợp lệ.` };
    }
  }

  if (role === ROLES.STUDENT) {
    if (typeof studentCode !== 'string' || !studentCode.trim() || studentCode.trim().length > 32) {
      return { error: 'Mã sinh viên là bắt buộc đối với Sinh viên.' };
    }
    if (typeof dateOfBirth !== 'string' || Number.isNaN(Date.parse(dateOfBirth))) {
      return { error: 'Ngày sinh không hợp lệ (Định dạng mẫu YYYY-MM-DD).' };
    }
  }

  return null; // Validated successfully
}

function validateForgotPassword(body) {
  if (typeof body?.email !== 'string' || body.email.length > 254 || !emailRegex.test(body.email)) {
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

  if (typeof email !== 'string' || !email.trim() || email.length > 254) {
    return { error: 'Email không được để trống.' };
  }
  if (typeof password !== 'string' || !password || password.length > 1024) {
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

  if (typeof email !== 'string' || email.length > 254 || !emailRegex.test(email)) {
    return { error: 'Email không hợp lệ.' };
  }
  if (typeof otpCode !== 'string' || !/^\d{6}$/.test(otpCode)) {
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

  if (typeof oldPassword !== 'string' || !oldPassword || oldPassword.length > 1024) {
    return { error: 'Mật khẩu cũ là bắt buộc.' };
  }
  if (typeof newPassword !== 'string' || newPassword.length > 128 || !passwordRegex.test(newPassword)) {
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

  if (typeof token !== 'string' || !token.trim() || token.length > 512) {
    return { error: 'Token khôi phục mật khẩu là bắt buộc.' };
  }
  if (typeof newPassword !== 'string' || newPassword.length > 128 || !passwordRegex.test(newPassword)) {
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
