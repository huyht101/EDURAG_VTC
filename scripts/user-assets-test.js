'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');

const temporaryUploadRoot = path.join(os.tmpdir(), `edurag-user-assets-${crypto.randomUUID()}`);
process.env.UPLOAD_DIR = temporaryUploadRoot;
process.env.AVATAR_MAX_SIZE_BYTES = '1024';
process.env.JWT_SECRET = 'user-assets-test-secret-must-be-at-least-32-characters';

const authConfig = require('../src/configs/auth');
const userRepo = require('../src/repositories/user-repository');
const userService = require('../src/services/user-service');
const avatarService = require('../src/services/avatar-service');
const avatarFiles = require('../src/services/avatar-file-service');
const documentService = require('../src/services/document-service');
const libraryService = require('../src/services/library-service');
const { normalizeMultipartFilename } = require('../src/utils/multipart-filename');
const { neutralizeFormula } = require('../src/utils/csv');

function token(id, role) {
  return jwt.sign(
    { id, role, authVersion: 1, type: authConfig.purpose },
    authConfig.secret,
    {
      algorithm: authConfig.algorithm,
      issuer: authConfig.issuer,
      audience: authConfig.audience,
      subject: String(id),
      jwtid: crypto.randomUUID(),
      expiresIn: '15m'
    }
  );
}

function auth(value) {
  return { Authorization: `Bearer ${value}` };
}

async function collectCsv(filters, rows, batchSize = 5) {
  let output = '';
  const calls = [];
  const repository = {
    async listUsersForExportBatch(receivedFilters, afterId, limit) {
      calls.push({ receivedFilters, afterId, limit });
      return rows.filter((row) => row.id > afterId).slice(0, limit);
    }
  };
  const count = await userService.exportUsersCsv(filters, {
    write(chunk) { output += chunk; }
  }, { userRepo: repository, batchSize });
  return { output, calls, count };
}

async function testCsv() {
  assert.equal(neutralizeFormula(' =SUM(A1:A2)'), "' =SUM(A1:A2)");
  assert.equal(neutralizeFormula('\t@cmd'), "'\t@cmd");
  assert.equal(neutralizeFormula('\r-safe'), "'\r-safe");
  assert.equal(neutralizeFormula('normal'), 'normal');

  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    full_name: index === 0 ? 'Nguyễn, "An"\nLớp 3' : `User ${index + 1}`,
    email: index === 1 ? ' =danger@example.test' : `user${index + 1}@example.test`,
    role: index % 2 ? 'TEACHER' : 'STUDENT',
    status: 'ACTIVE',
    created_at: index === 2 ? null : new Date('2026-08-01T00:00:00.000Z'),
    password_hash: 'must-not-export',
    auth_version: 99
  }));
  const filters = { search: 'User', role: 'STUDENT', status: 'ACTIVE' };
  const result = await collectCsv(filters, rows);
  assert.equal(result.count, 12, 'CSV export must not inherit the list endpoint page size.');
  assert.equal(result.calls.length, 3);
  assert(result.calls.every((call) => call.limit === 5));
  assert(result.calls.every((call) => call.receivedFilters === filters));
  assert(result.output.startsWith('\ufeff"id","fullName","email","role","status","createdAt"\r\n'));
  assert(result.output.includes('"Nguyễn, ""An""\nLớp 3"'));
  assert(result.output.includes('"\' =danger@example.test"'));
  assert(!result.output.includes('must-not-export'));
  assert(!result.output.includes('auth_version'));
}

async function imageBuffers() {
  const input = { create: { width: 3, height: 2, channels: 3, background: '#2b6cb0' } };
  return {
    jpeg: await sharp(input).jpeg().toBuffer(),
    png: await sharp(input).png().toBuffer(),
    webp: await sharp(input).webp().toBuffer()
  };
}

async function animatedWebpBuffer() {
  const width = 2;
  const height = 2;
  const channels = 4;
  const red = Buffer.from(Array(width * height).fill([255, 0, 0, 255]).flat());
  const blue = Buffer.from(Array(width * height).fill([0, 0, 255, 255]).flat());
  return sharp(Buffer.concat([red, blue]), {
    raw: { width, height: height * 2, channels, pages: 2, pageHeight: height }
  }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
}

async function assertRejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error.code === code);
}

async function testAvatarFileValidation(buffers) {
  assert.equal((await avatarFiles.validate({
    buffer: buffers.jpeg, originalname: 'avatar', mimetype: 'application/octet-stream'
  })).mimeType, 'image/jpeg');
  assert.equal((await avatarFiles.validate({
    buffer: buffers.png, originalname: 'ảnh.png', mimetype: 'image/png'
  })).mimeType, 'image/png');
  assert.equal((await avatarFiles.validate({
    buffer: buffers.webp, originalname: '', mimetype: ''
  })).mimeType, 'image/webp');

  await assertRejectsCode(avatarFiles.validate({
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'),
    originalname: 'avatar.svg', mimetype: 'image/svg+xml'
  }), 'UNSUPPORTED_AVATAR_TYPE');
  await assertRejectsCode(avatarFiles.validate({
    buffer: Buffer.from('not-an-image'), originalname: 'avatar.png', mimetype: 'image/png'
  }), 'INVALID_AVATAR_CONTENT');
  await assertRejectsCode(avatarFiles.validate({
    buffer: buffers.png, originalname: 'avatar.jpg', mimetype: 'image/png'
  }), 'AVATAR_TYPE_MISMATCH');
  await assertRejectsCode(avatarFiles.validate({
    buffer: buffers.png, originalname: 'avatar.png', mimetype: 'image/jpeg'
  }), 'AVATAR_TYPE_MISMATCH');
  await assertRejectsCode(avatarFiles.validate({
    buffer: await animatedWebpBuffer(), originalname: 'animated.webp', mimetype: 'image/webp'
  }), 'UNSUPPORTED_AVATAR_ANIMATION');

  const saved = await avatarFiles.persist({
    buffer: buffers.webp, originalname: '../../client-name', mimetype: 'application/octet-stream'
  });
  assert.match(saved.storageKey, /^avatars\/[0-9a-f-]{36}\.webp$/i);
  assert(!saved.storageKey.includes('client-name'));
  await avatarFiles.remove(saved.storageKey);
}

async function testAvatarFailureSemantics() {
  const removals = [];
  const fakeFiles = {
    async persist() { return { storageKey: 'avatars/new.png', mimeType: 'image/png' }; },
    async remove(key) { removals.push(key); }
  };
  const old = { id: 7, avatar_storage_key: 'avatars/old.jpg', avatar_mime_type: 'image/jpeg' };
  const fakeRepo = {
    async findAvatarByIdForUpdate() { return old; },
    async updateAvatar() { throw new Error('db failed'); }
  };
  await assert.rejects(avatarService.uploadMyAvatar(7, {}, {
    avatarFiles: fakeFiles,
    userRepo: fakeRepo,
    withTransaction: async (callback) => callback({})
  }), /db failed/);
  assert.deepEqual(removals, ['avatars/new.png'], 'DB failure must remove only the new file.');

  removals.length = 0;
  fakeRepo.updateAvatar = async () => {};
  const originalError = console.error;
  console.error = () => {};
  const cleanupFailingFiles = {
    ...fakeFiles,
    async remove(key) { removals.push(key); if (key === 'avatars/old.jpg') throw new Error('cleanup failed'); }
  };
  const replaced = await avatarService.uploadMyAvatar(7, {}, {
    avatarFiles: cleanupFailingFiles,
    userRepo: fakeRepo,
    withTransaction: async (callback) => callback({})
  });
  console.error = originalError;
  assert.equal(replaced.avatarAvailable, true);
  assert.deepEqual(removals, ['avatars/old.jpg'], 'Old cleanup failure must not remove the new active avatar.');

  removals.length = 0;
  fakeRepo.updateAvatar = async () => { throw new Error('delete db failed'); };
  await assert.rejects(avatarService.deleteMyAvatar(7, {
    avatarFiles: fakeFiles,
    userRepo: fakeRepo,
    withTransaction: async (callback) => callback({})
  }), /delete db failed/);
  assert.deepEqual(removals, [], 'DELETE database failure must leave the active file untouched.');

  let updates = 0;
  const emptyRepo = {
    async findAvatarByIdForUpdate() {
      return { id: 7, avatar_storage_key: null, avatar_mime_type: null };
    },
    async updateAvatar() { updates += 1; }
  };
  const deleted = await avatarService.deleteMyAvatar(7, {
    avatarFiles: fakeFiles,
    userRepo: emptyRepo,
    withTransaction: async (callback) => callback({})
  });
  assert.equal(deleted.avatarAvailable, false);
  assert.equal(updates, 0, 'Repeated DELETE must not issue a needless update.');
}

async function testHttp(buffers) {
  const originalFindAuth = userRepo.findAuthUserById;
  const originalExport = userService.exportUsersCsv;
  const originalUploadAvatar = avatarService.uploadMyAvatar;
  const originalOpenAvatar = avatarService.openMyAvatar;
  const originalDeleteAvatar = avatarService.deleteMyAvatar;
  const originalUploadDocument = documentService.uploadDocument;
  const originalManagedFile = documentService.openManagedFile;
  const originalManagedPreview = documentService.openManagedPreview;
  const originalLibrarySource = libraryService.openSource;
  const originalLibraryPreview = libraryService.openPreview;

  const actors = new Map([
    [1, { id: 1, email: 'admin@example.test', role: 'ADMIN', status: 'ACTIVE', auth_version: 1 }],
    [2, { id: 2, email: 'teacher@example.test', role: 'TEACHER', status: 'ACTIVE', auth_version: 1 }],
    [3, { id: 3, email: 'student@example.test', role: 'STUDENT', status: 'ACTIVE', auth_version: 1 }]
  ]);
  userRepo.findAuthUserById = async (id) => actors.get(Number(id)) || null;
  userService.exportUsersCsv = async (_filters, writable) => {
    writable.write('\ufeff"id","fullName","email","role","status","createdAt"\r\n');
    writable.write('"1","Admin","admin@example.test","ADMIN","ACTIVE",""\r\n');
  };
  avatarService.uploadMyAvatar = async (_id, file) => ({
    avatarAvailable: true, avatarUrl: '/api/profile/avatar', avatarMimeType: file.mimetype
  });
  avatarService.openMyAvatar = async () => ({
    stream: Readable.from(buffers.png), size: buffers.png.length, mimeType: 'image/png'
  });
  avatarService.deleteMyAvatar = async () => ({
    avatarAvailable: false, avatarUrl: null, avatarMimeType: null
  });
  documentService.uploadDocument = async (_user, file) => ({ originalFilename: file.originalname });
  const previewBytes = Buffer.from('%PDF-1.4\npreview-body');
  const opened = (filename) => ({
    stream: Readable.from(previewBytes), size: previewBytes.length,
    mimeType: 'application/pdf', filename,
    document: { mime_type: 'application/pdf', original_filename: filename }
  });
  documentService.openManagedFile = async () => opened('Kế hoạch thực tập 2026.pdf');
  documentService.openManagedPreview = async () => opened('Kế hoạch thực tập 2026.pdf');
  libraryService.openSource = async () => opened('Kế hoạch thực tập 2026.pdf');
  libraryService.openPreview = async () => opened('Kế hoạch thực tập 2026.pdf');

  const app = require('../src/app');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const admin = token(1, 'ADMIN');
  const teacher = token(2, 'TEACHER');
  const student = token(3, 'STUDENT');
  try {
    assert.equal((await fetch(`${baseUrl}/api/admin/users/export`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/admin/users/export`, { headers: auth(teacher) })).status, 403);
    const csv = await fetch(`${baseUrl}/api/admin/users/export?role=ADMIN`, { headers: auth(admin) });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /^text\/csv; charset=utf-8/i);
    assert.equal(csv.headers.get('content-disposition'), 'attachment; filename="users.csv"');
    const csvBytes = Buffer.from(await csv.arrayBuffer());
    assert.deepEqual([...csvBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert(csvBytes.subarray(3).toString('utf8').startsWith('"id"'), '/export must resolve as the static CSV route.');

    assert.equal((await fetch(`${baseUrl}/api/profile/avatar`)).status, 401);
    const avatarGet = await fetch(`${baseUrl}/api/profile/avatar`, { headers: auth(student) });
    assert.equal(avatarGet.status, 200);
    assert.equal(avatarGet.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await avatarGet.arrayBuffer()), buffers.png);
    assert.equal((await fetch(`${baseUrl}/uploads/avatars/example.png`)).status, 404);

    const avatarForm = new FormData();
    avatarForm.append('avatar', new Blob([buffers.png], { type: 'image/png' }), 'ảnh.png');
    assert.equal((await fetch(`${baseUrl}/api/profile/avatar`, {
      method: 'POST', headers: auth(student), body: avatarForm
    })).status, 200);
    const oversized = new FormData();
    oversized.append('avatar', new Blob([Buffer.alloc(1025)], { type: 'image/png' }), 'large.png');
    assert.equal((await fetch(`${baseUrl}/api/profile/avatar`, {
      method: 'POST', headers: auth(student), body: oversized
    })).status, 413);
    assert.equal((await fetch(`${baseUrl}/api/profile/avatar`, {
      method: 'DELETE', headers: auth(student)
    })).status, 200);

    for (const filename of [
      'ascii.pdf', 'Kế hoạch thực tập.pdf', 'ten co khoang trang.pdf',
      'tài-liệu-😀.pdf', 'Đúng UTF-8 – kiểm thử.pdf'
    ]) {
      const form = new FormData();
      form.append('file', new Blob([previewBytes], { type: 'application/pdf' }), filename);
      const response = await fetch(`${baseUrl}/api/documents`, {
        method: 'POST', headers: auth(teacher), body: form
      });
      assert.equal(response.status, 202);
      assert.equal((await response.json()).data.originalFilename, filename);
    }
    for (const [url, actor] of [
      ['/api/documents/1/file', teacher], ['/api/documents/1/preview', teacher],
      ['/api/library/documents/1/source', student], ['/api/library/documents/1/preview', student]
    ]) {
      const response = await fetch(`${baseUrl}${url}`, { headers: auth(actor) });
      assert.equal(response.status, 200, url);
      assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8''/i, url);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), previewBytes, url);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    userRepo.findAuthUserById = originalFindAuth;
    userService.exportUsersCsv = originalExport;
    avatarService.uploadMyAvatar = originalUploadAvatar;
    avatarService.openMyAvatar = originalOpenAvatar;
    avatarService.deleteMyAvatar = originalDeleteAvatar;
    documentService.uploadDocument = originalUploadDocument;
    documentService.openManagedFile = originalManagedFile;
    documentService.openManagedPreview = originalManagedPreview;
    libraryService.openSource = originalLibrarySource;
    libraryService.openPreview = originalLibraryPreview;
  }
}

async function main() {
  assert.equal(normalizeMultipartFilename('Káº¿ hoáº¡ch thá»±c táº­p.pdf'), 'Kế hoạch thực tập.pdf');
  assert.equal(normalizeMultipartFilename('tÃ i-liá»u-ð.pdf'), 'tài-liệu-😀.pdf');
  assert.equal(normalizeMultipartFilename('Kế hoạch thực tập.pdf'), 'Kế hoạch thực tập.pdf');
  assert.equal(normalizeMultipartFilename('emoji-😀.pdf'), 'emoji-😀.pdf');
  await testCsv();
  const buffers = await imageBuffers();
  await testAvatarFileValidation(buffers);
  await testAvatarFailureSemantics();
  await testHttp(buffers);

  const schema = await fs.readFile(path.join(__dirname, '../src/database/schema.sql'), 'utf8');
  const migration = await fs.readFile(
    path.join(__dirname, '../src/database/migrations/20260801_user_avatar_storage.sql'), 'utf8'
  );
  for (const source of [schema, migration]) {
    assert.match(source, /avatar_storage_key/);
    assert.match(source, /avatar_mime_type/);
    assert.match(source, /image\/jpeg/);
    assert.match(source, /image\/png/);
    assert.match(source, /image\/webp/);
  }
  assert.match(schema, /20260801_user_avatar_storage\.sql/);
  console.log('User assets, CSV export and multipart Unicode regression passed.');
}

main().finally(async () => {
  await fs.rm(temporaryUploadRoot, { recursive: true, force: true });
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
