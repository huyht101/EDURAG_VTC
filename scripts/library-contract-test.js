'use strict';

const assert = require('assert/strict');
const { PassThrough } = require('stream');

const libraryController = require('../src/controllers/library-controller');
const libraryRepo = require('../src/repositories/library-repository');
const libraryService = require('../src/services/library-service');
const documentRepo = require('../src/repositories/document-repository');
const documentService = require('../src/services/document-service');
const localStorage = require('../src/storage/local-storage');
const { validateLibraryQuery } = require('../src/validators/library');
const { validateDocumentQuery } = require('../src/validators/document');
const ROLES = require('../src/constants/roles');
const { normalizeListQuery } = require('../src/utils/document-list-query');
const {
  REQUIRED_DOCUMENT_COLUMNS,
  checkDocumentSchema
} = require('./document-schema-check');

const readyDocument = {
  id: 12,
  title: 'Public title',
  description: 'Public description',
  author: 'Public author',
  file_type: 'PDF',
  file_size_bytes: 1234,
  storage_key: 'documents/2026/07/source.pdf',
  original_filename: 'source.pdf',
  mime_type: 'application/pdf',
  page_count: 5,
  preview_status: 'READY',
  preview_storage_key: null,
  preview_mime_type: 'application/pdf',
  created_at: new Date('2026-07-22T08:00:00.000Z'),
  updated_at: new Date('2026-07-22T09:00:00.000Z'),
  processing_status: 'READY',
  visibility_status: 'VISIBLE',
  uploaded_by: 99,
  checksum_sha256: 'internal',
  deleted_at: null
};

async function testRepositoryScope() {
  const calls = [];
  const executor = {
    async execute(statement, params) {
      calls.push({ statement, params });
      return calls.length === 1 ? [[{ total: 0 }]] : [[]];
    }
  };
  await libraryRepo.listEligibleDocuments({
    offset: 20,
    limit: 10,
    q: "Tiếng Việt 100%_\\' OR 1=1",
    fileType: 'PDF',
    author: 'A_B%',
    sort: 'title_asc'
  }, executor);
  assert.equal(calls.length, 2);
  assert(calls.every(({ statement }) => statement.includes("d.processing_status = 'READY'")));
  assert(calls.every(({ statement }) => statement.includes("d.visibility_status = 'VISIBLE'")));
  assert(calls.every(({ statement }) => statement.includes("ESCAPE '!'")));
  assert(calls.every(({ statement }) => statement.includes('d.file_type = ?')));
  assert.deepEqual(calls[0].params, calls[1].params, 'Count and data query filters must match.');
  assert.deepEqual(calls[0].params, [
    "%Tiếng Việt 100!%!_\\' OR 1=1%",
    "%Tiếng Việt 100!%!_\\' OR 1=1%",
    "%Tiếng Việt 100!%!_\\' OR 1=1%",
    'PDF',
    '%A!_B!%%'
  ]);
  assert.match(calls[1].statement, /ORDER BY d\.title ASC, d\.id ASC/);
  assert.match(calls[1].statement, /LIMIT 10 OFFSET 20/);

  const detailSql = [];
  const detailExecutor = {
    async execute(statement) {
      detailSql.push(statement);
      return [[]];
    }
  };
  await libraryRepo.findEligibleById(12, detailExecutor);
  assert(detailSql[0].includes("d.processing_status = 'READY'"));
  assert(detailSql[0].includes("d.visibility_status = 'VISIBLE'"));
}

async function testRuntimeSchemaGuard() {
  const legacyExecutor = {
    async execute() {
      return [[{ COLUMN_NAME: 'id' }, { COLUMN_NAME: 'title' }]];
    }
  };
  await assert.rejects(
    () => checkDocumentSchema(legacyExecutor),
    (error) => error.code === 'DOCUMENT_SCHEMA_MIGRATION_REQUIRED'
      && error.missingColumns.includes('description')
      && error.missingColumns.includes('preview_status')
  );

  let call = 0;
  const compatibleExecutor = {
    async execute() {
      call += 1;
      if (call === 1) {
        return [[
          { COLUMN_NAME: 'id' },
          ...REQUIRED_DOCUMENT_COLUMNS.map((COLUMN_NAME) => ({ COLUMN_NAME }))
        ]];
      }
      if (call === 2 || call === 4) return [[{ total: 0 }]];
      return [[]];
    }
  };
  const result = await checkDocumentSchema(compatibleExecutor);
  assert.deepEqual(result, { requiredColumns: 6, repositoryQueries: 4 });
  assert.equal(call, 7, 'Schema guard must execute real management/library list and detail queries.');
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
    {
      page: '2',
      limit: '10',
      q: ' Public title ',
      fileType: ' PDF ',
      author: ' Public author ',
      sort: 'oldest'
    },
    { repository, fileService }
  );
  assert.deepEqual(receivedFilters, {
    offset: 10,
    page: 2,
    limit: 10,
    q: 'Public title',
    fileType: 'PDF',
    author: 'Public author',
    processingStatus: '',
    visibilityStatus: '',
    previewStatus: '',
    ownerId: '',
    sort: 'oldest'
  });
  assert.equal(page.offset, 10);
  assert.equal(page.page, 2);
  assert.equal(page.totalPages, 1);
  assert.deepEqual(
    Object.keys(page.documents[0]).sort(),
    [
      'author', 'createdAt', 'description', 'fileSize', 'fileType', 'id',
      'originalAvailable', 'originalFileUrl', 'pageCount', 'previewAvailable',
      'previewMimeType', 'previewStatus', 'previewUrl', 'title', 'updatedAt'
    ]
  );
  assert.equal(page.documents[0].originalAvailable, true);
  assert.equal(page.documents[0].previewAvailable, true);
  assert.equal(page.documents[0].pageCount, 5);
  assert.equal(page.documents[0].previewUrl, '/api/library/documents/12/preview');
  assert.equal(page.documents[0].originalFileUrl, '/api/library/documents/12/source');
  for (const internal of [
    'uploadedBy', 'uploaded_by', 'storageKey', 'storage_key', 'originalFilename',
    'previewStorageKey', 'preview_storage_key', 'checksumSha256', 'processingStatus',
    'visibilityStatus', 'deletedAt', 'jobId'
  ]) {
    assert(!Object.hasOwn(page.documents[0], internal), `${internal} must not be public.`);
  }
  assert(validateLibraryQuery({ visibilityStatus: 'DELETED' })?.error);
  assert(validateLibraryQuery({ processingStatus: 'FAILED' })?.error);
  assert.equal(validateLibraryQuery({
    page: ' 1 ', limit: '20', q: ' tiếng Việt ', fileType: 'PDF', author: ' A&B ', sort: 'newest'
  }), null);
  assert.equal(validateLibraryQuery({ offset: '0', limit: '20', search: 'legacy' }), null);
  assert.equal(validateLibraryQuery({ page: '1', offset: '0' }), null);
  assert.equal(validateLibraryQuery({ page: '2', offset: '10', limit: '10' }), null);
  assert(validateLibraryQuery({ page: '2', offset: '11', limit: '10' })?.error);
  assert.equal(validateLibraryQuery({ q: ' title ', search: 'title' }), null);
  assert.equal(validateLibraryQuery({ q: '   ', search: 'title' }), null);
  assert(validateLibraryQuery({ q: 'new', search: 'legacy' })?.error);
  assert(validateLibraryQuery({ page: '0' })?.error);
  assert(validateLibraryQuery({ limit: '101' })?.error);
  assert(validateLibraryQuery({ sort: 'random' })?.error);
  assert(validateLibraryQuery({ fileType: 'PPTX' })?.error);
  assert(validateLibraryQuery({ q: ['repeated'] })?.error);
  assert(validateLibraryQuery({ fileType: ['PDF', 'TXT'] })?.error);
  assert(validateLibraryQuery({ page: ['1', '2'] })?.error);
  assert(validateLibraryQuery({ q: 'x'.repeat(256) })?.error);
  assert(validateLibraryQuery({ author: 'x'.repeat(256) })?.error);
  assert.deepEqual(
    normalizeListQuery({ offset: '7', limit: '3', search: ' legacy ' }),
    {
      offset: 7,
      page: 3,
      limit: 3,
      q: 'legacy',
      fileType: '',
      author: '',
      processingStatus: '',
      visibilityStatus: '',
      previewStatus: '',
      ownerId: '',
      sort: 'newest'
    }
  );
  assert.deepEqual(
    normalizeListQuery({ q: ' title ', page: '2', limit: '10' }),
    {
      offset: 10,
      page: 2,
      limit: 10,
      q: 'title',
      fileType: '',
      author: '',
      processingStatus: '',
      visibilityStatus: '',
      previewStatus: '',
      ownerId: '',
      sort: 'newest'
    }
  );
  assert.deepEqual(
    normalizeListQuery({}),
    {
      offset: 0,
      page: 1,
      limit: 20,
      q: '',
      fileType: '',
      author: '',
      processingStatus: '',
      visibilityStatus: '',
      previewStatus: '',
      ownerId: '',
      sort: 'newest'
    }
  );
}

async function testManagementFiltersAndOwnership() {
  const calls = [];
  const executor = {
    async execute(statement, params) {
      calls.push({ statement, params });
      return calls.length === 1 ? [[{ total: 2 }]] : [[readyDocument]];
    }
  };
  await documentRepo.listDocuments({
    offset: 0,
    limit: 20,
    q: "file%_\\' OR 1=1",
    fileType: 'DOCX',
    processingStatus: 'READY',
    visibilityStatus: 'VISIBLE',
    previewStatus: 'READY',
    uploadedBy: 44,
    sort: 'title_desc'
  }, executor);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params, calls[1].params);
  assert.deepEqual(calls[0].params, [
    44,
    'READY',
    'VISIBLE',
    'DOCX',
    'READY',
    "%file!%!_\\' OR 1=1%",
    "%file!%!_\\' OR 1=1%",
    "%file!%!_\\' OR 1=1%",
    "%file!%!_\\' OR 1=1%"
  ]);
  assert(calls.every(({ statement }) => statement.includes('d.uploaded_by = ?')));
  assert(calls.every(({ statement }) => statement.includes('d.original_filename LIKE ?')));
  assert.match(calls[1].statement, /ORDER BY d\.title DESC, d\.id DESC/);

  let teacherFilters;
  const repository = {
    async listDocuments(filters) {
      teacherFilters = filters;
      return { total: 21, documents: [readyDocument] };
    }
  };
  const serialize = async (document) => ({ id: document.id });
  const teacherPage = await documentService.listDocuments(
    { id: 44, role: ROLES.TEACHER },
    { page: '2', limit: '20', q: ' tên ', previewStatus: 'READY', sort: 'oldest' },
    { repository, publicDocument: serialize }
  );
  assert.equal(teacherFilters.uploadedBy, 44);
  assert.equal(teacherFilters.ownerId, '');
  assert.equal(teacherPage.page, 2);
  assert.equal(teacherPage.offset, 20);
  assert.equal(teacherPage.totalPages, 2);
  await assert.rejects(
    () => documentService.listDocuments(
      { id: 44, role: ROLES.TEACHER },
      { ownerId: '45' },
      { repository, publicDocument: serialize }
    ),
    (error) => error.status === 403 && error.code === 'OWNER_FILTER_FORBIDDEN'
  );
  await documentService.listDocuments(
    { id: 1, role: ROLES.ADMIN },
    { ownerId: '45' },
    { repository, publicDocument: serialize }
  );
  assert.equal(teacherFilters.uploadedBy, 45);

  assert.equal(validateDocumentQuery({
    page: '1',
    limit: '100',
    q: 'tên',
    fileType: 'TXT',
    processingStatus: 'READY',
    visibilityStatus: 'VISIBLE',
    previewStatus: 'NOT_APPLICABLE',
    ownerId: '45',
    sort: 'title_asc'
  }), null);
  assert.equal(validateDocumentQuery({
    q: ' tài liệu ', search: 'tài liệu', page: '3', offset: '40', limit: '20'
  }), null);
  assert(validateDocumentQuery({
    q: 'tài liệu', search: 'khác'
  })?.error);
  assert(validateDocumentQuery({
    page: '3', offset: '41', limit: '20'
  })?.error);
  for (const invalid of [
    { ownerId: '0' },
    { fileType: 'PPTX' },
    { previewStatus: 'UNKNOWN' },
    { sort: 'id_asc' },
    { limit: '0' },
    { q: 'x'.repeat(256) },
    { unknown: 'value' }
  ]) {
    assert(validateDocumentQuery(invalid)?.error, JSON.stringify(invalid));
  }
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
  const preview = await libraryService.openPreview(12, {
    repository: eligibleRepository,
    fileService: availableFiles
  });
  assert.equal(preview.mimeType, 'application/pdf');

  const missingRepository = { async findEligibleById() { return null; } };
  for (const action of [
    () => libraryService.getDocument(12, { repository: missingRepository, fileService: availableFiles }),
    () => libraryService.openSource(12, { repository: missingRepository, fileService: availableFiles }),
    () => libraryService.openPreview(12, { repository: missingRepository, fileService: availableFiles })
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
  await assert.rejects(
    () => libraryService.openPreview(12, {
      repository: {
        async findEligibleById() {
          return {
            ...readyDocument,
            file_type: 'DOCX',
            preview_status: 'FAILED',
            preview_storage_key: null,
            preview_mime_type: null,
            page_count: null
          };
        }
      },
      fileService: availableFiles
    }),
    (error) => error.status === 409 && error.code === 'PREVIEW_UNAVAILABLE'
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
  await testRuntimeSchemaGuard();
  await testDtoAndFixedQueryScope();
  await testManagementFiltersAndOwnership();
  await testDetailAndSourceStates();
  await testSupportedSourceTypes();
  await testStorageBoundaryAndStreamErrors();
  console.log('LIBRARY_CONTRACT_OK scope=READY+VISIBLE dto=allowlist source=authorized-state');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
