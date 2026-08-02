const citationRepo = require('../repositories/citation-repository');
const fileService = require('./document-file-service');
const appError = require('../utils/app-error');
const { readSourceLocator } = require('../utils/source-locator');
const { canReadOriginal, citationUrls } = require('./citation-url-service');

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw appError(400, 'INVALID_ID', 'citation id không hợp lệ.');
  return id;
}

function authorize(user, context) {
  if (context.session_deleted_at || Number(context.session_user_id) !== Number(user.id)) {
    throw appError(404, 'CITATION_NOT_FOUND', 'Không tìm thấy citation.');
  }
}

async function canOpenOriginal(user, context) {
  return canReadOriginal(user, context) && fileService.exists(context.storage_key);
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
    sourceLocator: readSourceLocator(context.source_locator_snapshot),
    retrievalScore: context.retrieval_score,
    rerankScore: context.rerank_score
  };
}

async function getCitation(user, idValue) {
  const context = await citationRepo.findContextById(parseId(idValue));
  if (!context) throw appError(404, 'CITATION_NOT_FOUND', 'Không tìm thấy citation.');
  authorize(user, context);
  return {
    ...snapshot(context),
    ...citationUrls(user, context),
    originalAvailable: await canOpenOriginal(user, context)
  };
}

async function openOriginal(user, idValue) {
  const context = await citationRepo.findContextById(parseId(idValue));
  if (!context) throw appError(404, 'CITATION_NOT_FOUND', 'Không tìm thấy citation.');
  authorize(user, context);
  if (!context.storage_key || context.visibility_status === 'DELETED') {
    throw appError(409, 'ORIGINAL_SOURCE_UNAVAILABLE', 'File gốc hiện không khả dụng; citation snapshot vẫn được giữ.');
  }
  if (!canReadOriginal(user, context)) {
    throw appError(403, 'ORIGINAL_DOWNLOAD_FORBIDDEN', 'Bạn không được tải original file này.');
  }
  if (!(await fileService.exists(context.storage_key))) {
    throw appError(409, 'ORIGINAL_SOURCE_UNAVAILABLE', 'File gốc hiện không khả dụng; citation snapshot vẫn được giữ.');
  }
  try {
    return {
      ...(await fileService.open(context.storage_key)),
      filename: context.original_filename,
      mimeType: context.mime_type
    };
  } catch (error) {
    if (error.code === 'FILE_NOT_FOUND') {
      throw appError(409, 'ORIGINAL_SOURCE_UNAVAILABLE', 'File gốc hiện không khả dụng; citation snapshot vẫn được giữ.');
    }
    throw error;
  }
}

module.exports = { getCitation, openOriginal };
