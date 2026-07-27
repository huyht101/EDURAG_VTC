const libraryRepo = require('../repositories/library-repository');
const fileService = require('./document-file-service');
const documentDto = require('./document-dto-service');
const appError = require('../utils/app-error');
const { normalizeListQuery } = require('../utils/document-list-query');

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw appError(400, 'INVALID_ID', 'document id không hợp lệ.');
  }
  return id;
}

async function publicDocument(document, files = fileService) {
  return documentDto.libraryDocument(document, files);
}

async function listDocuments(query = {}, dependencies = {}) {
  const repository = dependencies.repository || libraryRepo;
  const files = dependencies.fileService || fileService;
  const filters = normalizeListQuery(query);
  const result = await repository.listEligibleDocuments(filters);
  return {
    offset: filters.offset,
    page: filters.page,
    limit: filters.limit,
    total: result.total,
    totalPages: Math.ceil(result.total / filters.limit),
    documents: await Promise.all(result.documents.map((document) => publicDocument(document, files)))
  };
}

async function getDocument(idValue, dependencies = {}) {
  const repository = dependencies.repository || libraryRepo;
  const files = dependencies.fileService || fileService;
  const document = await repository.findEligibleById(parseId(idValue));
  if (!document) throw appError(404, 'LIBRARY_DOCUMENT_NOT_FOUND', 'Không tìm thấy tài liệu.');
  return { document: await publicDocument(document, files) };
}

async function openSource(idValue, dependencies = {}) {
  const repository = dependencies.repository || libraryRepo;
  const files = dependencies.fileService || fileService;
  const document = await repository.findEligibleById(parseId(idValue));
  if (!document) throw appError(404, 'LIBRARY_DOCUMENT_NOT_FOUND', 'Không tìm thấy tài liệu.');
  if (!(await files.exists(document.storage_key))) {
    throw appError(409, 'ORIGINAL_SOURCE_UNAVAILABLE', 'File gốc hiện không khả dụng.');
  }
  try {
    return {
      ...(await files.open(document.storage_key)),
      filename: document.original_filename,
      mimeType: document.mime_type
    };
  } catch (error) {
    if (error.code === 'FILE_NOT_FOUND') {
      throw appError(409, 'ORIGINAL_SOURCE_UNAVAILABLE', 'File gốc hiện không khả dụng.');
    }
    throw error;
  }
}

async function openPreview(idValue, dependencies = {}) {
  const repository = dependencies.repository || libraryRepo;
  const files = dependencies.fileService || fileService;
  const document = await repository.findEligibleById(parseId(idValue));
  if (!document) throw appError(404, 'LIBRARY_DOCUMENT_NOT_FOUND', 'Không tìm thấy tài liệu.');
  const storageKey = documentDto.previewStorageKey(document);
  if (!storageKey || !(await files.exists(storageKey))) {
    throw appError(409, 'PREVIEW_UNAVAILABLE', 'Bản xem trước hiện không khả dụng.');
  }
  try {
    return {
      ...(await files.open(storageKey)),
      filename: `${document.title}.pdf`,
      mimeType: document.preview_mime_type || 'application/pdf'
    };
  } catch (error) {
    if (error.code === 'FILE_NOT_FOUND') {
      throw appError(409, 'PREVIEW_UNAVAILABLE', 'Bản xem trước hiện không khả dụng.');
    }
    throw error;
  }
}

module.exports = { listDocuments, getDocument, openSource, openPreview, publicDocument, parseId };
