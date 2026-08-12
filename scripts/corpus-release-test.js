'use strict';

const assert = require('assert/strict');
const fsp = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');

const {
  bootstrapCorpus,
  classifyBootstrapState,
  countTableRows,
  downloadAndVerifyRelease,
  inspectCorpus,
  inspectPublishSource,
  inspectReadOnlyPublishSource,
  localReleaseState,
  parseCommandLine,
  publishCorpus,
  restoreOriginals,
  restoreCorpus,
  sourceFingerprint,
  stageOriginalFile,
  validateOptionalCloudConfiguration
} = require('./corpus-manager');
const {
  POINTER_SCHEMA_VERSION,
  assertPublishableDocuments,
  buildReleaseManifest,
  credentialState,
  loadCloudConfig,
  manifestObjectKey,
  parseDocumentsFromDump,
  releaseError,
  sha256Buffer,
  validateReleaseManifest
} = require('./lib/corpus-release');
const corpusRuntime = require('./lib/corpus-runtime');
const { approvedCorpusConfig } = require('./restored-corpus-live-smoke');
const { auditDownloadedRelease } = require('./corpus-prepublish-audit');
const { assertRemoteResetAllowed } = require('./remote-test-utils');
const { DockerUploadVolume } = require('./lib/docker-upload-volume');
const { GcsObjectStore } = require('./lib/gcs-object-store');
const {
  markCorpusFailure,
  normalizeRemoteReadError
} = require('./lib/corpus-bootstrap-errors');

const config = Object.freeze({
  projectId: 'test-project',
  bucket: 'edurag-test-bucket',
  objectPrefix: 'portable-corpus/v1',
  credentialsFile: path.join(os.tmpdir(), 'not-used.json')
});
const temporaryDirectories = new Set();

async function cleanupTemporaryDirectories() {
  await Promise.all([...temporaryDirectories].map(
    (directory) => fsp.rm(directory, { recursive: true, force: true })
  ));
  temporaryDirectories.clear();
}

async function listenLoopback(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function manifestInput() {
  const mysql = Buffer.from('mysql-data');
  const qdrant = Buffer.from('qdrant-data');
  const original = Buffer.from('unit-fixture-original');
  return {
    buffers: { mysql, qdrant, original },
    input: {
      config,
      mysql: { sha256: sha256Buffer(mysql), sizeBytes: mysql.length },
      qdrant: { sha256: sha256Buffer(qdrant), sizeBytes: qdrant.length },
      documents: [{
        documentId: '1', sha256: sha256Buffer(original), sizeBytes: original.length,
        localStorageKey: 'documents/2026/07/example.pdf', originalFilename: 'demo.pdf',
        mimeType: 'application/pdf', file: 'C:\\secret\\must-not-leak.pdf',
        serviceAccountJson: 'must-not-leak'
      }],
      compatibility: {
        databaseSchemaVersion: '1.0.0', mysqlServerVersion: '8.4.10',
        qdrantServerVersion: '1.18.2', qdrantCollectionName: 'education_docs',
        embeddingModel: 'gemini-embedding-001', embeddingDimension: 768, pipelineVersion: null
      },
      expectedCounts: { documents: 1, processingJobs: 1, chunks: 1, citations: 1, qdrantPoints: 1 },
      inventory: {
        activeDocuments: ['1'],
        chunks: [{
          documentId: '1', vectorNodeId: '9589059b-c74b-40b8-896a-47aa77ed4601',
          contentHash: 'e7600f3da27237e68019ee627b32f0e059824b52f2d38f2bbe01ad9388ad1cf0', hidden: false
        }]
      },
      sourceFingerprint: 'a'.repeat(64),
      sanitization: { secretAndPathScan: 'passed' },
      createdAtUtc: '2026-07-21T00:00:00.000Z'
    }
  };
}

async function stagedRelease() {
  const fixture = manifestInput();
  const manifest = buildReleaseManifest(fixture.input);
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-release-test-stage-'));
  temporaryDirectories.add(temporary);
  const files = new Map();
  const artifacts = [manifest.artifacts.mysql, manifest.artifacts.qdrant, ...manifest.artifacts.documents];
  const buffers = [fixture.buffers.mysql, fixture.buffers.qdrant, fixture.buffers.original];
  for (let index = 0; index < artifacts.length; index += 1) {
    const file = path.join(temporary, `artifact-${index}`);
    await fsp.writeFile(file, buffers[index]);
    files.set(artifacts[index].objectKey, file);
  }
  return {
    temporary,
    manifest,
    files,
    generatedLegacy: false,
    publishDocuments: [{
      documentId: '1', title: 'Demo document', originalFilename: 'demo.pdf',
      processingStatus: 'READY', visibilityStatus: 'VISIBLE',
      sha256: manifest.artifacts.documents[0].sha256,
      sizeBytes: manifest.artifacts.documents[0].sizeBytes
    }]
  };
}

async function unsafeAuthTokenBundle() {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-release-test-unsafe-sql-'));
  const files = {
    mysqlDump: 'mysql/edurag.sql',
    qdrantSnapshot: 'qdrant/education_docs.snapshot',
    inventory: 'inventory.json'
  };
  const payloads = {
    [files.mysqlDump]: "INSERT INTO `auth_tokens` VALUES (1);\n",
    [files.qdrantSnapshot]: 'snapshot',
    [files.inventory]: '{"activeDocuments":[],"chunks":[]}\n'
  };
  for (const [relative, value] of Object.entries(payloads)) {
    const target = path.join(directory, relative);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, value, 'utf8');
  }
  const checksums = Object.fromEntries(Object.entries(payloads).map(([relative, value]) => [
    relative, sha256Buffer(Buffer.from(value, 'utf8'))
  ]));
  const manifest = {
    bundleFormatVersion: '1.0.0',
    databaseSchemaVersion: '1.0.0',
    mysqlServerVersion: '8.4.10',
    qdrantServerVersion: '1.18.2',
    qdrantCollectionName: 'education_docs',
    embeddingModel: 'gemini-embedding-001',
    embeddingDimension: 768,
    documentCount: 0,
    chunkCount: 0,
    qdrantPointCount: 0,
    originalFilesIncluded: false,
    files,
    checksums
  };
  await fsp.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  await fsp.writeFile(
    path.join(directory, 'checksums.sha256'),
    `${Object.entries(checksums).map(([relative, digest]) => `${digest}  ${relative}`).join('\n')}\n`,
    'utf8'
  );
  return directory;
}

class FakeObjectStore {
  constructor() {
    this.objects = new Map();
    this.uploadOrder = [];
    this.privacyChecks = 0;
  }

  async assertPrivateTarget() { this.privacyChecks += 1; }

  async metadata(key) {
    const item = this.objects.get(key);
    if (!item) return { exists: false };
    return { exists: true, sizeBytes: item.bytes.length, ...item.metadata };
  }

  async uploadCreateOnly(source, key, metadata) {
    if (this.objects.has(key)) return { uploaded: false, preconditionFailed: true };
    const bytes = await fsp.readFile(source);
    this.objects.set(key, { bytes, metadata: { ...metadata } });
    this.uploadOrder.push(metadata.kind);
    return { uploaded: true };
  }

  async download(key, destination) {
    const item = this.objects.get(key);
    if (!item) throw releaseError('GCS_OBJECT_MISSING', 'missing');
    await fsp.writeFile(destination, item.bytes);
  }
}

function reconciledFixture() {
  return {
    stats: { documents: 1, jobs: 1, chunks: 1, citations: 1 },
    chunks: [], points: [{}]
  };
}

async function main() {
  const privacyRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-gcs-privacy-test-'));
  const writerCredential = path.join(privacyRoot, 'writer.json');
  const readerCredential = path.join(privacyRoot, 'reader.json');
  const wrongProjectCredential = path.join(privacyRoot, 'wrong-project-writer.json');
  await fsp.writeFile(writerCredential, JSON.stringify({
    type: 'service_account', project_id: 'valid-project',
    client_email: 'edurag-corpus-writer@example.invalid'
  }));
  await fsp.writeFile(readerCredential, JSON.stringify({
    type: 'service_account', project_id: 'valid-project',
    client_email: 'edurag-corpus-reader@example.invalid'
  }));
  await fsp.writeFile(wrongProjectCredential, JSON.stringify({
    type: 'service_account', project_id: 'other-project',
    client_email: 'edurag-corpus-writer@example.invalid'
  }));
  const privateStore = ({ attestation = '', credential = writerCredential, metadata, policy }) => {
    const store = Object.create(GcsObjectStore.prototype);
    store.projectId = 'valid-project';
    store.bucketName = 'valid-private-bucket';
    store.credentialsFile = credential;
    store.privateTargetOwnerAttestation = attestation;
    store.bucket = {
      getMetadata: async () => {
        if (metadata instanceof Error) throw metadata;
        return [metadata];
      },
      iam: { getPolicy: async () => [policy || { bindings: [] }] }
    };
    return store;
  };
  await privateStore({ metadata: { iamConfiguration: { publicAccessPrevention: 'enforced' } } })
    .assertPrivateTarget();
  const forbidden = Object.assign(new Error('permission denied'), { code: 403 });
  await privateStore({
    attestation: 'valid-project/valid-private-bucket', metadata: forbidden
  }).assertPrivateTarget();
  await assert.rejects(
    () => privateStore({ metadata: forbidden }).assertPrivateTarget(),
    (error) => error.code === 'GCS_BUCKET_PRIVACY_UNVERIFIED'
  );
  await assert.rejects(
    () => privateStore({ attestation: 'other-project/valid-private-bucket', metadata: forbidden })
      .assertPrivateTarget(),
    (error) => error.code === 'GCS_BUCKET_PRIVACY_UNVERIFIED'
  );
  await assert.rejects(
    () => privateStore({
      attestation: 'valid-project/valid-private-bucket', credential: readerCredential,
      metadata: forbidden
    }).assertPrivateTarget(),
    (error) => error.code === 'GCS_WRITER_IDENTITY_MISMATCH'
  );
  await assert.rejects(
    () => privateStore({
      attestation: 'valid-project/valid-private-bucket', credential: wrongProjectCredential,
      metadata: forbidden
    }).assertPrivateTarget(),
    (error) => error.code === 'GCS_WRITER_IDENTITY_MISMATCH'
  );
  await assert.rejects(
    () => privateStore({
      metadata: { iamConfiguration: { publicAccessPrevention: 'inherited' } },
      policy: { bindings: [{ members: ['allUsers'] }] }
    }).assertPrivateTarget(),
    (error) => error.code === 'GCS_PUBLIC_BUCKET_BLOCKED'
  );
  await fsp.rm(privacyRoot, { recursive: true, force: true });

  assert.doesNotThrow(() => corpusRuntime.assertPointLifecycle(
    { payload: { is_active: true, is_hidden: false } },
    { vectorNodeId: 'active-point', visibilityStatus: 'VISIBLE' }
  ));
  assert.throws(
    () => corpusRuntime.assertPointLifecycle(
      { payload: { is_hidden: false } },
      { vectorNodeId: 'legacy-point', visibilityStatus: 'VISIBLE' }
    ),
    (error) => error.code === 'CORPUS_QDRANT_LIFECYCLE_INCOMPATIBLE'
  );
  const validPasswordHash = `$2b$12$${'a'.repeat(53)}`;
  const accountPolicy = corpusRuntime.validatePrivateAccountRows([
    {
      id: 1,
      email: 'canonical.user@private.example',
      fullName: 'Canonical User',
      phone: null,
      passwordHash: validPasswordHash
    },
    {
      id: 2,
      email: 'another-account@example.vn',
      fullName: 'Another User',
      phone: '0900000000',
      passwordHash: validPasswordHash
    }
  ]);
  assert.deepEqual(accountPolicy, { accountRows: 2, containsAccountData: true });
  const singleAccountDump = (
    `CREATE TABLE \`users\` (\`email\` varchar(255), \`password_hash\` varchar(255));\n`
    + `INSERT INTO \`users\` VALUES ('canonical.user@private.example','${validPasswordHash}');`
  );
  const multipleAccountDump = `${singleAccountDump}\n`
    + `INSERT INTO \`users\` VALUES ('another-account@example.vn','${validPasswordHash}');`;
  corpusRuntime.assertSafeMysqlDump(singleAccountDump);
  corpusRuntime.assertSafeMysqlDump(multipleAccountDump);
  assert.throws(
    () => corpusRuntime.validatePrivateAccountRows([{
      id: 3,
      email: 'plaintext@example.com',
      fullName: 'Plaintext Rejected',
      phone: null,
      passwordHash: 'plaintext-password'
    }]),
    (error) => error.code === 'CORPUS_ACCOUNT_PASSWORD_HASH_INVALID'
  );
  for (const value of [
    'password=plaintext-secret',
    'reset_token=reset-secret-value',
    'otp=123456',
    'api_key=api-secret-value',
    'cloud_credential=cloud-secret-value',
    'Authorization: Bearer abcdefghijklmnop',
    '-----BEGIN PRIVATE KEY-----'
  ]) {
    assert.throws(
      () => corpusRuntime.scanSensitiveText('policy regression', value),
      (error) => error.code === 'CORPUS_SECRET_SCAN_FAILED'
    );
  }
  assert.throws(
    () => corpusRuntime.assertSafeMysqlDump('CREATE TABLE `outside_scope` (`id` bigint);'),
    (error) => error.code === 'CORPUS_MYSQL_TABLE_OUT_OF_SCOPE'
  );
  assert.throws(
    () => corpusRuntime.assertSafeMysqlDump(
      'CREATE TABLE `auth_tokens` (`id` bigint); INSERT INTO `auth_tokens` VALUES (1);'
    ),
    (error) => error.code === 'CORPUS_MYSQL_DUMP_UNSAFE'
  );

  const auditDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-corpus-audit-test-'));
  temporaryDirectories.add(auditDirectory);
  const auditBytes = Buffer.from('Safe corpus audit fixture with enough readable text for validation.', 'utf8');
  const auditReleaseId = 'v1-000000000000000000000000';
  const auditReleasePrefix = `test/releases/${auditReleaseId}`;
  const auditKey = `${auditReleasePrefix}/documents/1.txt`;
  const auditFile = path.join(auditDirectory, 'document.txt');
  await fsp.writeFile(auditFile, auditBytes);
  const auditManifestKey = `${auditReleasePrefix}/manifest.json`;
  const auditMysqlKey = `${auditReleasePrefix}/mysql/corpus.sql.gz`;
  const auditQdrantKey = `${auditReleasePrefix}/qdrant/education_docs.snapshot`;
  const auditResult = await auditDownloadedRelease({
    manifest: {
      releaseId: auditReleaseId,
      objectPrefix: auditReleasePrefix,
      expectedCounts: { qdrantPoints: 1 },
      sanitization: { secretAndPathScan: 'passed' },
      inventory: {
        activeDocuments: ['1'],
        chunks: [{
          documentId: '1',
          vectorNodeId: '9589059b-c74b-40b8-896a-47aa77ed4601',
          contentHash: 'e7600f3da27237e68019ee627b32f0e059824b52f2d38f2bbe01ad9388ad1cf0',
          hidden: false
        }]
      },
      artifacts: {
        mysql: { objectKey: auditMysqlKey },
        qdrant: { objectKey: auditQdrantKey },
        documents: [{
          documentId: '1', objectKey: auditKey, originalFilename: 'tai-lieu.txt',
          mimeType: 'text/plain', sha256: sha256Buffer(auditBytes), sizeBytes: auditBytes.length
        }]
      }
    },
    key: auditManifestKey,
    config: { objectPrefix: 'test' },
    objectStore: {
      list: async (prefix) => prefix === auditReleasePrefix
        ? [auditManifestKey, auditMysqlKey, auditQdrantKey, auditKey]
          .map((objectKey) => ({ objectKey }))
        : [auditManifestKey, auditMysqlKey, auditQdrantKey, auditKey]
          .map((objectKey) => ({ objectKey }))
    },
    files: new Map([[auditKey, auditFile]])
  }, {
    environment: {
      CORPUS_APPROVED_BUNDLE_CONFIRMED: 'true',
      CORPUS_APPROVED_RELEASE_ID: auditReleaseId
    }
  });
  assert.equal(auditResult.status, 'CORPUS_PREPUBLISH_AUDIT_CONDITIONAL');
  assert.equal(auditResult.mutation, false);
  assert.equal(auditResult.inventory.mechanicalValidationCoverage, '1/1');
  assert.equal(auditResult.inventory.textExtractionCoverage, '1/1');
  assert.equal(auditResult.inventory.bucket.unexpectedObjects, 0);
  assert.equal(auditResult.inventory.bucket.releaseVersions, 1);
  assert.deepEqual(auditResult.distribution, {
    access: 'PRIVATE',
    containsAccountData: true,
    publicDistribution: 'FORBIDDEN'
  });
  assert(!auditResult.findings.some((finding) => finding.severity === 'BLOCKER'));
  const blockedAudit = await auditDownloadedRelease({
    manifest: auditResult.releaseId === auditReleaseId
      ? {
        releaseId: auditReleaseId,
        objectPrefix: auditReleasePrefix,
        expectedCounts: { qdrantPoints: 1 },
        sanitization: { secretAndPathScan: 'passed' },
        inventory: {
          activeDocuments: ['1'],
          chunks: [{
            documentId: '1',
            vectorNodeId: '9589059b-c74b-40b8-896a-47aa77ed4601',
            contentHash: 'e7600f3da27237e68019ee627b32f0e059824b52f2d38f2bbe01ad9388ad1cf0',
            hidden: false
          }]
        },
        artifacts: {
          mysql: { objectKey: auditMysqlKey },
          qdrant: { objectKey: auditQdrantKey },
          documents: [{
            documentId: '1', objectKey: auditKey, originalFilename: 'tai-lieu.txt',
            mimeType: 'text/plain', sha256: sha256Buffer(auditBytes), sizeBytes: auditBytes.length
          }]
        }
      }
      : null,
    key: auditManifestKey,
    config: { objectPrefix: 'test' },
    objectStore: {
      list: async (prefix) => {
        const keys = [auditManifestKey, auditMysqlKey, auditQdrantKey, auditKey];
        if (prefix === auditReleasePrefix) keys.push(`${auditReleasePrefix}/.env`);
        return keys.map((objectKey) => ({ objectKey }));
      }
    },
    files: new Map([[auditKey, auditFile]])
  }, {
    environment: {
      CORPUS_APPROVED_BUNDLE_CONFIRMED: 'true',
      CORPUS_APPROVED_RELEASE_ID: auditReleaseId
    }
  });
  assert.equal(blockedAudit.status, 'CORPUS_PREPUBLISH_AUDIT_BLOCKED');
  assert(blockedAudit.findings.some((finding) =>
    finding.code === 'BUCKET_SELECTED_RELEASE_HAS_UNEXPECTED_OBJECT'));

  const sqlTuples = [
    "INSERT INTO `chat_messages` VALUES (1,'INSERT INTO citations VALUES (999);');",
    "INSERT INTO `citations` VALUES (1,'plain',NULL,1,'2026-07-22 10:11:12.123');",
    "INSERT INTO `citations` VALUES (1,'comma,inside',1),(2,'parentheses (inside)',0);",
    "INSERT INTO `citations` VALUES (1,'apostrophe\\'s and slash \\\\ path',NULL);",
    "INSERT INTO `citations` VALUES (1,'doubled '' quote',-2.5);",
    "INSERT INTO `citations` VALUES (1,'semicolon; inside',1),(2,'Tiếng Việt\\ntrên nhiều dòng',0);",
    "INSERT INTO `citations` VALUES\n(1,'actual\nmultiline',NULL);"
  ].join('\n');
  assert.equal(countTableRows(sqlTuples, 'citations'), 8);
  assert.equal(countTableRows(sqlTuples, 'document_processing_jobs'), 0);
  for (const malformed of [
    "INSERT INTO `citations` VALUES (1,'unterminated);",
    "INSERT INTO `citations` VALUES (1,'closed') trailing;",
    "INSERT INTO `citations` VALUES (1,'closed';",
    "INSERT INTO `citations` VALUES ;"
  ]) {
    assert.throws(
      () => countTableRows(malformed, 'citations'),
      (error) => error.code === 'CORPUS_MYSQL_DUMP_INVALID'
    );
  }
  const unsafeBundle = await unsafeAuthTokenBundle();
  try {
    await assert.rejects(
      () => corpusRuntime.verifyBundle(unsafeBundle, { quiet: true }),
      (error) => error.code === 'CORPUS_MYSQL_DUMP_UNSAFE'
    );
  } finally {
    await fsp.rm(unsafeBundle, { recursive: true, force: true });
  }

  assert.throws(
    () => loadCloudConfig({ environment: {}, rootDirectory: os.tmpdir() }),
    (error) => error.code === 'GCS_CONFIG_MISSING'
  );
  assert.equal(validateOptionalCloudConfiguration({ environment: {} }).state, 'NOT_CONFIGURED');
  assert.throws(
    () => validateOptionalCloudConfiguration({ environment: { GCS_BUCKET: 'partial-only' } }),
    (error) => error.code === 'GCS_CONFIG_INVALID'
  );
  const credentialRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-release-credential-test-'));
  temporaryDirectories.add(credentialRoot);
  await fsp.mkdir(path.join(credentialRoot, 'secrets'));
  const malformedCredential = path.join(credentialRoot, 'secrets', 'gcs.json');
  await fsp.writeFile(malformedCredential, '{invalid-json', 'utf8');
  assert.equal(credentialState(path.join(credentialRoot, 'secrets', 'missing.json')), 'MISSING');
  assert.equal(credentialState(malformedCredential), 'INVALID');
  assert.throws(
    () => loadCloudConfig({
      rootDirectory: credentialRoot,
      environment: {
        GCS_PROJECT_ID: 'test-project', GCS_BUCKET: 'edurag-test-bucket',
        GCS_OBJECT_PREFIX: 'portable-corpus/v1', GCS_CREDENTIALS_FILE: '../escape.json'
      }
    }),
    (error) => error.code === 'GCS_CONFIG_INVALID'
  );
  const fixture = manifestInput();
  const identityInput = {
    documents: new Map([['1', {
      documentId: '1', sha256: '1'.repeat(64), sizeBytes: 10,
      localStorageKey: 'documents/one.pdf'
    }]]),
    inventory: { activeDocuments: ['1'], chunks: [] },
    expectedCounts: { documents: 1, processingJobs: 1, chunks: 0, citations: 0, qdrantPoints: 0 },
    compatibility: { databaseSchemaVersion: '1.0.0' },
    mysqlContentSha256: '2'.repeat(64),
    qdrantContentSha256: '3'.repeat(64)
  };
  const identity = sourceFingerprint(identityInput);
  assert.equal(sourceFingerprint(identityInput), identity, 'Complete content identity must be deterministic.');
  assert.equal(sourceFingerprint({
    ...identityInput,
    exportedAtUtc: '2099-01-01T00:00:00.000Z',
    temporaryDirectory: 'C:\\runtime-specific\\export',
    databaseConnectionId: 999,
    qdrantSnapshotName: 'runtime-specific.snapshot',
    schemaAutoIncrement: 123456
  }), identity, 'Logical identity must ignore runtime/export metadata that is not corpus content.');
  assert.notEqual(sourceFingerprint({ ...identityInput, mysqlContentSha256: '4'.repeat(64) }), identity);
  assert.notEqual(
    sourceFingerprint({
      ...identityInput,
      mysqlContentSha256: sha256Buffer(Buffer.from(singleAccountDump))
    }),
    sourceFingerprint({
      ...identityInput,
      mysqlContentSha256: sha256Buffer(Buffer.from(multipleAccountDump))
    }),
    'Account-row changes in the scoped MySQL dump must produce a new logical release identity.'
  );
  assert.notEqual(sourceFingerprint({ ...identityInput, qdrantContentSha256: '5'.repeat(64) }), identity);
  const changedDocuments = new Map(identityInput.documents);
  changedDocuments.set('1', { ...changedDocuments.get('1'), sha256: '6'.repeat(64) });
  assert.notEqual(sourceFingerprint({ ...identityInput, documents: changedDocuments }), identity);
  const qdrantHash = corpusRuntime.qdrantContentSha256([{
    id: '9589059b-c74b-40b8-896a-47aa77ed4601', vector: [0.1, 0.2], payload: { doc_id: '1' }
  }]);
  assert.notEqual(qdrantHash, corpusRuntime.qdrantContentSha256([{
    id: '9589059b-c74b-40b8-896a-47aa77ed4601', vector: [0.1, 0.3], payload: { doc_id: '1' }
  }]));
  const valid = buildReleaseManifest(fixture.input);
  validateReleaseManifest(valid, config);
  const alternateSnapshot = Buffer.from('qdrant-wire-variant');
  const transportVariant = buildReleaseManifest({
    ...fixture.input,
    qdrant: { sha256: sha256Buffer(alternateSnapshot), sizeBytes: alternateSnapshot.length }
  });
  assert.equal(
    transportVariant.releaseId,
    valid.releaseId,
    'Release identity must not depend on Qdrant snapshot transport bytes.'
  );
  assert.notEqual(transportVariant.artifacts.qdrant.sha256, valid.artifacts.qdrant.sha256);
  assert.equal(buildReleaseManifest(fixture.input).releaseId, valid.releaseId);
  assert.equal(
    buildReleaseManifest({ ...fixture.input, createdAtUtc: '2099-01-01T00:00:00.000Z' }).releaseId,
    valid.releaseId,
    'Release identity must not depend on manifest creation time.'
  );
  const mysqlChanged = buildReleaseManifest({ ...fixture.input, sourceFingerprint: 'b'.repeat(64) });
  assert.notEqual(mysqlChanged.releaseId, valid.releaseId, 'Scoped content changes must change release identity.');
  assert.equal(valid.artifacts.documents[0].file, undefined, 'Local staging path leaked into release manifest.');
  assert.equal(
    valid.artifacts.documents[0].serviceAccountJson,
    undefined,
    'Unexpected source fields leaked into release manifest.'
  );

  const readyDocument = {
    documentId: '1', title: 'Demo', originalFilename: 'demo.pdf', storageType: 'LOCAL',
    localStorageKey: 'documents/2026/07/example.pdf', processingStatus: 'READY',
    visibilityStatus: 'VISIBLE', deletedAt: null, sha256: 'b'.repeat(64), sizeBytes: 10
  };
  assert.equal(assertPublishableDocuments(new Map([['1', readyDocument]])).length, 1);
  assert.throws(
    () => assertPublishableDocuments(new Map([['1', { ...readyDocument, processingStatus: 'PROCESSING' }]])),
    (error) => error.code === 'CORPUS_DOCUMENT_NOT_READY'
  );
  assert.throws(
    () => assertPublishableDocuments(new Map([['1', {
      ...readyDocument, visibilityStatus: 'DELETED', deletedAt: '2026-07-22 00:00:00'
    }]])),
    (error) => error.code === 'CORPUS_DOCUMENT_NOT_PUBLISHABLE'
  );
  assert.equal(
    assertPublishableDocuments(new Map([['1', { ...readyDocument, visibilityStatus: 'HIDDEN' }]])).length,
    1,
    'Hidden READY documents remain publishable with hidden retrieval state.'
  );
  const currentDocumentDump = parseDocumentsFromDump(
    `INSERT INTO \`documents\` VALUES `
    + `(1,2,'Demo','Description','Author','demo.pdf','LOCAL','documents/2026/07/example.pdf',`
    + `'PDF','application/pdf',10,'${'b'.repeat(64)}',2,'READY',NULL,'application/pdf',`
    + `'READY','VISIBLE','2026-07-28 00:00:00.000',NULL,`
    + `'2026-07-28 00:00:00.000','2026-07-28 00:00:00.000');`
  ).get('1');
  assert.equal(currentDocumentDump.localStorageKey, readyDocument.localStorageKey);
  assert.equal(currentDocumentDump.originalFilename, readyDocument.originalFilename);
  assert.equal(currentDocumentDump.processingStatus, 'READY');

  const originalTestDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-original-stage-test-'));
  const originalBytes = Buffer.from('verified original');
  const originalDocument = {
    ...readyDocument,
    sha256: sha256Buffer(originalBytes),
    sizeBytes: originalBytes.length
  };
  const goodOriginal = path.join(originalTestDirectory, 'good');
  await stageOriginalFile({
    copyOut: async (_storageKey, target) => fsp.writeFile(target, originalBytes)
  }, originalDocument, goodOriginal);
  await assert.rejects(
    () => stageOriginalFile({
      copyOut: async (_storageKey, target) => fsp.writeFile(target, Buffer.from('changed'))
    }, originalDocument, path.join(originalTestDirectory, 'bad')),
    (error) => error.code === 'CORPUS_ORIGINAL_SOURCE_MISMATCH'
  );
  await assert.rejects(
    () => stageOriginalFile({
      copyOut: async () => { throw releaseError('CORPUS_ORIGINAL_SOURCE_MISSING', 'missing'); }
    }, originalDocument, path.join(originalTestDirectory, 'missing')),
    (error) => error.code === 'CORPUS_ORIGINAL_SOURCE_MISSING'
  );
  await fsp.rm(originalTestDirectory, { recursive: true, force: true });

  const publishInspection = await inspectPublishSource({
    databaseStats: () => ({ activeJobs: 0 }),
    documentInventory: () => [readyDocument],
    volumeStore: {
      stat: async () => ({ exists: true, sha256: readyDocument.sha256, sizeBytes: readyDocument.sizeBytes })
    }
  });
  assert.equal(publishInspection.status, 'CORPUS_PUBLISH_LOCAL_READY');
  assert.equal(publishInspection.documents[0].original, 'VERIFIED');
  await assert.rejects(
    () => inspectPublishSource({
      databaseStats: () => ({ activeJobs: 0 }),
      documentInventory: () => [readyDocument],
      volumeStore: { stat: async () => ({ exists: false }) }
    }),
    (error) => error.code === 'CORPUS_PUBLISH_PLAN_BLOCKED'
      && error.plan.blockers.includes('CORPUS_ORIGINAL_SOURCE_MISSING:1')
  );
  await assert.rejects(
    () => inspectPublishSource({
      databaseStats: () => ({ activeJobs: 1 }),
      documentInventory: () => [{ ...readyDocument, processingStatus: 'PROCESSING' }],
      volumeStore: { stat: async () => { throw new Error('must not inspect ineligible original'); } }
    }),
    (error) => error.code === 'CORPUS_PUBLISH_PLAN_BLOCKED'
      && error.plan.blockers.includes('CORPUS_ACTIVE_JOBS')
      && error.plan.blockers.includes('CORPUS_DOCUMENT_NOT_READY:1')
  );
  const planLogs = [];
  const originalLog = console.log;
  console.log = (message) => planLogs.push(String(message));
  try {
    await assert.rejects(
      () => inspectPublishSource({
        databaseStats: () => ({ activeJobs: 0 }),
        documentInventory: () => [{ ...readyDocument, title: 'GOOGLE_API_KEY=private-marker' }],
        volumeStore: { stat: async () => ({ exists: false }) }
      }),
      (error) => error.code === 'CORPUS_PUBLISH_PLAN_BLOCKED'
        && error.plan.documents[0].title === '[REDACTED]'
    );
  } finally {
    console.log = originalLog;
  }
  assert(!planLogs.join('\n').includes('private-marker'), 'Blocked publish plan leaked a credential-like title.');

  assert.deepEqual(parseCommandLine(['publish', '--dry-run']), {
    command: 'publish', dryRun: true, confirmReviewed: false
  });
  assert.deepEqual(parseCommandLine(['publish', '--confirm-reviewed']), {
    command: 'publish', dryRun: false, confirmReviewed: true
  });
  assert.throws(
    () => approvedCorpusConfig({}, { releaseId: 'v1-aabbccddeeff001122334455' }),
    /BLOCKED BY DATA APPROVAL/
  );
  assert.deepEqual(
    approvedCorpusConfig({
      CORPUS_APPROVED_BUNDLE_CONFIRMED: 'true',
      CORPUS_APPROVED_RELEASE_ID: 'v1-aabbccddeeff001122334455',
      CORPUS_APPROVED_DOCUMENT_ID: '9',
      CORPUS_APPROVED_QUERY: 'Reviewed corpus question'
    }, { releaseId: 'v1-aabbccddeeff001122334455' }),
    {
      releaseId: 'v1-aabbccddeeff001122334455',
      documentId: 9,
      query: 'Reviewed corpus question'
    }
  );
  for (const invalid of [
    ['publish'],
    ['publish', '--confirm-review'],
    ['publish', '--dry-run', '--dry-run'],
    ['publish', '--dry-run', '--confirm-reviewed'],
    ['verify', '--dry-run']
  ]) {
    assert.throws(
      () => {
        const parsed = parseCommandLine(invalid);
        if (parsed.command === 'publish') {
          // parseCommandLine deliberately leaves the missing/combined intent
          // decision to publishCorpus.
          if (parsed.dryRun && parsed.confirmReviewed) {
            throw releaseError('CORPUS_PUBLISH_OPTIONS_INVALID', 'combined');
          }
          if (!parsed.dryRun && !parsed.confirmReviewed) {
            throw releaseError('CORPUS_REVIEW_CONFIRMATION_REQUIRED', 'missing');
          }
        }
      },
      (error) => ['CORPUS_OPTION_INVALID', 'CORPUS_PUBLISH_OPTIONS_INVALID',
        'CORPUS_REVIEW_CONFIRMATION_REQUIRED'].includes(error.code)
    );
  }

  const invalidRelease = structuredClone(valid);
  invalidRelease.releaseId = '../bad';
  assert.throws(() => validateReleaseManifest(invalidRelease, config), /header is invalid/);
  const traversal = structuredClone(valid);
  traversal.artifacts.documents[0].localStorageKey = '../escape.pdf';
  assert.throws(() => validateReleaseManifest(traversal, config), /storage key is invalid/);
  const duplicate = structuredClone(valid);
  duplicate.artifacts.documents.push({ ...duplicate.artifacts.documents[0] });
  duplicate.expectedCounts.documents = 2;
  assert.throws(() => validateReleaseManifest(duplicate, config), /invalid or duplicated/);
  const badSize = structuredClone(valid);
  badSize.artifacts.mysql.sizeBytes = 0;
  assert.throws(() => validateReleaseManifest(badSize, config), /checksum or size is invalid/);

  let stageCalls = 0;
  await assert.rejects(
    () => publishCorpus({
      config,
      stageSource: async () => { stageCalls += 1; return stagedRelease(); },
      pointer: null
    }),
    (error) => error.code === 'CORPUS_REVIEW_CONFIRMATION_REQUIRED'
  );
  assert.equal(stageCalls, 0, 'Missing confirmation must fail before staging.');
  await assert.rejects(
    () => publishCorpus({
      config, dryRun: true, confirmReviewed: true,
      stageSource: async () => { stageCalls += 1; return stagedRelease(); },
      pointer: null
    }),
    (error) => error.code === 'CORPUS_PUBLISH_OPTIONS_INVALID'
  );
  assert.equal(stageCalls, 0, 'Invalid option combination must fail before staging.');

  let dryRunPointerWrites = 0;
  const dryRunStore = new FakeObjectStore();
  const dryRun = await publishCorpus({
    config, dryRun: true, objectStore: dryRunStore,
    getCredentialState: () => 'MISSING',
    planSource: async () => ({ ...(await stagedRelease()), provisional: true }),
    stageSource: async () => { throw new Error('dry-run must not start frozen export'); }, pointer: null,
    writePointer: async () => { dryRunPointerWrites += 1; }
  });
  assert.equal(dryRun.status, 'CORPUS_PUBLISH_READY');
  assert.equal(dryRun.mutation, false);
  assert.equal(dryRun.identity, 'PROVISIONAL_UNTIL_FROZEN_EXPORT');
  assert.equal(dryRun.documents[0].processingStatus, 'READY');
  assert.equal(dryRun.documents[0].visibilityStatus, 'VISIBLE');
  assert.equal(dryRun.containsAccountData, true);
  assert.equal(dryRun.publicDistribution, 'FORBIDDEN');
  assert.equal(dryRunStore.objects.size, 0, 'Dry-run must not upload cloud objects.');
  assert.equal(dryRunStore.privacyChecks, 1, 'Dry-run must verify that the target is private without mutation.');
  assert.equal(dryRunPointerWrites, 0, 'Dry-run must not update the release pointer.');

  const inspectLogs = [];
  const previousLog = console.log;
  console.log = (message) => inspectLogs.push(String(message));
  let inspected;
  try {
    inspected = await inspectCorpus({
      readPointer: async () => ({
        pointerSchemaVersion: POINTER_SCHEMA_VERSION,
        releaseId: valid.releaseId,
        manifestSha256: 'f'.repeat(64),
        publishedAtUtc: '2026-07-21T00:00:00.000Z'
      }),
      servicesRunning: () => new Set(),
      inspectLocalState: async () => { throw new Error('local services are not running'); }
    });
  } finally {
    console.log = previousLog;
  }
  assert.equal(inspected.mode, 'LOCAL_ONLY');
  assert.equal(inspected.mutation, false);
  assert.equal(inspected.credential, 'NOT_READ');
  assert.equal(inspected.remote, 'NOT_CHECKED_LOCAL_ONLY');
  assert.equal(inspected.local, 'NOT_RUNNING');
  assert(inspectLogs.some((line) => line.includes('"mode":"LOCAL_ONLY"')));

  const objectStore = new FakeObjectStore();
  let pointer;
  const first = await publishCorpus({
    config, objectStore, confirmReviewed: true,
    stageSource: stagedRelease,
    pointer: null,
    writePointer: async (value) => { pointer = value; }
  });
  assert.equal(first.uploaded, 4);
  assert.deepEqual(objectStore.uploadOrder, ['mysql', 'qdrant', 'document', 'manifest']);
  assert.equal(objectStore.privacyChecks, 1);
  assert.equal(pointer.pointerSchemaVersion, POINTER_SCHEMA_VERSION);

  const second = await publishCorpus({
    config, objectStore, confirmReviewed: true,
    stageSource: stagedRelease,
    pointer,
    writePointer: async () => { throw new Error('idempotent publish must not rewrite pointer'); }
  });
  assert.equal(second.uploaded, 0);
  assert.equal(second.skipped, 4);

  const incomplete = new FakeObjectStore();
  await assert.rejects(
    () => downloadAndVerifyRelease({ config, objectStore: incomplete, pointer }),
    (error) => error.code === 'GCS_OBJECT_MISSING'
  );

  const mismatchStore = new FakeObjectStore();
  const mismatchStage = await stagedRelease();
  const firstArtifact = mismatchStage.manifest.artifacts.mysql;
  mismatchStore.objects.set(firstArtifact.objectKey, {
    bytes: Buffer.from('different'),
    metadata: {
      sha256: firstArtifact.sha256, kind: firstArtifact.kind,
      releaseId: mismatchStage.manifest.releaseId
    }
  });
  await assert.rejects(
    () => publishCorpus({
      config, objectStore: mismatchStore, confirmReviewed: true,
      stageSource: async () => mismatchStage, pointer: null, writePointer: async () => {}
    }),
    (error) => error.code === 'CORPUS_RELEASE_REMOTE_MISMATCH'
  );

  const prePointerStore = new FakeObjectStore();
  let prePointerWrites = 0;
  await assert.rejects(
    () => publishCorpus({
      config, objectStore: prePointerStore, confirmReviewed: true,
      stageSource: stagedRelease, pointer: null,
      downloadRelease: async () => {
        throw releaseError('CORPUS_RELEASE_CHECKSUM_MISMATCH', 'post-upload verification failed');
      },
      writePointer: async () => { prePointerWrites += 1; }
    }),
    (error) => error.code === 'CORPUS_RELEASE_CHECKSUM_MISMATCH'
  );
  assert.equal(prePointerWrites, 0, 'Pointer changed before complete release verification.');

  let writerFreezes = 0;
  let writerResumes = 0;
  await assert.rejects(
    () => publishCorpus({
      config, objectStore: new FakeObjectStore(), confirmReviewed: true,
      stageSource: stagedRelease, pointer: null, manageWriterLifecycle: true,
      freezeWriters: () => { writerFreezes += 1; return ['app', 'rag-service']; },
      resumeWriters: (services) => {
        assert.deepEqual(services, ['app', 'rag-service']);
        writerResumes += 1;
      },
      downloadRelease: async () => {
        throw releaseError('CORPUS_RELEASE_CHECKSUM_MISMATCH', 'forced post-upload failure');
      },
      writePointer: async () => { throw new Error('pointer must not change'); }
    }),
    (error) => error.code === 'CORPUS_RELEASE_CHECKSUM_MISMATCH'
  );
  assert.equal(writerFreezes, 1);
  assert.equal(writerResumes, 1, 'Publish failure must resume every paused writer.');

  const deniedStore = new FakeObjectStore();
  deniedStore.uploadCreateOnly = async () => {
    throw releaseError('GCS_WRITE_PERMISSION_REQUIRED', 'writer permission required');
  };
  await assert.rejects(
    () => publishCorpus({
      config, objectStore: deniedStore, confirmReviewed: true,
      stageSource: stagedRelease, pointer: null, writePointer: async () => {}
    }),
    (error) => error.code === 'GCS_WRITE_PERMISSION_REQUIRED'
  );

  const publicStore = new FakeObjectStore();
  publicStore.assertPrivateTarget = async () => {
    throw releaseError('GCS_PUBLIC_BUCKET_BLOCKED', 'public bucket');
  };
  await assert.rejects(
    () => publishCorpus({
      config, objectStore: publicStore, confirmReviewed: true,
      stageSource: stagedRelease, pointer: null, writePointer: async () => {}
    }),
    (error) => error.code === 'GCS_PUBLIC_BUCKET_BLOCKED'
  );
  assert.equal(publicStore.objects.size, 0, 'Public target must be rejected before upload.');

  let mutationStarted = false;
  await assert.rejects(
    () => restoreCorpus({
      downloadRelease: async () => { throw releaseError('CORPUS_RELEASE_CHECKSUM_MISMATCH', 'bad'); },
      ensureDataServices: async () => { mutationStarted = true; }
    }),
    (error) => error.code === 'CORPUS_RELEASE_CHECKSUM_MISMATCH'
  );
  assert.equal(mutationStarted, false, 'all remote verification must finish before local mutation');

  const restoreTemporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-release-test-restore-'));
  let structuredCalls = 0;
  let originalCalls = 0;
  let inspectCalls = 0;
  const restored = await restoreCorpus({
    downloadRelease: async () => ({
      manifest: valid, pointer, files: new Map(), temporary: restoreTemporary, ownsTemporary: true
    }),
    ensureDataServices: async () => {},
    inspectUploads: async () => ({ empty: true, fileCount: 0, releaseState: null }),
    inspectLocal: async () => (inspectCalls++ === 0
      ? { state: 'EMPTY' }
      : { state: 'COMPATIBLE', reconciled: reconciledFixture() }),
    inspectOriginals: async () => ({
      state: inspectCalls < 2 ? 'EMPTY' : 'COMPATIBLE', present: inspectCalls < 2 ? 0 : 1
    }),
    restoreStructured: async () => { structuredCalls += 1; },
    restoreOriginals: async () => {
      originalCalls += 1;
      return { restored: 1, skipped: 0, targetVolume: 'test_uploads', rollbackOriginals: async () => {} };
    },
    writeReleaseState: async () => {}
  });
  assert.equal(restored.status, 'CORPUS_RESTORE_OK');
  assert.equal(structuredCalls, 1);
  assert.equal(originalCalls, 1);
  await assert.rejects(() => fsp.access(restoreTemporary), (error) => error.code === 'ENOENT');

  const compatibleTemporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-release-test-compatible-'));
  structuredCalls = 0;
  const compatible = await restoreCorpus({
    downloadRelease: async () => ({
      manifest: valid, pointer, files: new Map(), temporary: compatibleTemporary, ownsTemporary: true
    }),
    ensureDataServices: async () => {},
    inspectUploads: async () => ({ empty: false, fileCount: 1, releaseState: null }),
    inspectLocal: async () => ({ state: 'COMPATIBLE', reconciled: reconciledFixture() }),
    inspectOriginals: async () => ({ state: 'COMPATIBLE', present: 1 }),
    restoreStructured: async () => { structuredCalls += 1; },
    writeReleaseState: async () => {}
  });
  assert.equal(compatible.status, 'CORPUS_ALREADY_RESTORED');
  assert.equal(structuredCalls, 0);
  await assert.rejects(() => fsp.access(compatibleTemporary), (error) => error.code === 'ENOENT');

  const rollbackTemporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-release-test-rollback-'));
  let structuredRollbacks = 0;
  let rollbackInspectCalls = 0;
  let writerResumesAfterRestore = 0;
  await assert.rejects(
    () => restoreCorpus({
      downloadRelease: async () => ({
        manifest: valid, pointer, files: new Map(), temporary: rollbackTemporary, ownsTemporary: true
      }),
      ensureDataServices: async () => {},
      inspectUploads: async () => ({ empty: true, fileCount: 0, releaseState: null }),
      inspectLocal: async () => {
        if (structuredRollbacks === 0) {
          if (rollbackInspectCalls++ === 0) return { state: 'EMPTY' };
          throw releaseError('CORPUS_RESTORE_VERIFY_FAILED', 'forced');
        }
        return { state: 'EMPTY' };
      },
      inspectOriginals: async () => ({ state: 'EMPTY', present: 0 }),
      restoreStructured: async () => ({
        rollbackRestore: async () => { structuredRollbacks += 1; }
      }),
      restoreOriginals: async () => ({
        restored: 1, skipped: 0, targetVolume: 'test_uploads', rollbackOriginals: async () => {}
      }),
      writeReleaseState: async () => {},
      manageWriterLifecycle: true,
      freezeWriters: () => ['app'],
      resumeWriters: () => { writerResumesAfterRestore += 1; }
    }),
    (error) => error.code === 'CORPUS_RESTORE_VERIFY_FAILED'
  );
  assert.equal(structuredRollbacks, 1, 'Post-apply verification failure must roll structured stores back.');
  assert.equal(writerResumesAfterRestore, 1, 'Restore failure must resume paused writers.');

  const firstOriginal = valid.artifacts.documents[0];
  const originalDocuments = [
    firstOriginal,
    {
      ...firstOriginal,
      documentId: '2',
      objectKey: `${firstOriginal.objectKey}-second`,
      localStorageKey: 'documents/2/second.pdf'
    }
  ];
  const originalFiles = new Map(originalDocuments.map((document) => [document.objectKey, Buffer.from('x')]));
  let originalPutCalls = 0;
  const removedOriginals = [];
  await assert.rejects(
    () => restoreOriginals({
      manifest: { artifacts: { documents: originalDocuments } }, files: originalFiles
    }, {
      volumeStore: {
        async putAtomic(_file, _key, document) {
          originalPutCalls += 1;
          if (originalPutCalls === 2) throw releaseError('CORPUS_ORIGINAL_LOCAL_WRITE_FAILED', 'forced');
          return { restored: true, skipped: false, volumeName: 'test_uploads', document };
        },
        async removeExact(key) { removedOriginals.push(key); }
      }
    }),
    (error) => error.code === 'CORPUS_ORIGINAL_LOCAL_WRITE_FAILED'
  );
  assert.deepEqual(removedOriginals, [originalDocuments[0].localStorageKey]);

  const incompatibleTemporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-release-test-incompatible-'));
  await assert.rejects(
    () => restoreCorpus({
      downloadRelease: async () => ({
        manifest: valid, files: new Map(), temporary: incompatibleTemporary, ownsTemporary: true
      }),
      ensureDataServices: async () => {},
      inspectUploads: async () => ({ empty: false, fileCount: 1, releaseState: null }),
      inspectLocal: async () => { throw releaseError('CORPUS_EXISTING_STATE_MISMATCH', 'different'); }
    }),
    (error) => error.code === 'CORPUS_EXISTING_STATE_MISMATCH'
  );
  await assert.rejects(() => fsp.access(incompatibleTemporary), (error) => error.code === 'ENOENT');

  let restoreCalls = 0;
  const off = await bootstrapCorpus({ mode: 'off', restore: async () => { restoreCalls += 1; } });
  assert.equal(off.reason, 'OFF');
  assert.equal(restoreCalls, 0);

  const emptyStats = {
    mysqlVersion: '8.4.0',
    users: 1, nonDemoUsers: 0, authTokens: 0, documents: 0, readyDocuments: 0,
    inProgressDocuments: 0, jobs: 0, activeJobs: 0, chunks: 0, activeChunks: 0,
    sessions: 0, messages: 0, citations: 0, usageRows: 0
  };
  const emptyQdrant = { serverVersion: '1.18.2', exists: false, pointCount: 0 };
  assert.equal(
    classifyBootstrapState(emptyStats, emptyQdrant, { empty: true, fileCount: 0 }).state,
    'EMPTY'
  );
  assert.equal(classifyBootstrapState(null, emptyQdrant, { empty: true }).state, 'UNKNOWN');

  const socketClosingQdrant = http.createServer();
  socketClosingQdrant.on('connection', (socket) => socket.destroy());
  const socketClosingQdrantUrl = await listenLoopback(socketClosingQdrant);
  try {
    await assert.rejects(
      () => corpusRuntime.qdrantRequest('/collections/test?api_key=must-not-appear', {
        baseUrl: socketClosingQdrantUrl,
        method: 'POST',
        qdrantPhase: 'TEST_UNAVAILABLE',
        timeoutMs: 500
      }),
      (error) => error.code === 'CORPUS_QDRANT_REQUEST_FAILED'
        && error.method === 'POST'
        && error.target === '/collections/test'
        && error.qdrantPhase === 'TEST_UNAVAILABLE'
        && ['UND_ERR_SOCKET', 'ECONNRESET'].includes(error.causeCode)
        && error.cause
        && !error.message.includes('must-not-appear')
    );
  } finally {
    await closeServer(socketClosingQdrant);
  }

  const deniedQdrant = http.createServer((_request, response) => {
    response.writeHead(401, { 'content-type': 'text/plain' });
    response.end('permission denied\nignored detail');
  });
  const deniedQdrantUrl = await listenLoopback(deniedQdrant);
  try {
    await assert.rejects(
      () => corpusRuntime.qdrantRequest('/collections/test', {
        baseUrl: deniedQdrantUrl,
        httpErrorCode: 'CORPUS_QDRANT_INSPECT_FAILED',
        qdrantPhase: 'TEST_HTTP_ERROR'
      }),
      (error) => error.code === 'CORPUS_QDRANT_INSPECT_FAILED'
        && error.method === 'GET'
        && error.target === '/collections/test'
        && error.qdrantPhase === 'TEST_HTTP_ERROR'
        && error.status === 401
        && error.responseBody === 'permission denied'
    );
  } finally {
    await closeServer(deniedQdrant);
  }
  const qdrantOnly = classifyBootstrapState(
    emptyStats, { exists: true, pointCount: 1 }, { empty: true, fileCount: 0 }
  );
  assert.equal(qdrantOnly.state, 'PRESENT');
  assert.equal(qdrantOnly.partial, true);
  const uploadsOnly = classifyBootstrapState(emptyStats, emptyQdrant, { empty: false, fileCount: 1 });
  assert.equal(uploadsOnly.state, 'PRESENT');
  assert.equal(uploadsOnly.partial, true);
  const completedWithoutQdrant = {
    ...emptyStats, documents: 1, readyDocuments: 1, jobs: 1, chunks: 2, activeChunks: 2
  };
  assert.equal(
    classifyBootstrapState(completedWithoutQdrant, emptyQdrant, { empty: false, fileCount: 1 }).state,
    'PRESENT'
  );
  const inProgressStats = {
    ...emptyStats, documents: 1, inProgressDocuments: 1, jobs: 1, activeJobs: 1
  };
  assert.equal(
    classifyBootstrapState(inProgressStats, emptyQdrant, { empty: false, fileCount: 1 }).state,
    'PRESENT'
  );
  const localStats = {
    ...emptyStats, documents: 2, readyDocuments: 2, jobs: 2, chunks: 3, activeChunks: 3
  };
  assert.equal(
    classifyBootstrapState(localStats, { exists: true, pointCount: 3 }, { empty: false, fileCount: 2 }).state,
    'PRESENT'
  );

  const cloudEnvironment = {
    GCS_PROJECT_ID: 'test-project', GCS_BUCKET: 'test-bucket',
    GCS_OBJECT_PREFIX: 'portable-corpus/v1', GCS_CREDENTIALS_FILE: 'secrets/not-read.json'
  };

  const freshBootstrapOrder = [];
  const firstInvocation = await bootstrapCorpus({
    mode: 'auto',
    environment: cloudEnvironment,
    rootDirectory: credentialRoot,
    ensureDataServices: async () => { freshBootstrapOrder.push('ensure-data-services'); },
    databaseStats: async () => {
      freshBootstrapOrder.push('inspect-mysql');
      assert.equal(freshBootstrapOrder[0], 'ensure-data-services');
      return emptyStats;
    },
    qdrantInfo: async () => {
      freshBootstrapOrder.push('inspect-qdrant');
      return emptyQdrant;
    },
    inspectUploads: async () => {
      freshBootstrapOrder.push('inspect-uploads');
      return { empty: true, fileCount: 0, releaseState: null };
    },
    restore: async () => {
      freshBootstrapOrder.push('restore');
      return { status: 'CORPUS_RESTORE_OK' };
    }
  });
  assert.equal(firstInvocation.status, 'CORPUS_RESTORE_OK');
  assert.deepEqual(freshBootstrapOrder, [
    'ensure-data-services', 'inspect-mysql', 'inspect-qdrant', 'inspect-uploads', 'restore'
  ]);

  const autoRestored = await bootstrapCorpus({
    mode: 'auto',
    environment: cloudEnvironment,
    rootDirectory: credentialRoot,
    inspectBootstrap: async () => ({ state: 'EMPTY', activeJobs: 0 }),
    restore: async () => { restoreCalls += 1; return { status: 'CORPUS_RESTORE_OK' }; }
  });
  assert.equal(autoRestored.status, 'CORPUS_RESTORE_OK');
  assert.equal(restoreCalls, 1);

  const selectedState = localReleaseState(valid, pointer);
  const localRetained = await bootstrapCorpus({
    mode: 'auto',
    pointer,
    inspectBootstrap: async () => ({
      state: 'PRESENT', activeJobs: 0, partial: false, stores: {}, releaseState: selectedState
    }),
    verifyMarkedLocalRelease: async () => ({
      structured: { state: 'COMPATIBLE', reconciled: reconciledFixture() },
      originals: { state: 'COMPATIBLE', present: valid.artifacts.documents.length }
    }),
    restore: async () => { restoreCalls += 1; throw new Error('must not restore over verified local state'); }
  });
  assert.equal(localRetained.status, 'CORPUS_ALREADY_RESTORED');
  assert.equal(localRetained.releaseState, 'VERIFIED');
  assert.equal(restoreCalls, 1, 'Auto attempted to restore over existing local data.');

  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'auto', pointer,
      inspectBootstrap: async () => ({
        state: 'PRESENT', activeJobs: 0, partial: false, stores: {}, releaseState: selectedState
      }),
      verifyMarkedLocalRelease: async () => {
        throw releaseError('CORPUS_QDRANT_REQUEST_FAILED', 'synthetic inspection failure');
      },
      restore: async () => { throw new Error('Inspection failure must not restore.'); }
    }),
    (error) => error.code === 'CORPUS_QDRANT_REQUEST_FAILED'
  );

  const differentSelectedPointer = {
    ...pointer,
    releaseId: `v1-${'a'.repeat(24)}`,
    manifestSha256: 'b'.repeat(64)
  };
  let retainedManifest;
  const validDifferentLocal = await bootstrapCorpus({
    mode: 'auto',
    pointer: differentSelectedPointer,
    inspectBootstrap: async () => ({
      state: 'PRESENT', activeJobs: 0, partial: false, stores: {}, releaseState: selectedState
    }),
    verifyMarkedLocalRelease: async (manifest) => {
      retainedManifest = manifest;
      return {
        structured: { state: 'COMPATIBLE', reconciled: reconciledFixture() },
        originals: { state: 'COMPATIBLE', present: valid.artifacts.documents.length }
      };
    },
    restore: async () => { throw new Error('auto must retain a verified different local release'); }
  });
  assert.equal(validDifferentLocal.status, 'CORPUS_LOCAL_RELEASE_RETAINED');
  assert.equal(validDifferentLocal.releaseId, selectedState.releaseId);
  assert.equal(validDifferentLocal.selectedReleaseId, differentSelectedPointer.releaseId);
  assert.equal(retainedManifest.releaseId, selectedState.releaseId);

  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'required',
      restore: async () => {
        throw releaseError('CORPUS_EXISTING_STATE_MISMATCH', 'required exact-release mismatch');
      }
    }),
    (error) => error.code === 'CORPUS_EXISTING_STATE_MISMATCH'
  );

  const mismatchedMarker = await bootstrapCorpus({
    mode: 'auto',
    pointer,
    inspectBootstrap: async () => ({
      state: 'PRESENT', activeJobs: 0, partial: false, stores: {},
      releaseState: { ...selectedState, manifestSha256: 'f'.repeat(64) }
    })
  });
  assert.equal(mismatchedMarker.status, 'CORPUS_LOCAL_DIVERGED_RETAINED');
  assert.equal(mismatchedMarker.mutation, false);
  const staleMarker = await bootstrapCorpus({
    mode: 'auto',
    inspectBootstrap: async () => ({
      state: 'EMPTY', activeJobs: 0, partial: false, stores: {}, releaseState: selectedState
    })
  });
  assert.equal(staleMarker.status, 'CORPUS_LOCAL_DIVERGED_RETAINED');
  assert.equal(staleMarker.mutation, false);
  const unmarkedPresent = await bootstrapCorpus({
      mode: 'auto', environment: cloudEnvironment, rootDirectory: credentialRoot,
      inspectBootstrap: async () => ({
        state: 'PRESENT', activeJobs: 0, partial: false, stores: {}, releaseState: null
      }),
      restore: async () => {
        throw markCorpusFailure(releaseError('GCS_REMOTE_UNAVAILABLE', 'offline'), {
          phase: 'REMOTE_READ', localMutationStarted: false, rollbackConfirmed: false
        });
      }
    });
  assert.equal(unmarkedPresent.status, 'CORPUS_LOCAL_DIVERGED_RETAINED');
  assert.equal(unmarkedPresent.mutation, false);

  const busyPresent = await bootstrapCorpus({
      mode: 'auto',
      inspectBootstrap: async () => ({
        state: 'PRESENT', activeJobs: 1, inProgress: true, partial: false, stores: {}
      }),
      restore: async () => { throw new Error('must not restore busy local state'); }
    });
  assert.equal(busyPresent.status, 'CORPUS_LOCAL_DIVERGED_RETAINED');
  assert.equal(busyPresent.activeJobs, 1);
  const partialPresent = await bootstrapCorpus({
      mode: 'auto',
      inspectBootstrap: async () => ({
        state: 'PRESENT', activeJobs: 0, partial: true, stores: {}
      }),
      restore: async () => { throw new Error('must not restore partial local state'); }
    });
  assert.equal(partialPresent.status, 'CORPUS_LOCAL_PARTIAL_RETAINED');
  assert.equal(partialPresent.mutation, false);

  const qdrantInspectCause = Object.assign(
    releaseError('CORPUS_QDRANT_REQUEST_FAILED', 'Qdrant GET / failed (ECONNREFUSED).'),
    {
      method: 'GET', target: '/', qdrantPhase: 'RUNTIME_INFO_ROOT',
      cause: Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' })
    }
  );
  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'auto', localInspectAttempts: 1,
      inspectBootstrap: async () => { throw qdrantInspectCause; }
    }),
    (error) => error.code === 'CORPUS_LOCAL_STATE_UNKNOWN'
      && error.corpusPhase === 'LOCAL_INSPECT'
      && error.method === 'GET'
      && error.target === '/'
      && error.qdrantPhase === 'RUNTIME_INFO_ROOT'
      && error.cause === qdrantInspectCause
      && error.message.includes('ECONNREFUSED')
  );
  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'auto', inspectBootstrap: async () => ({ state: 'UNKNOWN', reason: 'forced' })
    }),
    (error) => error.code === 'CORPUS_LOCAL_STATE_UNKNOWN'
  );

  const missing = releaseError('GCS_CREDENTIAL_MISSING', 'secret-value-must-not-appear');
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  let auto;
  try {
    auto = await bootstrapCorpus({
      mode: 'auto', restore: async () => {
        throw markCorpusFailure(missing, {
          phase: 'REMOTE_READ', localMutationStarted: false, rollbackConfirmed: false
        });
      },
      inspectBootstrap: async () => ({ state: 'EMPTY', activeJobs: 0 })
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(auto.status, 'DEGRADED');
  assert(!warnings.join('\n').includes('secret-value-must-not-appear'), 'Bootstrap log leaked an upstream detail.');
  const readDenied = await bootstrapCorpus({
    mode: 'auto',
    inspectBootstrap: async () => ({ state: 'EMPTY', activeJobs: 0 }),
    environment: {
      GCS_PROJECT_ID: 'test-project', GCS_BUCKET: 'test-bucket',
      GCS_OBJECT_PREFIX: 'portable-corpus/v1', GCS_CREDENTIALS_FILE: 'secrets/not-read.json'
    },
    downloadRelease: async () => {
      throw Object.assign(new Error('permission detail'), { statusCode: 403 });
    }
  });
  assert.equal(readDenied.status, 'DEGRADED');
  assert.equal(readDenied.reason, 'GCS_READ_PERMISSION_REQUIRED');
  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'required',
      downloadRelease: async () => {
        throw Object.assign(new Error('permission detail'), { statusCode: 403 });
      }
    }),
    (error) => error.code === 'GCS_READ_PERMISSION_REQUIRED'
      && error.corpusPhase === 'REMOTE_READ'
  );
  await assert.rejects(
    () => bootstrapCorpus({ mode: 'required', restore: async () => { throw missing; } }),
    (error) => error.code === 'GCS_CREDENTIAL_MISSING'
  );
  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'required',
      restore: async () => { throw releaseError('CORPUS_EXISTING_STATE_MISMATCH', 'different'); }
    }),
    (error) => error.code === 'CORPUS_EXISTING_STATE_MISMATCH'
  );
  const invalidAutoConfig = await bootstrapCorpus({
    mode: 'auto',
    environment: { GCS_BUCKET: 'partial-only' },
    inspectBootstrap: async () => ({ state: 'EMPTY', activeJobs: 0 })
  });
  assert.equal(invalidAutoConfig.status, 'DEGRADED');
  assert.equal(invalidAutoConfig.reason, 'GCS_CONFIG_INVALID');

  const invalidCredentialEnvironment = {
    GCS_PROJECT_ID: 'test-project', GCS_BUCKET: 'test-bucket',
    GCS_OBJECT_PREFIX: 'portable-corpus/v1', GCS_CREDENTIALS_FILE: 'secrets/gcs.json'
  };
  const invalidCredentialAuto = await bootstrapCorpus({
    mode: 'auto', environment: invalidCredentialEnvironment, rootDirectory: credentialRoot,
    inspectBootstrap: async () => ({ state: 'EMPTY', activeJobs: 0 })
  });
  assert.equal(invalidCredentialAuto.status, 'DEGRADED');
  assert.equal(invalidCredentialAuto.reason, 'GCS_CREDENTIAL_INVALID');
  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'required', environment: invalidCredentialEnvironment, rootDirectory: credentialRoot
    }),
    (error) => error.code === 'GCS_CREDENTIAL_INVALID'
      && error.corpusPhase === 'REMOTE_READ'
  );

  const missingPointerFile = path.join(credentialRoot, 'missing-corpus-release.json');
  let missingPointerInspections = 0;
  const missingPointerAuto = await bootstrapCorpus({
    mode: 'auto', environment: cloudEnvironment, pointerFile: missingPointerFile, objectStore: {},
    inspectBootstrap: async () => {
      missingPointerInspections += 1;
      return { state: 'EMPTY', activeJobs: 0 };
    }
  });
  assert.equal(missingPointerAuto.status, 'DEGRADED');
  assert.equal(missingPointerAuto.reason, 'CORPUS_RELEASE_POINTER_MISSING');
  assert.equal(missingPointerInspections, 2);
  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'required', environment: cloudEnvironment,
      pointerFile: missingPointerFile, objectStore: {}
    }),
    (error) => error.code === 'CORPUS_RELEASE_POINTER_MISSING'
      && error.corpusPhase === 'REMOTE_READ'
  );

  let emptyInspections = 0;
  const rawFetch = await bootstrapCorpus({
    mode: 'auto', environment: cloudEnvironment,
    inspectBootstrap: async () => { emptyInspections += 1; return { state: 'EMPTY', activeJobs: 0 }; },
    downloadRelease: async () => { throw new TypeError('fetch failed'); }
  });
  assert.equal(rawFetch.status, 'DEGRADED');
  assert.equal(rawFetch.code, 'GCS_REMOTE_UNAVAILABLE');
  assert.equal(rawFetch.phase, 'REMOTE_READ');
  assert.equal(emptyInspections, 2, 'Auto fallback must re-confirm EMPTY after a remote-read failure.');
  let changedInspections = 0;
  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'auto', environment: cloudEnvironment,
      inspectBootstrap: async () => {
        changedInspections += 1;
        return changedInspections === 1
          ? { state: 'EMPTY', activeJobs: 0 }
          : { state: 'PRESENT', activeJobs: 0 };
      },
      downloadRelease: async () => { throw new TypeError('fetch failed'); }
    }),
    (error) => error.code === 'CORPUS_LOCAL_STATE_CHANGED'
  );
  let unknownAfterFailureInspections = 0;
  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'auto', environment: cloudEnvironment, localInspectAttempts: 1,
      inspectBootstrap: async () => {
        unknownAfterFailureInspections += 1;
        if (unknownAfterFailureInspections === 1) return { state: 'EMPTY', activeJobs: 0 };
        throw releaseError('CORPUS_QDRANT_REQUEST_FAILED', 'forced local probe failure');
      },
      downloadRelease: async () => { throw new TypeError('fetch failed'); }
    }),
    (error) => error.code === 'CORPUS_LOCAL_STATE_UNKNOWN'
      && error.corpusPhase === 'LOCAL_INSPECT'
      && error.cause?.code === 'CORPUS_QDRANT_REQUEST_FAILED'
  );
  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'required', environment: cloudEnvironment,
      downloadRelease: async () => { throw new TypeError('fetch failed'); }
    }),
    (error) => error.code === 'GCS_REMOTE_UNAVAILABLE'
      && error.corpusPhase === 'REMOTE_READ' && error.localMutationStarted === false
  );

  for (const transport of [
    Object.assign(new Error('aborted'), { name: 'AbortError' }),
    Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
    new TypeError('fetch failed', { cause: Object.assign(new Error('socket'), { code: 'ECONNRESET' }) })
  ]) {
    assert.equal(normalizeRemoteReadError(transport).code, 'GCS_REMOTE_UNAVAILABLE');
  }
  assert.equal(normalizeRemoteReadError(Object.assign(new Error('denied'), { statusCode: 403 })).code,
    'GCS_READ_PERMISSION_REQUIRED');
  assert.equal(normalizeRemoteReadError(Object.assign(new Error('missing'), { statusCode: 404 })).code,
    'GCS_OBJECT_MISSING');
  assert.equal(normalizeRemoteReadError(Object.assign(new Error('unavailable'), { statusCode: 503 })).code,
    'GCS_REMOTE_UNAVAILABLE');
  const programmingFailure = new TypeError('unexpected adapter invariant');
  assert.equal(normalizeRemoteReadError(programmingFailure), programmingFailure,
    'Unknown programming failures must not be classified as degradable remote availability errors.');

  const incompatibleManifest = structuredClone(valid);
  incompatibleManifest.compatibility.embeddingDimension += 1;
  assert.throws(
    () => validateReleaseManifest(incompatibleManifest, config),
    (error) => error.code === 'CORPUS_RELEASE_INCOMPATIBLE'
  );
  for (const fatalCode of [
    'CORPUS_RELEASE_CHECKSUM_MISMATCH',
    'CORPUS_RELEASE_MANIFEST_INVALID',
    'CORPUS_RELEASE_INCOMPATIBLE'
  ]) {
    for (const mode of ['auto', 'required']) {
      await assert.rejects(
        () => bootstrapCorpus({
          mode, environment: cloudEnvironment,
          inspectBootstrap: async () => ({ state: 'EMPTY', activeJobs: 0 }),
          downloadRelease: async () => { throw releaseError(fatalCode, 'forced integrity failure'); }
        }),
        (error) => error.code === fatalCode
      );
    }
  }

  let postApplyRollback = 0;
  let postApplyInspect = 0;
  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'auto', environment: cloudEnvironment,
      inspectBootstrap: async () => ({ state: 'EMPTY', activeJobs: 0 }),
      downloadRelease: async () => ({ manifest: valid, pointer, files: new Map(), ownsTemporary: false }),
      ensureDataServices: async () => {},
      inspectUploads: async () => ({ empty: true, fileCount: 0, releaseState: null }),
      inspectLocal: async () => {
        if (postApplyInspect++ === 0) return { state: 'EMPTY' };
        throw releaseError('GCS_REMOTE_UNAVAILABLE', 'forced after apply');
      },
      inspectOriginals: async () => ({ state: 'EMPTY', present: 0 }),
      restoreStructured: async () => ({ rollbackRestore: async () => { postApplyRollback += 1; } }),
      restoreOriginals: async () => ({
        restored: 0, skipped: 0, targetVolume: 'test', rollbackOriginals: async () => {}
      }),
      writeReleaseState: async () => {}
    }),
    (error) => error.code === 'GCS_REMOTE_UNAVAILABLE'
      && error.localMutationStarted === true && error.rollbackConfirmed === true
  );
  assert.equal(postApplyRollback, 1);

  await assert.rejects(
    () => bootstrapCorpus({
      mode: 'auto', environment: cloudEnvironment,
      inspectBootstrap: async () => ({ state: 'EMPTY', activeJobs: 0 }),
      downloadRelease: async () => ({ manifest: valid, pointer, files: new Map(), ownsTemporary: false }),
      ensureDataServices: async () => {},
      inspectUploads: async () => ({ empty: true, fileCount: 0, releaseState: null }),
      inspectLocal: (() => {
        let calls = 0;
        return async () => {
          if (calls++ === 0) return { state: 'EMPTY' };
          throw releaseError('CORPUS_RESTORE_VERIFY_FAILED', 'forced');
        };
      })(),
      inspectOriginals: async () => ({ state: 'EMPTY', present: 0 }),
      restoreStructured: async () => ({
        rollbackRestore: async () => { throw new Error('forced rollback failure'); }
      }),
      restoreOriginals: async () => ({
        restored: 0, skipped: 0, targetVolume: 'test', rollbackOriginals: async () => {}
      }),
      writeReleaseState: async () => {}
    }),
    (error) => error.code === 'CORPUS_RESTORE_ROLLBACK_FAILED'
  );

  const ownedDownloadTemporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-release-test-download-cleanup-'));
  await assert.rejects(
    () => downloadAndVerifyRelease({
      config, pointer,
      createTemporaryDirectory: async () => ownedDownloadTemporary,
      objectStore: { download: async () => { throw new TypeError('fetch failed'); } }
    }),
    (error) => error.code === 'GCS_REMOTE_UNAVAILABLE'
      && error.corpusPhase === 'REMOTE_READ' && error.localMutationStarted === false
  );
  await assert.rejects(() => fsp.access(ownedDownloadTemporary), (error) => error.code === 'ENOENT');

  await assert.rejects(
    () => downloadAndVerifyRelease({
      config, pointer,
      createTemporaryDirectory: async () => 'test-owned-temporary',
      removeTemporaryDirectory: async () => { throw new Error('forced cleanup failure'); },
      objectStore: { download: async () => { throw new TypeError('fetch failed'); } }
    }),
    (error) => error.code === 'CORPUS_TEMP_CLEANUP_FAILED'
      && error.corpusPhase === 'FINALIZE' && error.localMutationStarted === false
  );

  const helperCleanupFailure = new DockerUploadVolume({
    composeProject: 'edurag_remote_test_helper',
    compose: (args) => {
      if (args[0] === 'ps') return 'app-container';
      if (args[0] === 'images') return 'app-image';
      throw new Error(`Unexpected compose call: ${args.join(' ')}`);
    },
    docker: (args) => {
      if (args[0] === 'inspect') {
        return JSON.stringify([{ Type: 'volume', Destination: '/usr/src/app/uploads', Name: 'test_uploads' }]);
      }
      if (args[0] === 'run') return 'helper-id';
      if (args[0] === 'rm') return { status: 1 };
      throw new Error(`Unexpected docker call: ${args.join(' ')}`);
    }
  });
  await assert.rejects(
    () => helperCleanupFailure.withHelper(async () => ({ ok: true })),
    (error) => error.code === 'CORPUS_HELPER_CLEANUP_FAILED'
  );

  assert.doesNotThrow(() => assertRemoteResetAllowed(
    ['down', '-v', '--remove-orphans'],
    { REMOTE_E2E_CONFIRM_ISOLATED: 'true' },
    'edurag_remote_test_policy'
  ));
  assert.throws(
    () => assertRemoteResetAllowed(['down', '-v'], {}, 'edurag_remote_e2e'),
    (error) => error.code === 'REMOTE_RESET_CONFIRMATION_REQUIRED'
  );
  assert.doesNotThrow(() => assertRemoteResetAllowed(
    ['down', '-v'], { REMOTE_RESET_CONFIRM_PROJECT: 'edurag_remote_e2e' }, 'edurag_remote_e2e'
  ));
  assert.doesNotThrow(() => assertRemoteResetAllowed(['down'], {}, 'edurag_remote_e2e'));

  const pointerKey = manifestObjectKey(config, pointer.releaseId);
  assert(objectStore.objects.has(pointerKey), 'complete release must contain a manifest object');
  await cleanupTemporaryDirectories();
  console.log(
    'CORPUS_RELEASE_TEST_OK manifest=validated publish=create-only+manifest-last+idempotent '
    + 'restore=staged+empty+compatible+rollback bootstrap=phase-aware+empty-degraded+local-safe+required-strict '
    + 'publish=dry-run-zero-mutation+review-confirmation+pointer-last+writer-resume '
    + 'prepublish-audit=read-only+mechanical-validation'
  );
}

main().catch(async (error) => {
  await cleanupTemporaryDirectories();
  console.error(`CORPUS_RELEASE_TEST_FAILED: ${error.code || 'ERROR'} ${error.message}`);
  process.exit(1);
});
