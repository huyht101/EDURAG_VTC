const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const authConfig = require('../configs/auth');
const ROLES = require('../constants/roles');
const STATUSES = require('../constants/statuses');
const TOKEN_TYPES = require('../constants/token-types');
const withTransaction = require('../database/transaction');
const userRepo = require('../repositories/user-repository');
const tokenRepo = require('../repositories/token-repository');

const OTP_EXPIRES_MINUTES = 10;
const RESET_TOKEN_EXPIRES_MINUTES = 15;
const MAX_TOKEN_ATTEMPTS = 5;

function appError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function bcryptRounds() {
  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  if (!Number.isInteger(rounds) || rounds < 10 || rounds > 15) {
    throw new Error('BCRYPT_ROUNDS must be an integer from 10 to 15.');
  }
  return rounds;
}

function tokenPepper() {
  const pepper = process.env.TOKEN_HMAC_PEPPER;
  if (!pepper || pepper.length < 32) {
    throw new Error('TOKEN_HMAC_PEPPER must contain at least 32 characters.');
  }
  return pepper;
}

function hashToken(userId, tokenType, value) {
  return crypto
    .createHmac('sha256', tokenPepper())
    .update(`${userId}:${tokenType}:${value}`)
    .digest('hex');
}

function hashesMatch(leftHex, rightHex) {
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function deliverDevelopmentSecret(kind, value, expiresMinutes) {
  const enabled = process.env.NODE_ENV === 'development'
    && process.env.AUTH_DEV_DELIVERY_LOG_SECRETS === 'true';
  if (enabled) {
    console.warn(`[DEV-ONLY ${kind}] ${value} (expires in ${expiresMinutes} minutes)`);
  }
}

async function registerStudent({ email, password, fullName, phone, studentCode, dateOfBirth }) {
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, bcryptRounds());

  return withTransaction(async (connection) => {
    if (await userRepo.checkDuplicate({ email: normalizedEmail, studentCode }, connection)) {
      throw appError(409, 'DUPLICATE_DATA', 'Email hoặc mã sinh viên đã được đăng ký.');
    }
    const role = await userRepo.findRoleByCode(ROLES.STUDENT, connection);
    if (!role) throw new Error('STUDENT role is missing from the database.');

    const userId = await userRepo.createUser({
      roleId: role.id,
      fullName: fullName.trim(),
      email: normalizedEmail,
      passwordHash,
      phone: phone || null,
      status: STATUSES.ACTIVE
    }, connection);
    await userRepo.createStudentProfile({ userId, studentCode, dateOfBirth }, connection);
    return { id: userId, email: normalizedEmail, role: ROLES.STUDENT, status: STATUSES.ACTIVE };
  });
}

async function registerTeacher({ email, password, fullName, phone, academicTitle, degree, department }) {
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, bcryptRounds());

  return withTransaction(async (connection) => {
    if (await userRepo.checkDuplicate({ email: normalizedEmail }, connection)) {
      throw appError(409, 'EMAIL_ALREADY_EXISTS', 'Email đã được đăng ký.');
    }
    const role = await userRepo.findRoleByCode(ROLES.TEACHER, connection);
    if (!role) throw new Error('TEACHER role is missing from the database.');

    const userId = await userRepo.createUser({
      roleId: role.id,
      fullName: fullName.trim(),
      email: normalizedEmail,
      passwordHash,
      phone: phone || null,
      status: STATUSES.PENDING
    }, connection);
    await userRepo.createTeacherProfile({
      userId,
      academicTitle: academicTitle || null,
      degree: degree || null,
      department: department || null
    }, connection);
    return { id: userId, email: normalizedEmail, role: ROLES.TEACHER, status: STATUSES.PENDING };
  });
}

async function login({ email, password }) {
  const user = await userRepo.findUserByEmail(email.trim().toLowerCase());
  const invalidCredentials = () => appError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không chính xác.');
  if (!user || !(await bcrypt.compare(password, user.password_hash))) throw invalidCredentials();

  if (user.status !== STATUSES.ACTIVE) {
    const messages = {
      [STATUSES.PENDING]: 'Tài khoản đang chờ Admin phê duyệt.',
      [STATUSES.LOCKED]: 'Tài khoản đã bị khóa.',
      [STATUSES.REJECTED]: 'Yêu cầu đăng ký đã bị từ chối.'
    };
    throw appError(403, `ACCOUNT_${user.status}`, messages[user.status] || 'Tài khoản không hợp lệ.');
  }

  if (user.role === ROLES.ADMIN) {
    const otpCode = await issueOtp(user.id, TOKEN_TYPES.ADMIN_OTP);
    deliverDevelopmentSecret('ADMIN OTP', otpCode, OTP_EXPIRES_MINUTES);
    return { requireOtp: true, email: user.email, delivery: 'EMAIL_PROVIDER_NOT_CONFIGURED' };
  }

  return authResult(user);
}

async function verifyAdminOtp({ email, otpCode }) {
  const user = await userRepo.findUserByEmail(email.trim().toLowerCase());
  if (!user || user.role !== ROLES.ADMIN || user.status !== STATUSES.ACTIVE) {
    throw appError(400, 'INVALID_REQUEST', 'Yêu cầu xác thực OTP không hợp lệ.');
  }

  const valid = await withTransaction(async (connection) => {
    const record = await tokenRepo.findActiveTokenByUserAndType(user.id, TOKEN_TYPES.ADMIN_OTP, connection);
    const suppliedHash = hashToken(user.id, TOKEN_TYPES.ADMIN_OTP, otpCode);
    if (!record || !hashesMatch(record.token_hash, suppliedHash)) {
      if (record) await tokenRepo.recordFailedAttempt(record.id, MAX_TOKEN_ATTEMPTS, connection);
      return false;
    }
    await tokenRepo.markTokenAsUsed(record.id, connection);
    return true;
  });
  if (!valid) throw appError(400, 'INVALID_OR_EXPIRED_OTP', 'Mã OTP không hợp lệ hoặc đã hết hạn.');

  return authResult(user);
}

async function requestPasswordReset(email) {
  const user = await userRepo.findUserByEmail(email.trim().toLowerCase());
  if (!user) return true;

  const secret = crypto.randomBytes(32).toString('hex');
  const rawToken = `${user.id}.${secret}`;
  const tokenHash = hashToken(user.id, TOKEN_TYPES.PASSWORD_RESET, secret);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRES_MINUTES * 60 * 1000);

  await withTransaction(async (connection) => {
    await tokenRepo.revokeTokensByUserAndType(user.id, TOKEN_TYPES.PASSWORD_RESET, connection);
    await tokenRepo.saveToken({
      userId: user.id,
      tokenType: TOKEN_TYPES.PASSWORD_RESET,
      tokenHash,
      expiresAt
    }, connection);
  });

  deliverDevelopmentSecret('PASSWORD RESET TOKEN', rawToken, RESET_TOKEN_EXPIRES_MINUTES);
  return true;
}

async function resetPassword({ token, newPassword }) {
  const [userIdText, secret, ...extra] = token.split('.');
  const userId = Number(userIdText);
  if (!Number.isSafeInteger(userId) || !secret || extra.length > 0) {
    throw appError(400, 'INVALID_OR_EXPIRED_TOKEN', 'Token khôi phục không hợp lệ hoặc đã hết hạn.');
  }
  const suppliedHash = hashToken(userId, TOKEN_TYPES.PASSWORD_RESET, secret);
  const passwordHash = await bcrypt.hash(newPassword, bcryptRounds());

  const valid = await withTransaction(async (connection) => {
    const record = await tokenRepo.findActiveTokenByUserAndType(userId, TOKEN_TYPES.PASSWORD_RESET, connection);
    if (!record || !hashesMatch(record.token_hash, suppliedHash)) {
      if (record) await tokenRepo.recordFailedAttempt(record.id, MAX_TOKEN_ATTEMPTS, connection);
      return false;
    }
    await userRepo.updatePasswordAndIncrementVersion(userId, passwordHash, connection);
    await tokenRepo.markTokenAsUsed(record.id, connection);
    return true;
  });
  if (!valid) throw appError(400, 'INVALID_OR_EXPIRED_TOKEN', 'Token khôi phục không hợp lệ hoặc đã hết hạn.');
  return true;
}

function signJwt(user) {
  return jwt.sign(
    { id: user.id, role: user.role, authVersion: user.auth_version },
    authConfig.secret,
    { expiresIn: authConfig.expiresIn }
  );
}

function authResult(user) {
  return {
    token: signJwt(user),
    user: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      status: user.status,
      authVersion: user.auth_version
    }
  };
}

async function issueOtp(userId, tokenType) {
  const otpCode = String(crypto.randomInt(100000, 1000000));
  const tokenHash = hashToken(userId, tokenType, otpCode);
  const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);
  await withTransaction(async (connection) => {
    await tokenRepo.revokeTokensByUserAndType(userId, tokenType, connection);
    await tokenRepo.saveToken({ userId, tokenType, tokenHash, expiresAt }, connection);
  });
  return otpCode;
}

module.exports = {
  registerStudent,
  registerTeacher,
  login,
  verifyAdminOtp,
  requestPasswordReset,
  resetPassword
};
