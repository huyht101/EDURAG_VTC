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

function isActivationCompensation(job, payload) {
  return job.status === JOB_STATUSES.SUCCEEDED
    && payload.eventType === JOB_STATUSES.FAILED
    && [JOB_TYPES.INGEST, JOB_TYPES.REPROCESS].includes(job.job_type)
    && ['ACTIVATION_FAILED', 'ACTIVATION_ACK_UNAVAILABLE'].includes(payload.error?.code);
}

function stableJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return stableJson(JSON.parse(value));
    } catch (_error) {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map(stableJson);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableJson(value[key])])
    );
  }
  return value;
}

function comparableChunk(chunk, persisted = false) {
  return {
    chunkIndex: Number(persisted ? chunk.chunk_index : chunk.chunkIndex),
    vectorNodeId: String(persisted ? chunk.vector_node_id : chunk.vectorNodeId).toLowerCase(),
    chunkText: persisted ? chunk.chunk_text : chunk.chunkText,
    contentHash: String(persisted ? chunk.content_hash : chunk.contentHash).toLowerCase(),
    tokenCount: (persisted ? chunk.token_count : chunk.tokenCount) ?? null,
    pageNumber: (persisted ? chunk.page_number : chunk.pageNumber) ?? null,
    sectionTitle: (persisted ? chunk.section_title : chunk.sectionTitle) ?? null,
    sourceLocator: stableJson((persisted ? chunk.source_locator : chunk.sourceLocator) ?? null)
  };
}

async function manifestMatches(jobId, manifest, chunks, connection) {
  if (!Array.isArray(manifest)) return false;
  const persisted = await chunks.listByJob(jobId, connection);
  if (persisted.length !== manifest.length) return false;
  const expected = [...manifest]
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .map((chunk) => comparableChunk(chunk));
  const actual = persisted.map((chunk) => comparableChunk(chunk, true));
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function ack(job, payload, outcome, canActivate, reason = null, status = job.status) {
  return {
    acknowledged: true,
    jobId: job.id,
    attemptCount: Number(payload.attemptCount),
    outcome,
    canActivate,
    reason,
    status
  };
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
      return ack(job, payload, 'IGNORED', false, 'STALE_ATTEMPT');
    }
    if (isActivationCompensation(job, payload)) {
      await jobs.markFailed(job.id, payload.error.code, payload.error.message, connection);
      await documents.updateProcessingStatus(
        job.document_id,
        DOCUMENT_STATUSES.processing.FAILED,
        connection
      );
      return ack(job, payload, 'ACCEPTED', false, 'ACTIVATION_COMPENSATED', JOB_STATUSES.FAILED);
    }
    if (terminalStatus(job.status)) {
      if (job.status === payload.eventType) {
        if (payload.eventType === JOB_STATUSES.SUCCEEDED
          && [JOB_TYPES.INGEST, JOB_TYPES.REPROCESS].includes(job.job_type)) {
          if (!Array.isArray(payload.chunks)) {
            throw appError(400, 'CHUNK_MANIFEST_REQUIRED', 'Callback success cần complete chunk manifest.');
          }
          if (!(await manifestMatches(job.id, payload.chunks, chunks, connection))) {
            return ack(job, payload, 'REJECTED', false, 'MANIFEST_CONFLICT');
          }
          return ack(job, payload, 'IDEMPOTENT_REPLAY', true, null, JOB_STATUSES.SUCCEEDED);
        }
        return ack(job, payload, 'IDEMPOTENT_REPLAY', false, null);
      }
      return ack(job, payload, 'REJECTED', false, 'JOB_ALREADY_TERMINAL');
    }
    if (job.status !== JOB_STATUSES.RUNNING) {
      return ack(job, payload, 'IGNORED', false, 'JOB_NOT_RUNNING');
    }

    if (payload.eventType === 'PROGRESS') {
      await jobs.markProgress(job.id, payload.stage || null, connection);
      return ack(job, payload, 'ACCEPTED', false, 'PROGRESS_ONLY', JOB_STATUSES.RUNNING);
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
      return ack(
        job,
        payload,
        'ACCEPTED',
        [JOB_TYPES.INGEST, JOB_TYPES.REPROCESS].includes(job.job_type),
        null,
        JOB_STATUSES.SUCCEEDED
      );
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
    return ack(job, payload, 'ACCEPTED', false, null, payload.eventType);
  });
}

module.exports = {
  handleCallback,
  stableJson,
  comparableChunk,
  manifestMatches,
  ack,
  isActivationCompensation
};
