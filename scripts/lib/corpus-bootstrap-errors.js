'use strict';

const REMOTE_READ_CODES = new Set([
  'GCS_CONFIG_MISSING',
  'GCS_CONFIG_INVALID',
  'GCS_CREDENTIAL_MISSING',
  'GCS_CREDENTIAL_INVALID',
  'GCS_READ_PERMISSION_REQUIRED',
  'GCS_REMOTE_READ_FAILED',
  'GCS_REMOTE_UNAVAILABLE',
  'GCS_OBJECT_MISSING',
  'CORPUS_RELEASE_POINTER_MISSING'
]);

const NETWORK_CODES = new Set([
  'ABORT_ERR',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET'
]);

function corpusBoundaryError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function errorChain(error) {
  const chain = [];
  const seen = new Set();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current) && chain.length < 8) {
    chain.push(current);
    seen.add(current);
    current = current.cause;
  }
  return chain;
}

function numericStatus(error) {
  for (const candidate of errorChain(error)) {
    const value = Number(candidate.statusCode || candidate.response?.status || candidate.code || 0);
    if ([401, 403, 404, 408, 429].includes(value) || (value >= 500 && value <= 599)) return value;
  }
  return 0;
}

function isTransportFailure(error) {
  return errorChain(error).some((candidate) => {
    if (NETWORK_CODES.has(String(candidate.code || '').toUpperCase())) return true;
    if (candidate.name === 'AbortError' || candidate.name === 'TimeoutError') return true;
    // Native fetch deliberately exposes transport failure as a TypeError without a code.
    return candidate instanceof TypeError && candidate.message === 'fetch failed';
  });
}

function normalizeRemoteReadError(error, missingCode = 'GCS_OBJECT_MISSING') {
  if (REMOTE_READ_CODES.has(error?.code)) return error;
  const status = numericStatus(error);
  if (status === 404) {
    return corpusBoundaryError(missingCode, 'The requested remote corpus object does not exist.', error);
  }
  if (status === 401 || status === 403) {
    return corpusBoundaryError(
      'GCS_READ_PERMISSION_REQUIRED',
      'Remote corpus read permission or valid credentials are required.',
      error
    );
  }
  if (status === 408 || status === 429 || (status >= 500 && status <= 599)) {
    return corpusBoundaryError(
      'GCS_REMOTE_UNAVAILABLE',
      'The remote corpus service is unavailable.',
      error
    );
  }
  if (isTransportFailure(error)) {
    return corpusBoundaryError(
      'GCS_REMOTE_UNAVAILABLE',
      'The remote corpus service is unavailable.',
      error
    );
  }
  return error;
}

function markCorpusFailure(error, state) {
  if (!error || typeof error !== 'object') return error;
  for (const [name, value] of Object.entries({
    corpusPhase: state.phase,
    localMutationStarted: Boolean(state.localMutationStarted),
    rollbackConfirmed: Boolean(state.rollbackConfirmed)
  })) {
    try {
      Object.defineProperty(error, name, { configurable: true, value });
    } catch (_error) {
      // A frozen third-party error is still safe to propagate; it simply cannot degrade.
    }
  }
  return error;
}

function isDegradableRemoteReadFailure(error) {
  return Boolean(
    error
    && REMOTE_READ_CODES.has(error.code)
    && error.corpusPhase === 'REMOTE_READ'
    && error.localMutationStarted === false
  );
}

module.exports = {
  REMOTE_READ_CODES,
  isDegradableRemoteReadFailure,
  isTransportFailure,
  markCorpusFailure,
  normalizeRemoteReadError
};
