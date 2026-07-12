// Auth Routes - /api/auth
const router = require('express').Router();

const authController = require('../controllers/auth-controller');
const { authMiddleware } = require('../middlewares/auth-middleware');
const validateRequest = require('../middlewares/validate-middleware');
const {
  validateRegister,
  validateLogin,
  validateForgotPassword,
  validateVerifyOtp,
  validateResetPassword
} = require('../validators/auth');

// POST /api/auth/register
router.post('/register', validateRequest(validateRegister), authController.register);

// POST /api/auth/login
router.post('/login', validateRequest(validateLogin), authController.login);

// POST /api/auth/admin/verify-otp
router.post('/admin/verify-otp', validateRequest(validateVerifyOtp), authController.verifyAdminOtp);

// POST /api/auth/logout  (requires valid JWT)
router.post('/logout', authMiddleware, authController.logout);

// POST /api/auth/forgot-password
router.post('/forgot-password', validateRequest(validateForgotPassword), authController.forgotPassword);

// POST /api/auth/reset-password
router.post('/reset-password', validateRequest(validateResetPassword), authController.resetPassword);

module.exports = router;
