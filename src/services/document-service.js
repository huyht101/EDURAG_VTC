const path = require('path');

const ROLES = require('../constants/roles');
const DOCUMENT_STATUSES = require('../constants/document-statuses');
const JOB_TYPES = require('../constants/job-types');
const withTransaction = require('../database/transaction');
const documentRepo = require('../repositories/document-repository');
const jobRepo = require('../repositories/processing-job-repository');
const fileService = require('./document-file-service');
const { getRagClient } = require('../clients/rag-client');
const appError = require('../utils/app-error');

function parseId(value, name = 'id') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw appError(400, 'INVALID_ID', `${name} không hợp lệ.`);
  return id;
}

function assertManager(user, document) {
  const allowed = user.role === ROLES.ADMIN
    || (user.role === ROLES.TEACHER && Number(document.uploaded_by) === Number(user.id));
  if (!allowed) throw appError(404, 'DOCUMENT_NOT_FOUND', 'Không tìm thấy document.');
}

function publicDocument(document) {
  return {
    id: document.id,
    uploadedBy: document.uploaded_by,
    title: document.title,
    originalFilename: document.original_filename,
    fileType: document.file_type,
    mimeType: document.mime_type,
    fileSizeBytes: document.file_size_bytes,
    checksumSha256: document.checksum_sha256,
    processingStatus: document.processing_status,
    visibilityStatus: document.visibility_status,
    processedAt: document.processed_at,
    deletedAt: document.deleted_at,
    createdAt: document.created_at,
    updatedAt: document.updated_at
  };
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    documentId: job.document_id,
    jobType: job.job_type,
    status: job.status,
    currentStage: job.current_stage,
    attemptCount: job.attempt_count,
    maxAttempts: job.max_attempts,
    totalChunks: job.total_chunks,
    errorCode: job.error_code,
    errorMessage: job.error_message,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    finishedAt: job.finished_at
  };
}

async function uploadDocument(user, file, requestedTitle) {
  const stored = await fileService.persist(file);
  const fallbackTitle = path.basename(stored.originalFilename, stored.extension);
  const title = String(requestedTitle || fallbackTitle).trim();
  if (!title || title.length > 255) {
    await fileService.remove(stored.storageKey);
    throw appError(400, 'INVALID_TITLE', 'title phải có từ 1 đến 255 ký tự.');
  }

  let documentId;
  let jobId;
  try {
    ({ documentId, jobId } = await withTransaction(async (connection) => {
      const createdDocumentId = await documentRepo.createDocument({
        uploadedBy: user.id,
        title,
        ...stored,
        processingStatus: DOCUMENT_STATUSES.processing.UPLOADED,
        visibilityStatus: DOCUMENT_STATUSES.visibility.VISIBLE
      }, connection);
      const createdJobId = await jobRepo.createJob({
        documentId: createdDocumentId,
        jobType: JOB_TYPES.INGEST
      }, connection);
      return { documentId: createdDocumentId, jobId: createdJobId };
    }));
  } catch (error) {
    await fileService.remove(stored.storageKey);
    throw error;
  }

  const job = await withTransaction(async (connection) => {
    const started = await jobRepo.markRunning(jobId, connection);
    if (!started) throw appError(409, 'JOB_NOT_DISPATCHABLE', 'Processing job không thể dispatch.');
    await documentRepo.updateProcessingStatus(
      documentId,
      DOCUMENT_STATUSES.processing.PROCESSING,
      connection
    );
    return jobRepo.findById(jobId, connection);
  });

  try {
    const dispatch = await getRagClient().startIngest({
      jobId: String(jobId),
      attemptCount: job.attempt_count,
      documentId: String(documentId),
      file: {
        storageType: stored.storageType,
        storageKey: stored.storageKey,
        fileType: stored.fileType,
        mimeType: stored.mimeType,
        checksumSha256: stored.checksumSha256
      }
    });
    if (!dispatch.accepted) throw appError(503, 'RAG_DISPATCH_REJECTED', 'Python RAG service từ chối ingest job.');
  } catch (error) {
    await withTransaction(async (connection) => {
      await jobRepo.markDispatchFailed(jobId, error.code || 'RAG_DISPATCH_FAILED', error.message, connection);
      await documentRepo.updateProcessingStatus(
        documentId,
        DOCUMENT_STATUSES.processing.FAILED,
        connection
      );
    });
    throw appError(503, error.code || 'RAG_DISPATCH_FAILED', 'Không thể dispatch document sang RAG service.', {
      documentId,
      jobId
    });
  }

  const document = await documentRepo.findById(documentId);
  return { document: publicDocument(document), job: publicJob(await jobRepo.findById(jobId)) };
}

async function listDocuments(user, query) {
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const filters = {
    offset,
    limit,
    search: query.search?.trim() || '',
    processingStatus: query.processingStatus || '',
    visibilityStatus: query.visibilityStatus || ''
  };
  if (user.role === ROLES.TEACHER) filters.uploadedBy = user.id;
  const result = await documentRepo.listDocuments(filters);
  return {
    offset,
    limit,
    total: result.total,
    documents: result.documents.map(publicDocument)
  };
}

async function getDocument(user, idValue) {
  const id = parseId(idValue, 'document id');
  const document = await documentRepo.findById(id);
  if (!document || document.visibility_status === DOCUMENT_STATUSES.visibility.DELETED) {
    throw appError(404, 'DOCUMENT_NOT_FOUND', 'Không tìm thấy document.');
  }
  assertManager(user, document);
  return {
    document: publicDocument(document),
    latestJob: publicJob(await jobRepo.findLatestForDocument(id))
  };
}

async function updateDocument(user, idValue, title) {
  const id = parseId(idValue, 'document id');
  return withTransaction(async (connection) => {
    const document = await documentRepo.findByIdForUpdate(id, connection);
    if (!document) throw appError(404, 'DOCUMENT_NOT_FOUND', 'Không tìm thấy document.');
    assertManager(user, document);
    if (document.visibility_status === DOCUMENT_STATUSES.visibility.DELETED) {
      throw appError(409, 'DOCUMENT_DELETED', 'Document đã bị xóa.');
    }
    await documentRepo.updateTitle(id, title.trim(), connection);
    return publicDocument(await documentRepo.findById(id, connection));
  });
}

async function openManagedFile(user, idValue) {
  const id = parseId(idValue, 'document id');
  const document = await documentRepo.findById(id);
  if (!document || document.visibility_status === DOCUMENT_STATUSES.visibility.DELETED) {
    throw appError(404, 'DOCUMENT_NOT_FOUND', 'Không tìm thấy document.');
  }
  assertManager(user, document);
  const file = await fileService.open(document.storage_key);
  return { ...file, document };
}

async function getProcessingJob(user, idValue) {
  const id = parseId(idValue, 'job id');
  const job = await jobRepo.findById(id);
  if (!job) throw appError(404, 'PROCESSING_JOB_NOT_FOUND', 'Không tìm thấy processing job.');
  const document = await documentRepo.findById(job.document_id);
  if (!document) throw appError(404, 'DOCUMENT_NOT_FOUND', 'Không tìm thấy document.');
  assertManager(user, document);
  return publicJob(job);
}

function operationConfig(action) {
  if (action === 'hide') {
    return { jobType: JOB_TYPES.SET_RETRIEVAL, targetVisibility: 'HIDDEN', retrievalEnabled: false };
  }
  if (action === 'unhide') {
    return { jobType: JOB_TYPES.SET_RETRIEVAL, targetVisibility: 'VISIBLE', retrievalEnabled: true };
  }
  return { jobType: JOB_TYPES.DELETE_VECTORS, targetVisibility: 'DELETED' };
}

async function operateDocument(user, idValue, action) {
  const id = parseId(idValue, 'document id');
  const config = operationConfig(action);
  const jobId = await withTransaction(async (connection) => {
    const document = await documentRepo.findByIdForUpdate(id, connection);
    if (!document) throw appError(404, 'DOCUMENT_NOT_FOUND', 'Không tìm thấy document.');
    assertManager(user, document);
    if (document.visibility_status === 'DELETED') throw appError(409, 'DOCUMENT_DELETED', 'Document đã bị xóa.');

    const active = await jobRepo.findActiveForDocument(id, connection);
    if (action !== 'delete' && active) {
      throw appError(409, 'DOCUMENT_BUSY', 'Document đang có processing job hoạt động.');
    }
    if (action === 'hide' && document.visibility_status !== 'VISIBLE') {
      throw appError(409, 'INVALID_VISIBILITY_TRANSITION', 'Chỉ document VISIBLE mới có thể hide.');
    }
    if (action === 'unhide'
      && (document.visibility_status !== 'HIDDEN' || document.processing_status !== 'READY')) {
      throw appError(409, 'INVALID_VISIBILITY_TRANSITION', 'Chỉ document READY và HIDDEN mới có thể unhide.');
    }
    if (action === 'delete' && active) {
      await jobRepo.cancelActiveForDocument(id, connection);
      await documentRepo.updateProcessingStatus(id, 'CANCELLED', connection);
    }
    return jobRepo.createJob({
      documentId: id,
      jobType: config.jobType,
      jobConfig: { targetVisibility: config.targetVisibility }
    }, connection);
  });

  const job = await withTransaction(async (connection) => {
    if (!(await jobRepo.markRunning(jobId, connection))) {
      throw appError(409, 'JOB_NOT_DISPATCHABLE', 'Operation job không thể dispatch.');
    }
    return jobRepo.findById(jobId, connection);
  });

  try {
    const client = getRagClient();
    const payload = {
      jobId: String(jobId),
      attemptCount: job.attempt_count,
      documentId: String(id)
    };
    const dispatch = action === 'delete'
      ? await client.deleteVectors(payload)
      : await client.setRetrieval({ ...payload, enabled: config.retrievalEnabled });
    if (!dispatch.accepted) throw appError(503, 'RAG_OPERATION_REJECTED', 'RAG service từ chối operation.');
    if (dispatch.completed) {
      await withTransaction(async (connection) => {
        await jobRepo.markSucceeded(jobId, { currentStage: 'COMPLETED' }, connection);
        await documentRepo.updateVisibility(id, config.targetVisibility, connection);
      });
    }
  } catch (error) {
    await jobRepo.markDispatchFailed(jobId, error.code || 'RAG_OPERATION_FAILED', error.message);
    throw appError(503, error.code || 'RAG_OPERATION_FAILED', 'Không thể thực hiện RAG document operation.', {
      documentId: id,
      jobId
    });
  }

  return {
    document: publicDocument(await documentRepo.findById(id)),
    job: publicJob(await jobRepo.findById(jobId))
  };
}

module.exports = {
  uploadDocument,
  listDocuments,
  getDocument,
  updateDocument,
  openManagedFile,
  getProcessingJob,
  operateDocument,
  publicDocument,
  publicJob,
  assertManager,
  parseId
};
