const DOCUMENT_STATUSES = require('../constants/document-statuses');
const JOB_STATUSES = require('../constants/job-statuses');
const JOB_TYPES = require('../constants/job-types');
const withTransaction = require('../database/transaction');
const documentRepo = require('../repositories/document-repository');
const jobRepo = require('../repositories/processing-job-repository');
const { getRagClient } = require('../clients/rag-client');
const appError = require('../utils/app-error');

function isIngestDispatchOutcomeUnknown(error) {
  return error?.code === 'RAG_REQUEST_TIMEOUT';
}

function ingestArtifact(document) {
  if (document.file_type !== 'DOCX') {
    return {
      storageType: document.storage_type,
      storageKey: document.storage_key,
      fileType: document.file_type,
      mimeType: document.mime_type,
      checksumSha256: document.checksum_sha256
    };
  }
  if (document.preview_status !== 'READY' || !document.preview_storage_key
    || document.preview_mime_type !== 'application/pdf') {
    throw appError(409, 'CANONICAL_ARTIFACT_NOT_READY', 'Canonical PDF chưa sẵn sàng để ingest.');
  }
  return {
    storageType: document.storage_type,
    storageKey: document.preview_storage_key,
    fileType: 'PDF',
    mimeType: 'application/pdf',
    checksumSha256: null
  };
}

async function recordIngestDispatchFailure(documentId, jobId, error, dependencies = {}) {
  if (isIngestDispatchOutcomeUnknown(error)) return false;
  const runTransaction = dependencies.withTransaction || withTransaction;
  const jobs = dependencies.jobRepo || jobRepo;
  const documents = dependencies.documentRepo || documentRepo;
  await runTransaction(async (connection) => {
    const job = await jobs.findByIdForUpdate(jobId, connection);
    if (!job || job.status !== JOB_STATUSES.RUNNING) return;
    await jobs.markDispatchFailed(
      jobId,
      error.code || 'RAG_DISPATCH_FAILED',
      error.message,
      connection
    );
    await documents.updateProcessingStatus(
      documentId,
      DOCUMENT_STATUSES.processing.FAILED,
      connection
    );
  });
  return true;
}

async function dispatchIngest(jobId, dependencies = {}) {
  const runTransaction = dependencies.withTransaction || withTransaction;
  const jobs = dependencies.jobRepo || jobRepo;
  const documents = dependencies.documentRepo || documentRepo;
  const client = dependencies.ragClient || getRagClient();

  const claimed = await runTransaction(async (connection) => {
    const job = await jobs.findByIdForUpdate(jobId, connection);
    if (!job || job.job_type !== JOB_TYPES.INGEST) {
      throw appError(404, 'INGEST_JOB_NOT_FOUND', 'Không tìm thấy INGEST job.');
    }
    const document = await documents.findByIdForUpdate(job.document_id, connection);
    if (!document || document.visibility_status === DOCUMENT_STATUSES.visibility.DELETED) {
      throw appError(404, 'DOCUMENT_NOT_FOUND', 'Không tìm thấy document để ingest.');
    }
    const file = ingestArtifact(document);
    if (job.status === JOB_STATUSES.RUNNING) {
      return { claimed: false, reason: 'ALREADY_RUNNING', job, document, file };
    }
    if (job.status !== JOB_STATUSES.QUEUED) {
      return { claimed: false, reason: 'NOT_QUEUED', job, document, file };
    }
    if (!(await jobs.markRunning(job.id, connection))) {
      return { claimed: false, reason: 'CLAIM_LOST', job, document, file };
    }
    await documents.updateProcessingStatus(
      document.id,
      DOCUMENT_STATUSES.processing.PROCESSING,
      connection
    );
    return {
      claimed: true,
      job: await jobs.findById(job.id, connection),
      document,
      file
    };
  });

  if (!claimed.claimed) return claimed;
  try {
    const response = await client.startIngest({
      jobId: String(claimed.job.id),
      attemptCount: claimed.job.attempt_count,
      documentId: String(claimed.document.id),
      file: claimed.file
    });
    if (!response.accepted) {
      throw appError(503, 'RAG_DISPATCH_REJECTED', 'Python RAG service từ chối ingest job.');
    }
    return { ...claimed, accepted: true };
  } catch (error) {
    await recordIngestDispatchFailure(claimed.document.id, claimed.job.id, error, {
      withTransaction: runTransaction,
      jobRepo: jobs,
      documentRepo: documents
    });
    throw error;
  }
}

module.exports = {
  ingestArtifact,
  dispatchIngest,
  isIngestDispatchOutcomeUnknown,
  recordIngestDispatchFailure
};
