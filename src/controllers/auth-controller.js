// Auth Controller - HTTP layer for authentication endpoints
const authService = require('../services/auth-service');
const ROLES = require('../constants/roles');

/**
 * POST /api/auth/register
 */
async function register(req, res, next) {
  try {
    const { role } = req.body;
    let result;

    if (role === ROLES.STUDENT) {
      result = await authService.registerStudent(req.body);
    } else {
      result = await authService.registerTeacher(req.body);
    }

    return res.ok('Đăng ký tài khoản thành công.', result, 201);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/login
 */
async function login(req, res, next) {
  try {
    const result = await authService.login(req.body);

    if (result.requireOtp) {
      return res.ok('Yêu cầu xác thực OTP đã được tạo.', result);
    }

    return res.ok('Đăng nhập thành công.', result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/admin/verify-otp
 */
async function verifyAdminOtp(req, res, next) {
  try {
    const result = await authService.verifyAdminOtp(req.body);
    return res.ok('Xác thực OTP thành công.', result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/logout
 * Logout-all increments auth_version so all previously issued JWTs are revoked.
 */
async function logout(req, res, next) {
  try {
    await authService.logoutAll(req.user.id, req.user.authVersion);
    return res.ok('Đăng xuất tất cả thiết bị thành công.', {});
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/forgot-password
 */
async function forgotPassword(req, res, next) {
  try {
    await authService.requestPasswordReset(req.body.email);
    return res.ok('Nếu email tồn tại, yêu cầu đặt lại mật khẩu đã được ghi nhận.', {});
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/reset-password
 */
async function resetPassword(req, res, next) {
  try {
    await authService.resetPassword(req.body);
    return res.ok('Đặt lại mật khẩu thành công. Hãy đăng nhập bằng mật khẩu mới.', {});
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  verifyAdminOtp,
  logout,
  forgotPassword,
  resetPassword
};
