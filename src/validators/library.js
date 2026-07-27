const {
  FILE_TYPES,
  QUERY_TEXT_MAX_LENGTH,
  SORT_VALUES,
  optionalText
} = require('../utils/document-list-query');

function validInteger(value, minimum) {
  if (value === undefined) return true;
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const normalized = String(value).trim();
  if (!normalized) return true;
  if (!/^\d+$/.test(normalized)) return false;
  const number = Number(normalized);
  return Number.isSafeInteger(number) && number >= minimum;
}

function validateText(query, field) {
  if (query[field] === undefined) return null;
  if (typeof query[field] !== 'string') return `${field} phải là chuỗi.`;
  if (query[field].trim().length > QUERY_TEXT_MAX_LENGTH) {
    return `${field} không được vượt quá ${QUERY_TEXT_MAX_LENGTH} ký tự.`;
  }
  return null;
}

function validateEnum(query, field, values) {
  if (query[field] === undefined) return null;
  if (typeof query[field] !== 'string') return `${field} không hợp lệ.`;
  const normalized = query[field].trim();
  if (normalized && !values.includes(normalized)) return `${field} không hợp lệ.`;
  return null;
}

function validateCompatibility(query) {
  const q = optionalText(query.q);
  const search = optionalText(query.search);
  if (q && search && q !== search) {
    return 'q và search phải giống nhau sau khi trim.';
  }
  const pageText = optionalText(query.page);
  const offsetText = optionalText(query.offset);
  if (pageText && offsetText) {
    const limit = Number(optionalText(query.limit) || 20);
    const expectedOffset = (Number(pageText) - 1) * limit;
    if (Number(offsetText) !== expectedOffset) {
      return 'page và offset không nhất quán với limit.';
    }
  }
  return null;
}

function validateLibraryQuery(query) {
  const allowed = ['q', 'fileType', 'author', 'page', 'limit', 'sort', 'offset', 'search'];
  if (Object.keys(query).some((key) => !allowed.includes(key))) {
    return { error: 'Document Library không hỗ trợ query parameter này.' };
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
  for (const field of ['q', 'search', 'author']) {
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
  for (const [field, values] of [['fileType', FILE_TYPES], ['sort', SORT_VALUES]]) {
    const error = validateEnum(query, field, values);
    if (error) return { error };
  }
  return null;
}

module.exports = {
  validateCompatibility,
  validateEnum,
  validateLibraryQuery,
  validInteger,
  validateText
};
