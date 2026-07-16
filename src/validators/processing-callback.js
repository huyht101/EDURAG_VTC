const crypto = require('crypto');

const JOB_STATUSES = require('../constants/job-statuses');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const EVENTS = ['PROGRESS', JOB_STATUSES.SUCCEEDED, JOB_STATUSES.FAILED, JOB_STATUSES.CANCELLED];

function validateChunk(chunk, index) {
  if (!chunk || typeof chunk !== 'object') return `chunks[${index}] phải là object.`;
  if (!Number.isInteger(chunk.chunkIndex) || chunk.chunkIndex < 0) return `chunks[${index}].chunkIndex không hợp lệ.`;
  if (!UUID.test(chunk.vectorNodeId || '')) return `chunks[${index}].vectorNodeId không phải UUID.`;
  if (typeof chunk.chunkText !== 'string' || !chunk.chunkText
    || Buffer.byteLength(chunk.chunkText, 'utf8') > 65535) {
    return `chunks[${index}].chunkText phải có từ 1 đến 65535 bytes UTF-8.`;
  }
  if (!SHA256.test(chunk.contentHash || '')) return `chunks[${index}].contentHash không hợp lệ.`;
  const actualHash = crypto.createHash('sha256').update(chunk.chunkText, 'utf8').digest('hex');
  if (chunk.contentHash.toLowerCase() !== actualHash) {
    return `chunks[${index}].contentHash không khớp chunkText.`;
  }
  if (chunk.tokenCount !== undefined && (!Number.isInteger(chunk.tokenCount) || chunk.tokenCount <= 0)) {
    return `chunks[${index}].tokenCount không hợp lệ.`;
  }
  if (chunk.pageNumber !== undefined && chunk.pageNumber !== null
    && (!Number.isInteger(chunk.pageNumber) || chunk.pageNumber < 1)) {
    return `chunks[${index}].pageNumber không hợp lệ.`;
  }
  if (chunk.sourceLocator !== undefined && chunk.sourceLocator !== null
    && (typeof chunk.sourceLocator !== 'object' || Array.isArray(chunk.sourceLocator))) {
    return `chunks[${index}].sourceLocator phải là object.`;
  }
  if (chunk.sectionTitle !== undefined && chunk.sectionTitle !== null
    && (typeof chunk.sectionTitle !== 'string' || chunk.sectionTitle.length > 500)) {
    return `chunks[${index}].sectionTitle không hợp lệ.`;
  }
  return null;
}

function validateProcessingCallback(body) {
  if (!body || typeof body !== 'object') return { error: 'Callback payload là bắt buộc.' };
  if (!Number.isSafeInteger(Number(body.jobId)) || Number(body.jobId) <= 0) return { error: 'jobId không hợp lệ.' };
  if (body.documentId !== undefined
    && (!Number.isSafeInteger(Number(body.documentId)) || Number(body.documentId) <= 0)) {
    return { error: 'documentId không hợp lệ.' };
  }
  if (!Number.isInteger(body.attemptCount) || body.attemptCount < 1) return { error: 'attemptCount không hợp lệ.' };
  if (!EVENTS.includes(body.eventType)) return { error: 'eventType không hợp lệ.' };
  if (body.eventType === 'PROGRESS' && body.stage !== undefined
    && (typeof body.stage !== 'string' || body.stage.length > 32)) {
    return { error: 'stage không hợp lệ.' };
  }
  if (body.eventType === JOB_STATUSES.SUCCEEDED) {
    if (body.result !== undefined && (typeof body.result !== 'object' || Array.isArray(body.result))) {
      return { error: 'result phải là object.' };
    }
    if (body.result?.embeddingDimension !== undefined
      && (!Number.isInteger(body.result.embeddingDimension) || body.result.embeddingDimension <= 0)) {
      return { error: 'result.embeddingDimension không hợp lệ.' };
    }
    if (body.chunks !== undefined && !Array.isArray(body.chunks)) return { error: 'chunks phải là array.' };
    for (const [field, maxLength] of [
      ['currentStage', 32], ['pipelineVersion', 50], ['parserName', 100],
      ['embeddingModel', 150], ['vectorCollection', 128]
    ]) {
      if (body.result?.[field] !== undefined
        && (typeof body.result[field] !== 'string' || body.result[field].length > maxLength)) {
        return { error: `result.${field} không hợp lệ.` };
      }
    }
    if (Array.isArray(body.chunks)) {
      if (body.chunks.length < 1 || body.chunks.length > 5000) {
        return { error: 'Complete chunk manifest phải có từ 1 đến 5000 chunks.' };
      }
      const indexes = new Set();
      const nodes = new Set();
      for (let i = 0; i < body.chunks.length; i += 1) {
        const error = validateChunk(body.chunks[i], i);
        if (error) return { error };
        if (indexes.has(body.chunks[i].chunkIndex) || nodes.has(body.chunks[i].vectorNodeId)) {
          return { error: 'Chunk manifest chứa index hoặc vectorNodeId trùng.' };
        }
        indexes.add(body.chunks[i].chunkIndex);
        nodes.add(body.chunks[i].vectorNodeId);
      }
    }
  }
  if ([JOB_STATUSES.FAILED, JOB_STATUSES.CANCELLED].includes(body.eventType)
    && body.error !== undefined && (typeof body.error !== 'object' || Array.isArray(body.error))) {
    return { error: 'error phải là object.' };
  }
  if (body.error?.code !== undefined
    && (typeof body.error.code !== 'string' || body.error.code.length > 64)) {
    return { error: 'error.code không hợp lệ.' };
  }
  if (body.error?.message !== undefined
    && (typeof body.error.message !== 'string' || body.error.message.length > 2000)) {
    return { error: 'error.message không hợp lệ.' };
  }
  return null;
}

module.exports = validateProcessingCallback;
