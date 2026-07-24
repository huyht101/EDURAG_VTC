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

module.exports = {
  getMyProfile,
  updateMyProfile,
  changeMyPassword,
  listUsers,
  getUserById,
  updateUserStatus
};
