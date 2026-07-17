'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const assert = require('assert/strict');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs/promises');
const jwt = require('jsonwebtoken');

const DEMO_ADMIN_EMAIL = 'admin@example.com';
const DEMO_ADMIN_PASSWORD = '123456';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
process.env.NODE_ENV = 'development';
process.env.AUTH_DEV_DELIVERY_LOG_SECRETS = 'true';
process.env.RAG_MODE = 'mock';

const required = [
  'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET',
  'TOKEN_HMAC_PEPPER', 'RAG_INTERNAL_TOKEN', 'UPLOAD_DIR'
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required for part2 smoke tests.`);
}

const app = require('../src/app');
const pool = require('../src/configs/db');
const withTransaction = require('../src/database/transaction');
const userRepo = require('../src/repositories/user-repository');
const documentRepo = require('../src/repositories/document-repository');
const documentService = require('../src/services/document-service');
const documentFileService = require('../src/services/document-file-service');

function accessToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, authVersion: user.auth_version },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function createActiveUser(role, suffix) {
  const email = `${role.toLowerCase()}.${suffix}@smoke.test`;
  const password = 'SmokePass@2026';
  const passwordHash = await bcrypt.hash(password, 10);
  const id = await withTransaction(async (connection) => {
    const roleRow = await userRepo.findRoleByCode(role, connection);
    const userId = await userRepo.createUser({
      roleId: roleRow.id,
      fullName: `${role} Smoke`,
      email,
      passwordHash,
      status: 'ACTIVE'
    }, connection);
    if (role === 'TEACHER') {
      await userRepo.createTeacherProfile({ userId, department: null }, connection);
    }
    return userId;
  });
  return { ...(await userRepo.findUserByEmail(email)), password, id };
}

async function recursiveFileCount(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      count += entry.isDirectory()
        ? await recursiveFileCount(`${directory}/${entry.name}`)
        : 1;
    }
    return count;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

async function listenOnSafePort(application) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = crypto.randomInt(20_000, 40_000);
    const server = application.listen(port, '127.0.0.1');
    try {
      await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
      return server;
    } catch (error) {
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('Could not allocate a safe local smoke-test port.');
}

async function main() {
  const suffix = `${Date.now()}-${crypto.randomInt(1000, 9999)}`;
  const teacher1 = await createActiveUser('TEACHER', `one-${suffix}`);
  const teacher2 = await createActiveUser('TEACHER', `two-${suffix}`);
  const admin = await userRepo.findUserByEmail(DEMO_ADMIN_EMAIL);
  assert(admin, 'Seeded Admin is required.');

  const server = await listenOnSafePort(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(path, options = {}, expectedStatus = 200) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      signal: options.signal || AbortSignal.timeout(15_000)
    });
    let payload = null;
    if (response.status !== 204 && response.headers.get('content-type')?.includes('application/json')) {
      payload = await response.json();
    }
    assert.equal(response.status, expectedStatus, `${options.method || 'GET'} ${path}: ${JSON.stringify(payload)}`);
    return { response, payload };
  }

  const auth = (token, extra = {}) => ({ authorization: `Bearer ${token}`, ...extra });
  const teacher1Token = (await request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: teacher1.email, password: teacher1.password })
  })).payload.data.token;
  let teacher2Token = accessToken(teacher2);
  let deliveredAdminOtp;
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const match = args.join(' ').match(/\[DEV-ONLY ADMIN OTP\] (\d{6})/);
    if (match) deliveredAdminOtp = match[1];
    else originalWarn(...args);
  };
  let adminToken;
  try {
    const login = await request('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: DEMO_ADMIN_EMAIL, password: DEMO_ADMIN_PASSWORD })
    });
    assert.equal(login.payload.data.requireOtp, true, 'Admin password login must require OTP.');
    assert.match(deliveredAdminOtp || '', /^\d{6}$/, 'Development adapter must deliver an Admin OTP.');
    const verified = await request('/api/auth/admin/verify-otp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: DEMO_ADMIN_EMAIL, otpCode: deliveredAdminOtp })
    });
    adminToken = verified.payload.data.token;
    assert.equal(jwt.verify(adminToken, process.env.JWT_SECRET).role, 'ADMIN');
  } finally {
    console.warn = originalWarn;
  }

  try {
    await request('/api/admin/users?limit=5', { headers: auth(adminToken) });
    await request('/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `weak.${suffix}@smoke.test`, password: DEMO_ADMIN_PASSWORD,
        fullName: 'Weak Password', role: 'TEACHER'
      })
    }, 400);
    const studentEmail = `student.${suffix}@smoke.test`;
    const studentPassword = 'StudentPass@2026';
    await request('/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: studentEmail, password: studentPassword, fullName: 'Student Smoke',
        role: 'STUDENT', studentCode: `SV-${suffix}`, dateOfBirth: '2004-01-02'
      })
    }, 201);
    let studentToken = (await request('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: studentEmail, password: studentPassword })
    })).payload.data.token;
    await request('/api/profile', { headers: auth(studentToken) });
    await request('/api/profile', {
      method: 'PUT', headers: auth(studentToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ fullName: 'Student Updated', dateOfBirth: '2004-02-03' })
    });
    await request('/api/profile/password', {
      method: 'PUT', headers: auth(studentToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ oldPassword: studentPassword, newPassword: 'StudentNew@2026' })
    });
    await request('/api/profile', { headers: auth(studentToken) }, 401);
    studentToken = (await request('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: studentEmail, password: 'StudentNew@2026' })
    })).payload.data.token;

    const pendingEmail = `pending.${suffix}@smoke.test`;
    await request('/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: pendingEmail, password: 'PendingPass@2026', fullName: 'Pending Teacher', role: 'TEACHER'
      })
    }, 201);
    const pending = await userRepo.findUserByEmail(pendingEmail);
    await request(`/api/admin/users/${pending.id}/status`, {
      method: 'PUT', headers: auth(adminToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ status: 'ACTIVE', reviewNote: 'Smoke approve' })
    });
    const rejectedEmail = `rejected.${suffix}@smoke.test`;
    await request('/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: rejectedEmail, password: 'RejectPass@2026', fullName: 'Rejected Teacher', role: 'TEACHER'
      })
    }, 201);
    const rejected = await userRepo.findUserByEmail(rejectedEmail);
    await request(`/api/admin/users/${rejected.id}/status`, {
      method: 'PUT', headers: auth(adminToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ status: 'REJECTED', reviewNote: 'Smoke reject' })
    });

    await request(`/api/admin/users/${teacher2.id}/status`, {
      method: 'PUT', headers: auth(adminToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ status: 'LOCKED', lockReason: 'Smoke lock' })
    });
    await request('/api/profile', { headers: auth(teacher2Token) }, 403);
    await request(`/api/admin/users/${teacher2.id}/status`, {
      method: 'PUT', headers: auth(adminToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ status: 'ACTIVE' })
    });
    teacher2Token = (await request('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: teacher2.email, password: teacher2.password })
    })).payload.data.token;

    await request('/api/documents', { headers: auth(studentToken) }, 403);
    await request('/api/documents', { headers: auth(process.env.RAG_INTERNAL_TOKEN) }, 401);

    const invalidForm = new FormData();
    invalidForm.append('file', new Blob(['not a pdf'], { type: 'application/pdf' }), 'invalid.pdf');
    await request('/api/documents', {
      method: 'POST', headers: auth(teacher1Token), body: invalidForm
    }, 400);

    const largeForm = new FormData();
    largeForm.append('file', new Blob([Buffer.alloc(Number(process.env.FILE_MAX_SIZE_BYTES) + 1)], { type: 'text/plain' }), 'large.txt');
    await request('/api/documents', {
      method: 'POST', headers: auth(teacher1Token), body: largeForm
    }, 413);

    const beforeCleanup = await recursiveFileCount(process.env.UPLOAD_DIR);
    const originalCreate = documentRepo.createDocument;
    documentRepo.createDocument = async () => { throw new Error('SMOKE_DB_FAILURE'); };
    await assert.rejects(() => documentService.uploadDocument(
      { id: teacher1.id, role: 'TEACHER' },
      {
        buffer: Buffer.from('cleanup test'), size: 12, originalname: 'cleanup.txt', mimetype: 'text/plain'
      },
      'Cleanup test'
    ));
    documentRepo.createDocument = originalCreate;
    assert.equal(await recursiveFileCount(process.env.UPLOAD_DIR), beforeCleanup, 'DB failure must clean stored file.');

    const uploadForm = new FormData();
    uploadForm.append('file', new Blob(['verified source text'], { type: 'text/plain' }), 'source.txt');
    uploadForm.append('title', 'Smoke Document');
    const uploaded = (await request('/api/documents', {
      method: 'POST', headers: auth(teacher1Token), body: uploadForm
    }, 202)).payload.data;
    const documentId = uploaded.document.id;
    const jobId = uploaded.job.id;
    assert.equal(uploaded.document.processingStatus, 'PROCESSING');
    await request(`/api/documents/jobs/${jobId}`, { headers: auth(teacher1Token) });

    await request(`/api/documents/${documentId}`, { headers: auth(teacher2Token) }, 404);
    await request('/api/documents', { headers: auth(adminToken) });
    await request('/api/internal/rag/processing-callback', {
      method: 'POST', headers: auth(teacher1Token, { 'content-type': 'application/json' }),
      body: JSON.stringify({ eventType: 'PROGRESS', jobId, attemptCount: 1, stage: 'PARSING' })
    }, 401);
    await request('/api/internal/rag/processing-callback', {
      method: 'POST',
      headers: auth(process.env.RAG_INTERNAL_TOKEN, { 'content-type': 'application/json' }),
      body: JSON.stringify({ eventType: 'PROGRESS', jobId, attemptCount: 1, stage: 'PARSING' })
    });
    await request('/api/internal/rag/processing-callback', {
      method: 'POST', headers: auth(process.env.RAG_INTERNAL_TOKEN, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        eventType: 'SUCCEEDED', jobId, attemptCount: 1,
        chunks: [{ chunkIndex: 0, vectorNodeId: 'invalid', chunkText: 'x', contentHash: 'x' }]
      })
    }, 400);
    await request('/api/internal/rag/processing-callback', {
      method: 'POST', headers: auth(process.env.RAG_INTERNAL_TOKEN, { 'content-type': 'application/json' }),
      body: JSON.stringify({ eventType: 'SUCCEEDED', jobId, attemptCount: 1, chunks: [] })
    }, 400);

    const vectorNodeId = crypto.randomUUID();
    const callback = {
      eventType: 'SUCCEEDED', jobId, attemptCount: 1, documentId,
      chunks: [{
        chunkIndex: 0,
        vectorNodeId,
        chunkText: 'verified source text',
        contentHash: crypto.createHash('sha256').update('verified source text').digest('hex'),
        tokenCount: 3,
        pageNumber: 1,
        sourceLocator: { line: 1 }
      }],
      result: { parserName: 'smoke', pipelineVersion: 'smoke-v1' }
    };
    const internalHeaders = auth(process.env.RAG_INTERNAL_TOKEN, { 'content-type': 'application/json' });
    await request('/api/internal/rag/processing-callback', {
      method: 'POST', headers: internalHeaders, body: JSON.stringify(callback)
    });
    const duplicate = (await request('/api/internal/rag/processing-callback', {
      method: 'POST', headers: internalHeaders, body: JSON.stringify(callback)
    })).payload.data;
    assert.equal(duplicate.duplicate, true);
    const stale = (await request('/api/internal/rag/processing-callback', {
      method: 'POST', headers: internalHeaders,
      body: JSON.stringify({ ...callback, attemptCount: 2 })
    })).payload.data;
    assert.equal(stale.ignored, true);

    const detail = (await request(`/api/documents/${documentId}`, { headers: auth(teacher1Token) })).payload.data;
    assert.equal(detail.document.processingStatus, 'READY');
    await request(`/api/documents/${documentId}`, {
      method: 'PATCH', headers: auth(teacher1Token, { 'content-type': 'application/json' }),
      body: JSON.stringify({ title: 'Smoke Document Updated' })
    });
    const fileResponse = await fetch(`${base}/api/documents/${documentId}/file`, {
      headers: auth(teacher1Token),
      signal: AbortSignal.timeout(15_000)
    });
    assert.equal(fileResponse.status, 200);
    assert.equal(await fileResponse.text(), 'verified source text');

    await request(`/api/documents/${documentId}/hide`, { method: 'POST', headers: auth(teacher1Token) }, 202);
    await request(`/api/documents/${documentId}/unhide`, { method: 'POST', headers: auth(teacher1Token) }, 202);

    process.env.RAG_MOCK_SOURCE_VECTOR_NODE_ID = vectorNodeId;
    process.env.RAG_MOCK_MULTI_USAGE = 'true';
    const session = (await request('/api/chat/sessions', {
      method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ title: 'Smoke Chat' })
    }, 201)).payload.data;
    await request('/api/chat/sessions', { headers: auth(studentToken) });
    const clientRequestId = crypto.randomUUID();
    const chat = (await request(`/api/chat/sessions/${session.id}/messages`, {
      method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ content: 'Câu hỏi smoke', clientRequestId })
    })).payload.data;
    assert.equal(chat.clientRequestId, clientRequestId);
    assert.equal(chat.assistantMessage.citations.length, 1);
    const citationId = chat.assistantMessage.citations[0].id;
    const duplicateChat = (await request(`/api/chat/sessions/${session.id}/messages`, {
      method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ content: 'Câu hỏi smoke', clientRequestId })
    })).payload.data;
    assert.equal(duplicateChat.duplicate, true);
    assert.equal(duplicateChat.clientRequestId, clientRequestId);

    const optionalRequestCases = [
      { label: 'omitted', body: { content: 'Generated request id: omitted' } },
      { label: 'null', body: { content: 'Generated request id: null', clientRequestId: null } },
      { label: 'empty', body: { content: 'Generated request id: empty', clientRequestId: '' } },
      { label: 'whitespace', body: { content: 'Generated request id: whitespace', clientRequestId: '   ' } }
    ];
    const generatedRequestIds = new Set();
    for (const item of optionalRequestCases) {
      const result = (await request(`/api/chat/sessions/${session.id}/messages`, {
        method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }),
        body: JSON.stringify(item.body)
      })).payload.data;
      assert(UUID.test(result.clientRequestId), `${item.label} must return a generated UUID.`);
      assert(!generatedRequestIds.has(result.clientRequestId), `${item.label} reused a generated UUID.`);
      generatedRequestIds.add(result.clientRequestId);
    }

    const concurrentSession = (await request('/api/chat/sessions', {
      method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ title: 'Concurrent Smoke' })
    }, 201)).payload.data;
    const concurrentId = crypto.randomUUID();
    const concurrentResults = await Promise.all([
      request(`/api/chat/sessions/${concurrentSession.id}/messages`, {
        method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }),
        body: JSON.stringify({ content: 'Concurrent retry', clientRequestId: concurrentId })
      }),
      request(`/api/chat/sessions/${concurrentSession.id}/messages`, {
        method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }),
        body: JSON.stringify({ content: 'Concurrent retry', clientRequestId: concurrentId })
      })
    ]);
    assert.deepEqual(
      concurrentResults.map((item) => item.payload.data.duplicate).sort(),
      [false, true],
      'Concurrent retry must create exactly one USER message.'
    );
    assert(concurrentResults.every((item) => item.payload.data.clientRequestId === concurrentId));
    const concurrentHistory = (await request(
      `/api/chat/sessions/${concurrentSession.id}/messages`,
      { headers: auth(studentToken) }
    )).payload.data.messages;
    assert.equal(new Set(concurrentHistory.map((message) => message.messageOrder)).size, 2);

    const conflictSession = (await request('/api/chat/sessions', {
      method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }), body: '{}'
    }, 201)).payload.data;
    await request(`/api/chat/sessions/${conflictSession.id}/messages`, {
      method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ content: 'Cross-session conflict', clientRequestId })
    }, 409);
    await request(`/api/chat/sessions/${session.id}/messages`, { headers: auth(studentToken) });
    const availableCitation = (await request(`/api/citations/${citationId}`, {
      headers: auth(studentToken)
    })).payload.data;
    assert.equal(availableCitation.originalAvailable, true);

    const storedDocument = await documentRepo.findById(documentId);
    await documentFileService.remove(storedDocument.storage_key);
    const missingOriginalCitation = (await request(`/api/citations/${citationId}/source`, {
      headers: auth(studentToken)
    })).payload.data;
    assert.equal(missingOriginalCitation.originalAvailable, false);
    await request(`/api/documents/${documentId}/file`, { headers: auth(teacher1Token) }, 404);

    await request(`/api/documents/${documentId}/hide`, { method: 'POST', headers: auth(teacher1Token) }, 202);
    const hiddenCitation = (await request(`/api/citations/${citationId}/source`, {
      headers: auth(studentToken)
    })).payload.data;
    assert.equal(hiddenCitation.originalAvailable, false);
    await request(`/api/citations/${citationId}/file`, { headers: auth(studentToken) }, 409);
    await request(`/api/documents/${documentId}`, { method: 'DELETE', headers: auth(teacher1Token) }, 202);
    await request(`/api/citations/${citationId}`, { headers: auth(studentToken) });
    await request(`/api/chat/sessions/${session.id}/messages`, { headers: auth(studentToken) });

    const noAnswerSession = (await request('/api/chat/sessions', {
      method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }), body: '{}'
    }, 201)).payload.data;
    delete process.env.RAG_MOCK_SOURCE_VECTOR_NODE_ID;
    const noAnswer = (await request(`/api/chat/sessions/${noAnswerSession.id}/messages`, {
      method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ content: '__NO_ANSWER__', clientRequestId: crypto.randomUUID() })
    })).payload.data;
    assert.equal(noAnswer.assistantMessage.noAnswer, true);
    await request(`/api/chat/sessions/${noAnswerSession.id}/messages`, {
      method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ content: '__RAG_ERROR__', clientRequestId: crypto.randomUUID() })
    }, 502);

    const rollbackForm = new FormData();
    rollbackForm.append('file', new Blob(['rollback source'], { type: 'text/plain' }), 'rollback.txt');
    const rollbackUpload = (await request('/api/documents', {
      method: 'POST', headers: auth(teacher1Token), body: rollbackForm
    }, 202)).payload.data;
    const rollbackCallback = {
      eventType: 'SUCCEEDED', jobId: rollbackUpload.job.id, attemptCount: 1,
      chunks: [{
        chunkIndex: 0, vectorNodeId, chunkText: 'duplicate vector',
        contentHash: crypto.createHash('sha256').update('duplicate vector').digest('hex')
      }]
    };
    await request('/api/internal/rag/processing-callback', {
      method: 'POST', headers: internalHeaders, body: JSON.stringify(rollbackCallback)
    }, 500);
    const rolledBack = (await request(`/api/documents/${rollbackUpload.document.id}`, {
      headers: auth(teacher1Token)
    })).payload.data;
    assert.equal(rolledBack.document.processingStatus, 'PROCESSING');
    assert.equal(rolledBack.latestJob.status, 'RUNNING');
    rollbackCallback.chunks[0].vectorNodeId = crypto.randomUUID();
    await request('/api/internal/rag/processing-callback', {
      method: 'POST', headers: internalHeaders, body: JSON.stringify(rollbackCallback)
    });

    process.env.RAG_MODE = 'remote';
    const remoteForm = new FormData();
    remoteForm.append('file', new Blob(['remote failure'], { type: 'text/plain' }), 'remote.txt');
    const remoteFailure = await request('/api/documents', {
      method: 'POST', headers: auth(teacher1Token), body: remoteForm
    }, 503);
    assert(remoteFailure.payload.data.documentId);
    const failedDetail = (await request(`/api/documents/${remoteFailure.payload.data.documentId}`, {
      headers: auth(adminToken)
    })).payload.data;
    assert.equal(failedDetail.document.processingStatus, 'FAILED');
    process.env.RAG_MODE = 'mock';

    const dashboard = (await request('/api/admin/dashboard/summary', { headers: auth(adminToken) })).payload.data;
    assert.equal(dashboard.usage.scope, 'LLM_CALLS_ONLY');
    assert(dashboard.usage.totals.calls >= 2);

    await request(`/api/chat/sessions/${session.id}`, { method: 'DELETE', headers: auth(studentToken) }, 204);
    await request(`/api/chat/sessions/${session.id}`, { headers: auth(studentToken) }, 404);

    console.log('PART2_SMOKE_OK');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error(error);
  try {
    await pool.end();
  } catch (_) {
    // The normal test teardown may already have closed the pool.
  }
  process.exit(1);
});
