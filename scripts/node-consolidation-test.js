'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');

process.env.TOKEN_HMAC_PEPPER = process.env.TOKEN_HMAC_PEPPER || 'test-only-token-pepper-at-least-32-characters';

const authService = require('../src/services/auth-service');
const citationService = require('../src/services/citation-service');
const citationRepo = require('../src/repositories/citation-repository');
const { normalizeQueryResult } = require('../src/clients/rag-contract');
const { createCorsMiddleware } = require('../src/middlewares/cors-middleware');
const { errorHandler } = require('../src/middlewares/error-middleware');
const { createRateLimiter } = require('../src/middlewares/rate-limit-middleware');
const appError = require('../src/utils/app-error');
const TOKEN_TYPES = require('../src/constants/token-types');

async function listen(application) {
  return new Promise((resolve, reject) => {
    const server = application.listen(0, '127.0.0.1');
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

async function testRateLimit() {
  const application = express();
  application.get('/limited', createRateLimiter({
    windowMs: 60_000,
    limit: 2,
    identifier: 'test-auth-limit'
  }), (_req, res) => res.json({ ok: true }));
  const server = await listen(application);
  try {
    const url = `http://127.0.0.1:${server.address().port}/limited`;
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url)).status, 200);
    const limited = await fetch(url);
    assert.equal(limited.status, 429);
    assert(limited.headers.get('ratelimit'), 'Standard RateLimit header is required.');
    assert.equal((await limited.json()).errorCode, 'RATE_LIMIT_EXCEEDED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testCors() {
  const application = express();
  application.use(createCorsMiddleware(new Set(['http://frontend.test'])));
  application.get('/cors', (_req, res) => res.json({ ok: true }));
  application.use(errorHandler);
  const server = await listen(application);
  try {
    const url = `http://127.0.0.1:${server.address().port}/cors`;
    const withoutOrigin = await fetch(url);
    assert.equal(withoutOrigin.status, 200);
    const allowed = await fetch(url, { headers: { origin: 'http://frontend.test' } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://frontend.test');
    const previousError = console.error;
    console.error = () => {};
    try {
      const denied = await fetch(url, { headers: { origin: 'http://unknown.test' } });
      assert.equal(denied.status, 403);
      assert.equal((await denied.json()).errorCode, 'CORS_ORIGIN_DENIED');
    } finally {
      console.error = previousError;
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function responseCapture() {
  return {
    statusCode: null,
    payload: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; }
  };
}

function testErrorSanitization() {
  const response = responseCapture();
  const error = new Error('private database password at C:\\secret\\database.sql');
  error.data = { sql: 'SELECT secret' };
  const previousError = console.error;
  console.error = () => {};
  try { errorHandler(error, {}, response, () => {}); } finally { console.error = previousError; }
  assert.equal(response.statusCode, 500);
  assert.equal(response.payload.errorCode, 'INTERNAL_SERVER_ERROR');
  assert(!JSON.stringify(response.payload).includes('private database'));
  assert(!Object.hasOwn(response.payload, 'data'));

  const expectedResponse = responseCapture();
  const expected = appError(502, 'UPSTREAM_SAFE', 'Upstream request failed safely.', { requestId: 'safe-id' });
  console.error = () => {};
  try { errorHandler(expected, {}, expectedResponse, () => {}); } finally { console.error = previousError; }
  assert.equal(expectedResponse.statusCode, 502);
  assert.equal(expectedResponse.payload.message, expected.message);
  assert.deepEqual(expectedResponse.payload.data, { requestId: 'safe-id' });
}

async function testCitationOwnership() {
  const original = citationRepo.findContextById;
  citationRepo.findContextById = async () => ({
    id: 7,
    message_id: 8,
    session_user_id: 41,
    storage_key: null,
    document_title_snapshot: 'Demo',
    source_text_snapshot: 'Snapshot'
  });
  try {
    const own = await citationService.getCitation({ id: 41, role: 'STUDENT' }, 7);
    assert.equal(own.id, 7);
    await assert.rejects(
      () => citationService.getCitation({ id: 99, role: 'ADMIN' }, 7),
      (error) => error.status === 404 && error.code === 'CITATION_NOT_FOUND'
    );
  } finally {
    citationRepo.findContextById = original;
  }
}

async function testResetTokenIsolation() {
  const userId = 42;
  const validSecret = 'a'.repeat(64);
  const invalidSecret = 'b'.repeat(64);
  const validHash = crypto
    .createHmac('sha256', process.env.TOKEN_HMAC_PEPPER)
    .update(`${userId}:${TOKEN_TYPES.PASSWORD_RESET}:${validSecret}`)
    .digest('hex');
  let used = false;
  let passwordUpdates = 0;
  let failedAttemptWrites = 0;
  const tokens = {
    async findActiveTokenByUserAndType() {
      return !used ? { id: 9, user_id: userId, token_hash: validHash } : null;
    },
    async markTokenAsUsed() { used = true; },
    async recordFailedAttempt() { failedAttemptWrites += 1; }
  };
  const users = {
    async updatePasswordAndIncrementVersion(id, passwordHash) {
      assert.equal(id, userId);
      assert.equal(passwordHash, 'hashed-password');
      passwordUpdates += 1;
    }
  };
  const dependencies = {
    tokenRepo: tokens,
    userRepo: users,
    withTransaction: async (work) => work({}),
    hashPassword: async () => 'hashed-password'
  };

  await assert.rejects(
    () => authService.resetPassword({ token: `${userId}.${invalidSecret}`, newPassword: 'ValidPass@2026' }, dependencies),
    (error) => error.code === 'INVALID_OR_EXPIRED_TOKEN'
  );
  assert.equal(used, false, 'A forged token must not consume the valid token.');
  assert.equal(failedAttemptWrites, 0, 'Password reset must not mutate attempt_count for a forged token.');
  await authService.resetPassword({ token: `${userId}.${validSecret}`, newPassword: 'ValidPass@2026' }, dependencies);
  assert.equal(passwordUpdates, 1);
  await assert.rejects(
    () => authService.resetPassword({ token: `${userId}.${validSecret}`, newPassword: 'ValidPass@2026' }, dependencies),
    (error) => error.code === 'INVALID_OR_EXPIRED_TOKEN'
  );
  assert.equal(passwordUpdates, 1, 'A consumed reset token must not be reused.');
}

function testCitationContract() {
  assert.throws(
    () => normalizeQueryResult({ answer: 'Unsourced answer', no_answer: false, citations: [] }),
    (error) => error.status === 502 && error.code === 'RAG_CITATIONS_REQUIRED'
  );
  const noAnswer = normalizeQueryResult({
    answer: 'Không tìm thấy thông tin phù hợp.',
    no_answer: true,
    citations: [{ vector_node_id: crypto.randomUUID(), source_text: 'Ignored' }]
  });
  assert.deepEqual(noAnswer.sources, []);
}

async function main() {
  assert.equal(
    await bcrypt.compare('123456', '$2b$12$bMzMUHcWiX7.t.YAVHaFq.nMbxN/zHbowX3kWo/jH2Q2esR/o8I8K'),
    true,
    'bcrypt 6 must verify hashes created by the existing seed/runtime.'
  );
  await testRateLimit();
  await testCors();
  testErrorSanitization();
  await testCitationOwnership();
  await testResetTokenIsolation();
  testCitationContract();
  console.log('NODE_CONSOLIDATION_OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
