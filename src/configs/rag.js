require('dotenv').config();

module.exports = {
  get mode() {
    const mode = String(process.env.RAG_MODE || 'mock').toLowerCase();
    if (!['mock', 'remote'].includes(mode)) throw new Error('RAG_MODE must be mock or remote.');
    return mode;
  },
  get serviceUrl() {
    return process.env.RAG_SERVICE_URL || null;
  },
  get requestTimeoutMs() {
    const value = Number(process.env.RAG_REQUEST_TIMEOUT_MS || 10000);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('RAG_REQUEST_TIMEOUT_MS must be positive.');
    return value;
  },
  get queryTimeoutMs() {
    const value = Number(process.env.RAG_QUERY_TIMEOUT_MS || 60000);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('RAG_QUERY_TIMEOUT_MS must be positive.');
    return value;
  },
  get callbackBodyLimit() {
    const value = String(process.env.RAG_CALLBACK_BODY_LIMIT || '25mb').trim().toLowerCase();
    if (!/^[1-9]\d*(kb|mb)$/.test(value)) {
      throw new Error('RAG_CALLBACK_BODY_LIMIT must be a positive kb or mb value.');
    }
    return value;
  },
  get historyMessageLimit() {
    const value = Number(process.env.RAG_HISTORY_MESSAGE_LIMIT || 20);
    if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
      throw new Error('RAG_HISTORY_MESSAGE_LIMIT must be between 1 and 100.');
    }
    return value;
  },
  get internalToken() {
    if (!process.env.RAG_INTERNAL_TOKEN || process.env.RAG_INTERNAL_TOKEN.length < 32) {
      throw new Error('RAG_INTERNAL_TOKEN must contain at least 32 characters.');
    }
    return process.env.RAG_INTERNAL_TOKEN;
  },
  get defaultSubjectId() {
    const value = String(process.env.RAG_DEFAULT_SUBJECT_ID || 'mvp-global').trim();
    if (!value || value.length > 100) {
      throw new Error('RAG_DEFAULT_SUBJECT_ID must contain between 1 and 100 characters.');
    }
    return value;
  },
  get sharedUploadDirectory() {
    const value = String(process.env.RAG_SHARED_UPLOAD_DIR || '/shared/uploads').trim();
    if (!value) throw new Error('RAG_SHARED_UPLOAD_DIR is required.');
    return value;
  },
  get callbackUrl() {
    const value = process.env.RAG_CALLBACK_URL
      || 'http://localhost:5000/api/internal/rag/processing-callback';
    let parsed;
    try {
      parsed = new URL(value);
    } catch (_error) {
      throw new Error('RAG_CALLBACK_URL must be a valid absolute URL.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('RAG_CALLBACK_URL must use http or https.');
    }
    return parsed.toString();
  }
};
