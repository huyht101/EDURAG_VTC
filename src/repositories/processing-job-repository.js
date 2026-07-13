const pool = require('../configs/db');

function db(executor) {
  return executor || pool;
}

async function createJob({ documentId, jobType, jobConfig = null, maxAttempts = 3 }, executor) {
  const [result] = await db(executor).execute(
    `INSERT INTO document_processing_jobs
      (document_id, job_type, status, job_config, max_attempts)
     VALUES (?, ?, 'QUEUED', ?, ?)`,
    [documentId, jobType, jobConfig ? JSON.stringify(jobConfig) : null, maxAttempts]
  );
  return result.insertId;
}

async function findById(id, executor) {
  const [rows] = await db(executor).execute(
    'SELECT * FROM document_processing_jobs WHERE id = ?',
    [id]
  );
  return rows[0] || null;
}

async function findByIdForUpdate(id, executor) {
  const [rows] = await db(executor).execute(
    'SELECT * FROM document_processing_jobs WHERE id = ? FOR UPDATE',
    [id]
  );
  return rows[0] || null;
}

async function findLatestForDocument(documentId, executor) {
  const [rows] = await db(executor).execute(
    `SELECT * FROM document_processing_jobs
     WHERE document_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    [documentId]
  );
  return rows[0] || null;
}

async function findActiveForDocument(documentId, executor) {
  const [rows] = await db(executor).execute(
    `SELECT * FROM document_processing_jobs
     WHERE document_id = ? AND status IN ('QUEUED','RUNNING')
     ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
    [documentId]
  );
  return rows[0] || null;
}

async function markRunning(id, executor) {
  const [result] = await db(executor).execute(
    `UPDATE document_processing_jobs
     SET status = 'RUNNING', attempt_count = attempt_count + 1,
         started_at = COALESCE(started_at, CURRENT_TIMESTAMP(3)),
         error_code = NULL, error_message = NULL
     WHERE id = ? AND status IN ('QUEUED','FAILED') AND attempt_count < max_attempts`,
    [id]
  );
  return result.affectedRows === 1;
}

async function markProgress(id, stage, executor) {
  await db(executor).execute(
    `UPDATE document_processing_jobs
     SET status = 'RUNNING', current_stage = ?, callback_received_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [stage || null, id]
  );
}

async function markSucceeded(id, result = {}, executor) {
  await db(executor).execute(
    `UPDATE document_processing_jobs
     SET status = 'SUCCEEDED', current_stage = ?, pipeline_version = ?, parser_name = ?,
         embedding_model = ?, embedding_dimension = ?, vector_collection = ?, total_chunks = ?,
         error_code = NULL, error_message = NULL,
         finished_at = CURRENT_TIMESTAMP(3), callback_received_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [
      result.currentStage || null, result.pipelineVersion || null, result.parserName || null,
      result.embeddingModel || null, result.embeddingDimension || null,
      result.vectorCollection || null, result.totalChunks ?? null, id
    ]
  );
}

async function markFailed(id, errorCode, errorMessage, executor) {
  await db(executor).execute(
    `UPDATE document_processing_jobs
     SET status = 'FAILED', error_code = ?, error_message = ?,
         finished_at = CURRENT_TIMESTAMP(3), callback_received_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [errorCode || 'PROCESSING_FAILED', errorMessage || null, id]
  );
}

async function markDispatchFailed(id, errorCode, errorMessage, executor) {
  await db(executor).execute(
    `UPDATE document_processing_jobs
     SET status = 'FAILED', error_code = ?, error_message = ?,
         finished_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [errorCode || 'RAG_DISPATCH_FAILED', errorMessage || null, id]
  );
}

async function markCancelled(id, errorCode, errorMessage, executor) {
  await db(executor).execute(
    `UPDATE document_processing_jobs
     SET status = 'CANCELLED', error_code = ?, error_message = ?,
         finished_at = CURRENT_TIMESTAMP(3), callback_received_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [errorCode || 'PROCESSING_CANCELLED', errorMessage || null, id]
  );
}

async function cancelActiveForDocument(documentId, executor) {
  await db(executor).execute(
    `UPDATE document_processing_jobs
     SET status = 'CANCELLED', error_code = 'SUPERSEDED_BY_DELETE',
         error_message = 'Cancelled because the document was deleted.',
         finished_at = CURRENT_TIMESTAMP(3)
     WHERE document_id = ? AND status IN ('QUEUED','RUNNING')`,
    [documentId]
  );
}

module.exports = {
  createJob,
  findById,
  findByIdForUpdate,
  findLatestForDocument,
  findActiveForDocument,
  markRunning,
  markProgress,
  markSucceeded,
  markFailed,
  markDispatchFailed,
  markCancelled,
  cancelActiveForDocument
};
