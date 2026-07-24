const pool = require('../configs/db');
const sqlPageNumbers = require('../utils/pagination');

function db(executor) {
  return executor || pool;
}

const SELECT_FIELDS = `
  d.id, d.title, d.file_type, d.file_size_bytes, d.storage_key,
  d.original_filename, d.mime_type, d.created_at,
  d.processing_status, d.visibility_status`;

async function listEligibleDocuments({ offset, limit, search }, executor) {
  const page = sqlPageNumbers(offset, limit);
  const conditions = [
    "d.processing_status = 'READY'",
    "d.visibility_status = 'VISIBLE'"
  ];
  const params = [];
  if (search) {
    conditions.push('d.title LIKE ?');
    params.push(`%${search}%`);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const database = db(executor);
  const [countRows] = await database.execute(
    `SELECT COUNT(*) AS total FROM documents d ${where}`,
    params
  );
  const [rows] = await database.execute(
    `SELECT ${SELECT_FIELDS}
     FROM documents d
     ${where}
     ORDER BY d.created_at DESC, d.id DESC
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
