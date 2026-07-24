const libraryRepo = require('../repositories/library-repository');
const fileService = require('./document-file-service');
const appError = require('../utils/app-error');

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw appError(400, 'INVALID_ID', 'document id không hợp lệ.');
  }
  return id;
}

async function publicDocument(document, files = fileService) {
  return {
    id: document.id,
    title: document.title,
    fileType: document.file_type,
    fileSize: Number(document.file_size_bytes),
    pageCount: null,
    createdAt: document.created_at,
    originalAvailable: await files.exists(document.storage_key)
  };
}

async function listDocuments(query = {}, dependencies = {}) {
  const repository = dependencies.repository || libraryRepo;
  const files = dependencies.fileService || fileService;
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const search = query.search?.trim() || '';
  const result = await repository.listEligibleDocuments({ offset, limit, search });
  return {
    offset,
    limit,
    total: result.total,
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

module.exports = { listDocuments, getDocument, openSource, publicDocument, parseId };
