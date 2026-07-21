// Auth Routes - /api/auth
const router = require('express').Router();

const authController = require('../controllers/auth-controller');
const { authMiddleware } = require('../middlewares/auth-middleware');
const validateRequest = require('../middlewares/validate-middleware');
const { authRateLimiters } = require('../middlewares/rate-limit-middleware');
const {
  validateRegister,
  validateLogin,
  validateForgotPassword,
  validateVerifyOtp,
  validateResetPassword
} = require('../validators/auth');

// POST /api/auth/register
router.post('/register', authRateLimiters.register, validateRequest(validateRegister), authController.register);

// POST /api/auth/login
router.post('/login', authRateLimiters.login, validateRequest(validateLogin), authController.login);

// POST /api/auth/admin/verify-otp
router.post('/admin/verify-otp', authRateLimiters.adminOtp, validateRequest(validateVerifyOtp), authController.verifyAdminOtp);

// POST /api/auth/logout  (requires valid JWT)
router.post('/logout', authMiddleware, authController.logout);

// POST /api/auth/forgot-password
router.post('/forgot-password', authRateLimiters.forgotPassword, validateRequest(validateForgotPassword), authController.forgotPassword);

// POST /api/auth/reset-password
router.post('/reset-password', authRateLimiters.resetPassword, validateRequest(validateResetPassword), authController.resetPassword);

module.exports = router;
