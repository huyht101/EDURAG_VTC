const crypto = require('crypto');
const ragConfig = require('../configs/rag');

function constantTimeTokenMatch(supplied, expected) {
  const suppliedDigest = crypto.createHash('sha256').update(supplied).digest();
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(suppliedDigest, expectedDigest);
}

function internalAuthMiddleware(req, res, next) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    return res.err(401, 'Internal bearer token is required.', 'INTERNAL_UNAUTHORIZED');
  }

  const supplied = authorization.slice(7).trim();
  if (!supplied || !constantTimeTokenMatch(supplied, ragConfig.internalToken)) {
    return res.err(401, 'Internal bearer token is invalid.', 'INTERNAL_UNAUTHORIZED');
  }
  return next();
}

module.exports = internalAuthMiddleware;
