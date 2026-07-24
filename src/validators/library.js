function validateLibraryQuery(query) {
  const allowed = ['offset', 'limit', 'search'];
  if (Object.keys(query).some((key) => !allowed.includes(key))) {
    return { error: 'Student Library không hỗ trợ filter quản trị.' };
  }
  for (const field of ['offset', 'limit']) {
    if (query[field] !== undefined && !/^\d+$/.test(String(query[field]))) {
      return { error: `${field} phải là số nguyên không âm.` };
    }
  }
  if (query.limit !== undefined && Number(query.limit) < 1) {
    return { error: 'limit phải lớn hơn hoặc bằng 1.' };
  }
  if (query.search !== undefined
    && (typeof query.search !== 'string' || query.search.length > 255)) {
    return { error: 'search không được vượt quá 255 ký tự.' };
  }
  return null;
}

module.exports = { validateLibraryQuery };
