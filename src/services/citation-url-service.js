const ROLES = require('../constants/roles');

function isManager(user, document) {
  return user?.role === ROLES.ADMIN
    || (user?.role === ROLES.TEACHER
      && Number(document.uploaded_by) === Number(user.id));
}

function isLibraryEligible(document) {
  return document.processing_status === 'READY' && document.visibility_status === 'VISIBLE';
}

function canReadOriginal(user, document) {
  if (!document.storage_key || document.visibility_status === 'DELETED') return false;
  if (isManager(user, document)) return true;
  return document.file_type === 'TXT' && isLibraryEligible(document);
}

function citationUrls(user, citation) {
  const documentId = citation.document_id;
  if (!documentId || citation.visibility_status === 'DELETED') {
    return { previewUrl: null, originalFileUrl: null };
  }
  const eligible = isLibraryEligible(citation);
  const manager = isManager(user, citation);
  const hasPdfPreview = citation.preview_status === 'READY'
    && (citation.file_type === 'PDF' || Boolean(citation.preview_storage_key));
  const previewUrl = hasPdfPreview && eligible
    ? `/api/library/documents/${documentId}/preview`
    : (hasPdfPreview && manager ? `/api/documents/${documentId}/preview` : null);
  const originalFileUrl = canReadOriginal(user, citation)
    ? `/api/citations/${citation.id}/file`
    : null;
  return { previewUrl, originalFileUrl };
}

module.exports = { isManager, isLibraryEligible, canReadOriginal, citationUrls };
