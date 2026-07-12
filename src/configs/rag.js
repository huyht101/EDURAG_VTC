require('dotenv').config();

module.exports = {
  serviceUrl: process.env.RAG_SERVICE_URL || null,
  requestTimeoutMs: Number(process.env.RAG_REQUEST_TIMEOUT_MS || 10000),
  get internalToken() {
    if (!process.env.RAG_INTERNAL_TOKEN || process.env.RAG_INTERNAL_TOKEN.length < 32) {
      throw new Error('RAG_INTERNAL_TOKEN must contain at least 32 characters.');
    }
    return process.env.RAG_INTERNAL_TOKEN;
  }
};
