const JOB_TYPES = require('../constants/job-types');
const JOB_STATUSES = require('../constants/job-statuses');
const DOCUMENT_STATUSES = require('../constants/document-statuses');
const withTransaction = require('../database/transaction');
const jobRepo = require('../repositories/processing-job-repository');
const documentRepo = require('../repositories/document-repository');
const chunkRepo = require('../repositories/document-chunk-repository');
const appError = require('../utils/app-error');

function parseJobConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return {};
  }
}

function terminalStatus(eventType) {
  return [JOB_STATUSES.SUCCEEDED, JOB_STATUSES.FAILED, JOB_STATUSES.CANCELLED].includes(eventType);
}

const defaultDependencies = {
  withTransaction,
  jobRepo,
  documentRepo,
  chunkRepo
};

async function handleCallback(payload, dependencies = defaultDependencies) {
  const {
    withTransaction: runTransaction,
    jobRepo: jobs,
    documentRepo: documents,
    chunkRepo: chunks
  } = dependencies;
  return runTransaction(async (connection) => {
    const job = await jobs.findByIdForUpdate(Number(payload.jobId), connection);
    if (!job) throw appError(404, 'PROCESSING_JOB_NOT_FOUND', 'Không tìm thấy processing job.');
    const document = await documents.findByIdForUpdate(job.document_id, connection);
    if (!document) throw appError(404, 'DOCUMENT_NOT_FOUND', 'Không tìm thấy document của processing job.');
    if (payload.documentId !== undefined && String(payload.documentId) !== String(job.document_id)) {
      throw appError(400, 'CALLBACK_DOCUMENT_MISMATCH', 'documentId không khớp processing job.');
    }

    if (Number(payload.attemptCount) !== Number(job.attempt_count)) {
      return { acknowledged: true, ignored: true, reason: 'STALE_ATTEMPT' };
    }
    if (terminalStatus(job.status)) {
      if (job.status === payload.eventType) {
        return { acknowledged: true, duplicate: true, jobId: job.id };
      }
      return { acknowledged: true, ignored: true, reason: 'JOB_ALREADY_TERMINAL' };
    }
    if (job.status !== JOB_STATUSES.RUNNING) {
      return { acknowledged: true, ignored: true, reason: 'JOB_NOT_RUNNING' };
    }

    if (payload.eventType === 'PROGRESS') {
      await jobs.markProgress(job.id, payload.stage || null, connection);
      return { acknowledged: true, jobId: job.id, status: JOB_STATUSES.RUNNING };
    }

    if (payload.eventType === JOB_STATUSES.SUCCEEDED) {
      if ([JOB_TYPES.INGEST, JOB_TYPES.REPROCESS].includes(job.job_type)) {
        if (!Array.isArray(payload.chunks)) {
          throw appError(400, 'CHUNK_MANIFEST_REQUIRED', 'Callback success cần complete chunk manifest.');
        }
        if (job.job_type === JOB_TYPES.REPROCESS) {
          await chunks.deleteByDocument(job.document_id, connection);
        }
        await chunks.insertManifest(job.document_id, job.id, payload.chunks, connection);
        const totalChunks = await chunks.countByJob(job.id, connection);
        if (totalChunks !== payload.chunks.length) {
          throw appError(400, 'CHUNK_MANIFEST_COUNT_MISMATCH', 'Số chunk persist không khớp manifest.');
        }
        await jobs.markSucceeded(job.id, {
          ...(payload.result || {}),
          totalChunks,
          currentStage: payload.result?.currentStage || 'COMPLETED'
        }, connection);
        await documents.updateProcessingStatus(
          job.document_id,
          DOCUMENT_STATUSES.processing.READY,
          connection
        );
      } else {
        const config = parseJobConfig(job.job_config);
        if (!Object.values(DOCUMENT_STATUSES.visibility).includes(config.targetVisibility)) {
          throw appError(400, 'INVALID_OPERATION_JOB_CONFIG', 'Operation job thiếu targetVisibility hợp lệ.');
        }
        await jobs.markSucceeded(job.id, {
          ...(payload.result || {}),
          currentStage: payload.result?.currentStage || 'COMPLETED'
        }, connection);
        await documents.updateVisibility(job.document_id, config.targetVisibility, connection);
      }
      return { acknowledged: true, jobId: job.id, status: JOB_STATUSES.SUCCEEDED };
    }

    const errorCode = payload.error?.code || `PROCESSING_${payload.eventType}`;
    const errorMessage = payload.eventType === 'CANCELLED'
      ? 'Python RAG processing was cancelled.'
      : 'Python RAG processing failed.';
    if (payload.eventType === JOB_STATUSES.FAILED) {
      await jobs.markFailed(job.id, errorCode, errorMessage, connection);
    } else {
      await jobs.markCancelled(job.id, errorCode, errorMessage, connection);
    }
    if ([JOB_TYPES.INGEST, JOB_TYPES.REPROCESS].includes(job.job_type)) {
      await documents.updateProcessingStatus(
        job.document_id,
        payload.eventType === JOB_STATUSES.FAILED
          ? DOCUMENT_STATUSES.processing.FAILED
          : DOCUMENT_STATUSES.processing.CANCELLED,
        connection
      );
    }
    return { acknowledged: true, jobId: job.id, status: payload.eventType };
  });
}

module.exports = { handleCallback };
