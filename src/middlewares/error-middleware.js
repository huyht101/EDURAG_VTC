// Global Error Handling Middlewares

/**
 * Handle 404 Not Found endpoints
 */
function notFound(req, res, next) {
  const error = new Error(`API endpoint không tồn tại: ${req.originalUrl}`);
  error.status = 404;
  error.code = 'ENDPOINT_NOT_FOUND';
  next(error);
}

/**
 * Global centralized error handler middleware
 */
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const errorCode = err.code || 'INTERNAL_SERVER_ERROR';
  
  // Log lỗi chi tiết trên console server phục vụ debug
  console.error(`[ERROR LOG] ${new Date().toISOString()} - status: ${status} - code: ${errorCode}`);
  console.error(err.stack || err);

  res.status(status).json({
    success: false,
    message: err.message || 'Lỗi hệ thống nghiêm trọng (Internal Server Error).',
    errorCode: errorCode
  });
}

module.exports = {
  notFound,
  errorHandler
};
