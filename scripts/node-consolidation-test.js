'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');

process.env.TOKEN_HMAC_PEPPER = process.env.TOKEN_HMAC_PEPPER || 'test-only-token-pepper-at-least-32-characters';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret-at-least-32-characters';
process.env.RAG_INTERNAL_TOKEN = process.env.RAG_INTERNAL_TOKEN || 'test-only-internal-token-at-least-32-characters';

const authService = require('../src/services/auth-service');
const citationService = require('../src/services/citation-service');
const citationRepo = require('../src/repositories/citation-repository');
const { normalizeQueryResult } = require('../src/clients/rag-contract');
const { createCorsMiddleware } = require('../src/middlewares/cors-middleware');
const { errorHandler } = require('../src/middlewares/error-middleware');
const { createRateLimiter } = require('../src/middlewares/rate-limit-middleware');
const appError = require('../src/utils/app-error');
const TOKEN_TYPES = require('../src/constants/token-types');
const jwt = require('jsonwebtoken');
const authConfig = require('../src/configs/auth');
const { authMiddleware } = require('../src/middlewares/auth-middleware');
const userRepo = require('../src/repositories/user-repository');
const app = require('../src/app');
const { validDocxArchive } = require('../src/services/document-file-service');
const { shutdown } = require('../src/server');
const messageRepo = require('../src/repositories/chat-message-repository');
const tokenRepo = require('../src/repositories/token-repository');
const { MockRagClient } = require('../src/clients/rag-client');
const dbPool = require('../src/configs/db');

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
  const logs = [];
  console.error = (...values) => { logs.push(values.join(' ')); };
  try { errorHandler(error, {}, response, () => {}); } finally { console.error = previousError; }
  assert.equal(response.statusCode, 500);
  assert.equal(response.payload.errorCode, 'INTERNAL_SERVER_ERROR');
  assert(!JSON.stringify(response.payload).includes('private database'));
  assert(!Object.hasOwn(response.payload, 'data'));
  assert(!logs.join('\n').includes('private database'), 'Unknown error details must also be redacted from central logs.');

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
    storage_key: 'documents/7/demo.pdf',
    uploaded_by: 12,
    processing_status: 'READY',
    visibility_status: 'HIDDEN',
    document_title_snapshot: 'Demo',
    source_text_snapshot: 'Snapshot'
  });
  try {
    const own = await citationService.getCitation({ id: 41, role: 'STUDENT' }, 7);
    assert.equal(own.id, 7);
    assert.equal(own.originalAvailable, false, 'Hidden/deleted source keeps snapshot but not general original access.');
    await assert.rejects(
      () => citationService.getCitation({ id: 99, role: 'ADMIN' }, 7),
      (error) => error.status === 404 && error.code === 'CITATION_NOT_FOUND'
    );
    citationRepo.findContextById = async () => ({ session_deleted_at: new Date(), session_user_id: 41 });
    await assert.rejects(
      () => citationService.getCitation({ id: 41, role: 'STUDENT' }, 7),
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
  let hashCalls = 0;
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
    hashPassword: async () => { hashCalls += 1; return 'hashed-password'; }
  };

  await assert.rejects(
    () => authService.resetPassword({ token: `${userId}.${invalidSecret}`, newPassword: 'ValidPass@2026' }, dependencies),
    (error) => error.code === 'INVALID_OR_EXPIRED_TOKEN'
  );
  assert.equal(used, false, 'A forged token must not consume the valid token.');
  assert.equal(failedAttemptWrites, 0, 'Password reset must not mutate attempt_count for a forged token.');
  assert.equal(hashCalls, 0, 'A forged reset token must be rejected before bcrypt/hash work.');
  await authService.resetPassword({ token: `${userId}.${validSecret}`, newPassword: 'ValidPass@2026' }, dependencies);
  assert.equal(passwordUpdates, 1);
  await assert.rejects(
    () => authService.resetPassword({ token: `${userId}.${validSecret}`, newPassword: 'ValidPass@2026' }, dependencies),
    (error) => error.code === 'INVALID_OR_EXPIRED_TOKEN'
  );
  assert.equal(passwordUpdates, 1, 'A consumed reset token must not be reused.');
}

async function testLogoutAllAndJwtConstraints() {
  let version = 3;
  let increments = 0;
  const users = {
    async findUserByIdForUpdate() { return { id: 7, auth_version: version }; },
    async incrementAuthVersionIfCurrent(_id, expected) {
      if (version !== expected) return false;
      version += 1;
      increments += 1;
      return true;
    }
  };
  const dependencies = { userRepo: users, withTransaction: async (work) => work({}) };
  await Promise.all([
    authService.logoutAll(7, 3, dependencies),
    authService.logoutAll(7, 3, dependencies)
  ]);
  assert.equal(version, 4);
  assert.equal(increments, 1, 'Concurrent logout-all must increment auth_version exactly once.');

  const token = authService.signJwt({ id: 7, role: 'STUDENT', auth_version: 4 });
  const claims = jwt.verify(token, authConfig.secret, {
    algorithms: [authConfig.algorithm], issuer: authConfig.issuer, audience: authConfig.audience
  });
  assert.equal(claims.type, 'access');
  assert.equal(claims.sub, '7');
  assert(Number.isSafeInteger(claims.iat) && claims.exp > claims.iat);
  assert.match(claims.jti, /^[0-9a-f-]{36}$/i);

  const original = userRepo.findAuthUserById;
  userRepo.findAuthUserById = async () => ({
    id: 7, email: 'student@smoke.test', role: 'STUDENT', status: 'ACTIVE', auth_version: 4
  });
  try {
    let reached = false;
    const response = responseCapture();
    response.err = function err(status, message, code) {
      this.statusCode = status; this.payload = { message, errorCode: code }; return this;
    };
    await authMiddleware({ headers: { authorization: `Bearer ${token}` } }, response, () => { reached = true; });
    assert.equal(reached, true);
    const oldToken = authService.signJwt({ id: 7, role: 'STUDENT', auth_version: 3 });
    reached = false;
    await authMiddleware(
      { headers: { authorization: `Bearer ${oldToken}` } }, response,
      () => { reached = true; }
    );
    assert.equal(reached, false, 'A token issued before logout-all must be revoked by auth_version.');
    assert.equal(response.payload.errorCode, 'TOKEN_REVOKED');
    const wrongPurpose = jwt.sign(
      { id: 7, role: 'STUDENT', authVersion: 4, type: 'reset' },
      authConfig.secret,
      { algorithm: 'HS256', issuer: authConfig.issuer, audience: authConfig.audience, subject: '7', jwtid: crypto.randomUUID() }
    );
    reached = false;
    await authMiddleware(
      { headers: { authorization: `Bearer ${wrongPurpose}` } }, response,
      () => { reached = true; }
    );
    assert.equal(reached, false);
    assert.equal(response.statusCode, 401);
    const missingSubject = jwt.sign(
      { id: 7, role: 'STUDENT', authVersion: 4, type: 'access' },
      authConfig.secret,
      { algorithm: authConfig.algorithm, issuer: authConfig.issuer, audience: authConfig.audience, jwtid: crypto.randomUUID() }
    );
    reached = false;
    await authMiddleware(
      { headers: { authorization: `Bearer ${missingSubject}` } }, response,
      () => { reached = true; }
    );
    assert.equal(reached, false, 'JWTs missing the required subject claim must be rejected.');
    for (const invalidOptions of [
      { issuer: 'wrong-issuer', audience: authConfig.audience },
      { issuer: authConfig.issuer, audience: 'wrong-audience' }
    ]) {
      const constrained = jwt.sign(
        { id: 7, role: 'STUDENT', authVersion: 4, type: 'access' },
        authConfig.secret,
        { algorithm: authConfig.algorithm, ...invalidOptions, subject: '7', jwtid: crypto.randomUUID() }
      );
      reached = false;
      await authMiddleware(
        { headers: { authorization: `Bearer ${constrained}` } }, response,
        () => { reached = true; }
      );
      assert.equal(reached, false, 'JWT issuer and audience constraints must be enforced.');
      assert.equal(response.statusCode, 401);
    }
  } finally {
    userRepo.findAuthUserById = original;
  }
}

async function testHeadersAndCallbackAuthBeforeBody() {
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(health.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert(health.headers.get('content-security-policy'));
    assert.equal(health.headers.get('strict-transport-security'), null, 'Local HTTP must not advertise HSTS.');
    const unauthorized = await fetch(`${base}/api/internal/rag/processing-callback`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{'.repeat(200000)
    });
    assert.equal(unauthorized.status, 401, 'Internal auth must reject before parsing a large invalid body.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function testDocxArchiveGate() {
  assert.equal(validDocxArchive(Buffer.from('PK\u0003\u0004not-a-docx')), false);
  const names = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'];
  const locals = [];
  const central = [];
  let offset = 0;
  for (const value of names) {
    const name = Buffer.from(value);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local);
    const entry = Buffer.alloc(46 + name.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    name.copy(entry, 46);
    central.push(entry);
    offset += local.length;
  }
  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  assert.equal(validDocxArchive(Buffer.concat([...locals, centralBytes, eocd])), true);
}

async function testGracefulShutdown() {
  let httpCloses = 0;
  let poolCloses = 0;
  const fakeServer = { close(done) { httpCloses += 1; done(); } };
  const fakePool = { async end() { poolCloses += 1; } };
  const first = shutdown('TEST', { server: fakeServer, pool: fakePool, timeoutMs: 1000 });
  const second = shutdown('TEST', { server: fakeServer, pool: fakePool, timeoutMs: 1000 });
  assert.equal(first, second, 'Shutdown handler must be idempotent.');
  assert.equal((await first).graceful, true);
  assert.equal(httpCloses, 1);
  assert.equal(poolCloses, 1);
}

async function testPendingRecoveryAndMockDisposition() {
  let sqlText = '';
  const executor = {
    async execute(sql, values) {
      sqlText = sql;
      assert.deepEqual(values, [9, 120000000]);
      return [{ affectedRows: 1 }];
    }
  };
  assert.equal(await messageRepo.failStalePending(9, 120000, executor), true);
  assert.match(sqlText, /status = 'PENDING'/);
  assert.match(sqlText, /RAG_PENDING_TIMEOUT/);

  const previous = process.env.RAG_MOCK_SOURCE_VECTOR_NODE_ID;
  delete process.env.RAG_MOCK_SOURCE_VECTOR_NODE_ID;
  try {
    const result = await new MockRagClient().query({ requestId: crypto.randomUUID(), question: 'hello' });
    assert.equal(result.noAnswer, true);
    assert.deepEqual(result.sources, []);
  } finally {
    if (previous === undefined) delete process.env.RAG_MOCK_SOURCE_VECTOR_NODE_ID;
    else process.env.RAG_MOCK_SOURCE_VECTOR_NODE_ID = previous;
  }
  assert(dbPool.pool.config.queueLimit > 0, 'MySQL pool queue must be bounded.');
  assert(dbPool.queryTimeoutMs >= 1000 && dbPool.queryTimeoutMs <= 300000,
    'Every pool/transaction query must inherit a bounded timeout.');
  let queryOptions = null;
  const fakeExecutor = {
    async query(options) { queryOptions = options; return [[], []]; },
    async execute() { return [[], []]; }
  };
  await dbPool.applyQueryTimeout(fakeExecutor).query('SELECT SLEEP(?)', [0]);
  assert.equal(queryOptions.timeout, dbPool.queryTimeoutMs);
  assert.equal(queryOptions.sql, 'SELECT SLEEP(?)');

  let cleanupSql = '';
  const removed = await tokenRepo.deleteExpiredTokens(50000, {
    async execute(sql) { cleanupSql = sql; return [{ affectedRows: 3 }]; }
  });
  assert.equal(removed, 3);
  assert.match(cleanupSql, /expires_at <= CURRENT_TIMESTAMP\(3\)/);
  assert.match(cleanupSql, /LIMIT 1000/);
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
  await testLogoutAllAndJwtConstraints();
  await testHeadersAndCallbackAuthBeforeBody();
  testDocxArchiveGate();
  await testPendingRecoveryAndMockDisposition();
  await testGracefulShutdown();
  testCitationContract();
  console.log('NODE_CONSOLIDATION_OK');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
