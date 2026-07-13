const pool = require('../configs/db');
const sqlPageNumbers = require('../utils/pagination');

function db(executor) {
  return executor || pool;
}

const SELECT_FIELDS = `
  d.id, d.uploaded_by, d.title, d.original_filename, d.storage_type, d.storage_key,
  d.file_type, d.mime_type, d.file_size_bytes, d.checksum_sha256,
  d.processing_status, d.visibility_status, d.processed_at, d.deleted_at,
  d.created_at, d.updated_at`;

async function createDocument(data, executor) {
  const [result] = await db(executor).execute(
    `INSERT INTO documents
      (uploaded_by, title, original_filename, storage_type, storage_key, file_type,
       mime_type, file_size_bytes, checksum_sha256, processing_status, visibility_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.uploadedBy, data.title, data.originalFilename, data.storageType, data.storageKey,
      data.fileType, data.mimeType, data.fileSizeBytes, data.checksumSha256,
      data.processingStatus, data.visibilityStatus
    ]
  );
  return result.insertId;
}

async function findById(id, executor) {
  const [rows] = await db(executor).execute(
    `SELECT ${SELECT_FIELDS} FROM documents d WHERE d.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function findByIdForUpdate(id, executor) {
  const [rows] = await db(executor).execute(
    `SELECT ${SELECT_FIELDS} FROM documents d WHERE d.id = ? FOR UPDATE`,
    [id]
  );
  return rows[0] || null;
}

async function listDocuments(filters, executor) {
  const page = sqlPageNumbers(filters.offset, filters.limit);
  const conditions = [];
  const params = [];
  if (filters.uploadedBy !== undefined) {
    conditions.push('d.uploaded_by = ?');
    params.push(filters.uploadedBy);
  }
  if (filters.processingStatus) {
    conditions.push('d.processing_status = ?');
    params.push(filters.processingStatus);
  }
  if (filters.visibilityStatus) {
    conditions.push('d.visibility_status = ?');
    params.push(filters.visibilityStatus);
  } else {
    conditions.push("d.visibility_status <> 'DELETED'");
  }
  if (filters.search) {
    conditions.push('(d.title LIKE ? OR d.original_filename LIKE ?)');
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
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

async function updateTitle(id, title, executor) {
  await db(executor).execute('UPDATE documents SET title = ? WHERE id = ?', [title, id]);
}

async function updateProcessingStatus(id, status, executor) {
  const processedAt = status === 'READY' ? new Date() : null;
  await db(executor).execute(
    `UPDATE documents
     SET processing_status = ?,
         processed_at = CASE WHEN ? = 'READY' THEN ? ELSE processed_at END
     WHERE id = ?`,
    [status, status, processedAt, id]
  );
}

async function updateVisibility(id, status, executor) {
  await db(executor).execute(
    `UPDATE documents
     SET visibility_status = ?,
         deleted_at = CASE WHEN ? = 'DELETED' THEN CURRENT_TIMESTAMP(3) ELSE NULL END
     WHERE id = ?`,
    [status, status, id]
  );
}

module.exports = {
  createDocument,
  findById,
  findByIdForUpdate,
  listDocuments,
  updateTitle,
  updateProcessingStatus,
  updateVisibility
};
