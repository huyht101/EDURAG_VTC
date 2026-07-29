'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const express = require('express');
const { PDFDocument } = require('pdf-lib');

const documentController = require('../src/controllers/document-controller');
const libraryController = require('../src/controllers/library-controller');
const documentFileService = require('../src/services/document-file-service');
const documentService = require('../src/services/document-service');
const libraryService = require('../src/services/library-service');
const documentDto = require('../src/services/document-dto-service');
const previewService = require('../src/services/document-preview-service');
const {
  inlineContentDisposition,
  sanitizeFilename
} = require('../src/utils/content-disposition');
const { backfillDocument } = require('./backfill-document-previews');
const { validateDocumentUpdate } = require('../src/validators/document');
const { splitStatements } = require('./migrate');

async function pdfBytes(pageCount) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) pdf.addPage([300, 400]);
  return Buffer.from(await pdf.save());
}

async function testPdfCountAndMetadata() {
  const bytes = await pdfBytes(3);
  assert.equal(await documentFileService.countPdfPages(bytes), 3);
  await assert.rejects(
    () => documentFileService.countPdfPages(Buffer.from('%PDF-invalid')),
    (error) => error.code === 'INVALID_PDF'
  );
  const metadata = documentService.normalizeUploadMetadata({
    originalname: 'A&B.pdf'
  }, {
    title: '   ',
    description: ' A&B ',
    author: '  '
  });
  assert.deepEqual(metadata, {
    title: 'A&B',
    description: 'A&B',
    author: null
  });
  assert.deepEqual(documentService.initialPreview({
    fileType: 'PDF',
    pageCount: 3
  }), {
    pageCount: 3,
    previewStatus: 'READY',
    previewStorageKey: null,
    previewMimeType: 'application/pdf'
  });
  assert.equal(documentService.initialPreview({ fileType: 'DOCX' }).previewStatus, 'PENDING');
  assert.equal(documentService.initialPreview({ fileType: 'TXT' }).previewStatus, 'NOT_APPLICABLE');
  assert(validateDocumentUpdate({ pageCount: 99 })?.error);
  assert.equal(validateDocumentUpdate({ description: null, author: 'A&B' }), null);
}

function decodedExtendedFilename(header) {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  assert(match, `Missing RFC 5987 filename*: ${header}`);
  return decodeURIComponent(match[1]);
}

async function testUnicodePreviewHeadersAndBytes() {
  const cases = [
    'Kế hoạch thực tập 2026.pdf',
    '  Báo "cáo"/(A_B) 100% \\ quý\r\n4.pdf  '
  ];
  for (const filename of cases) {
    const header = inlineContentDisposition(filename);
    assert.match(header, /^inline; filename="[ -~]+"; filename\*=UTF-8''/);
    assert(!/[^\x20-\x7e]/.test(header), 'HTTP header must contain ASCII bytes only.');
    assert(!/[\r\n]/.test(header), 'HTTP header must not allow line injection.');
    assert.equal(decodedExtendedFilename(header), sanitizeFilename(filename));
  }

  const payload = await pdfBytes(2);
  const filename = 'Kế hoạch "thực/tập" (2026) 100%.pdf';
  const originalLibraryOpen = libraryService.openPreview;
  const originalManagementOpen = documentService.openManagedPreview;
  libraryService.openPreview = async () => ({
    filename,
    mimeType: 'application/pdf',
    size: payload.length,
    stream: Readable.from(payload)
  });
  documentService.openManagedPreview = async () => ({
    filename,
    mimeType: 'application/pdf',
    size: payload.length,
    stream: Readable.from(payload)
  });

  let streamedError = null;
  const server = http.createServer((req, res) => {
    const controller = req.url === '/library'
      ? libraryController.streamPreview
      : documentController.streamPreview;
    controller(
      { params: { id: '1' }, user: { id: 1, role: 'ADMIN' } },
      res,
      (error) => {
        streamedError = error;
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end();
        }
      }
    );
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    for (const route of ['library', 'management']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/${route}`);
      assert.equal(response.status, 200);
      const header = response.headers.get('content-disposition') || '';
      assert.match(header, /^inline;/i);
      assert.equal(decodedExtendedFilename(header), sanitizeFilename(filename));
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
    }
    assert.equal(streamedError, null);
  } finally {
    libraryService.openPreview = originalLibraryOpen;
    documentService.openManagedPreview = originalManagementOpen;
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}

async function testUnicodeSourceHeadersRemainAttachments() {
  const payload = await pdfBytes(1);
  const filename = 'Kế hoạch nguồn 2026.pdf';
  const originalLibraryOpen = libraryService.openSource;
  const originalManagementOpen = documentService.openManagedFile;
  libraryService.openSource = async () => ({
    filename,
    mimeType: 'application/pdf',
    size: payload.length,
    stream: Readable.from(payload)
  });
  documentService.openManagedFile = async () => ({
    document: {
      mime_type: 'application/pdf',
      original_filename: filename
    },
    size: payload.length,
    stream: Readable.from(payload)
  });

  const app = express();
  app.get('/library', (req, res, next) => {
    req.params.id = '1';
    return libraryController.streamSource(req, res, next);
  });
  app.get('/management', (req, res, next) => {
    req.params.id = '1';
    req.user = { id: 1, role: 'ADMIN' };
    return documentController.streamFile(req, res, next);
  });
  app.use((error, _req, res, _next) => res.status(500).json({ code: error.code || error.name }));
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  try {
    for (const route of ['library', 'management']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/${route}`);
      assert.equal(response.status, 200);
      const header = response.headers.get('content-disposition') || '';
      assert.match(header, /^attachment;/i);
      assert.equal(decodedExtendedFilename(header), filename);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
    }
  } finally {
    libraryService.openSource = originalLibraryOpen;
    documentService.openManagedFile = originalManagementOpen;
    await new Promise((resolve) => server.close(resolve));
  }
}

function fakePreviewDependencies(document) {
  const state = {
    document: { ...document },
    job: {
      id: 9,
      document_id: document.id,
      status: 'RUNNING',
      attempt_count: 1,
      max_attempts: 3
    },
    files: new Map([['documents/source.docx', Buffer.from('original')]]),
    jobSucceeded: false,
    jobFailed: false
  };
  const documentRepo = {
    async findById() { return { ...state.document }; },
    async findByIdForUpdate() { return { ...state.document }; },
    async updatePreview(_id, update) {
      Object.assign(state.document, {
        preview_status: update.status,
        preview_storage_key: update.storageKey,
        preview_mime_type: update.mimeType,
        page_count: update.pageCount
      });
    }
  };
  const jobRepo = {
    async findByIdForUpdate() { return { ...state.job }; },
    async markSucceeded() {
      state.job.status = 'SUCCEEDED';
      state.jobSucceeded = true;
    },
    async markFailed() {
      state.job.status = 'FAILED';
      state.jobFailed = true;
    }
  };
  const fileService = {
    async exists(key) { return state.files.has(key); },
    resolveStorageKey() { return 'safe-source.docx'; },
    async countPdfPages(buffer) {
      return documentFileService.countPdfPages(buffer);
    },
    async publish(source, key) {
      state.files.set(key, await fs.readFile(source));
    },
    async remove(key) { state.files.delete(key); }
  };
  return {
    state,
    documentRepo,
    jobRepo,
    fileService,
    withTransaction: async (callback) => callback({})
  };
}

async function testPreviewSuccessFailureAndRetry() {
  const base = {
    id: 44,
    file_type: 'DOCX',
    storage_key: 'documents/source.docx',
    preview_status: 'PENDING',
    preview_storage_key: null,
    preview_mime_type: null,
    page_count: null,
    visibility_status: 'VISIBLE',
    processing_status: 'READY'
  };
  const success = fakePreviewDependencies(base);
  const result = await previewService.processClaimedJob(success.state.job, {
    ...success,
    convert: async (_source, directory) => {
      const output = path.join(directory, 'safe-source.pdf');
      await fs.writeFile(output, await pdfBytes(2));
      return output;
    }
  });
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(success.state.document.preview_status, 'READY');
  assert.equal(success.state.document.page_count, 2);
  assert.equal(success.state.document.processing_status, 'READY');
  assert(success.state.files.has(success.state.document.preview_storage_key));
  assert(success.state.jobSucceeded);

  const failed = fakePreviewDependencies(base);
  const failure = await previewService.processClaimedJob(failed.state.job, {
    ...failed,
    convert: async () => {
      const error = new Error('conversion failed');
      error.code = 'PREVIEW_CONVERSION_FAILED';
      throw error;
    }
  });
  assert.equal(failure.status, 'FAILED');
  assert.equal(failed.state.document.preview_status, 'FAILED');
  assert.equal(failed.state.document.page_count, null);
  assert.equal(failed.state.document.processing_status, 'READY');
  assert(failed.state.files.has(base.storage_key), 'Original DOCX must remain after preview failure.');
  assert(failed.state.jobFailed);

  let converted = false;
  const retry = fakePreviewDependencies({
    ...base,
    preview_status: 'READY',
    preview_storage_key: 'previews/44/existing.pdf',
    preview_mime_type: 'application/pdf',
    page_count: 2
  });
  retry.state.files.set('previews/44/existing.pdf', await pdfBytes(2));
  const replay = await previewService.processClaimedJob(retry.state.job, {
    ...retry,
    convert: async () => { converted = true; }
  });
  assert.deepEqual(replay, { status: 'SUCCEEDED', reused: true });
  assert.equal(converted, false);
}

async function testLibreOfficeArgumentsAreIsolated() {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'edurag-preview-argv-'));
  try {
    let observed = null;
    await previewService.convertDocxToPdf('safe-original.docx', temporaryDirectory, {
      command: 'soffice-test',
      timeoutMs: 4321,
      runProcess: async (command, args, timeoutMs) => {
        observed = { command, args, timeoutMs };
        await fs.writeFile(path.join(temporaryDirectory, 'safe-original.pdf'), await pdfBytes(1));
      }
    });
    assert.equal(observed.command, 'soffice-test');
    assert.equal(observed.timeoutMs, 4321);
    assert(observed.args.includes('--headless'));
    assert(observed.args.includes('safe-original.docx'));
    assert(observed.args.some(
      (argument) => argument.startsWith('-env:UserInstallation=file:')
        && argument.includes('edurag-preview-argv-')
    ));
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function testDtoSafetyAndMigrationParser() {
  const record = {
    id: 1,
    title: 'Public',
    description: null,
    author: null,
    file_type: 'PDF',
    file_size_bytes: 10,
    page_count: 1,
    preview_status: 'READY',
    preview_storage_key: null,
    preview_mime_type: 'application/pdf',
    storage_key: 'documents/private.pdf',
    created_at: new Date(),
    updated_at: new Date()
  };
  const dto = await documentDto.libraryDocument(record, {
    async exists() { return true; }
  });
  assert.equal(dto.previewAvailable, true);
  assert.equal(dto.previewUrl, '/api/library/documents/1/preview');
  for (const field of ['storageKey', 'storage_key', 'previewStorageKey', 'checksumSha256']) {
    assert(!Object.hasOwn(dto, field));
  }
  assert.deepEqual(
    splitStatements("-- comment\nALTER TABLE `x` ADD COLUMN `a` VARCHAR(20);\nUPDATE `x` SET `a` = 'a;b';"),
    [
      'ALTER TABLE `x` ADD COLUMN `a` VARCHAR(20)',
      "UPDATE `x` SET `a` = 'a;b'"
    ]
  );
}

async function testBackfillBehavior() {
  const updates = [];
  const validPdf = await pdfBytes(4);
  const dependencies = {
    fileService: {
      resolveStorageKey(key) { return `safe/${key}`; },
      countPdfPages: documentFileService.countPdfPages
    },
    documentRepo: {
      async updatePreview(id, update) { updates.push({ id, ...update }); }
    },
    readFile: async () => validPdf
  };
  assert.equal(await backfillDocument({
    id: 10,
    file_type: 'PDF',
    storage_key: 'old.pdf'
  }, false, dependencies), 'updated');
  assert.deepEqual(updates, [{
    id: 10,
    status: 'READY',
    storageKey: null,
    mimeType: 'application/pdf',
    pageCount: 4
  }]);

  await assert.rejects(
    () => backfillDocument({
      id: 11,
      file_type: 'PDF',
      storage_key: 'corrupt.pdf'
    }, false, {
      ...dependencies,
      readFile: async () => Buffer.from('%PDF-corrupt')
    }),
    (error) => error.code === 'INVALID_PDF'
  );

  let enqueueCalls = 0;
  const previewDependencies = {
    previewService: {
      async ensureQueued(id) {
        enqueueCalls += 1;
        assert.equal(id, 12);
        return 88;
      }
    }
  };
  assert.equal(await backfillDocument({
    id: 12,
    file_type: 'DOCX'
  }, false, previewDependencies), 'updated');
  assert.equal(await backfillDocument({
    id: 12,
    file_type: 'DOCX'
  }, false, previewDependencies), 'updated');
  assert.equal(enqueueCalls, 2, 'Reruns must delegate to idempotent ensureQueued without direct conversion.');
  assert.equal(await backfillDocument({
    id: 13,
    file_type: 'TXT'
  }, false, dependencies), 'skipped');
  assert.equal(await backfillDocument({
    id: 14,
    file_type: 'PDF'
  }, true, {
    readFile: async () => { throw new Error('Dry-run must not read or mutate files.'); }
  }), 'updated');
}

async function main() {
  await testPdfCountAndMetadata();
  await testUnicodePreviewHeadersAndBytes();
  await testUnicodeSourceHeadersRemainAttachments();
  await testPreviewSuccessFailureAndRetry();
  await testLibreOfficeArgumentsAreIsolated();
  await testDtoSafetyAndMigrationParser();
  await testBackfillBehavior();
  console.log('DOCUMENT_PREVIEW_TESTS_OK pdf=physical-pages metadata=allowlist preview=durable-job headers=rfc5987');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
