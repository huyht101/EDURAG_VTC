'use strict';

const assert = require('assert/strict');
const { PassThrough } = require('stream');

const libraryController = require('../src/controllers/library-controller');
const libraryRepo = require('../src/repositories/library-repository');
const libraryService = require('../src/services/library-service');
const localStorage = require('../src/storage/local-storage');
const { validateLibraryQuery } = require('../src/validators/library');

const readyDocument = {
  id: 12,
  title: 'Public title',
  file_type: 'PDF',
  file_size_bytes: 1234,
  storage_key: 'documents/2026/07/source.pdf',
  original_filename: 'source.pdf',
  mime_type: 'application/pdf',
  created_at: new Date('2026-07-22T08:00:00.000Z'),
  processing_status: 'READY',
  visibility_status: 'VISIBLE',
  uploaded_by: 99,
  checksum_sha256: 'internal',
  deleted_at: null
};

async function testRepositoryScope() {
  const sql = [];
  const executor = {
    async execute(statement) {
      sql.push(statement);
      return sql.length === 1 ? [[{ total: 0 }]] : [[]];
    }
  };
  await libraryRepo.listEligibleDocuments({ offset: 0, limit: 20, search: '' }, executor);
  await libraryRepo.findEligibleById(12, executor);
  assert(sql.every((statement) => statement.includes("d.processing_status = 'READY'")));
  assert(sql.every((statement) => statement.includes("d.visibility_status = 'VISIBLE'")));
}

async function testDtoAndFixedQueryScope() {
  let receivedFilters;
  const repository = {
    async listEligibleDocuments(filters) {
      receivedFilters = filters;
      return { total: 1, documents: [readyDocument] };
    }
  };
  const fileService = { async exists() { return true; } };
  const page = await libraryService.listDocuments(
    { offset: '0', limit: '20', search: 'Public title' },
    { repository, fileService }
  );
  assert.deepEqual(receivedFilters, { offset: 0, limit: 20, search: 'Public title' });
  assert.deepEqual(
    Object.keys(page.documents[0]).sort(),
    ['createdAt', 'fileSize', 'fileType', 'id', 'originalAvailable', 'pageCount', 'title']
  );
  assert.equal(page.documents[0].originalAvailable, true);
  assert.equal(page.documents[0].pageCount, null);
  for (const internal of [
    'uploadedBy', 'uploaded_by', 'storageKey', 'storage_key', 'originalFilename',
    'checksumSha256', 'processingStatus', 'visibilityStatus', 'deletedAt', 'jobId'
  ]) {
    assert(!Object.hasOwn(page.documents[0], internal), `${internal} must not be public.`);
  }
  assert(validateLibraryQuery({ visibilityStatus: 'DELETED' })?.error);
  assert(validateLibraryQuery({ processingStatus: 'FAILED' })?.error);
  assert.equal(validateLibraryQuery({ offset: '0', limit: '20', search: 'title' }), null);
}

async function testDetailAndSourceStates() {
  const availableFiles = {
    async exists() { return true; },
    async open() {
      const stream = new PassThrough();
      stream.end('source');
      return { stream, size: 6 };
    }
  };
  const eligibleRepository = { async findEligibleById() { return readyDocument; } };
  const detail = await libraryService.getDocument(12, {
    repository: eligibleRepository,
    fileService: availableFiles
  });
  assert.equal(detail.document.id, 12);
  const source = await libraryService.openSource(12, {
    repository: eligibleRepository,
    fileService: availableFiles
  });
  assert.equal(source.filename, 'source.pdf');
  assert.equal(source.mimeType, 'application/pdf');

  const missingRepository = { async findEligibleById() { return null; } };
  for (const action of [
    () => libraryService.getDocument(12, { repository: missingRepository, fileService: availableFiles }),
    () => libraryService.openSource(12, { repository: missingRepository, fileService: availableFiles })
  ]) {
    await assert.rejects(action, (error) => (
      error.status === 404 && error.code === 'LIBRARY_DOCUMENT_NOT_FOUND'
    ));
  }

  await assert.rejects(
    () => libraryService.openSource(12, {
      repository: eligibleRepository,
      fileService: { async exists() { return false; } }
    }),
    (error) => error.status === 409 && error.code === 'ORIGINAL_SOURCE_UNAVAILABLE'
  );
}

async function testSupportedSourceTypes() {
  const variants = [
    { fileType: 'PDF', filename: 'source.pdf', mimeType: 'application/pdf' },
    {
      fileType: 'DOCX',
      filename: 'source.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    },
    { fileType: 'TXT', filename: 'source.txt', mimeType: 'text/plain' }
  ];
  const files = {
    async exists() { return true; },
    async open() {
      const stream = new PassThrough();
      stream.end('source');
      return { stream, size: 6 };
    }
  };
  for (const variant of variants) {
    const repository = {
      async findEligibleById() {
        return {
          ...readyDocument,
          file_type: variant.fileType,
          original_filename: variant.filename,
          mime_type: variant.mimeType
        };
      }
    };
    const source = await libraryService.openSource(12, { repository, fileService: files });
    assert.equal(source.filename, variant.filename);
    assert.equal(source.mimeType, variant.mimeType);
  }
}

async function testStorageBoundaryAndStreamErrors() {
  for (const storageKey of [
    '../outside.txt',
    'documents/../outside.txt',
    '/absolute/outside.txt',
    'documents//outside.txt'
  ]) {
    assert.throws(
      () => localStorage.resolveStorageKey(storageKey),
      (error) => error.status === 400 && error.code === 'INVALID_STORAGE_KEY'
    );
  }

  const originalOpenSource = libraryService.openSource;
  const stream = new PassThrough();
  const response = new PassThrough();
  response.setHeader = () => {};
  response.attachment = () => {};
  const expectedError = new Error('CONTROLLED_STREAM_READ_ERROR');
  let observedError;
  libraryService.openSource = async () => ({
    stream,
    size: 6,
    filename: 'source.txt',
    mimeType: 'text/plain'
  });
  try {
    await libraryController.streamSource(
      { params: { id: '12' } },
      response,
      (error) => { observedError = error; }
    );
    stream.emit('error', expectedError);
    assert.equal(observedError, expectedError);
    stream.end('source');
  } finally {
    libraryService.openSource = originalOpenSource;
  }
}

async function main() {
  await testRepositoryScope();
  await testDtoAndFixedQueryScope();
  await testDetailAndSourceStates();
  await testSupportedSourceTypes();
  await testStorageBoundaryAndStreamErrors();
  console.log('LIBRARY_CONTRACT_OK scope=READY+VISIBLE dto=allowlist source=authorized-state');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
