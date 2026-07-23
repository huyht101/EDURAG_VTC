const { rateLimit } = require('express-rate-limit');

const httpConfig = require('../configs/http');

function createRateLimiter({ windowMs, limit, identifier }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    identifier,
    handler(req, res) {
      return res.status(429).json({
        success: false,
        message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
        errorCode: 'RATE_LIMIT_EXCEEDED'
      });
    }
  });
}

function general(identifier) {
  return createRateLimiter({
    identifier,
    windowMs: httpConfig.authRateLimitWindowMs,
    limit: httpConfig.authRateLimitMax
  });
}

function sensitive(identifier) {
  return createRateLimiter({
    identifier,
    windowMs: httpConfig.authSensitiveRateLimitWindowMs,
    limit: httpConfig.authSensitiveRateLimitMax
  });
}

function chat(identifier) {
  return createRateLimiter({
    identifier,
    windowMs: 60 * 1000, // 1 phút
    limit: 15           // Tối đa 15 request mỗi phút
  });
}

module.exports = {
  createRateLimiter,
  authRateLimiters: {
    register: general('auth-register'),
    login: general('auth-login'),
    adminOtp: sensitive('auth-admin-otp'),
    forgotPassword: sensitive('auth-forgot-password'),
    resetPassword: sensitive('auth-reset-password')
  },
  chatLimiter: chat('chat-limit')
};
