const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateSessionCreate(body) {
  if (body === undefined || body === null) return null;
  const allowed = ['title'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) return { error: 'Session body chứa field không hợp lệ.' };
  if (body.title !== undefined
    && (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 255)) {
    return { error: 'title phải có từ 1 đến 255 ký tự.' };
  }
  return null;
}

function validatePagination(query) {
  for (const field of ['offset', 'limit']) {
    if (query[field] !== undefined && !/^\d+$/.test(String(query[field]))) {
      return { error: `${field} phải là số nguyên không âm.` };
    }
  }
  return null;
}

function validateSendMessage(body) {
  if (!body || typeof body.content !== 'string' || !body.content.trim()) {
    return { error: 'content là bắt buộc.' };
  }
  if (body.content.trim().length > 10000) return { error: 'content vượt quá 10000 ký tự.' };
  if (!UUID.test(body.clientRequestId || '')) return { error: 'clientRequestId phải là UUID.' };
  return null;
}

module.exports = { validateSessionCreate, validatePagination, validateSendMessage };
