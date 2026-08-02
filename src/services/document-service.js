const path = require('path');

const ROLES = require('../constants/roles');
const DOCUMENT_STATUSES = require('../constants/document-statuses');
const PREVIEW_STATUSES = require('../constants/preview-statuses');
const JOB_TYPES = require('../constants/job-types');
const withTransaction = require('../database/transaction');
const documentRepo = require('../repositories/document-repository');
const jobRepo = require('../repositories/processing-job-repository');
const fileService = require('./document-file-service');
const documentDto = require('./document-dto-service');
const { getRagClient } = require('../clients/rag-client');
const ingestService = require('./document-ingest-service');
const appError = require('../utils/app-error');
const { normalizeListQuery } = require('../utils/document-list-query');

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

async function publicDocument(document) {
  return documentDto.managementDocument(document);
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

function normalizeNullable(value, maximum, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw appError(400, `INVALID_${field.toUpperCase()}`, `${field} không hợp lệ.`);
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw appError(400, `INVALID_${field.toUpperCase()}`, `${field} không được vượt quá ${maximum} ký tự.`);
  }
  return normalized;
}

function normalizeUploadMetadata(file, input = {}) {
  const filename = path.basename(file?.originalname || '');
  const extension = path.extname(filename);
  const fallbackTitle = path.basename(filename, extension);
  const requestedTitle = input.title === undefined || input.title === null ? '' : input.title;
  if (typeof requestedTitle !== 'string') {
    throw appError(400, 'INVALID_TITLE', 'title không hợp lệ.');
  }
  const title = requestedTitle.trim() || fallbackTitle.trim();
  if (!title || title.length > 255) {
    throw appError(400, 'INVALID_TITLE', 'title phải có từ 1 đến 255 ký tự.');
  }
  return {
    title,
    description: normalizeNullable(input.description, 2000, 'description'),
    author: normalizeNullable(input.author, 255, 'author')
  };
}

function initialPreview(stored) {
  if (stored.fileType === 'PDF') {
    return {
      pageCount: stored.pageCount,
      previewStatus: PREVIEW_STATUSES.READY,
      previewStorageKey: null,
      previewMimeType: 'application/pdf'
    };
  }
  if (stored.fileType === 'DOCX') {
    return {
      pageCount: null,
      previewStatus: PREVIEW_STATUSES.PENDING,
      previewStorageKey: null,
      previewMimeType: null
    };
  }
  return {
    pageCount: null,
    previewStatus: PREVIEW_STATUSES.NOT_APPLICABLE,
    previewStorageKey: null,
    previewMimeType: null
  };
}

async function uploadDocument(user, file, metadataInput = {}, dependencies = {}) {
  const files = dependencies.fileService || fileService;
  const documents = dependencies.documentRepo || documentRepo;
  const jobs = dependencies.jobRepo || jobRepo;
  const runTransaction = dependencies.withTransaction || withTransaction;
  const dispatcher = dependencies.ingestService || ingestService;
  const serialize = dependencies.publicDocument || publicDocument;
  const metadata = normalizeUploadMetadata(file, metadataInput);
  const stored = await files.persist(file);

  let documentId;
  let jobId;
  let previewJobId = null;
  try {
    ({ documentId, jobId, previewJobId } = await runTransaction(async (connection) => {
      const createdDocumentId = await documents.createDocument({
        uploadedBy: user.id,
        ...metadata,
        ...stored,
        ...initialPreview(stored),
        processingStatus: DOCUMENT_STATUSES.processing.UPLOADED,
        visibilityStatus: DOCUMENT_STATUSES.visibility.VISIBLE
      }, connection);
      const createdJobId = await jobs.createJob({
        documentId: createdDocumentId,
        jobType: JOB_TYPES.INGEST
      }, connection);
      const createdPreviewJobId = stored.fileType === 'DOCX'
        ? await jobs.createJob({
          documentId: createdDocumentId,
          jobType: JOB_TYPES.GENERATE_PDF_PREVIEW,
          jobConfig: { sourceFileType: stored.fileType }
        }, connection)
        : null;
      return {
        documentId: createdDocumentId,
        jobId: createdJobId,
        previewJobId: createdPreviewJobId
      };
    }));
  } catch (error) {
    await files.remove(stored.storageKey);
    throw error;
  }

  if (stored.fileType !== 'DOCX') {
    try {
      await dispatcher.dispatchIngest(jobId);
    } catch (error) {
      throw appError(503, error.code || 'RAG_DISPATCH_FAILED', 'Không thể dispatch document sang RAG service.', {
        documentId,
        jobId
      });
    }
  }

  const document = await documents.findById(documentId);
  return {
    document: await serialize(document),
    job: publicJob(await jobs.findById(jobId)),
    previewJob: previewJobId ? publicJob(await jobs.findById(previewJobId)) : null
  };
}

async function listDocuments(user, query, dependencies = {}) {
  const repository = dependencies.repository || documentRepo;
  const serialize = dependencies.publicDocument || publicDocument;
  const filters = normalizeListQuery(query);
  if (user.role === ROLES.TEACHER) {
    if (filters.ownerId) {
      throw appError(403, 'OWNER_FILTER_FORBIDDEN', 'Teacher không được lọc theo ownerId.');
    }
    filters.uploadedBy = user.id;
  } else if (user.role === ROLES.ADMIN && filters.ownerId) {
    filters.uploadedBy = Number(filters.ownerId);
  }
  const result = await repository.listDocuments(filters);
  return {
    offset: filters.offset,
    page: filters.page,
    limit: filters.limit,
    total: result.total,
    totalPages: Math.ceil(result.total / filters.limit),
    documents: await Promise.all(result.documents.map(serialize))
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
    document: await publicDocument(document),
    latestJob: publicJob(await jobRepo.findLatestForDocument(id))
  };
}

function normalizeUpdateMetadata(input) {
  const metadata = {};
  if (Object.prototype.hasOwnProperty.call(input, 'title')) metadata.title = input.title.trim();
  for (const [field, maximum] of [['description', 2000], ['author', 255]]) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      metadata[field] = normalizeNullable(input[field], maximum, field);
    }
  }
  return metadata;
}

async function updateDocument(user, idValue, metadataInput) {
  const id = parseId(idValue, 'document id');
  const updated = await withTransaction(async (connection) => {
    const document = await documentRepo.findByIdForUpdate(id, connection);
    if (!document) throw appError(404, 'DOCUMENT_NOT_FOUND', 'Không tìm thấy document.');
    assertManager(user, document);
    if (document.visibility_status === DOCUMENT_STATUSES.visibility.DELETED) {
      throw appError(409, 'DOCUMENT_DELETED', 'Document đã bị xóa.');
    }
    await documentRepo.updateMetadata(id, normalizeUpdateMetadata(metadataInput), connection);
    return documentRepo.findById(id, connection);
  });
  return publicDocument(updated);
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

async function openManagedPreview(user, idValue) {
  const id = parseId(idValue, 'document id');
  const document = await documentRepo.findById(id);
  if (!document || document.visibility_status === DOCUMENT_STATUSES.visibility.DELETED) {
    throw appError(404, 'DOCUMENT_NOT_FOUND', 'Không tìm thấy document.');
  }
  assertManager(user, document);
  const storageKey = documentDto.previewStorageKey(document);
  if (!storageKey || !(await fileService.exists(storageKey))) {
    throw appError(409, 'PREVIEW_UNAVAILABLE', 'Bản xem trước hiện không khả dụng.');
  }
  try {
    return {
      ...(await fileService.open(storageKey)),
      filename: `${document.title}.pdf`,
      mimeType: document.preview_mime_type || 'application/pdf',
      document
    };
  } catch (error) {
    if (error.code === 'FILE_NOT_FOUND') {
      throw appError(409, 'PREVIEW_UNAVAILABLE', 'Bản xem trước hiện không khả dụng.');
    }
    throw error;
  }
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
    document: await publicDocument(await documentRepo.findById(id)),
    job: publicJob(await jobRepo.findById(jobId))
  };
}

module.exports = {
  uploadDocument,
  listDocuments,
  getDocument,
  updateDocument,
  openManagedFile,
  openManagedPreview,
  getProcessingJob,
  operateDocument,
  publicDocument,
  publicJob,
  assertManager,
  parseId,
  normalizeUploadMetadata,
  normalizeUpdateMetadata,
  initialPreview,
  isIngestDispatchOutcomeUnknown: ingestService.isIngestDispatchOutcomeUnknown,
  recordIngestDispatchFailure: ingestService.recordIngestDispatchFailure
};
