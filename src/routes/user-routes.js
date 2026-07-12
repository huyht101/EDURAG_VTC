// User Routes - /api/profile and /api/admin/users
const router = require('express').Router();

const userController = require('../controllers/user-controller');
const { authMiddleware } = require('../middlewares/auth-middleware');
const roleMiddleware = require('../middlewares/role-middleware');
const validateRequest = require('../middlewares/validate-middleware');
const { validateChangePassword } = require('../validators/auth');
const { validateUpdateProfile, validateStatusUpdate } = require('../validators/user');

const ROLES = require('../constants/roles');

// ─────────────────────────────────────────────
// /api/profile  (any authenticated user)
// ─────────────────────────────────────────────

// GET /api/profile
router.get('/profile', authMiddleware, userController.getMyProfile);

// PUT /api/profile
router.put('/profile', authMiddleware, validateRequest(validateUpdateProfile), userController.updateMyProfile);

// PUT /api/profile/password
router.put(
  '/profile/password',
  authMiddleware,
  validateRequest(validateChangePassword),
  userController.changeMyPassword
);

// ─────────────────────────────────────────────
// /api/admin/users  (ADMIN only)
// ─────────────────────────────────────────────

// GET /api/admin/users
router.get(
  '/admin/users',
  authMiddleware,
  roleMiddleware([ROLES.ADMIN]),
  userController.listUsers
);

// GET /api/admin/users/:id
router.get(
  '/admin/users/:id',
  authMiddleware,
  roleMiddleware([ROLES.ADMIN]),
  userController.getUserById
);

// PUT /api/admin/users/:id/status
// Used for: approve/reject teacher, lock/unlock user
router.put(
  '/admin/users/:id/status',
  authMiddleware,
  roleMiddleware([ROLES.ADMIN]),
  validateRequest(validateStatusUpdate),
  userController.updateUserStatus
);

module.exports = router;
