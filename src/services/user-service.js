const bcrypt = require('bcrypt');

const ROLES = require('../constants/roles');
const STATUSES = require('../constants/statuses');
const withTransaction = require('../database/transaction');
const userRepo = require('../repositories/user-repository');
const appError = require('../utils/app-error');

function bcryptRounds() {
  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  if (!Number.isInteger(rounds) || rounds < 10 || rounds > 15) {
    throw new Error('BCRYPT_ROUNDS must be an integer from 10 to 15.');
  }
  return rounds;
}

async function getMyProfile(userId, role) {
  const profile = await userRepo.findProfileDetail(userId, role);
  if (!profile) throw appError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.');
  return profile;
}

async function updateMyProfile(userId, role, data) {
  const studentOnly = ['dateOfBirth'];
  const teacherOnly = ['academicTitle', 'degree', 'department'];
  if (role !== ROLES.STUDENT && studentOnly.some((field) => field in data)) {
    throw appError(400, 'PROFILE_FIELD_NOT_ALLOWED', 'dateOfBirth chỉ dành cho Student profile.');
  }
  if (role !== ROLES.TEACHER && teacherOnly.some((field) => field in data)) {
    throw appError(400, 'PROFILE_FIELD_NOT_ALLOWED', 'Các trường chuyên môn chỉ dành cho Teacher profile.');
  }

  return withTransaction(async (connection) => {
    const current = await userRepo.findProfileDetail(userId, role, connection);
    if (!current) throw appError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.');

    await userRepo.updateBasicInfo(userId, {
      fullName: data.fullName?.trim() || current.full_name,
      phone: Object.prototype.hasOwnProperty.call(data, 'phone') ? data.phone || null : current.phone
    }, connection);

    if (role === ROLES.STUDENT && data.dateOfBirth) {
      await userRepo.updateStudentProfile(userId, { dateOfBirth: data.dateOfBirth }, connection);
    }
    if (role === ROLES.TEACHER) {
      await userRepo.updateTeacherProfile(userId, {
        academicTitle: Object.prototype.hasOwnProperty.call(data, 'academicTitle')
          ? data.academicTitle || null : current.academic_title,
        degree: Object.prototype.hasOwnProperty.call(data, 'degree')
          ? data.degree || null : current.degree,
        department: Object.prototype.hasOwnProperty.call(data, 'department')
          ? data.department || null : current.department
      }, connection);
    }
    return userRepo.findProfileDetail(userId, role, connection);
  });
}

async function changeMyPassword(userId, { oldPassword, newPassword }, dependencies = {}) {
  const transaction = dependencies.withTransaction || withTransaction;
  const users = dependencies.userRepo || userRepo;
  const comparePassword = dependencies.comparePassword || bcrypt.compare;
  const hashPassword = dependencies.hashPassword || ((password) => bcrypt.hash(password, bcryptRounds()));
  await transaction(async (connection) => {
    const currentHash = await users.findPasswordHashById(userId, connection, true);
    if (!currentHash) throw appError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.');
    if (!(await comparePassword(oldPassword, currentHash))) {
      throw appError(400, 'INCORRECT_OLD_PASSWORD', 'Mật khẩu hiện tại không chính xác.');
    }
    if (await comparePassword(newPassword, currentHash)) {
      throw appError(400, 'SAME_AS_OLD_PASSWORD', 'Mật khẩu mới không được trùng với mật khẩu hiện tại.');
    }
    const newHash = await hashPassword(newPassword);
    await users.updatePasswordAndIncrementVersion(userId, newHash, connection);
  });
  return true;
}

async function listUsers({ page, limit, search, role, status }) {
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 10));
  const result = await userRepo.listUsers({ page: pageNum, limit: limitNum, search, role, status });
  return { page: pageNum, limit: limitNum, ...result };
}

async function getUserById(id) {
  const user = await userRepo.findUserById(id);
  if (!user) throw appError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.');
  return user;
}

async function updateUserStatus(targetId, { status, reviewNote, lockReason }, adminId) {
  if (Number(targetId) === Number(adminId)) {
    throw appError(400, 'CANNOT_CHANGE_SELF_STATUS', 'Admin không thể thay đổi trạng thái của chính mình.');
  }

  return withTransaction(async (connection) => {
    const user = await userRepo.findUserByIdForUpdate(targetId, connection);
    if (!user) throw appError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.');

    if (user.status === STATUSES.PENDING && status === STATUSES.ACTIVE && user.role === ROLES.TEACHER) {
      await userRepo.reviewTeacher(targetId, status, adminId, reviewNote || null, connection);
    } else if (user.status === STATUSES.PENDING && status === STATUSES.REJECTED && user.role === ROLES.TEACHER) {
      if (!reviewNote?.trim()) throw appError(400, 'REVIEW_NOTE_REQUIRED', 'Lý do từ chối là bắt buộc.');
      await userRepo.reviewTeacher(targetId, status, adminId, reviewNote.trim(), connection);
    } else if (user.status === STATUSES.REJECTED && status === STATUSES.PENDING && user.role === ROLES.TEACHER) {
      await userRepo.reopenTeacherReview(targetId, connection);
    } else if (user.status === STATUSES.ACTIVE && status === STATUSES.LOCKED) {
      if (!lockReason?.trim()) throw appError(400, 'LOCK_REASON_REQUIRED', 'Lý do khóa là bắt buộc.');
      await userRepo.lockUser(targetId, adminId, lockReason.trim(), connection);
    } else if (user.status === STATUSES.LOCKED && status === STATUSES.ACTIVE) {
      await userRepo.unlockUser(targetId, connection);
    } else {
      throw appError(409, 'INVALID_STATUS_TRANSITION', `Không thể chuyển ${user.status} thành ${status}.`);
    }

    return userRepo.findUserById(targetId, connection);
  });
}

module.exports = {
  getMyProfile,
  updateMyProfile,
  changeMyPassword,
  listUsers,
  getUserById,
  updateUserStatus
};
