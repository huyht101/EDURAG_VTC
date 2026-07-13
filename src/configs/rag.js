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
  }
};
