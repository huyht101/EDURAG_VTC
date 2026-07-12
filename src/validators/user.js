const STATUSES = require('../constants/statuses');

function validateUpdateProfile(body) {
  if (!body || Object.keys(body).length === 0) return { error: 'Dữ liệu cập nhật trống.' };
  const allowed = ['fullName', 'phone', 'dateOfBirth', 'academicTitle', 'degree', 'department'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    return { error: 'Profile chứa trường không được phép cập nhật.' };
  }
  if (Object.prototype.hasOwnProperty.call(body, 'fullName') && !body.fullName?.trim()) {
    return { error: 'Họ tên không được để trống.' };
  }
  if (body.dateOfBirth && Number.isNaN(Date.parse(body.dateOfBirth))) {
    return { error: 'Ngày sinh không hợp lệ.' };
  }
  return null;
}

function validateStatusUpdate(body) {
  const allowed = [STATUSES.PENDING, STATUSES.ACTIVE, STATUSES.LOCKED, STATUSES.REJECTED];
  if (!body || !allowed.includes(body.status)) return { error: 'Trạng thái không hợp lệ.' };
  if (body.reviewNote !== undefined && typeof body.reviewNote !== 'string') {
    return { error: 'reviewNote phải là chuỗi.' };
  }
  if (body.lockReason !== undefined && typeof body.lockReason !== 'string') {
    return { error: 'lockReason phải là chuỗi.' };
  }
  return null;
}

module.exports = { validateUpdateProfile, validateStatusUpdate };
