// Role-based Authorization Middleware

/**
 * Check if the authenticated user has one of the allowed roles
 * @param {string[]} allowedRoles - List of allowed roles
 */
function roleMiddleware(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Yêu cầu xác thực tài khoản trước (Authentication required).',
        errorCode: 'UNAUTHORIZED'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền truy cập chức năng này (Permission denied).',
        errorCode: 'PERMISSION_DENIED'
      });
    }

    next();
  };
}

module.exports = roleMiddleware;
