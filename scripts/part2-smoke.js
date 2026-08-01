'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const assert = require('assert/strict');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs/promises');
const jwt = require('jsonwebtoken');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

const DEMO_ADMIN_EMAIL = 'admin@example.com';
const DEMO_ADMIN_PASSWORD = '123456';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const { vietnameseDocxBytes } = require('./lib/vietnamese-docx-fixture');

const LIBRARY_SOURCE_FIXTURES = [
  {
    fileType: 'PDF',
    filename: 'Kế hoạch thực tập 😀.pdf',
    title: 'Kế hoạch thực tập 2026',
    mimeType: 'application/pdf',
    bytes: Buffer.from('%PDF-1.7\nEDURAG PDF source bytes\n%%EOF\n')
  },
  {
    fileType: 'DOCX',
    filename: 'library-source.docx',
    title: 'Báo "cáo"/(A_B) 100% \\ tiếng Việt',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes: Buffer.from(
      'UEsDBBQAAAAAAGx5+FwcQqjh7gAAAO4AAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDxUeXBlcyB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3BhY2thZ2UvMjAwNi9jb250ZW50LXR5cGVzIj48RGVmYXVsdCBFeHRlbnNpb249InJlbHMiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtcGFja2FnZS5yZWxhdGlvbnNoaXBzK3htbCIvPjxEZWZhdWx0IEV4dGVuc2lvbj0ieG1sIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24veG1sIi8+PC9UeXBlcz5QSwMEFAAAAAAAbHn4XGF7L0PyAAAA8gAAAAsAAABfcmVscy8ucmVsczxSZWxhdGlvbnNoaXBzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L3JlbGF0aW9uc2hpcHMiPjxSZWxhdGlvbnNoaXAgSWQ9InJJZDEiIFR5cGU9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L3JlbGF0aW9uc2hpcHMvb2ZmaWNlRG9jdW1lbnQiIFRhcmdldD0id29yZC9kb2N1bWVudC54bWwiLz48L1JlbGF0aW9uc2hpcHM+UEsDBBQAAAAAAGx5+FxG0CYzqgAAAKoAAAARAAAAd29yZC9kb2N1bWVudC54bWw8dzpkb2N1bWVudCB4bWxuczp3PSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvd29yZHByb2Nlc3NpbmdtbC8yMDA2L21haW4iPjx3OmJvZHk+PHc6cD48dzpyPjx3OnQ+RURVUkFHIERPQ1ggc291cmNlIGJ5dGVzPC93OnQ+PC93OnI+PC93OnA+PC93OmJvZHk+PC93OmRvY3VtZW50PlBLAQIUABQAAAAAAGx5+FwcQqjh7gAAAO4AAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQAFAAAAAAAbHn4XGF7L0PyAAAA8gAAAAsAAAAAAAAAAAAAAIABHwEAAF9yZWxzLy5yZWxzUEsBAhQAFAAAAAAAbHn4XEbQJjOqAAAAqgAAABEAAAAAAAAAAAAAAIABOgIAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAADAAMAuQAAABMDAAAAAA==',
      'base64'
    )
  },
  {
    fileType: 'TXT',
    filename: 'library-source.txt',
    mimeType: 'text/plain',
    bytes: Buffer.from('EDURAG TXT source bytes\n', 'utf8')
  }
];
process.env.NODE_ENV = 'development';
process.env.AUTH_DEV_DELIVERY_LOG_SECRETS = 'true';
process.env.RAG_MODE = 'mock';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
process.env.AUTH_SENSITIVE_RATE_LIMIT_MAX = '1000';

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
const authService = require('../src/services/auth-service');
const previewWorker = require('../src/workers/document-preview-worker');
const { sanitizeFilename } = require('../src/utils/content-disposition');
const { backfillDocument } = require('./backfill-document-previews');

function accessToken(user) {
  return authService.signJwt(user);
}

function assertInlineUtf8Filename(header, expectedFilename) {
  assert.match(header, /^inline;/i);
  assert(!/[\r\n]/.test(header));
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  assert(match, `Missing RFC 5987 filename*: ${header}`);
  assert.equal(decodeURIComponent(match[1]), sanitizeFilename(expectedFilename));
}

function assertAttachmentUtf8Filename(header, expectedFilename) {
  assert.match(header, /^attachment;/i);
  assert(!/[\r\n]/.test(header));
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (match) {
    assert.equal(decodeURIComponent(match[1]), sanitizeFilename(expectedFilename));
  } else {
    assert(/^[\x20-\x7e]+$/.test(expectedFilename), `Missing RFC 5987 filename*: ${header}`);
    assert(header.includes(`filename="${expectedFilename}"`));
  }
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

async function cleanupSmokeSuffix(suffix) {
  const emailMarker = `%${suffix}%`;
  const storageKeys = await withTransaction(async (connection) => {
    const [users] = await connection.execute(
      'SELECT id, avatar_storage_key FROM users WHERE email LIKE ?',
      [emailMarker]
    );
    const userIds = users.map((row) => row.id);
    if (!userIds.length) return [];
    const userMarks = userIds.map(() => '?').join(',');
    const [sessions] = await connection.execute(
      `SELECT id FROM chat_sessions WHERE user_id IN (${userMarks})`, userIds
    );
    const sessionIds = sessions.map((row) => row.id);
    const sessionMarks = sessionIds.map(() => '?').join(',');
    const [messages] = sessionIds.length
      ? await connection.execute(`SELECT id FROM chat_messages WHERE session_id IN (${sessionMarks})`, sessionIds)
      : [[]];
    const messageIds = messages.map((row) => row.id);
    const messageMarks = messageIds.map(() => '?').join(',');
    const [documents] = await connection.execute(
      `SELECT id, storage_key, preview_storage_key
       FROM documents WHERE uploaded_by IN (${userMarks})`,
      userIds
    );
    const documentIds = documents.map((row) => row.id);
    const documentMarks = documentIds.map(() => '?').join(',');

    if (messageIds.length) {
      await connection.execute(`DELETE FROM citations WHERE message_id IN (${messageMarks})`, messageIds);
      await connection.execute(`DELETE FROM llm_usage_logs WHERE message_id IN (${messageMarks})`, messageIds);
      await connection.execute(`DELETE FROM chat_messages WHERE id IN (${messageMarks})`, messageIds);
    }
    await connection.execute(`DELETE FROM llm_usage_logs WHERE user_id IN (${userMarks})`, userIds);
    if (sessionIds.length) {
      await connection.execute(`DELETE FROM chat_sessions WHERE id IN (${sessionMarks})`, sessionIds);
    }
    if (documentIds.length) {
      await connection.execute(`DELETE FROM document_chunks WHERE document_id IN (${documentMarks})`, documentIds);
      await connection.execute(`DELETE FROM document_processing_jobs WHERE document_id IN (${documentMarks})`, documentIds);
      await connection.execute(`DELETE FROM documents WHERE id IN (${documentMarks})`, documentIds);
    }
    await connection.execute(`DELETE FROM auth_tokens WHERE user_id IN (${userMarks})`, userIds);
    await connection.execute(`DELETE FROM users WHERE id IN (${userMarks})`, userIds);
    const [remaining] = await connection.execute(
      'SELECT COUNT(*) AS total FROM users WHERE email LIKE ?',
      [emailMarker]
    );
    assert.equal(Number(remaining[0].total), 0, 'Smoke cleanup must remove every user sharing the test marker.');
    return [
      ...users.map((row) => row.avatar_storage_key),
      ...documents.flatMap((row) => [row.storage_key, row.preview_storage_key])
    ].filter(Boolean);
  });
  await Promise.all(storageKeys.map((storageKey) => documentFileService.remove(storageKey).catch(() => {})));
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
  const conversionFailureDocxBytes = LIBRARY_SOURCE_FIXTURES[1].bytes;
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]);
  pdf.addPage([300, 400]);
  pdf.addPage([300, 400]);
  LIBRARY_SOURCE_FIXTURES[0].bytes = Buffer.from(await pdf.save());
  LIBRARY_SOURCE_FIXTURES[1].bytes = vietnameseDocxBytes();
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

  await previewWorker.start();
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
        email: `invalid-date.${suffix}@smoke.test`,
        password: studentPassword,
        fullName: 'Invalid Date',
        role: 'STUDENT',
        studentCode: `INVALID-${suffix}`,
        dateOfBirth: '2024-02-31'
      })
    }, 400);
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

    await request('/api/profile/avatar', {}, 401);
    let previousAvatarKey = null;
    for (const [format, mimeType, extension] of [
      ['jpeg', 'image/jpeg', '.jpg'], ['png', 'image/png', '.png'], ['webp', 'image/webp', '.webp']
    ]) {
      const bytes = await sharp({
        create: { width: 4, height: 3, channels: 3, background: '#1d4ed8' }
      })[format]().toBuffer();
      const form = new FormData();
      form.append('avatar', new Blob([bytes], { type: mimeType }), `ảnh ${format}${extension}`);
      const uploadedAvatar = (await request('/api/profile/avatar', {
        method: 'POST', headers: auth(studentToken), body: form
      })).payload.data;
      assert.deepEqual(uploadedAvatar, {
        avatarAvailable: true,
        avatarUrl: '/api/profile/avatar',
        avatarMimeType: mimeType
      });
      const profileWithAvatar = (await request('/api/profile', {
        headers: auth(studentToken)
      })).payload.data;
      assert.equal(profileWithAvatar.avatarAvailable, true);
      assert.equal(profileWithAvatar.avatarUrl, '/api/profile/avatar');
      assert.equal(profileWithAvatar.avatarMimeType, mimeType);
      assert(!Object.hasOwn(profileWithAvatar, 'avatar_storage_key'));
      assert(!Object.hasOwn(profileWithAvatar, 'avatar_mime_type'));
      const [[storedAvatar]] = await pool.execute(
        'SELECT avatar_storage_key, avatar_mime_type FROM users WHERE id = ?',
        [Number(jwt.decode(studentToken).id)]
      );
      assert.match(storedAvatar.avatar_storage_key, new RegExp(`^avatars/[0-9a-f-]{36}\\${extension}$`, 'i'));
      assert.equal(storedAvatar.avatar_mime_type, mimeType);
      assert(!JSON.stringify(uploadedAvatar).includes(storedAvatar.avatar_storage_key));
      assert.equal(await documentFileService.exists(storedAvatar.avatar_storage_key), true);
      if (previousAvatarKey) assert.equal(await documentFileService.exists(previousAvatarKey), false);
      previousAvatarKey = storedAvatar.avatar_storage_key;
      const fetchedAvatar = await fetch(`${base}/api/profile/avatar`, {
        headers: auth(studentToken), signal: AbortSignal.timeout(15_000)
      });
      assert.equal(fetchedAvatar.status, 200);
      assert.equal(fetchedAvatar.headers.get('content-type'), mimeType);
      assert.deepEqual(Buffer.from(await fetchedAvatar.arrayBuffer()), bytes);
    }
    const svgAvatar = new FormData();
    svgAvatar.append('avatar', new Blob([
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'
    ], { type: 'image/svg+xml' }), 'avatar.svg');
    await request('/api/profile/avatar', {
      method: 'POST', headers: auth(studentToken), body: svgAvatar
    }, 400);
    await request('/api/profile/avatar', { method: 'DELETE', headers: auth(studentToken) });
    await request('/api/profile/avatar', { method: 'DELETE', headers: auth(studentToken) });
    const [[clearedAvatar]] = await pool.execute(
      'SELECT avatar_storage_key, avatar_mime_type FROM users WHERE id = ?',
      [Number(jwt.decode(studentToken).id)]
    );
    assert.equal(clearedAvatar.avatar_storage_key, null);
    assert.equal(clearedAvatar.avatar_mime_type, null);
    assert.equal(await documentFileService.exists(previousAvatarKey), false);

    await request('/api/admin/users/export', {}, 401);
    await request('/api/admin/users/export', { headers: auth(teacher1Token) }, 403);
    const exportedUsers = await fetch(`${base}/api/admin/users/export?search=${encodeURIComponent(suffix)}`, {
      headers: auth(adminToken), signal: AbortSignal.timeout(15_000)
    });
    assert.equal(exportedUsers.status, 200);
    assert.match(exportedUsers.headers.get('content-type') || '', /^text\/csv; charset=utf-8/i);
    assert.equal(exportedUsers.headers.get('content-disposition'), 'attachment; filename="users.csv"');
    const exportedBytes = Buffer.from(await exportedUsers.arrayBuffer());
    assert.deepEqual([...exportedBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const exportedText = exportedBytes.subarray(3).toString('utf8');
    assert.match(exportedText, /^"id","fullName","email","role","status","createdAt"/);
    for (const forbidden of ['password_hash', 'auth_version', 'token_hash', 'otp']) {
      assert(!exportedText.toLowerCase().includes(forbidden));
    }

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
    await request('/api/documents', {
      method: 'POST', headers: auth(studentToken), body: new FormData()
    }, 403);
    await request('/api/library/documents', {}, 401);
    await request('/api/library/documents/1', {}, 401);
    await request('/api/library/documents/1/source', {}, 401);
    await request('/api/library/documents/1/preview', {}, 401);
    await request('/api/library/documents', { headers: auth(studentToken) });
    await request('/api/library/documents', { headers: auth(teacher1Token) });
    await request('/api/library/documents', { headers: auth(adminToken) });
    await request('/api/library/documents?visibilityStatus=DELETED', {
      headers: auth(studentToken)
    }, 400);
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
      { title: 'Cleanup test' }
    ));
    documentRepo.createDocument = originalCreate;
    assert.equal(await recursiveFileCount(process.env.UPLOAD_DIR), beforeCleanup, 'DB failure must clean stored file.');

    const uploadForm = new FormData();
    uploadForm.append('file', new Blob(['verified source text'], { type: 'text/plain' }), 'source.txt');
    uploadForm.append('title', 'Smoke Document');
    uploadForm.append('description', 'Smoke description');
    uploadForm.append('author', 'Smoke author');
    const uploaded = (await request('/api/documents', {
      method: 'POST', headers: auth(teacher1Token), body: uploadForm
    }, 202)).payload.data;
    const documentId = uploaded.document.id;
    const jobId = uploaded.job.id;
    assert.equal(uploaded.document.processingStatus, 'PROCESSING');
    await request(`/api/documents/${documentId}`, { headers: auth(studentToken) }, 403);
    await request(`/api/documents/${documentId}/file`, { headers: auth(studentToken) }, 403);
    await request(`/api/documents/${documentId}/preview`, { headers: auth(studentToken) }, 403);
    await request(`/api/documents/jobs/${jobId}`, { headers: auth(studentToken) }, 403);
    await request(`/api/documents/${documentId}`, {
      method: 'PATCH',
      headers: auth(studentToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ title: 'Forbidden Student Update' })
    }, 403);
    await request(`/api/documents/${documentId}/hide`, {
      method: 'POST', headers: auth(studentToken)
    }, 403);
    await request(`/api/documents/${documentId}/unhide`, {
      method: 'POST', headers: auth(studentToken)
    }, 403);
    await request(`/api/documents/${documentId}`, {
      method: 'DELETE', headers: auth(studentToken)
    }, 403);
    const processingLibrary = (await request('/api/library/documents?search=Smoke%20Document', {
      headers: auth(studentToken)
    })).payload.data.documents;
    assert(!processingLibrary.some((document) => Number(document.id) === Number(documentId)));
    await request(`/api/library/documents/${documentId}`, { headers: auth(studentToken) }, 404);
    await request(`/api/library/documents/${documentId}/source`, { headers: auth(studentToken) }, 404);
    await request(`/api/documents/jobs/${jobId}`, { headers: auth(teacher1Token) });

    await request(`/api/documents/${documentId}`, { headers: auth(teacher2Token) }, 404);
    await request(`/api/documents/${documentId}/file`, { headers: auth(teacher2Token) }, 404);
    await request(`/api/documents/${documentId}/preview`, { headers: auth(teacher2Token) }, 404);
    await request(`/api/documents/jobs/${jobId}`, { headers: auth(teacher2Token) }, 404);
    await request(`/api/documents/${documentId}`, {
      method: 'PATCH',
      headers: auth(teacher2Token, { 'content-type': 'application/json' }),
      body: JSON.stringify({ title: 'Forbidden Cross-owner Update' })
    }, 404);
    await request(`/api/documents/${documentId}/hide`, {
      method: 'POST', headers: auth(teacher2Token)
    }, 404);
    await request(`/api/documents/${documentId}/unhide`, {
      method: 'POST', headers: auth(teacher2Token)
    }, 404);
    await request(`/api/documents/${documentId}`, {
      method: 'DELETE', headers: auth(teacher2Token)
    }, 404);
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
    assert.equal(duplicate.outcome, 'IDEMPOTENT_REPLAY');
    assert.equal(duplicate.canActivate, true);
    const stale = (await request('/api/internal/rag/processing-callback', {
      method: 'POST', headers: internalHeaders,
      body: JSON.stringify({ ...callback, attemptCount: 2 })
    })).payload.data;
    assert.equal(stale.outcome, 'IGNORED');
    assert.equal(stale.canActivate, false);
    assert.equal(stale.reason, 'STALE_ATTEMPT');

    const detail = (await request(`/api/documents/${documentId}`, { headers: auth(teacher1Token) })).payload.data;
    assert.equal(detail.document.processingStatus, 'READY');
    assert.equal(detail.document.description, 'Smoke description');
    assert.equal(detail.document.author, 'Smoke author');
    assert.equal(detail.document.pageCount, null);
    assert.equal(detail.document.previewStatus, 'NOT_APPLICABLE');
    const libraryTokens = [studentToken, teacher2Token, adminToken];
    const libraryDocuments = [];
    for (const token of libraryTokens) {
      const page = (await request('/api/library/documents?search=Smoke%20Document&limit=10', {
        headers: auth(token)
      })).payload.data;
      const document = page.documents.find((item) => Number(item.id) === Number(documentId));
      assert(document, 'READY + VISIBLE document must appear in Document Library for every role.');
      libraryDocuments.push(document);
    }
    const [libraryDocument] = libraryDocuments;
    assert.deepEqual(
      Object.keys(libraryDocument).sort(),
      [
        'author', 'createdAt', 'description', 'fileSize', 'fileType', 'id',
        'originalAvailable', 'originalFileUrl', 'pageCount', 'previewAvailable',
        'previewMimeType', 'previewStatus', 'previewUrl', 'title', 'updatedAt'
      ]
    );
    assert.equal(libraryDocument.originalAvailable, true);
    assert.equal(libraryDocument.description, 'Smoke description');
    assert.equal(libraryDocument.author, 'Smoke author');
    for (const [index, token] of libraryTokens.entries()) {
      assert.deepEqual(libraryDocuments[index], libraryDocument);
      const libraryDetail = (await request(`/api/library/documents/${documentId}`, {
        headers: auth(token)
      })).payload.data.document;
      assert.deepEqual(libraryDetail, libraryDocument);
      const librarySource = await fetch(`${base}/api/library/documents/${documentId}/source`, {
        headers: auth(token),
        signal: AbortSignal.timeout(15_000)
      });
      assert.equal(librarySource.status, 200);
      assert.match(librarySource.headers.get('content-disposition') || '', /attachment/i);
      assert.equal(await librarySource.text(), 'verified source text');
    }

    async function uploadSearchFixture({
      token,
      title,
      description,
      author,
      filename,
      mimeType = 'text/plain',
      bytes = Buffer.from(`source ${title}`, 'utf8'),
      complete = true
    }) {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: mimeType }), filename);
      form.append('title', title);
      form.append('description', description);
      form.append('author', author);
      const result = (await request('/api/documents', {
        method: 'POST',
        headers: auth(token),
        body: form
      }, 202)).payload.data;
      if (complete) {
        const text = `search fixture ${result.document.id}`;
        await request('/api/internal/rag/processing-callback', {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({
            eventType: 'SUCCEEDED',
            jobId: result.job.id,
            documentId: result.document.id,
            attemptCount: 1,
            chunks: [{
              chunkIndex: 0,
              vectorNodeId: crypto.randomUUID(),
              chunkText: text,
              contentHash: crypto.createHash('sha256').update(text).digest('hex'),
              pageNumber: result.document.fileType === 'PDF' ? 1 : null
            }]
          })
        });
      }
      return result;
    }

    function listPath(prefix, query) {
      return `${prefix}?${new URLSearchParams(query).toString()}`;
    }

    const listMarker = `list-${suffix}`;
    const readySearchFixtures = [];
    readySearchFixtures.push(await uploadSearchFixture({
      token: teacher1Token,
      title: 'Danh mục ổn định',
      description: `${listMarker} mô tả tiếng Việt`,
      author: 'Tác giả 100%',
      filename: `${listMarker}-percent.pdf`,
      mimeType: 'application/pdf',
      bytes: LIBRARY_SOURCE_FIXTURES[0].bytes
    }));
    readySearchFixtures.push(await uploadSearchFixture({
      token: teacher1Token,
      title: 'Danh mục ổn định',
      description: `${listMarker} mô tả DOCX`,
      author: 'Tác_giả',
      filename: `${listMarker}-underscore.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: LIBRARY_SOURCE_FIXTURES[1].bytes
    }));
    readySearchFixtures.push(await uploadSearchFixture({
      token: teacher1Token,
      title: 'Zeta tài liệu',
      description: `${listMarker} mô tả TXT`,
      author: 'Tác\\giả',
      filename: `${listMarker}-backslash.txt`
    }));
    readySearchFixtures.push(await uploadSearchFixture({
      token: teacher1Token,
      title: 'Alpha tài liệu',
      description: `${listMarker} x' OR 1=1 --`,
      author: "O'Brien",
      filename: `${listMarker}-quote.txt`
    }));
    readySearchFixtures.push(await uploadSearchFixture({
      token: teacher2Token,
      title: 'Tài liệu owner khác',
      description: `${listMarker} owner thứ hai`,
      author: 'Nguyễn Ánh',
      filename: `original-${listMarker}-needle.txt`
    }));

    const processingFixture = await uploadSearchFixture({
      token: teacher1Token,
      title: `Processing ${listMarker}`,
      description: `${listMarker} processing`,
      author: 'Processing author',
      filename: `${listMarker}-processing.txt`,
      complete: false
    });
    const failedFixture = await uploadSearchFixture({
      token: teacher1Token,
      title: `Failed ${listMarker}`,
      description: `${listMarker} failed`,
      author: 'Failed author',
      filename: `${listMarker}-failed.txt`,
      complete: false
    });
    await documentRepo.updateProcessingStatus(failedFixture.document.id, 'FAILED');
    const hiddenFixture = await uploadSearchFixture({
      token: teacher1Token,
      title: `Hidden ${listMarker}`,
      description: `${listMarker} hidden`,
      author: 'Hidden author',
      filename: `${listMarker}-hidden.txt`
    });
    await request(`/api/documents/${hiddenFixture.document.id}/hide`, {
      method: 'POST',
      headers: auth(teacher1Token)
    }, 202);
    const deletedFixture = await uploadSearchFixture({
      token: teacher1Token,
      title: `Deleted ${listMarker}`,
      description: `${listMarker} deleted`,
      author: 'Deleted author',
      filename: `${listMarker}-deleted.txt`
    });
    await request(`/api/documents/${deletedFixture.document.id}`, {
      method: 'DELETE',
      headers: auth(teacher1Token)
    }, 202);

    const publicQuery = {
      q: listMarker,
      page: '1',
      limit: '100',
      sort: 'title_asc'
    };
    const publicPages = [];
    for (const pageNumber of [1, 2, 3]) {
      const page = (await request(listPath('/api/library/documents', {
        ...publicQuery,
        page: String(pageNumber),
        limit: '2'
      }), { headers: auth(studentToken) })).payload.data;
      assert.equal(page.page, pageNumber);
      assert.equal(page.offset, (pageNumber - 1) * 2);
      assert.equal(page.limit, 2);
      assert.equal(page.total, 5);
      assert.equal(page.totalPages, 3);
      publicPages.push(...page.documents);
    }
    assert.equal(publicPages.length, 5);
    assert.equal(new Set(publicPages.map((document) => document.id)).size, 5);
    assert.deepEqual(
      new Set(publicPages.map((document) => document.id)),
      new Set(readySearchFixtures.map((fixture) => fixture.document.id))
    );
    const equalTitleIds = publicPages
      .filter((document) => document.title === 'Danh mục ổn định')
      .map((document) => Number(document.id));
    assert.deepEqual(equalTitleIds, [...equalTitleIds].sort((left, right) => left - right));

    const sortedIds = {};
    for (const sort of ['newest', 'oldest', 'title_asc', 'title_desc']) {
      const result = (await request(listPath('/api/library/documents', {
        q: listMarker,
        sort,
        page: '1',
        limit: '100'
      }), { headers: auth(studentToken) })).payload.data;
      assert.equal(result.total, 5);
      sortedIds[sort] = result.documents.map((document) => Number(document.id));
    }
    assert.deepEqual(sortedIds.newest, [...sortedIds.oldest].reverse());
    assert.deepEqual(sortedIds.title_desc, [...sortedIds.title_asc].reverse());

    const rolePages = [];
    for (const token of [studentToken, teacher1Token, teacher2Token, adminToken]) {
      rolePages.push((await request(
        listPath('/api/library/documents', publicQuery),
        { headers: auth(token) }
      )).payload.data);
    }
    for (const rolePage of rolePages.slice(1)) assert.deepEqual(rolePage, rolePages[0]);

    const legacySearch = (await request(listPath('/api/library/documents', {
      search: listMarker,
      page: '1',
      limit: '100',
      sort: 'title_asc'
    }), { headers: auth(studentToken) })).payload.data;
    assert.deepEqual(legacySearch.documents, rolePages[0].documents);
    const matchingAliases = (await request(listPath('/api/library/documents', {
      q: ` ${listMarker} `,
      search: listMarker,
      page: '1',
      offset: '0',
      limit: '100',
      sort: 'title_asc'
    }), { headers: auth(studentToken) })).payload.data;
    assert.deepEqual(matchingAliases, rolePages[0]);
    const exactOffset = (await request(listPath('/api/library/documents', {
      q: listMarker,
      offset: '3',
      limit: '2',
      sort: 'title_asc'
    }), { headers: auth(studentToken) })).payload.data;
    assert.equal(exactOffset.offset, 3);
    assert.equal(exactOffset.page, 2);
    assert.equal(exactOffset.total, 5);
    assert.deepEqual(exactOffset.documents, rolePages[0].documents.slice(3, 5));
    const matchingPageOffset = (await request(listPath('/api/library/documents', {
      q: listMarker,
      page: '2',
      offset: '2',
      limit: '2',
      sort: 'title_asc'
    }), { headers: auth(studentToken) })).payload.data;
    assert.deepEqual(matchingPageOffset.documents, rolePages[0].documents.slice(2, 4));

    const literalCases = [
      ['%', readySearchFixtures[0].document.id],
      ['_', readySearchFixtures[1].document.id],
      ['\\', readySearchFixtures[2].document.id],
      ["x' OR 1=1 --", readySearchFixtures[3].document.id],
      ['Nguyễn Ánh', readySearchFixtures[4].document.id]
    ];
    for (const [q, expectedId] of literalCases) {
      const result = (await request(listPath('/api/library/documents', {
        q,
        page: '1',
        limit: '100'
      }), { headers: auth(studentToken) })).payload.data;
      assert.equal(result.total, 1, `Literal search must match exactly one fixture: ${q}`);
      assert.equal(Number(result.documents[0].id), Number(expectedId));
    }
    const combinedLibrary = (await request(listPath('/api/library/documents', {
      q: listMarker,
      fileType: 'TXT',
      author: 'Nguyễn',
      sort: 'oldest',
      page: '1',
      limit: '20'
    }), { headers: auth(studentToken) })).payload.data;
    assert.equal(combinedLibrary.total, 1);
    assert.equal(Number(combinedLibrary.documents[0].id), Number(readySearchFixtures[4].document.id));
    for (const [fileType, expectedTotal] of [['PDF', 1], ['DOCX', 1], ['TXT', 3]]) {
      const result = (await request(listPath('/api/library/documents', {
        q: listMarker,
        fileType,
        page: '1',
        limit: '100'
      }), { headers: auth(studentToken) })).payload.data;
      assert.equal(result.total, expectedTotal);
      assert(result.documents.every((document) => document.fileType === fileType));
    }
    await request('/api/library/documents?q=%20%20&author=%20%20', {
      headers: auth(studentToken)
    });
    for (const invalidQuery of [
      'fileType=PPTX',
      'sort=random',
      'page=0',
      'limit=101',
      'processingStatus=FAILED',
      'q=new&search=legacy',
      'page=2&offset=3&limit=2'
    ]) {
      await request(`/api/library/documents?${invalidQuery}`, {
        headers: auth(studentToken)
      }, 400);
    }
    for (const fixture of [processingFixture, failedFixture, hiddenFixture, deletedFixture]) {
      for (const endpoint of [
        `/api/library/documents/${fixture.document.id}`,
        `/api/library/documents/${fixture.document.id}/source`,
        `/api/library/documents/${fixture.document.id}/preview`
      ]) {
        await request(endpoint, { headers: auth(studentToken) }, 404);
      }
    }

    const teacher1Management = (await request(listPath('/api/documents', {
      q: listMarker,
      page: '1',
      limit: '100',
      sort: 'oldest'
    }), { headers: auth(teacher1Token) })).payload.data;
    assert(teacher1Management.documents.length >= 7);
    assert(teacher1Management.documents.every(
      (document) => Number(document.uploadedBy) === Number(teacher1.id)
    ));
    assert(!teacher1Management.documents.some(
      (document) => Number(document.id) === Number(readySearchFixtures[4].document.id)
    ));
    const teacher2Management = (await request(listPath('/api/documents', {
      q: listMarker,
      page: '1',
      limit: '100'
    }), { headers: auth(teacher2Token) })).payload.data;
    assert.equal(teacher2Management.total, 1);
    assert.equal(
      Number(teacher2Management.documents[0].id),
      Number(readySearchFixtures[4].document.id)
    );
    await request(`/api/documents?ownerId=${teacher2.id}`, {
      headers: auth(teacher1Token)
    }, 403);
    const adminOwner = (await request(`/api/documents?ownerId=${teacher2.id}`, {
      headers: auth(adminToken)
    })).payload.data;
    assert(adminOwner.documents.every(
      (document) => Number(document.uploadedBy) === Number(teacher2.id)
    ));
    assert(adminOwner.documents.some(
      (document) => Number(document.id) === Number(readySearchFixtures[4].document.id)
    ));
    const originalFilenameSearch = (await request(listPath('/api/documents', {
      q: `original-${listMarker}-needle`,
      page: '1',
      limit: '20'
    }), { headers: auth(adminToken) })).payload.data;
    assert.equal(originalFilenameSearch.total, 1);
    assert.equal(
      Number(originalFilenameSearch.documents[0].id),
      Number(readySearchFixtures[4].document.id)
    );
    assert(!Object.hasOwn(originalFilenameSearch.documents[0], 'storageKey'));
    assert(!Object.hasOwn(originalFilenameSearch.documents[0], 'storage_key'));
    const managementPages = [];
    for (const pageNumber of [1, 2, 3]) {
      const result = (await request(listPath('/api/documents', {
        q: listMarker,
        sort: 'newest',
        page: String(pageNumber),
        limit: '3'
      }), { headers: auth(adminToken) })).payload.data;
      assert.equal(result.total, 8);
      assert.equal(result.totalPages, 3);
      managementPages.push(...result.documents);
    }
    assert.equal(managementPages.length, 8);
    assert.equal(new Set(managementPages.map((document) => document.id)).size, 8);
    for (const [query, expectedId] of [
      [{ q: listMarker, processingStatus: 'PROCESSING' }, processingFixture.document.id],
      [{ q: listMarker, processingStatus: 'FAILED' }, failedFixture.document.id],
      [{ q: listMarker, visibilityStatus: 'HIDDEN' }, hiddenFixture.document.id],
      [{ q: listMarker, visibilityStatus: 'DELETED' }, deletedFixture.document.id]
    ]) {
      const result = (await request(listPath('/api/documents', {
        ...query,
        page: '1',
        limit: '20'
      }), { headers: auth(adminToken) })).payload.data;
      assert.equal(result.total, 1);
      assert.equal(Number(result.documents[0].id), Number(expectedId));
    }
    const combinedManagement = (await request(listPath('/api/documents', {
      q: listMarker,
      fileType: 'TXT',
      processingStatus: 'READY',
      visibilityStatus: 'VISIBLE',
      previewStatus: 'NOT_APPLICABLE',
      ownerId: String(teacher1.id),
      sort: 'title_desc',
      page: '1',
      limit: '100'
    }), { headers: auth(adminToken) })).payload.data;
    assert.equal(combinedManagement.total, 2);
    assert(combinedManagement.documents.every(
      (document) => Number(document.uploadedBy) === Number(teacher1.id)
        && document.fileType === 'TXT'
        && document.processingStatus === 'READY'
        && document.visibilityStatus === 'VISIBLE'
        && document.previewStatus === 'NOT_APPLICABLE'
    ));
    await request('/api/documents?previewStatus=UNKNOWN', {
      headers: auth(adminToken)
    }, 400);

    let pdfBackfillDocumentId = null;
    for (const fixture of LIBRARY_SOURCE_FIXTURES) {
      const fixtureForm = new FormData();
      fixtureForm.append(
        'file',
        new Blob([fixture.bytes], { type: fixture.mimeType }),
        fixture.filename
      );
      fixtureForm.append('title', fixture.title || `Library ${fixture.fileType} bytes`);
      const fixtureUpload = (await request('/api/documents', {
        method: 'POST',
        headers: auth(teacher1Token),
        body: fixtureForm
      }, 202)).payload.data;
      assert.equal(fixtureUpload.document.originalFilename, fixture.filename);
      const [[storedOriginalName]] = await pool.execute(
        'SELECT original_filename FROM documents WHERE id = ?',
        [fixtureUpload.document.id]
      );
      assert.equal(storedOriginalName.original_filename, fixture.filename);
      const managementDetail = (await request(
        `/api/documents/${fixtureUpload.document.id}`,
        { headers: auth(teacher1Token) }
      )).payload.data.document;
      assert.equal(managementDetail.originalFilename, fixture.filename);
      const fixtureText = `verified ${fixture.fileType} source`;
      await request('/api/internal/rag/processing-callback', {
        method: 'POST',
        headers: internalHeaders,
        body: JSON.stringify({
          eventType: 'SUCCEEDED',
          jobId: fixtureUpload.job.id,
          documentId: fixtureUpload.document.id,
          attemptCount: 1,
          chunks: [{
            chunkIndex: 0,
            vectorNodeId: crypto.randomUUID(),
            chunkText: fixtureText,
            contentHash: crypto.createHash('sha256').update(fixtureText).digest('hex'),
            pageNumber: 1
          }]
        })
      });
      const fixtureDetail = (await request(
        `/api/library/documents/${fixtureUpload.document.id}`,
        { headers: auth(studentToken) }
      )).payload.data.document;
      assert.equal(fixtureDetail.fileType, fixture.fileType);
      assert.equal(fixtureDetail.originalAvailable, true);
      if (fixture.fileType === 'PDF') {
        assert.equal(fixtureDetail.title, fixture.title);
        assert.equal(fixtureDetail.pageCount, 3);
        assert.equal(fixtureDetail.previewStatus, 'READY');
        assert.equal(fixtureDetail.previewAvailable, true);
        for (const token of libraryTokens) {
          const previewResponse = await fetch(
            `${base}${fixtureDetail.previewUrl}`,
            { headers: auth(token), signal: AbortSignal.timeout(15_000) }
          );
          assert.equal(previewResponse.status, 200);
          assertInlineUtf8Filename(
            previewResponse.headers.get('content-disposition') || '',
            `${fixture.title}.pdf`
          );
          assert.deepEqual(Buffer.from(await previewResponse.arrayBuffer()), fixture.bytes);
        }
        for (const [token, status] of [
          [teacher1Token, 200],
          [teacher2Token, 404],
          [adminToken, 200]
        ]) {
          const managementPreview = await fetch(
            `${base}/api/documents/${fixtureUpload.document.id}/preview`,
            { headers: auth(token), signal: AbortSignal.timeout(15_000) }
          );
          assert.equal(managementPreview.status, status);
          if (status === 200) {
            assertInlineUtf8Filename(
              managementPreview.headers.get('content-disposition') || '',
              `${fixture.title}.pdf`
            );
            assert.deepEqual(
              Buffer.from(await managementPreview.arrayBuffer()),
              fixture.bytes
            );
          }
        }
      } else if (fixture.fileType === 'TXT') {
        assert.equal(fixtureDetail.pageCount, null);
        assert.equal(fixtureDetail.previewStatus, 'NOT_APPLICABLE');
        assert.equal(fixtureDetail.previewAvailable, false);
        assert.equal(fixtureDetail.previewUrl, null);
      } else {
        let docxDetail = fixtureDetail;
        for (let attempt = 0; attempt < 120 && docxDetail.previewStatus === 'PENDING'; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          docxDetail = (await request(
            `/api/library/documents/${fixtureUpload.document.id}`,
            { headers: auth(studentToken) }
          )).payload.data.document;
        }
        assert.equal(docxDetail.previewStatus, 'READY', 'Disposable runtime must convert DOCX preview.');
        assert(Number.isInteger(docxDetail.pageCount) && docxDetail.pageCount >= 2);
        assert.equal(docxDetail.previewAvailable, true);
        const previewResponse = await fetch(`${base}${docxDetail.previewUrl}`, {
          headers: auth(studentToken),
          signal: AbortSignal.timeout(15_000)
        });
        assert.equal(previewResponse.status, 200);
        assert.match(previewResponse.headers.get('content-type') || '', /^application\/pdf/);
        assertInlineUtf8Filename(
          previewResponse.headers.get('content-disposition') || '',
          `${fixture.title}.pdf`
        );
        const previewBytes = Buffer.from(await previewResponse.arrayBuffer());
        assert.equal(previewBytes.subarray(0, 5).toString('ascii'), '%PDF-');
        assert.equal(await documentFileService.countPdfPages(previewBytes), docxDetail.pageCount);
      }
      const fixtureSource = await fetch(
        `${base}/api/library/documents/${fixtureUpload.document.id}/source`,
        { headers: auth(studentToken), signal: AbortSignal.timeout(15_000) }
      );
      assert.equal(fixtureSource.status, 200);
      assert.equal(Number(fixtureSource.headers.get('content-length')), fixture.bytes.length);
      assert.match(fixtureSource.headers.get('content-type') || '', new RegExp(`^${fixture.mimeType}`));
      const disposition = fixtureSource.headers.get('content-disposition') || '';
      assertAttachmentUtf8Filename(disposition, fixture.filename);
      assert(!/documents[\\/]/i.test(disposition));
      const received = Buffer.from(await fixtureSource.arrayBuffer());
      assert.equal(
        crypto.createHash('sha256').update(received).digest('hex'),
        crypto.createHash('sha256').update(fixture.bytes).digest('hex')
      );
      assert.deepEqual(received, fixture.bytes);
      if (fixture.fileType === 'PDF') {
        pdfBackfillDocumentId = fixtureUpload.document.id;
      }
    }
    const legacyPdfBefore = await documentRepo.findById(pdfBackfillDocumentId);
    const [[jobsBeforeBackfill]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM document_processing_jobs WHERE document_id = ?',
      [pdfBackfillDocumentId]
    );
    await pool.execute(
      `UPDATE documents
       SET page_count = NULL, preview_status = 'READY', preview_mime_type = 'application/pdf'
       WHERE id = ?`,
      [pdfBackfillDocumentId]
    );
    assert.equal(
      await backfillDocument({ ...legacyPdfBefore, page_count: null }, true),
      'updated'
    );
    assert.equal((await documentRepo.findById(pdfBackfillDocumentId)).page_count, null);
    assert.equal(
      await backfillDocument(
        await documentRepo.findById(pdfBackfillDocumentId),
        false
      ),
      'updated'
    );
    assert.equal(Number((await documentRepo.findById(pdfBackfillDocumentId)).page_count), 3);
    assert(!(await documentRepo.listForPreviewBackfill({
      afterId: Number(pdfBackfillDocumentId) - 1,
      limit: 100
    })).some((document) => Number(document.id) === Number(pdfBackfillDocumentId)));
    const [[jobsAfterBackfill]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM document_processing_jobs WHERE document_id = ?',
      [pdfBackfillDocumentId]
    );
    assert.equal(Number(jobsAfterBackfill.total), Number(jobsBeforeBackfill.total));

    const failedPreviewForm = new FormData();
    failedPreviewForm.append(
      'file',
      new Blob([conversionFailureDocxBytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }),
      'conversion-failure.docx'
    );
    const failedPreviewUpload = (await request('/api/documents', {
      method: 'POST',
      headers: auth(teacher1Token),
      body: failedPreviewForm
    }, 202)).payload.data;
    const failedPreviewText = 'DOCX original remains available after preview conversion failure.';
    await request('/api/internal/rag/processing-callback', {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({
        eventType: 'SUCCEEDED',
        jobId: failedPreviewUpload.job.id,
        documentId: failedPreviewUpload.document.id,
        attemptCount: 1,
        chunks: [{
          chunkIndex: 0,
          vectorNodeId: crypto.randomUUID(),
          chunkText: failedPreviewText,
          contentHash: crypto.createHash('sha256').update(failedPreviewText).digest('hex'),
          pageNumber: null
        }]
      })
    });
    let failedPreviewDetail = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      failedPreviewDetail = (await request(
        `/api/documents/${failedPreviewUpload.document.id}`,
        { headers: auth(teacher1Token) }
      )).payload.data.document;
      if (failedPreviewDetail.previewStatus !== 'PENDING') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(failedPreviewDetail.previewStatus, 'FAILED');
    assert.equal(failedPreviewDetail.pageCount, null);
    assert.equal(failedPreviewDetail.processingStatus, 'READY');
    assert.equal(failedPreviewDetail.originalAvailable, true);
    assert.equal(failedPreviewDetail.previewAvailable, false);
    const failedPreviewSource = await fetch(
      `${base}/api/documents/${failedPreviewUpload.document.id}/file`,
      { headers: auth(teacher1Token), signal: AbortSignal.timeout(15_000) }
    );
    assert.equal(failedPreviewSource.status, 200);
    assert.deepEqual(
      Buffer.from(await failedPreviewSource.arrayBuffer()),
      conversionFailureDocxBytes
    );
    await request(`/api/documents/${documentId}`, { headers: auth(adminToken) });
    await request(`/api/documents/jobs/${jobId}`, { headers: auth(adminToken) });
    const adminFile = await fetch(`${base}/api/documents/${documentId}/file`, {
      headers: auth(adminToken),
      signal: AbortSignal.timeout(15_000)
    });
    assert.equal(adminFile.status, 200);
    assert.equal(await adminFile.text(), 'verified source text');
    const [[jobsBeforeMetadataUpdate]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM document_processing_jobs WHERE document_id = ?',
      [documentId]
    );
    await request(`/api/documents/${documentId}`, {
      method: 'PATCH', headers: auth(adminToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        title: 'Smoke Document Admin Reviewed',
        description: 'Admin description',
        author: 'Admin author'
      })
    });
    await request(`/api/documents/${documentId}`, {
      method: 'PATCH', headers: auth(teacher1Token, { 'content-type': 'application/json' }),
      body: JSON.stringify({ title: 'Smoke Document Updated', description: null })
    });
    const metadataDetail = (await request(
      `/api/documents/${documentId}`,
      { headers: auth(teacher1Token) }
    )).payload.data.document;
    assert.equal(metadataDetail.title, 'Smoke Document Updated');
    assert.equal(metadataDetail.description, null);
    assert.equal(metadataDetail.author, 'Admin author');
    const [[jobsAfterMetadataUpdate]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM document_processing_jobs WHERE document_id = ?',
      [documentId]
    );
    assert.equal(
      Number(jobsAfterMetadataUpdate.total),
      Number(jobsBeforeMetadataUpdate.total),
      'Metadata update must not create an ingest/processing job.'
    );
    const fileResponse = await fetch(`${base}/api/documents/${documentId}/file`, {
      headers: auth(teacher1Token),
      signal: AbortSignal.timeout(15_000)
    });
    assert.equal(fileResponse.status, 200);
    assert.equal(await fileResponse.text(), 'verified source text');

    await request(`/api/documents/${documentId}/hide`, { method: 'POST', headers: auth(adminToken) }, 202);
    await request(`/api/library/documents/${documentId}`, { headers: auth(teacher2Token) }, 404);
    await request(`/api/documents/${documentId}/unhide`, { method: 'POST', headers: auth(adminToken) }, 202);
    await request(`/api/documents/${documentId}/hide`, { method: 'POST', headers: auth(teacher1Token) }, 202);
    await request(`/api/library/documents/${documentId}`, { headers: auth(studentToken) }, 404);
    await request(`/api/library/documents/${documentId}/source`, { headers: auth(studentToken) }, 404);
    await request(`/api/library/documents/${documentId}/preview`, { headers: auth(studentToken) }, 404);
    await request(`/api/documents/${documentId}/unhide`, { method: 'POST', headers: auth(teacher1Token) }, 202);

    process.env.RAG_MOCK_SOURCE_VECTOR_NODE_ID = vectorNodeId;
    process.env.RAG_MOCK_MULTI_USAGE = 'true';
    const session = (await request('/api/chat/sessions', {
      method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ title: 'Smoke Chat' })
    }, 201)).payload.data;
    await request('/api/chat/sessions', {
      method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }),
      body: JSON.stringify([])
    }, 400);
    await request('/api/chat/sessions', { headers: auth(studentToken) });
    await request('/api/chat/sessions?limit=0', { headers: auth(studentToken) }, 400);
    await request('/api/chat/sessions?limit=101', { headers: auth(studentToken) }, 400);
    await request(
      `/api/chat/sessions?offset=${Number.MAX_SAFE_INTEGER + 1}`,
      { headers: auth(studentToken) },
      400
    );
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
    assert.equal(Number(availableCitation.documentId), Number(documentId));
    assert.equal(availableCitation.documentTitle, 'Smoke Document Updated');
    assert.equal(availableCitation.pageNumber, 1);
    assert.equal(availableCitation.sourceText, 'Mock source fragment.');
    for (const internalField of ['vectorNodeId', 'storageKey', 'storage_key', 'jobId']) {
      assert(!Object.hasOwn(availableCitation, internalField));
    }
    const linkedLibraryDetail = (await request(
      `/api/library/documents/${availableCitation.documentId}`,
      { headers: auth(studentToken) }
    )).payload.data.document;
    assert.equal(Number(linkedLibraryDetail.id), Number(availableCitation.documentId));
    const linkedLibrarySource = await fetch(
      `${base}/api/library/documents/${availableCitation.documentId}/source`,
      { headers: auth(studentToken), signal: AbortSignal.timeout(15_000) }
    );
    assert.equal(linkedLibrarySource.status, 200);
    assert.equal(await linkedLibrarySource.text(), 'verified source text');
    const [[jobsBeforeSnapshotCheck]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM document_processing_jobs WHERE document_id = ?',
      [documentId]
    );
    await request(`/api/documents/${documentId}`, {
      method: 'PATCH',
      headers: auth(teacher1Token, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        title: 'Metadata Changed After Citation',
        description: 'Citation snapshot must remain immutable.',
        author: 'Updated author'
      })
    });
    const citationAfterMetadataUpdate = (await request(`/api/citations/${citationId}`, {
      headers: auth(studentToken)
    })).payload.data;
    assert.equal(citationAfterMetadataUpdate.documentTitle, availableCitation.documentTitle);
    assert.equal(citationAfterMetadataUpdate.pageNumber, availableCitation.pageNumber);
    assert.equal(citationAfterMetadataUpdate.sourceText, availableCitation.sourceText);
    const [[jobsAfterSnapshotCheck]] = await pool.execute(
      'SELECT COUNT(*) AS total FROM document_processing_jobs WHERE document_id = ?',
      [documentId]
    );
    assert.equal(
      Number(jobsAfterSnapshotCheck.total),
      Number(jobsBeforeSnapshotCheck.total),
      'Metadata-only updates after citation creation must not create processing jobs.'
    );
    await request(`/api/citations/${citationId}`, { headers: auth(adminToken) }, 404);

    const storedDocument = await documentRepo.findById(documentId);
    await documentFileService.remove(storedDocument.storage_key);
    for (const token of libraryTokens) {
      const missingLibraryOriginal = (await request(`/api/library/documents/${documentId}`, {
        headers: auth(token)
      })).payload.data.document;
      assert.equal(missingLibraryOriginal.originalAvailable, false);
      const missingSource = await request(`/api/library/documents/${documentId}/source`, {
        headers: auth(token)
      }, 409);
      assert.equal(missingSource.payload.errorCode, 'ORIGINAL_SOURCE_UNAVAILABLE');
      assert(!JSON.stringify(missingSource.payload).includes(process.env.UPLOAD_DIR));
    }
    const missingOriginalCitation = (await request(`/api/citations/${citationId}/source`, {
      headers: auth(studentToken)
    })).payload.data;
    assert.equal(missingOriginalCitation.originalAvailable, false);
    assert.equal(Number(missingOriginalCitation.documentId), Number(documentId));
    assert.equal(missingOriginalCitation.pageNumber, 1);
    assert.equal(missingOriginalCitation.sourceText, 'Mock source fragment.');
    await request(`/api/documents/${documentId}/file`, { headers: auth(teacher1Token) }, 404);

    await request(`/api/documents/${documentId}/hide`, { method: 'POST', headers: auth(teacher1Token) }, 202);
    await request(`/api/library/documents/${documentId}`, { headers: auth(studentToken) }, 404);
    await request(`/api/library/documents/${documentId}/preview`, { headers: auth(studentToken) }, 404);
    await request(`/api/library/documents/${documentId}/source`, { headers: auth(studentToken) }, 404);
    const hiddenCitation = (await request(`/api/citations/${citationId}/source`, {
      headers: auth(studentToken)
    })).payload.data;
    assert.equal(hiddenCitation.originalAvailable, false);
    assert.equal(Number(hiddenCitation.documentId), Number(documentId));
    assert.equal(hiddenCitation.pageNumber, 1);
    assert.equal(hiddenCitation.sourceText, 'Mock source fragment.');
    await request(`/api/citations/${citationId}/file`, { headers: auth(studentToken) }, 409);
    await request(`/api/documents/${documentId}`, { method: 'DELETE', headers: auth(teacher1Token) }, 202);
    await request(`/api/library/documents/${documentId}`, { headers: auth(studentToken) }, 404);
    const deletedCitation = (await request(`/api/citations/${citationId}`, {
      headers: auth(studentToken)
    })).payload.data;
    assert.equal(deletedCitation.originalAvailable, false);
    assert.equal(Number(deletedCitation.documentId), Number(documentId));
    assert.equal(deletedCitation.pageNumber, 1);
    assert.equal(deletedCitation.sourceText, 'Mock source fragment.');
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
    const unsourcedRequestId = crypto.randomUUID();
    await request(`/api/chat/sessions/${noAnswerSession.id}/messages`, {
      method: 'POST', headers: auth(studentToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ content: '__UNSOURCED_ANSWER__', clientRequestId: unsourcedRequestId })
    }, 502);
    const failedHistory = (await request(`/api/chat/sessions/${noAnswerSession.id}/messages`, {
      headers: auth(studentToken)
    })).payload.data.messages;
    const unsourcedUser = failedHistory.find((message) => message.clientRequestId === unsourcedRequestId);
    const unsourcedAssistant = failedHistory.find(
      (message) => message.messageOrder === unsourcedUser.messageOrder + 1
    );
    assert.equal(unsourcedAssistant.status, 'FAILED');
    assert.equal(unsourcedAssistant.errorCode, 'RAG_CITATIONS_REQUIRED');
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
    await request(`/api/library/documents/${remoteFailure.payload.data.documentId}`, {
      headers: auth(studentToken)
    }, 404);
    process.env.RAG_MODE = 'mock';

    const dashboard = (await request('/api/admin/dashboard/summary', { headers: auth(adminToken) })).payload.data;
    assert.equal(dashboard.usage.scope, 'LLM_CALLS_ONLY');
    assert(dashboard.usage.totals.calls >= 2);

    await request(`/api/chat/sessions/${session.id}`, { method: 'DELETE', headers: auth(studentToken) }, 204);
    await request(`/api/chat/sessions/${session.id}`, { headers: auth(studentToken) }, 404);

    let deliveredResetToken;
    const originalResetWarn = console.warn;
    console.warn = (...args) => {
      const match = args.join(' ').match(/\[DEV-ONLY PASSWORD RESET TOKEN\] ([^ ]+)/);
      if (match) deliveredResetToken = match[1];
      else originalResetWarn(...args);
    };
    let knownForgot;
    try {
      knownForgot = await request('/api/auth/forgot-password', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: studentEmail })
      });
    } finally {
      console.warn = originalResetWarn;
    }
    const unknownForgot = await request('/api/auth/forgot-password', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `unknown-${suffix}@smoke.test` })
    });
    assert.equal(knownForgot.payload.message, unknownForgot.payload.message);
    assert(deliveredResetToken, 'Development adapter must deliver a reset token.');
    const resetUserId = deliveredResetToken.split('.')[0];
    await request('/api/auth/reset-password', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: `${resetUserId}.${'0'.repeat(64)}`, newPassword: 'StudentReset@2026' })
    }, 400);
    await request('/api/auth/reset-password', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: deliveredResetToken, newPassword: 'StudentReset@2026' })
    });
    await request('/api/auth/reset-password', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: deliveredResetToken, newPassword: 'StudentAgain@2026' })
    }, 400);
    await request('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: studentEmail, password: 'StudentReset@2026' })
    });

    console.log('PART2_SMOKE_OK');
  } finally {
    await previewWorker.stop();
    await new Promise((resolve) => server.close(resolve));
    await cleanupSmokeSuffix(suffix);
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
