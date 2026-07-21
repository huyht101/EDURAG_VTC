'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  MockRagClient,
  RemoteRagClient
} = require('../src/clients/rag-client');
const {
  normalizeAcceptedResponse,
  normalizeProcessingCallback,
  normalizeQueryResult
} = require('../src/clients/rag-contract');
const { resolveSharedUploadPath } = require('../src/storage/shared-upload-path');
const validateProcessingCallback = require('../src/validators/processing-callback');
const { handleCallback } = require('../src/services/processing-callback-service');

const fixtureRoot = path.join(__dirname, '..', 'tests', 'fixtures', 'rag-contract', 'v0.1');
const storageKey = 'documents/2026/07/44444444-4444-4444-8444-444444444444.pdf';
const internalToken = 'contract-test-token-0123456789-abcdef';
const config = {
  serviceUrl: 'http://python.test',
  internalToken,
  requestTimeoutMs: 50,
  queryTimeoutMs: 50,
  defaultSubjectId: 'mvp-global',
  sharedUploadDirectory: '/shared/uploads',
  callbackUrl: 'http://node:5000/api/internal/rag/processing-callback'
};

function fixture(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, relativePath), 'utf8'));
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

function textResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body
  };
}

async function captureRemote(response, action) {
  const calls = [];
  const client = new RemoteRagClient(config, async (url, options) => {
    calls.push({ url: String(url), options });
    return response;
  });
  const result = await action(client);
  assert.equal(calls.length, 1);
  return { call: calls[0], result };
}

function parsedBody(call) {
  return JSON.parse(call.options.body);
}

function assertBearer(call) {
  assert.equal(call.options.headers.authorization, `Bearer ${internalToken}`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

async function testIngestContract() {
  const expectedRequest = fixture('ingest/request.json');
  const accepted = fixture('ingest/accepted-response.json');
  const { call, result } = await captureRemote(jsonResponse(accepted), (client) => client.startIngest({
    documentId: '42',
    jobId: '101',
    attemptCount: 2,
    file: { storageKey },
    teacherMetadata: {
      userId: '7',
      email: 'must-not-cross-boundary@example.test',
      role: 'TEACHER'
    }
  }));

  assert.equal(call.options.method, 'POST');
  assert.equal(call.url, 'http://python.test/api/ingest');
  assertBearer(call);
  assert.deepEqual(parsedBody(call), expectedRequest);
  assert.deepEqual(result, {
    accepted: true,
    completed: false,
    mode: 'remote',
    jobId: '101'
  });

  assert.throws(
    () => normalizeAcceptedResponse({ status: 'accepted', job_id: '999' }, '101'),
    (error) => error.code === 'RAG_JOB_ID_MISMATCH' && error.status === 502
  );
  assert.throws(
    () => normalizeAcceptedResponse({ status: 'accepted' }, '101'),
    (error) => error.code === 'RAG_ACCEPTED_RESPONSE_INVALID' && error.status === 502
  );
  assert.throws(
    () => normalizeAcceptedResponse({ job_id: '101' }, '101'),
    (error) => error.code === 'RAG_ACCEPTED_RESPONSE_INVALID' && error.status === 502
  );
  assert.deepEqual(
    normalizeAcceptedResponse({ status: 'rejected', job_id: '101' }, '101'),
    { accepted: false, completed: false, mode: 'remote', jobId: '101' }
  );
}

function testSharedPathSafety() {
  assert.equal(
    resolveSharedUploadPath(storageKey, '/shared/uploads'),
    fixture('ingest/request.json').file_path
  );
  assert.throws(
    () => resolveSharedUploadPath('../outside.pdf', '/shared/uploads'),
    (error) => error.code === 'INVALID_STORAGE_KEY'
  );
  assert.throws(
    () => resolveSharedUploadPath(storageKey, 'relative/uploads'),
    (error) => error.code === 'RAG_SHARED_UPLOAD_DIR_INVALID'
  );
}

async function testDocumentOperations() {
  const visibility = await captureRemote(
    jsonResponse({ status: 'accepted', job_id: '102' }),
    (client) => client.setRetrieval({
      documentId: '42',
      jobId: '102',
      attemptCount: 1,
      enabled: false
    })
  );
  assert.equal(visibility.call.options.method, 'PATCH');
  assert.equal(visibility.call.url, 'http://python.test/api/docs/42/visibility');
  assertBearer(visibility.call);
  assert.deepEqual(parsedBody(visibility.call), fixture('documents/visibility-request.json'));

  const unhide = await captureRemote(
    jsonResponse({ status: 'accepted', job_id: '104' }),
    (client) => client.setRetrieval({
      documentId: '42',
      jobId: '104',
      attemptCount: 2,
      enabled: true
    })
  );
  assert.deepEqual(parsedBody(unhide.call), {
    job_id: '104',
    attempt_count: 2,
    action: 'unhide',
    callback_url: config.callbackUrl
  });

  const deletion = await captureRemote(
    jsonResponse({ status: 'accepted', job_id: '103' }),
    (client) => client.deleteVectors({
      documentId: '42',
      jobId: '103',
      attemptCount: 1
    })
  );
  assert.equal(deletion.call.options.method, 'DELETE');
  assert.equal(deletion.call.url, 'http://python.test/api/ingest/42');
  assertBearer(deletion.call);
  assert.deepEqual(parsedBody(deletion.call), fixture('documents/delete-request.json'));
}

async function testChatContract() {
  const request = fixture('chat/query-request.json');
  const answer = fixture('chat/answer-response.json');
  const { call, result } = await captureRemote(jsonResponse(answer), (client) => client.query({
    requestId: request.request_id,
    userId: request.user_id,
    sessionId: request.conversation_id,
    question: request.question,
    history: [
      { role: 'USER', content: 'Earlier question' },
      { role: 'ASSISTANT', content: 'Earlier answer' }
    ]
  }));
  assert.equal(call.options.method, 'POST');
  assert.equal(call.url, 'http://python.test/api/query');
  assertBearer(call);
  assert.deepEqual(parsedBody(call), request);
  assert.equal(parsedBody(call).history.length, 2);
  assert.deepEqual(parsedBody(call).history.map((entry) => entry.role), ['user', 'assistant']);

  assert.equal(result.answer, answer.answer);
  assert.equal(result.noAnswer, false);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].vectorNodeId, answer.citations[0].vector_node_id);
  assert.equal(result.sources[0].sourceText, answer.citations[0].snippet);
  assert.equal(result.sources[0].sectionTitle, answer.citations[0].chapter);
  assert.equal(result.usageCalls.length, 1);
  assert.deepEqual(result.usageCalls[0], {
    callIndex: 1,
    operationType: 'ANSWER_GENERATION',
    provider: 'GOOGLE',
    model: 'models/gemini-3.5-flash',
    promptTokens: 21,
    completionTokens: 8,
    estimatedCost: null,
    currency: 'USD',
    latencyMs: null,
    status: 'SUCCEEDED',
    errorCode: null
  });

  const multiUsage = normalizeQueryResult({
    ...answer,
    usage: undefined,
    usage_calls: [
      { call_index: 1, operation_type: 'QUERY_REWRITE', provider: 'GOOGLE', model: 'router', prompt_tokens: 4, completion_tokens: 1 },
      { call_index: 2, operation_type: 'ANSWER_GENERATION', provider: 'GOOGLE', model: 'answer', prompt_tokens: 10, completion_tokens: 3 }
    ]
  });
  assert.deepEqual(multiUsage.usageCalls.map((call) => call.operationType), [
    'QUERY_REWRITE', 'ANSWER_GENERATION'
  ]);

  const noAnswerPayload = {
    ...fixture('chat/no-answer-response.json'),
    citations: [{ snippet: 'Must not become a synthetic citation.' }]
  };
  const noAnswer = normalizeQueryResult(noAnswerPayload);
  assert.equal(noAnswer.noAnswer, true);
  assert.equal(noAnswer.answer, noAnswerPayload.answer);
  assert.deepEqual(noAnswer.sources, []);
  assert.throws(
    () => normalizeQueryResult({
      answer: 'Answer without evidence.',
      no_answer: false,
      citations: []
    }),
    (error) => error.code === 'RAG_CITATIONS_REQUIRED' && error.status === 502
  );
  assert.throws(
    () => normalizeQueryResult({
      answer: 'Unverifiable',
      no_answer: false,
      citations: [{ source_text: 'Missing vector ID.' }]
    }),
    (error) => error.code === 'RAG_CITATION_INVALID'
  );
  assert.throws(
    () => normalizeQueryResult({ answer: 'Missing no-answer and citations fields.' }),
    (error) => error.code === 'RAG_QUERY_RESPONSE_INVALID' && error.status === 502
  );
  assert.throws(
    () => normalizeQueryResult({
      answer: 'Wrong citations shape.',
      no_answer: false,
      citations: {}
    }),
    (error) => error.code === 'RAG_QUERY_RESPONSE_INVALID' && error.status === 502
  );
}

async function assertRemoteError(fetchImpl, expectedCode, expectedStatus) {
  const client = new RemoteRagClient(config, fetchImpl);
  await assert.rejects(
    () => client.query({
      requestId: '33333333-3333-4333-8333-333333333333',
      userId: '9',
      sessionId: '501',
      question: 'test',
      history: []
    }),
    (error) => error.code === expectedCode && error.status === expectedStatus
  );
}

async function testUpstreamErrors() {
  await assertRemoteError(
    async () => jsonResponse(fixture('chat/upstream-error.json'), 500),
    'RAG_QUERY_FAILED',
    503
  );
  await assertRemoteError(
    async () => jsonResponse({ detail: [{ loc: ['body', 'question'], msg: 'required' }] }, 422),
    'RAG_UPSTREAM_VALIDATION_ERROR',
    502
  );
  await assertRemoteError(
    async () => textResponse('<html>upstream proxy error</html>', 502),
    'RAG_UPSTREAM_INVALID_RESPONSE',
    502
  );
  await assertRemoteError(
    async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
    'RAG_REQUEST_TIMEOUT',
    503
  );
  await assertRemoteError(
    async () => {
      throw new TypeError('connection refused');
    },
    'RAG_SERVICE_UNAVAILABLE',
    503
  );
  const tokenLeakClient = new RemoteRagClient(config, async () => jsonResponse({
    error_code: 'RAG_ERROR',
    message: `Do not expose ${internalToken}\nTraceback: internal stack`
  }, 500));
  await assert.rejects(
    () => tokenLeakClient.query({
      requestId: '33333333-3333-4333-8333-333333333333',
      userId: '9',
      sessionId: '501',
      question: 'test',
      history: []
    }),
    (error) => error.message === 'Python RAG service is temporarily unavailable.'
      && !error.message.includes(internalToken)
      && !error.message.includes('Traceback')
  );
}

function callbackDependencies(job, mutations) {
  return {
    withTransaction: async (callback) => callback({ transaction: true }),
    jobRepo: {
      findByIdForUpdate: async () => job ? ({ ...job }) : null,
      markProgress: async () => mutations.push('job-progress'),
      markSucceeded: async () => mutations.push('job-succeeded'),
      markFailed: async () => mutations.push('job-failed'),
      markCancelled: async () => mutations.push('job-cancelled')
    },
    documentRepo: {
      findByIdForUpdate: async () => ({ id: job.document_id }),
      updateProcessingStatus: async () => mutations.push('document-processing'),
      updateVisibility: async () => mutations.push('document-visibility')
    },
    chunkRepo: {
      deleteByDocument: async () => mutations.push('chunks-deleted'),
      insertManifest: async (_documentId, _jobId, chunks) => {
        mutations.push('chunks-inserted');
        mutations.manifestLength = chunks.length;
      },
      countByJob: async () => mutations.manifestLength
    }
  };
}

async function testCallbackContract() {
  const raw = {
    ...fixture('ingest/callback-succeeded.json'),
    delivery_retry_count: 99
  };
  const normalized = normalizeProcessingCallback(raw);
  assert.equal(normalized.jobId, '101');
  assert.equal(normalized.documentId, undefined);
  assert.equal(normalized.attemptCount, 2);
  assert.equal(normalized.chunks[0].vectorNodeId, raw.chunk_manifest[0].chunk_id);
  assert.equal(normalized.chunks[0].chunkText, 'Chunk one full text.');
  assert.equal(normalized.chunks[1].pageNumber, null);
  assert.equal(validateProcessingCallback(normalized), null);

  const incompleteAlias = JSON.parse(JSON.stringify(raw));
  incompleteAlias.chunk_manifest[0] = {
    chunk_index: 0,
    chunk_id: incompleteAlias.chunk_manifest[0].chunk_id,
    text_preview: 'Preview is not the complete chunk.'
  };
  assert.throws(
    () => normalizeProcessingCallback(incompleteAlias),
    (error) => error.code === 'RAG_CALLBACK_INCOMPLETE_MANIFEST'
  );

  const incompleteManifest = normalizeProcessingCallback({
    ...raw,
    chunk_manifest: [{
      chunk_index: 0,
      vector_node_id: raw.chunk_manifest[1].vector_node_id,
      text_preview: 'Preview is not the complete chunk.'
    }]
  });
  assert.match(validateProcessingCallback(incompleteManifest).error, /chunkText/);

  const chunksAlias = {
    ...raw,
    chunks: raw.chunk_manifest
  };
  delete chunksAlias.chunk_manifest;
  assert.deepEqual(
    normalizeProcessingCallback(chunksAlias).chunks,
    normalized.chunks
  );

  const conflictingManifests = {
    ...raw,
    chunks: JSON.parse(JSON.stringify(raw.chunk_manifest))
  };
  conflictingManifests.chunks[0].chunk_text = 'Conflicting complete text.';
  conflictingManifests.chunks[0].content_hash = sha256('Conflicting complete text.');
  assert.throws(
    () => normalizeProcessingCallback(conflictingManifests),
    (error) => error.code === 'RAG_CALLBACK_MANIFEST_CONFLICT'
  );

  assert.equal(sha256(normalized.chunks[0].chunkText), normalized.chunks[0].contentHash);
  assert.equal(sha256(normalized.chunks[1].chunkText), normalized.chunks[1].contentHash);
  const invalidHash = JSON.parse(JSON.stringify(normalized));
  invalidHash.chunks[0].contentHash = 'a'.repeat(64);
  assert.match(validateProcessingCallback(invalidHash).error, /không khớp chunkText/);

  const successMutations = [];
  const success = await handleCallback(normalized, callbackDependencies({
    id: 101,
    document_id: 42,
    attempt_count: 2,
    status: 'RUNNING',
    job_type: 'INGEST',
    job_config: null
  }, successMutations));
  assert.deepEqual(success, { acknowledged: true, jobId: 101, status: 'SUCCEEDED' });
  assert.deepEqual(
    [...successMutations],
    ['chunks-inserted', 'job-succeeded', 'document-processing']
  );

  const staleMutations = [];
  const stale = await handleCallback(normalized, callbackDependencies({
    id: 101,
    document_id: 42,
    attempt_count: 3,
    status: 'RUNNING',
    job_type: 'INGEST',
    job_config: null
  }, staleMutations));
  assert.deepEqual(stale, { acknowledged: true, ignored: true, reason: 'STALE_ATTEMPT' });
  assert.deepEqual(staleMutations, []);

  const duplicateMutations = [];
  const duplicate = await handleCallback(normalized, callbackDependencies({
    id: 101,
    document_id: 42,
    attempt_count: 2,
    status: 'SUCCEEDED',
    job_type: 'INGEST',
    job_config: null
  }, duplicateMutations));
  assert.deepEqual(duplicate, { acknowledged: true, duplicate: true, jobId: 101 });
  assert.deepEqual(duplicateMutations, []);

  const mismatchMutations = [];
  await assert.rejects(
    () => handleCallback(
      { ...normalized, documentId: 43 },
      callbackDependencies({
        id: 101,
        document_id: 42,
        attempt_count: 2,
        status: 'RUNNING',
        job_type: 'INGEST',
        job_config: null
      }, mismatchMutations)
    ),
    (error) => error.code === 'CALLBACK_DOCUMENT_MISMATCH' && error.status === 400
  );
  assert.deepEqual(mismatchMutations, []);

  const missingJobMutations = [];
  await assert.rejects(
    () => handleCallback(normalized, callbackDependencies(null, missingJobMutations)),
    (error) => error.code === 'PROCESSING_JOB_NOT_FOUND' && error.status === 404
  );
  assert.deepEqual(missingJobMutations, []);

  const failed = normalizeProcessingCallback(fixture('ingest/callback-failed.json'));
  const failedMutations = [];
  assert.deepEqual(
    await handleCallback(failed, callbackDependencies({
      id: 101,
      document_id: 42,
      attempt_count: 2,
      status: 'RUNNING',
      job_type: 'INGEST',
      job_config: null
    }, failedMutations)),
    { acknowledged: true, jobId: 101, status: 'FAILED' }
  );
  assert.deepEqual(failedMutations, ['job-failed', 'document-processing']);

  const cancelledMutations = [];
  assert.deepEqual(
    await handleCallback(
      { ...failed, eventType: 'CANCELLED' },
      callbackDependencies({
        id: 101,
        document_id: 42,
        attempt_count: 2,
        status: 'RUNNING',
        job_type: 'INGEST',
        job_config: null
      }, cancelledMutations)
    ),
    { acknowledged: true, jobId: 101, status: 'CANCELLED' }
  );
  assert.deepEqual(cancelledMutations, ['job-cancelled', 'document-processing']);

  for (const [callbackFixture, jobType, targetVisibility] of [
    ['documents/visibility-callback.json', 'SET_RETRIEVAL', 'HIDDEN'],
    ['documents/delete-callback.json', 'DELETE_VECTORS', 'DELETED']
  ]) {
    const operationMutations = [];
    const operation = normalizeProcessingCallback(fixture(callbackFixture));
    assert.deepEqual(
      await handleCallback(operation, callbackDependencies({
        id: Number(operation.jobId),
        document_id: 42,
        attempt_count: 1,
        status: 'RUNNING',
        job_type: jobType,
        job_config: JSON.stringify({ targetVisibility })
      }, operationMutations)),
      { acknowledged: true, jobId: Number(operation.jobId), status: 'SUCCEEDED' }
    );
    assert.deepEqual(operationMutations, ['job-succeeded', 'document-visibility']);
  }

  for (const callbackFixture of [
    'ingest/callback-failed.json',
    'documents/visibility-callback.json',
    'documents/delete-callback.json'
  ]) {
    assert.equal(
      validateProcessingCallback(normalizeProcessingCallback(fixture(callbackFixture))),
      null
    );
  }
}

async function testMockRegression() {
  const client = new MockRagClient();
  assert.deepEqual(await client.startIngest(), {
    accepted: true,
    completed: false,
    mode: 'mock'
  });
  assert.deepEqual(await client.setRetrieval(), {
    accepted: true,
    completed: true,
    mode: 'mock'
  });
  assert.deepEqual(await client.deleteVectors(), {
    accepted: true,
    completed: true,
    mode: 'mock'
  });
  const answer = await client.query({
    requestId: '33333333-3333-4333-8333-333333333333',
    question: 'mock regression'
  });
  assert.equal(answer.answer, null);
  assert.equal(answer.noAnswer, true);
  assert.equal(answer.usageCalls[0].provider, 'MOCK');
  const previous = process.env.RAG_MOCK_SOURCE_VECTOR_NODE_ID;
  process.env.RAG_MOCK_SOURCE_VECTOR_NODE_ID = '9589059b-c74b-40b8-896a-47aa77ed4601';
  try {
    const sourced = await client.query({ requestId: crypto.randomUUID(), question: 'sourced mock' });
    assert.equal(sourced.noAnswer, false);
    assert.equal(sourced.sources.length, 1);
  } finally {
    if (previous === undefined) delete process.env.RAG_MOCK_SOURCE_VECTOR_NODE_ID;
    else process.env.RAG_MOCK_SOURCE_VECTOR_NODE_ID = previous;
  }
}

async function main() {
  await testIngestContract();
  testSharedPathSafety();
  await testDocumentOperations();
  await testChatContract();
  await testUpstreamErrors();
  await testCallbackContract();
  await testMockRegression();
  console.log('RAG_CONTRACT_TESTS_OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
