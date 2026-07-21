// Global Error Handling Middlewares
const appError = require('../utils/app-error');

/**
 * Handle 404 Not Found endpoints
 */
function notFound(req, res, next) {
  next(appError(404, 'ENDPOINT_NOT_FOUND', 'API endpoint không tồn tại.'));
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
  
  const rawCorrelationId = req?.headers?.['x-request-id'] || req?.body?.requestId
    || req?.body?.request_id || req?.body?.jobId || req?.body?.job_id || 'none';
  const correlationId = String(rawCorrelationId).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'none';
  const method = req?.method || 'UNKNOWN';
  const route = req?.route?.path || req?.baseUrl || 'unmatched';
  const cause = String(err?.code || err?.name || 'Error').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  // Raw errors can contain provider payloads, SQL, credentials or host paths.
  // Operation-specific code should log only identifiers and redacted context.
  console.error(`[ERROR] time=${new Date().toISOString()} status=${status} code=${errorCode} cause=${cause} method=${method} route=${route} correlation=${correlationId}`);

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
