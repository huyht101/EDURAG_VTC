const STATUSES = require('../constants/statuses');
const { escapeHtml } = require('../utils/sanitize');

function validateUpdateProfile(body) {
  if (!body || Object.keys(body).length === 0) return { error: 'Dữ liệu cập nhật trống.' };
  const allowed = ['fullName', 'phone', 'dateOfBirth', 'academicTitle', 'degree', 'department'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    return { error: 'Profile chứa trường không được phép cập nhật.' };
  }

  // Escape HTML để chống Stored XSS
  if (body.fullName !== undefined && body.fullName !== null) {
    body.fullName = escapeHtml(body.fullName);
  }
  if (body.academicTitle !== undefined && body.academicTitle !== null) {
    body.academicTitle = escapeHtml(body.academicTitle);
  }
  if (body.degree !== undefined && body.degree !== null) {
    body.degree = escapeHtml(body.degree);
  }
  if (body.department !== undefined && body.department !== null) {
    body.department = escapeHtml(body.department);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'fullName')
    && (typeof body.fullName !== 'string' || !body.fullName.trim()
      || body.fullName.trim().length > 150)) {
    return { error: 'fullName không hợp lệ.' };
  }
  if (body.phone !== undefined && body.phone !== null
    && (typeof body.phone !== 'string' || body.phone.length > 20)) {
    return { error: 'phone không hợp lệ.' };
  }
  for (const [field, maxLength] of [
    ['academicTitle', 100], ['degree', 100], ['department', 150]
  ]) {
    if (body[field] !== undefined && body[field] !== null
      && (typeof body[field] !== 'string' || body[field].length > maxLength)) {
      return { error: `${field} không hợp lệ.` };
    }
  }
  if (body.dateOfBirth !== undefined
    && (typeof body.dateOfBirth !== 'string' || Number.isNaN(Date.parse(body.dateOfBirth)))) {
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
  if (body.reviewNote?.length > 500 || body.lockReason?.length > 500) {
    return { error: 'reviewNote và lockReason không được vượt quá 500 ký tự.' };
  }
  return null;
}

module.exports = { validateUpdateProfile, validateStatusUpdate };
