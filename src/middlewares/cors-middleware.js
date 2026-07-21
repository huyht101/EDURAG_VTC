const cors = require('cors');

const httpConfig = require('../configs/http');
const appError = require('../utils/app-error');

function createCorsMiddleware(origins = httpConfig.corsAllowedOrigins) {
  return cors({
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
    origin(origin, callback) {
      // Postman, server-to-server calls and same-origin requests may omit Origin.
      if (!origin) return callback(null, true);
      if (origins.has(origin)) return callback(null, true);
      // With an empty allowlist, omit CORS headers instead of blocking same-origin
      // traffic. Browsers still block cross-origin access.
      if (origins.size === 0) return callback(null, false);
      return callback(appError(403, 'CORS_ORIGIN_DENIED', 'Origin không được phép truy cập API.'));
    }
  });
}

module.exports = { createCorsMiddleware };
