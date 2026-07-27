const DOCUMENT_STATUSES = require('../constants/document-statuses');
const PREVIEW_STATUSES = require('../constants/preview-statuses');
const {
  FILE_TYPES,
  SORT_VALUES,
  optionalText
} = require('../utils/document-list-query');
const {
  validateCompatibility,
  validateEnum,
  validInteger,
  validateText
} = require('./library');

function validateDocumentQuery(query) {
  const allowed = [
    'q', 'fileType', 'processingStatus', 'visibilityStatus', 'previewStatus',
    'ownerId', 'page', 'limit', 'sort', 'offset', 'search'
  ];
  if (Object.keys(query).some((key) => !allowed.includes(key))) {
    return { error: 'Document Management không hỗ trợ query parameter này.' };
  }
  for (const [field, values] of [
    ['processingStatus', Object.values(DOCUMENT_STATUSES.processing)],
    ['visibilityStatus', Object.values(DOCUMENT_STATUSES.visibility)],
    ['previewStatus', Object.values(PREVIEW_STATUSES)],
    ['fileType', FILE_TYPES],
    ['sort', SORT_VALUES]
  ]) {
    const error = validateEnum(query, field, values);
    if (error) return { error };
  }
  if (!validInteger(query.page, 1)) {
    return { error: 'page phải là số nguyên lớn hơn hoặc bằng 1.' };
  }
  if (!validInteger(query.offset, 0)) {
    return { error: 'offset phải là số nguyên không âm.' };
  }
  if (!validInteger(query.limit, 1) || Number(optionalText(query.limit) || 20) > 100) {
    return { error: 'limit phải là số nguyên từ 1 đến 100.' };
  }
  if (!validInteger(query.ownerId, 1)) {
    return { error: 'ownerId phải là số nguyên lớn hơn hoặc bằng 1.' };
  }
  for (const field of ['q', 'search']) {
    const error = validateText(query, field);
    if (error) return { error };
  }
  const page = Number(optionalText(query.page) || 1);
  const limit = Number(optionalText(query.limit) || 20);
  if (!Number.isSafeInteger((page - 1) * limit)) {
    return { error: 'page và limit vượt phạm vi hỗ trợ.' };
  }
  const compatibilityError = validateCompatibility(query);
  if (compatibilityError) return { error: compatibilityError };
  return null;
}

function validateDocumentUpdate(body) {
  const allowed = new Set(['title', 'description', 'author']);
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
  if (!keys.length || keys.some((key) => !allowed.has(key))) {
    return { error: 'Chỉ được cập nhật title, description và author.' };
  }
  if (Object.prototype.hasOwnProperty.call(body, 'title')) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 255) {
      return { error: 'title phải có từ 1 đến 255 ký tự.' };
    }
  }
  for (const [field, maximum] of [['description', 2000], ['author', 255]]) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    if (body[field] !== null && typeof body[field] !== 'string') {
      return { error: `${field} phải là chuỗi hoặc null.` };
    }
    if (typeof body[field] === 'string' && body[field].trim().length > maximum) {
      return { error: `${field} không được vượt quá ${maximum} ký tự.` };
    }
  }
  return null;
}

module.exports = { validateDocumentQuery, validateDocumentUpdate };
