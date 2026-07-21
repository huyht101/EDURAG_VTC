// Global Error Handling Middlewares
const appError = require('../utils/app-error');

/**
 * Handle 404 Not Found endpoints
 */
function notFound(req, res, next) {
  next(appError(404, 'ENDPOINT_NOT_FOUND', `API endpoint không tồn tại: ${req.originalUrl}`));
}

/**
 * Global centralized error handler middleware
 */
function errorHandler(err, req, res, next) {
  const parserErrors = {
    'entity.parse.failed': () => appError(400, 'INVALID_JSON', 'JSON body không hợp lệ.'),
    'entity.too.large': () => appError(413, 'REQUEST_BODY_TOO_LARGE', 'Request body vượt quá giới hạn.')
  };
  const knownParserError = parserErrors[err?.type]?.() || null;
  const safeError = knownParserError || err;
  const operational = safeError?.isOperational === true;
  const status = operational ? Number(safeError.status) || 500 : 500;
  const errorCode = operational ? safeError.code || 'APPLICATION_ERROR' : 'INTERNAL_SERVER_ERROR';
  
  // Log lỗi chi tiết trên console server phục vụ debug
  console.error(`[ERROR LOG] ${new Date().toISOString()} - status: ${status} - code: ${errorCode}`);
  console.error(err.stack || err);

  const body = {
    success: false,
    message: operational
      ? safeError.message
      : 'Lỗi hệ thống nghiêm trọng (Internal Server Error).',
    errorCode
  };
  if (operational && safeError.data !== undefined) body.data = safeError.data;
  res.status(status).json(body);
}

module.exports = {
  notFound,
  errorHandler
};
