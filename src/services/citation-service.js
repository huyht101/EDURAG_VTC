const ROLES = require('../constants/roles');
const citationRepo = require('../repositories/citation-repository');
const fileService = require('./document-file-service');
const appError = require('../utils/app-error');

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw appError(400, 'INVALID_ID', 'citation id không hợp lệ.');
  return id;
}

function authorize(user, context) {
  if (user.role !== ROLES.ADMIN && Number(context.session_user_id) !== Number(user.id)) {
    throw appError(404, 'CITATION_NOT_FOUND', 'Không tìm thấy citation.');
  }
}

function canOpenOriginal(user, context) {
  if (!context.storage_key) return false;
  if (user.role === ROLES.ADMIN || Number(context.uploaded_by) === Number(user.id)) return true;
  return context.processing_status === 'READY' && context.visibility_status === 'VISIBLE';
}

function snapshot(context) {
  return {
    id: context.id,
    messageId: context.message_id,
    documentId: context.document_id,
    chunkId: context.chunk_id,
    citationOrder: context.citation_order,
    documentTitle: context.document_title_snapshot,
    pageNumber: context.page_number_snapshot,
    sectionTitle: context.section_title_snapshot,
    sourceText: context.source_text_snapshot,
    sourceLocator: context.source_locator_snapshot,
    retrievalScore: context.retrieval_score,
    rerankScore: context.rerank_score
  };
}

async function getCitation(user, idValue) {
  const context = await citationRepo.findContextById(parseId(idValue));
  if (!context) throw appError(404, 'CITATION_NOT_FOUND', 'Không tìm thấy citation.');
  authorize(user, context);
  return { ...snapshot(context), originalAvailable: canOpenOriginal(user, context) };
}

async function openOriginal(user, idValue) {
  const context = await citationRepo.findContextById(parseId(idValue));
  if (!context) throw appError(404, 'CITATION_NOT_FOUND', 'Không tìm thấy citation.');
  authorize(user, context);
  if (!canOpenOriginal(user, context)) {
    throw appError(409, 'ORIGINAL_SOURCE_UNAVAILABLE', 'File gốc hiện không khả dụng; citation snapshot vẫn được giữ.');
  }
  return {
    ...(await fileService.open(context.storage_key)),
    filename: context.original_filename,
    mimeType: context.mime_type
  };
}

module.exports = { getCitation, openOriginal };
