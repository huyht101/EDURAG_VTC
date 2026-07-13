const ragConfig = require('../configs/rag');
const appError = require('../utils/app-error');

function normalizeQueryResult(payload) {
  const result = payload?.data || payload || {};
  return {
    answer: result.answer === undefined ? null : result.answer,
    noAnswer: Boolean(result.noAnswer),
    sources: Array.isArray(result.sources) ? result.sources : [],
    usageCalls: Array.isArray(result.usageCalls) ? result.usageCalls : []
  };
}

class MockRagClient {
  async startIngest() {
    return { accepted: true, completed: false, mode: 'mock' };
  }

  async setRetrieval() {
    return { accepted: true, completed: true, mode: 'mock' };
  }

  async deleteVectors() {
    return { accepted: true, completed: true, mode: 'mock' };
  }

  async query({ requestId, question }) {
    if (question.includes('__RAG_ERROR__')) {
      throw appError(502, 'RAG_MOCK_FAILURE', 'Mock RAG failure requested.');
    }
    const noAnswer = question.includes('__NO_ANSWER__');
    const vectorNodeId = process.env.RAG_MOCK_SOURCE_VECTOR_NODE_ID || null;
    const usageCalls = [{
      requestId,
      callIndex: 1,
      operationType: 'ANSWER_GENERATION',
      provider: 'MOCK',
      model: 'mock-v1',
      promptTokens: 1,
      completionTokens: noAnswer ? 0 : 1,
      estimatedCost: null,
      currency: 'USD',
      latencyMs: 0,
      status: 'SUCCEEDED',
      errorCode: null
    }];
    if (process.env.RAG_MOCK_MULTI_USAGE === 'true') {
      usageCalls.unshift({
        ...usageCalls[0],
        callIndex: 1,
        operationType: 'QUERY_REWRITE',
        completionTokens: 0
      });
      usageCalls[1].callIndex = 2;
    }
    return {
      answer: noAnswer ? null : `Mock answer: ${question}`,
      noAnswer,
      sources: !noAnswer && vectorNodeId ? [{
        vectorNodeId,
        sourceText: 'Mock source fragment.',
        retrievalScore: 1
      }] : [],
      usageCalls
    };
  }
}

class RemoteRagClient {
  constructor(config = ragConfig) {
    if (!config.serviceUrl) throw new Error('RAG_SERVICE_URL is required in remote mode.');
    this.config = config;
  }

  async request(path, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await fetch(new URL(path, this.config.serviceUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.internalToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        throw appError(503, 'RAG_SERVICE_UNAVAILABLE', `RAG service returned HTTP ${response.status}.`);
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (error) {
      if (error.status) throw error;
      const code = error.name === 'AbortError' ? 'RAG_REQUEST_TIMEOUT' : 'RAG_SERVICE_UNAVAILABLE';
      throw appError(503, code, 'Không thể kết nối Python RAG service.');
    } finally {
      clearTimeout(timeout);
    }
  }

  async startIngest(payload) {
    const result = await this.request('/internal/documents/ingest', payload);
    return { accepted: result.accepted !== false, completed: false, mode: 'remote' };
  }

  async setRetrieval(payload) {
    const result = await this.request('/internal/documents/retrieval', payload);
    return { accepted: result.accepted !== false, completed: false, mode: 'remote' };
  }

  async deleteVectors(payload) {
    const result = await this.request('/internal/documents/vectors/delete', payload);
    return { accepted: result.accepted !== false, completed: false, mode: 'remote' };
  }

  async query(payload) {
    return normalizeQueryResult(await this.request('/internal/chat/query', payload));
  }
}

function createRagClient(mode = ragConfig.mode, config = ragConfig) {
  return mode === 'remote' ? new RemoteRagClient(config) : new MockRagClient();
}

function getRagClient() {
  return createRagClient();
}

module.exports = { createRagClient, getRagClient, normalizeQueryResult };
