const DOCUMENT_STATUSES = require('../constants/document-statuses');

function validateDocumentQuery(query) {
  const processing = Object.values(DOCUMENT_STATUSES.processing);
  const visibility = Object.values(DOCUMENT_STATUSES.visibility);
  if (query.processingStatus && !processing.includes(query.processingStatus)) {
    return { error: 'processingStatus không hợp lệ.' };
  }
  if (query.visibilityStatus && !visibility.includes(query.visibilityStatus)) {
    return { error: 'visibilityStatus không hợp lệ.' };
  }
  for (const field of ['offset', 'limit']) {
    if (query[field] !== undefined && (!/^\d+$/.test(String(query[field])))) {
      return { error: `${field} phải là số nguyên không âm.` };
    }
  }
  if (query.search !== undefined
    && (typeof query.search !== 'string' || query.search.length > 255)) {
    return { error: 'search không được vượt quá 255 ký tự.' };
  }
  return null;
}

function validateDocumentUpdate(body) {
  if (!body || Object.keys(body).length !== 1 || typeof body.title !== 'string') {
    return { error: 'Chỉ được cập nhật trường title.' };
  }
  const title = body.title.trim();
  if (!title || title.length > 255) return { error: 'title phải có từ 1 đến 255 ký tự.' };
  return null;
}

module.exports = { validateDocumentQuery, validateDocumentUpdate };
