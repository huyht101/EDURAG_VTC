const pool = require('../configs/db');
const sqlPageNumbers = require('../utils/pagination');
const { likePattern, orderBySql } = require('../utils/document-list-query');

function db(executor) {
  return executor || pool;
}

const SELECT_FIELDS = `
  d.id, d.uploaded_by, d.title, d.description, d.author,
  d.original_filename, d.storage_type, d.storage_key,
  d.file_type, d.mime_type, d.file_size_bytes, d.checksum_sha256,
  d.page_count, d.preview_status, d.preview_storage_key, d.preview_mime_type,
  d.processing_status, d.visibility_status, d.processed_at, d.deleted_at,
  d.created_at, d.updated_at`;

async function createDocument(data, executor) {
  const [result] = await db(executor).execute(
    `INSERT INTO documents
      (uploaded_by, title, description, author, original_filename, storage_type, storage_key,
       file_type, mime_type, file_size_bytes, checksum_sha256, page_count, preview_status,
       preview_storage_key, preview_mime_type, processing_status, visibility_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.uploadedBy, data.title, data.description, data.author,
      data.originalFilename, data.storageType, data.storageKey, data.fileType,
      data.mimeType, data.fileSizeBytes, data.checksumSha256, data.pageCount,
      data.previewStatus, data.previewStorageKey, data.previewMimeType,
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
  if (filters.fileType) {
    conditions.push('d.file_type = ?');
    params.push(filters.fileType);
  }
  if (filters.previewStatus) {
    conditions.push('d.preview_status = ?');
    params.push(filters.previewStatus);
  }
  if (filters.q) {
    const pattern = likePattern(filters.q);
    conditions.push(`(
      d.title LIKE ? ESCAPE '!'
      OR d.description LIKE ? ESCAPE '!'
      OR d.author LIKE ? ESCAPE '!'
      OR d.original_filename LIKE ? ESCAPE '!'
    )`);
    params.push(pattern, pattern, pattern, pattern);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
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

async function updateMetadata(id, metadata, executor) {
  const assignments = [];
  const params = [];
  for (const [field, column] of [
    ['title', 'title'],
    ['description', 'description'],
    ['author', 'author']
  ]) {
    if (Object.prototype.hasOwnProperty.call(metadata, field)) {
      assignments.push(`${column} = ?`);
      params.push(metadata[field]);
    }
  }
  if (!assignments.length) return;
  params.push(id);
  await db(executor).execute(
    `UPDATE documents SET ${assignments.join(', ')} WHERE id = ?`,
    params
  );
}

async function updatePreview(id, data, executor) {
  await db(executor).execute(
    `UPDATE documents
     SET preview_status = ?, preview_storage_key = ?, preview_mime_type = ?, page_count = ?
     WHERE id = ?`,
    [data.status, data.storageKey ?? null, data.mimeType ?? null, data.pageCount ?? null, id]
  );
}

async function listForPreviewBackfill({ afterId = 0, limit = 100 }, executor) {
  const page = sqlPageNumbers(0, limit);
  const [rows] = await db(executor).execute(
    `SELECT ${SELECT_FIELDS}
     FROM documents d
     WHERE d.id > ?
       AND d.visibility_status <> 'DELETED'
       AND d.file_type IN ('PDF','DOCX')
       AND (
         (d.file_type = 'PDF' AND d.page_count IS NULL)
         OR
         (d.file_type = 'DOCX' AND
           (d.preview_status <> 'READY' OR d.preview_storage_key IS NULL OR d.page_count IS NULL))
       )
     ORDER BY d.id ASC
     LIMIT ${page.limit}`,
    [afterId]
  );
  return rows;
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
  updateMetadata,
  updatePreview,
  listForPreviewBackfill,
  updateProcessingStatus,
  updateVisibility
};
