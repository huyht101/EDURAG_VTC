'use strict';

process.env.EMBEDDING_DIMENSION = '768';

const assert = require('assert/strict');
const http = require('http');

const { bootstrapCorpus } = require('./corpus-manager');
const {
  qdrantRequest,
  qdrantRuntimeCompatibility,
  waitForQdrantReady
} = require('./lib/corpus-runtime');
const { releaseError } = require('./lib/corpus-release');

function transient(code = 'UND_ERR_SOCKET') {
  const error = releaseError('CORPUS_QDRANT_NOT_READY', 'synthetic transient readiness failure');
  error.causeCode = code;
  error.cause = Object.assign(new Error('synthetic transport failure'), { code });
  return error;
}

function fakeClock() {
  let milliseconds = 0;
  return {
    now: () => milliseconds,
    sleep: async (duration) => { milliseconds += duration; },
    elapsed: () => milliseconds
  };
}

function captureLog() {
  const lines = [];
  return {
    lines,
    logger: {
      log: (value) => lines.push(String(value)),
      warn: (value) => lines.push(String(value))
    }
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function readinessTests() {
  const firstClock = fakeClock();
  const firstLog = captureLog();
  let firstAttempts = 0;
  const first = await waitForQdrantReady({
    now: firstClock.now,
    sleep: firstClock.sleep,
    log: firstLog.logger,
    request: async () => {
      firstAttempts += 1;
      if (firstAttempts === 1) throw transient('UND_ERR_SOCKET');
      return {};
    }
  });
  assert.equal(first.attempts, 2);
  assert.match(firstLog.lines[0], /^QDRANT_NOT_READY attempt=1 retryInMs=250 cause=UND_ERR_SOCKET$/);
  assert.match(firstLog.lines[1], /^QDRANT_READY attempts=2 elapsedMs=250$/);

  const slowClock = fakeClock();
  let slowAttempts = 0;
  const slow = await waitForQdrantReady({
    deadlineMs: 10000,
    retryBaseMs: 1000,
    retryMaxMs: 1000,
    now: slowClock.now,
    sleep: slowClock.sleep,
    log: captureLog().logger,
    request: async () => {
      slowAttempts += 1;
      if (slowAttempts <= 6) throw transient('ECONNREFUSED');
      return {};
    }
  });
  assert.equal(slow.attempts, 7);
  assert.equal(slow.elapsedMs, 6000, 'Readiness must outlive the reported 5x1s patch window.');

  const timeoutClock = fakeClock();
  let timeoutAttempts = 0;
  await assert.rejects(
    () => waitForQdrantReady({
      deadlineMs: 2500,
      retryBaseMs: 1000,
      retryMaxMs: 1000,
      now: timeoutClock.now,
      sleep: timeoutClock.sleep,
      log: captureLog().logger,
      request: async () => { timeoutAttempts += 1; throw transient('ECONNRESET'); }
    }),
    (error) => error.code === 'CORPUS_QDRANT_READINESS_TIMEOUT'
      && error.cause?.causeCode === 'ECONNRESET'
      && error.elapsedMs === 2500
  );
  assert.equal(timeoutClock.elapsed(), 2500);
  assert.equal(timeoutAttempts, 3);

  let permanentAttempts = 0;
  await assert.rejects(
    () => waitForQdrantReady({
      now: fakeClock().now,
      sleep: async () => { throw new Error('Permanent failure must not sleep.'); },
      log: captureLog().logger,
      request: async () => {
        permanentAttempts += 1;
        const error = releaseError('CORPUS_QDRANT_NOT_READY', 'permission denied');
        error.status = 401;
        throw error;
      }
    }),
    (error) => error.status === 401
  );
  assert.equal(permanentAttempts, 1);

  let mutationRequests = 0;
  const server = http.createServer((_request, response) => {
    mutationRequests += 1;
    response.writeHead(503, { 'content-type': 'text/plain' });
    response.end('not ready');
  });
  const baseUrl = await listen(server);
  try {
    await assert.rejects(
      () => qdrantRequest('/collections/test', { method: 'PUT', baseUrl }),
      (error) => error.status === 503
    );
    assert.equal(mutationRequests, 1, 'Unsafe mutation requests must remain single-attempt.');
  } finally {
    await close(server);
  }
}

async function corpusPolicyTests() {
  const compatibleStats = { mysqlVersion: '8.4.0' };
  assert.equal(qdrantRuntimeCompatibility(compatibleStats, {
    serverVersion: '1.18.2', exists: true, vectorSize: 768,
    distance: 'Cosine', collectionStatus: 'green'
  }).state, 'COMPATIBLE');
  assert.equal(qdrantRuntimeCompatibility(compatibleStats, {
    serverVersion: '1.18.2', exists: true, vectorSize: 1536,
    distance: 'Cosine', collectionStatus: 'green'
  }).code, 'CORPUS_EMBEDDING_MISMATCH');
  assert.equal(qdrantRuntimeCompatibility(compatibleStats, {
    serverVersion: '1.18.2', exists: true, vectorSize: 768,
    distance: 'Dot', collectionStatus: 'green'
  }).code, 'CORPUS_QDRANT_CONFIG_UNSUPPORTED');

  let restores = 0;
  const empty = await bootstrapCorpus({
    mode: 'auto',
    environment: {
      GCS_PROJECT_ID: 'test-project', GCS_BUCKET: 'edurag-test-bucket', GCS_OBJECT_PREFIX: 'portable-corpus/v1',
      GCS_CREDENTIALS_FILE: 'secrets/test-only-not-read.json'
    },
    inspectBootstrap: async () => ({
      state: 'EMPTY', partial: false, activeJobs: 0, releaseState: null,
      runtimeCompatibility: 'COMPATIBLE', stores: { mysql: 'EMPTY', qdrant: 'EMPTY', uploads: 'EMPTY' }
    }),
    restore: async () => { restores += 1; return { status: 'CORPUS_RESTORE_OK' }; }
  });
  assert.equal(empty.status, 'CORPUS_RESTORE_OK');
  assert.equal(restores, 1);

  let forbiddenCalls = 0;
  const diverged = await bootstrapCorpus({
    mode: 'auto',
    inspectBootstrap: async () => ({
      state: 'PRESENT', partial: false, activeJobs: 0, releaseState: null,
      runtimeCompatibility: 'COMPATIBLE', stores: { mysql: 'PRESENT', qdrant: 'PRESENT', uploads: 'PRESENT' }
    }),
    readPointer: async () => { forbiddenCalls += 1; },
    restore: async () => { forbiddenCalls += 1; }
  });
  assert.equal(diverged.status, 'CORPUS_LOCAL_DIVERGED_RETAINED');
  assert.equal(diverged.mutation, false);
  assert.equal(forbiddenCalls, 0, 'Auto diverged startup must not compare cloud or mutate local corpus.');

  const partial = await bootstrapCorpus({
    mode: 'auto',
    inspectBootstrap: async () => ({
      state: 'PRESENT', partial: true, activeJobs: 1, releaseState: null,
      runtimeCompatibility: 'COMPATIBLE', stores: { mysql: 'PRESENT', qdrant: 'EMPTY', uploads: 'PRESENT' }
    }),
    restore: async () => { forbiddenCalls += 1; }
  });
  assert.equal(partial.status, 'CORPUS_LOCAL_PARTIAL_RETAINED');
  assert.equal(partial.mutation, false);
  assert.equal(forbiddenCalls, 0);

  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'auto',
      inspectBootstrap: async () => ({ state: 'UNKNOWN', reason: 'synthetic' }),
      restore: async () => { forbiddenCalls += 1; }
    }),
    (error) => error.code === 'CORPUS_LOCAL_STATE_UNKNOWN'
  );
  assert.equal(forbiddenCalls, 0);

  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'auto',
      inspectBootstrap: async () => ({
        state: 'PRESENT', partial: false, releaseState: null,
        runtimeCompatibility: 'INCOMPATIBLE',
        incompatibility: { code: 'CORPUS_EMBEDDING_MISMATCH', component: 'QDRANT' }
      }),
      restore: async () => { forbiddenCalls += 1; }
    }),
    (error) => error.code === 'CORPUS_EMBEDDING_MISMATCH'
  );
  assert.equal(forbiddenCalls, 0);

  let requiredCalls = 0;
  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'required',
      restore: async () => {
        requiredCalls += 1;
        throw releaseError('CORPUS_EXISTING_STATE_MISMATCH', 'strict mismatch');
      }
    }),
    (error) => error.code === 'CORPUS_EXISTING_STATE_MISMATCH'
  );
  assert.equal(requiredCalls, 1);

  let offCalls = 0;
  const off = await bootstrapCorpus({
    mode: 'off',
    inspectBootstrap: async () => { offCalls += 1; },
    readPointer: async () => { offCalls += 1; },
    restore: async () => { offCalls += 1; }
  });
  assert.equal(off.reason, 'OFF');
  assert.equal(offCalls, 0);

  const rerun = await bootstrapCorpus({
    mode: 'auto',
    inspectBootstrap: async () => ({
      state: 'PRESENT', partial: false, activeJobs: 0, releaseState: null,
      runtimeCompatibility: 'COMPATIBLE', stores: { mysql: 'PRESENT', qdrant: 'PRESENT', uploads: 'PRESENT' }
    }),
    restore: async () => { forbiddenCalls += 1; }
  });
  assert.equal(rerun.status, 'CORPUS_LOCAL_DIVERGED_RETAINED');
  assert.equal(forbiddenCalls, 0);
}

async function main() {
  await readinessTests();
  await corpusPolicyTests();
  console.log(
    'CORPUS_STARTUP_POLICY_TEST_OK readiness_retry=true deadline=true permanent_fail_fast=true '
    + 'mutation_single_attempt=true auto_empty_restore=true auto_diverged_retained=true '
    + 'auto_partial_retained=true unknown_fail_closed=true incompatible_fail_closed=true '
    + 'required_strict=true off_no_cloud=true rerun=true'
  );
}

main().catch((error) => {
  console.error(`CORPUS_STARTUP_POLICY_TEST_FAILED: ${error.stack || error.message}`);
  process.exit(1);
});
