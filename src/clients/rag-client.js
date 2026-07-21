const ragConfig = require('../configs/rag');
const appError = require('../utils/app-error');
const {
  buildIngestRequest,
  buildVisibilityRequest,
  buildDeleteRequest,
  buildQueryRequest,
  normalizeAcceptedResponse,
  normalizeQueryResult
} = require('./rag-contract');

function upstreamMessage(payload, status) {
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.detail)) return `Python validation failed (${payload.detail.length} issue(s)).`;
  }
  return status >= 500
    ? 'Python RAG service is temporarily unavailable.'
    : `Python RAG service rejected the request (HTTP ${status}).`;
}

function upstreamCode(payload, status) {
  if (payload && typeof payload.error_code === 'string'
    && /^[A-Z][A-Z0-9_]{0,63}$/.test(payload.error_code)) {
    return payload.error_code;
  }
  if (status === 422) return 'RAG_UPSTREAM_VALIDATION_ERROR';
  return status >= 500 ? 'RAG_SERVICE_UNAVAILABLE' : 'RAG_UPSTREAM_ERROR';
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
    const vectorNodeId = process.env.RAG_MOCK_SOURCE_VECTOR_NODE_ID || null;
    const unsourcedContractViolation = question.includes('__UNSOURCED_ANSWER__');
    const noAnswer = question.includes('__NO_ANSWER__')
      || (!vectorNodeId && !unsourcedContractViolation);
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
      sources: !noAnswer && vectorNodeId && !unsourcedContractViolation ? [{
        vectorNodeId,
        sourceText: 'Mock source fragment.',
        retrievalScore: 1
      }] : [],
      usageCalls
    };
  }
}

class RemoteRagClient {
  constructor(config = ragConfig, fetchImpl = global.fetch) {
    if (!config.serviceUrl) throw new Error('RAG_SERVICE_URL is required in remote mode.');
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
    this.config = config;
    this.fetch = fetchImpl;
  }

  async request(operation, timeoutMs = this.config.requestTimeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(new URL(operation.path, this.config.serviceUrl), {
        method: operation.method,
        headers: {
          authorization: `Bearer ${this.config.internalToken}`,
          'content-type': 'application/json'
        },
        body: operation.body === undefined ? undefined : JSON.stringify(operation.body),
        signal: controller.signal
      });
      const text = await response.text();
      let payload = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (_error) {
          throw appError(
            502,
            'RAG_UPSTREAM_INVALID_RESPONSE',
            'Python RAG service returned a non-JSON response.'
          );
        }
      }
      if (!response.ok) {
        const status = response.status >= 500 ? 503 : 502;
        throw appError(
          status,
          upstreamCode(payload, response.status),
          upstreamMessage(payload, response.status)
        );
      }
      return payload;
    } catch (error) {
      if (error.status) throw error;
      if (error.name === 'AbortError') {
        throw appError(503, 'RAG_REQUEST_TIMEOUT', 'Python RAG service request timed out.');
      }
      throw appError(503, 'RAG_SERVICE_UNAVAILABLE', 'Cannot connect to Python RAG service.');
    } finally {
      clearTimeout(timeout);
    }
  }

  async startIngest(payload) {
    const operation = buildIngestRequest(payload, this.config);
    return normalizeAcceptedResponse(await this.request(operation), payload.jobId);
  }

  async setRetrieval(payload) {
    const operation = buildVisibilityRequest(payload, this.config);
    return normalizeAcceptedResponse(await this.request(operation), payload.jobId);
  }

  async deleteVectors(payload) {
    const operation = buildDeleteRequest(payload, this.config);
    return normalizeAcceptedResponse(await this.request(operation), payload.jobId);
  }

  async query(payload) {
    const operation = buildQueryRequest(payload);
    return normalizeQueryResult(await this.request(operation, this.config.queryTimeoutMs));
  }
}

function createRagClient(mode = ragConfig.mode, config = ragConfig, fetchImpl = global.fetch) {
  return mode === 'remote' ? new RemoteRagClient(config, fetchImpl) : new MockRagClient();
}

function getRagClient() {
  return createRagClient();
}

module.exports = {
  MockRagClient,
  RemoteRagClient,
  createRagClient,
  getRagClient,
  normalizeQueryResult
};
