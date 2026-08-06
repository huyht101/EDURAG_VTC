const fileService = require('./document-file-service');
const PREVIEW_STATUSES = require('../constants/preview-statuses');
const ROLES = require('../constants/roles');

function previewStorageKey(document) {
  if (document.preview_status !== PREVIEW_STATUSES.READY) return null;
  if (document.file_type === 'PDF') return document.storage_key;
  return document.preview_storage_key || null;
}

function canonicalDownloadArtifact(document) {
  if (document.file_type === 'TXT') {
    return {
      storageKey: document.storage_key,
      mimeType: document.mime_type || 'text/plain',
      extension: '.txt'
    };
  }
  const storageKey = previewStorageKey(document);
  if (!storageKey) return null;
  return {
    storageKey,
    mimeType: document.preview_mime_type || 'application/pdf',
    extension: '.pdf'
  };
}

function canonicalDownloadFilename(document, artifact = canonicalDownloadArtifact(document)) {
  if (!artifact) return null;
  const title = String(document.title || 'document').trim() || 'document';
  return title.toLowerCase().endsWith(artifact.extension)
    ? title : `${title}${artifact.extension}`;
}

function libraryFileType(document) {
  if (document.file_type === 'DOCX' && previewStorageKey(document)) return 'PDF';
  return document.file_type;
}

async function availability(document, files = fileService) {
  const originalAvailable = await files.exists(document.storage_key);
  const previewKey = previewStorageKey(document);
  const previewAvailable = previewKey
    ? (previewKey === document.storage_key ? originalAvailable : await files.exists(previewKey))
    : false;
  const downloadArtifact = canonicalDownloadArtifact(document);
  const downloadAvailable = downloadArtifact
    ? (downloadArtifact.storageKey === document.storage_key
      ? originalAvailable
      : (downloadArtifact.storageKey === previewKey
        ? previewAvailable
        : await files.exists(downloadArtifact.storageKey)))
    : false;
  return { originalAvailable, previewAvailable, downloadAvailable };
}

function commonFields(document, routes, state) {
  const originalFileUrl = routes.original(document.id);
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
    originalAvailable: Boolean(originalFileUrl) && state.originalAvailable,
    originalFileUrl,
    createdAt: document.created_at,
    updatedAt: document.updated_at
  };
}

function canUseLibraryOriginal(user, document) {
  return user?.role === ROLES.ADMIN
    || (user?.role === ROLES.TEACHER && Number(document.uploaded_by) === Number(user.id))
    || document.file_type === 'TXT';
}

async function libraryDocument(document, user, files = fileService) {
  const state = await availability(document, files);
  return {
    ...commonFields(document, {
    original: (id) => (canUseLibraryOriginal(user, document)
      ? `/api/library/documents/${id}/source` : null),
    preview: (id) => `/api/library/documents/${id}/preview`
    }, state),
    fileType: libraryFileType(document),
    downloadUrl: state.downloadAvailable
      ? `/api/library/documents/${document.id}/download` : null
  };
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
  canonicalDownloadArtifact,
  canonicalDownloadFilename,
  libraryFileType,
  availability,
  canUseLibraryOriginal,
  libraryDocument,
  managementDocument
};
