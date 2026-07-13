function validateDashboardQuery(query) {
  for (const field of ['from', 'to']) {
    if (query[field] !== undefined && Number.isNaN(Date.parse(query[field]))) {
      return { error: `${field} phải là ISO date/time hợp lệ.` };
    }
  }
  if (query.from && query.to && new Date(query.from) >= new Date(query.to)) {
    return { error: 'from phải nhỏ hơn to.' };
  }
  return null;
}

module.exports = validateDashboardQuery;
