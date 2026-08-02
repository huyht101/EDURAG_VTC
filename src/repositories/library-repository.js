const pool = require('../configs/db');
const sqlPageNumbers = require('../utils/pagination');
const { likePattern, orderBySql } = require('../utils/document-list-query');

function db(executor) {
  return executor || pool;
}

const SELECT_FIELDS = `
  d.id, d.uploaded_by, d.title, d.description, d.author, d.file_type, d.file_size_bytes,
  d.storage_key, d.original_filename, d.mime_type, d.page_count,
  d.preview_status, d.preview_storage_key, d.preview_mime_type,
  d.created_at, d.updated_at,
  d.processing_status, d.visibility_status`;

async function listEligibleDocuments(filters, executor) {
  const page = sqlPageNumbers(filters.offset, filters.limit);
  const conditions = [
    "d.processing_status = 'READY'",
    "d.visibility_status = 'VISIBLE'"
  ];
  const params = [];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    conditions.push(`(
      d.title LIKE ? ESCAPE '!'
      OR d.description LIKE ? ESCAPE '!'
      OR d.author LIKE ? ESCAPE '!'
    )`);
    params.push(pattern, pattern, pattern);
  }
  if (filters.fileType) {
    conditions.push('d.file_type = ?');
    params.push(filters.fileType);
  }
  if (filters.author) {
    conditions.push("d.author LIKE ? ESCAPE '!'");
    params.push(likePattern(filters.author));
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const orderBy = orderBySql(filters.sort);
  const database = db(executor);
  const [countRows] = await database.execute(
    `SELECT COUNT(*) AS total FROM documents d ${where}`,
    params
  );
  const [rows] = await database.execute(
    `SELECT ${SELECT_FIELDS}
     FROM documents d
     ${where}
     ORDER BY ${orderBy}
     LIMIT ${page.limit} OFFSET ${page.offset}`,
    params
  );
  return { total: Number(countRows[0].total), documents: rows };
}

async function findEligibleById(id, executor) {
  const [rows] = await db(executor).execute(
    `SELECT ${SELECT_FIELDS}
     FROM documents d
     WHERE d.id = ?
       AND d.processing_status = 'READY'
       AND d.visibility_status = 'VISIBLE'`,
    [id]
  );
  return rows[0] || null;
}

module.exports = { listEligibleDocuments, findEligibleById };
