const fileService = require('./document-file-service');
const PREVIEW_STATUSES = require('../constants/preview-statuses');

function previewStorageKey(document) {
  if (document.preview_status !== PREVIEW_STATUSES.READY) return null;
  if (document.file_type === 'PDF') return document.storage_key;
  return document.preview_storage_key || null;
}

async function availability(document, files = fileService) {
  const originalAvailable = await files.exists(document.storage_key);
  const previewKey = previewStorageKey(document);
  const previewAvailable = previewKey
    ? (previewKey === document.storage_key ? originalAvailable : await files.exists(previewKey))
    : false;
  return { originalAvailable, previewAvailable };
}

function commonFields(document, routes, state) {
  return {
    id: document.id,
    title: document.title,
    description: document.description,
    author: document.author,
    fileType: document.file_type,
    fileSize: Number(document.file_size_bytes),
    pageCount: document.page_count === null ? null : Number(document.page_count),
    previewStatus: document.preview_status,
    previewAvailable: state.previewAvailable,
    previewMimeType: document.preview_mime_type,
    previewUrl: state.previewAvailable ? routes.preview(document.id) : null,
    originalAvailable: state.originalAvailable,
    originalFileUrl: routes.original(document.id),
    createdAt: document.created_at,
    updatedAt: document.updated_at
  };
}

async function libraryDocument(document, files = fileService) {
  return commonFields(document, {
    original: (id) => `/api/library/documents/${id}/source`,
    preview: (id) => `/api/library/documents/${id}/preview`
  }, await availability(document, files));
}

async function managementDocument(document, files = fileService) {
  return {
    ...commonFields(document, {
      original: (id) => `/api/documents/${id}/file`,
      preview: (id) => `/api/documents/${id}/preview`
    }, await availability(document, files)),
    uploadedBy: document.uploaded_by,
    originalFilename: document.original_filename,
    mimeType: document.mime_type,
    fileSizeBytes: Number(document.file_size_bytes),
    checksumSha256: document.checksum_sha256,
    processingStatus: document.processing_status,
    visibilityStatus: document.visibility_status,
    processedAt: document.processed_at,
    deletedAt: document.deleted_at
  };
}

module.exports = {
  previewStorageKey,
  availability,
  libraryDocument,
  managementDocument
};
