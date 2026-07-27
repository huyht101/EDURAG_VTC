const SORT_VALUES = Object.freeze(['newest', 'oldest', 'title_asc', 'title_desc']);
const FILE_TYPES = Object.freeze(['PDF', 'DOCX', 'TXT']);
const QUERY_TEXT_MAX_LENGTH = 255;

const SORT_SQL = Object.freeze({
  newest: 'd.created_at DESC, d.id DESC',
  oldest: 'd.created_at ASC, d.id ASC',
  title_asc: 'd.title ASC, d.id ASC',
  title_desc: 'd.title DESC, d.id DESC'
});

function optionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePagination(query = {}) {
  const limitText = optionalText(query.limit);
  const limit = limitText ? Number.parseInt(limitText, 10) : 20;
  const pageText = optionalText(query.page);
  const offsetText = optionalText(query.offset);
  if (pageText) {
    const page = Number.parseInt(pageText, 10);
    return { page, limit, offset: (page - 1) * limit };
  }
  const offset = offsetText ? Number.parseInt(offsetText, 10) : 0;
  return { page: Math.floor(offset / limit) + 1, limit, offset };
}

function normalizeListQuery(query = {}) {
  return {
    ...normalizePagination(query),
    q: optionalText(query.q) || optionalText(query.search),
    fileType: optionalText(query.fileType),
    author: optionalText(query.author),
    processingStatus: optionalText(query.processingStatus),
    visibilityStatus: optionalText(query.visibilityStatus),
    previewStatus: optionalText(query.previewStatus),
    ownerId: optionalText(query.ownerId),
    sort: optionalText(query.sort) || 'newest'
  };
}

function likePattern(value) {
  return `%${value.replace(/[!%_]/g, (character) => `!${character}`)}%`;
}

function orderBySql(sort = 'newest') {
  const sql = SORT_SQL[sort];
  if (!sql) throw new Error('Sort value must be validated before repository use.');
  return sql;
}

module.exports = {
  FILE_TYPES,
  QUERY_TEXT_MAX_LENGTH,
  SORT_VALUES,
  likePattern,
  normalizeListQuery,
  normalizePagination,
  optionalText,
  orderBySql
};
