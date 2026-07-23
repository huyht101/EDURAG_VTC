// User Controller - HTTP layer for profile and admin user management
const userService = require('../services/user-service');

// ─────────────────────────────────────────────
// Profile endpoints
// ─────────────────────────────────────────────

/**
 * GET /api/profile
 */
async function getMyProfile(req, res, next) {
  try {
    const { id, role } = req.user;
    const profile = await userService.getMyProfile(id, role);
    return res.ok('OK', profile);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/profile
 */
async function updateMyProfile(req, res, next) {
  try {
    const { id, role } = req.user;
    const profile = await userService.updateMyProfile(id, role, req.body);
    return res.ok('Cập nhật profile thành công.', profile);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/profile/password
 */
async function changeMyPassword(req, res, next) {
  try {
    const { id } = req.user;
    await userService.changeMyPassword(id, req.body);
    return res.ok('Thay đổi mật khẩu thành công.', {});
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────
// Admin user management endpoints
// ─────────────────────────────────────────────

/**
 * GET /api/admin/users
 */
async function listUsers(req, res, next) {
  try {
    const { search, role, status } = req.query;
    const result = await userService.listUsers({
      page: req.query.page,
      limit: req.query.limit,
      search,
      role,
      status
    });
    return res.ok('OK', result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/users/:id
 */
async function getUserById(req, res, next) {
  try {
    const user = await userService.getUserById(req.params.id);
    return res.ok('OK', user);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/admin/users/:id/status
 * Used for: approve teacher, lock user, unlock user, reject teacher
 */
async function updateUserStatus(req, res, next) {
  try {
    const targetId = req.params.id;
    const adminId = req.user.id;
    const user = await userService.updateUserStatus(targetId, req.body, adminId);
    return res.ok('Cập nhật trạng thái người dùng thành công.', user);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/users/:id/reset-password
 */
async function adminResetPassword(req, res, next) {
  try {
    const targetId = req.params.id;
    const { newPassword } = req.body;
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'Mật khẩu mới không hợp lệ (tối thiểu 8 ký tự).' });
    }
    await userService.adminResetPassword(targetId, newPassword);
    return res.ok('Đặt lại mật khẩu người dùng thành công.', {});
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/students/import
 */
async function importStudents(req, res, next) {
  try {
    const excelService = require('../services/excel-service');
    let rawContent = req.body.fileContent;
    if (!rawContent && req.body.students && Array.isArray(req.body.students)) {
      const result = await userService.importStudentsBulk(req.body.students);
      return res.ok('Import danh sách sinh viên hoàn tất.', result);
    }
    if (!rawContent || typeof rawContent !== 'string') {
      return res.status(400).json({ error: 'Nội dung file (fileContent) hoặc mảng sinh viên (students) là bắt buộc.' });
    }
    const parsedRows = excelService.parseCsvOrExcel(rawContent);
    const students = parsedRows.map((r) => excelService.normalizeStudentRow(r));
    const result = await userService.importStudentsBulk(students);
    return res.ok('Import danh sách sinh viên hoàn tất.', result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMyProfile,
  updateMyProfile,
  changeMyPassword,
  listUsers,
  getUserById,
  updateUserStatus,
  adminResetPassword,
  importStudents
};
