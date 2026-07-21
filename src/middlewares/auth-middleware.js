const jwt = require('jsonwebtoken');

const authConfig = require('../configs/auth');
const STATUSES = require('../constants/statuses');
const userRepo = require('../repositories/user-repository');

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.err(401, 'Thiếu Bearer access token.', 'UNAUTHORIZED');
    }

    let decoded;
    try {
      decoded = jwt.verify(authHeader.slice(7), authConfig.secret, {
        algorithms: [authConfig.algorithm],
        issuer: authConfig.issuer,
        audience: authConfig.audience
      });
    } catch (_error) {
      return res.err(401, 'Access token không hợp lệ hoặc đã hết hạn.', 'TOKEN_INVALID_OR_EXPIRED');
    }

    if (decoded.type !== authConfig.purpose
      || typeof decoded.jti !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded.jti)
      || !Number.isSafeInteger(Number(decoded.id))
      || decoded.sub !== String(decoded.id)
      || !Number.isSafeInteger(decoded.iat)
      || !Number.isSafeInteger(decoded.exp)
      || decoded.exp <= decoded.iat) {
      return res.err(401, 'Access token không hợp lệ hoặc đã hết hạn.', 'TOKEN_INVALID_OR_EXPIRED');
    }

    const user = await userRepo.findAuthUserById(decoded.id);
    if (!user) return res.err(401, 'Người dùng không tồn tại.', 'USER_NOT_FOUND');
    if (user.status !== STATUSES.ACTIVE) {
      return res.err(403, `Tài khoản đang ở trạng thái ${user.status}.`, `ACCOUNT_${user.status}`);
    }
    if (!Number.isInteger(decoded.authVersion)
      || Number(decoded.authVersion) !== Number(user.auth_version)) {
      return res.err(401, 'Access token đã bị vô hiệu hóa.', 'TOKEN_REVOKED');
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      authVersion: user.auth_version
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { authMiddleware };
