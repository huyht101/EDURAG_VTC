'use strict';

const assert = require('assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  bootstrapCorpus,
  downloadAndVerifyRelease,
  publishCorpus,
  restoreCorpus
} = require('./corpus-manager');
const {
  POINTER_SCHEMA_VERSION,
  buildReleaseManifest,
  credentialState,
  loadCloudConfig,
  manifestObjectKey,
  releaseError,
  sha256Buffer,
  validateReleaseManifest
} = require('./lib/corpus-release');

const config = Object.freeze({
  projectId: 'test-project',
  bucket: 'edurag-test-bucket',
  objectPrefix: 'portable-corpus/v1',
  credentialsFile: path.join(os.tmpdir(), 'not-used.json')
});

function manifestInput() {
  const mysql = Buffer.from('mysql-data');
  const qdrant = Buffer.from('qdrant-data');
  const original = Buffer.from('approved-original');
  return {
    buffers: { mysql, qdrant, original },
    input: {
      config,
      mysql: { sha256: sha256Buffer(mysql), sizeBytes: mysql.length },
      qdrant: { sha256: sha256Buffer(qdrant), sizeBytes: qdrant.length },
      documents: [{
        documentId: '1', sha256: sha256Buffer(original), sizeBytes: original.length,
        localStorageKey: 'documents/2026/07/example.pdf', originalFilename: 'demo.pdf',
        mimeType: 'application/pdf'
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
  const files = new Map();
  const artifacts = [manifest.artifacts.mysql, manifest.artifacts.qdrant, ...manifest.artifacts.documents];
  const buffers = [fixture.buffers.mysql, fixture.buffers.qdrant, fixture.buffers.original];
  for (let index = 0; index < artifacts.length; index += 1) {
    const file = path.join(temporary, `artifact-${index}`);
    await fsp.writeFile(file, buffers[index]);
    files.set(artifacts[index].objectKey, file);
  }
  return { temporary, manifest, files, generatedLegacy: false };
}

class FakeObjectStore {
  constructor() {
    this.objects = new Map();
    this.uploadOrder = [];
  }

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
  assert.throws(
    () => loadCloudConfig({ environment: {}, rootDirectory: os.tmpdir() }),
    (error) => error.code === 'GCS_CONFIG_MISSING'
  );
  const credentialRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-release-credential-test-'));
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
  await fsp.rm(credentialRoot, { recursive: true, force: true });

  const fixture = manifestInput();
  const valid = buildReleaseManifest(fixture.input);
  validateReleaseManifest(valid, config);

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

  const objectStore = new FakeObjectStore();
  let pointer;
  const first = await publishCorpus({
    config, objectStore,
    stageSource: stagedRelease,
    pointer: null,
    writePointer: async (value) => { pointer = value; }
  });
  assert.equal(first.uploaded, 4);
  assert.deepEqual(objectStore.uploadOrder, ['mysql', 'qdrant', 'document', 'manifest']);
  assert.equal(pointer.pointerSchemaVersion, POINTER_SCHEMA_VERSION);

  const second = await publishCorpus({
    config, objectStore,
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
      config, objectStore: mismatchStore,
      stageSource: async () => mismatchStage, pointer: null, writePointer: async () => {}
    }),
    (error) => error.code === 'CORPUS_RELEASE_REMOTE_MISMATCH'
  );

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
      manifest: valid, files: new Map(), temporary: restoreTemporary, ownsTemporary: true
    }),
    ensureDataServices: async () => {},
    inspectLocal: async () => ({ state: inspectCalls++ === 0 ? 'EMPTY' : 'COMPATIBLE' }),
    restoreStructured: async () => { structuredCalls += 1; },
    reconcileRuntime: async () => reconciledFixture(),
    restoreOriginals: async () => { originalCalls += 1; return { restored: 1, skipped: 0, targetVolume: 'test_uploads' }; }
  });
  assert.equal(restored.status, 'CORPUS_RESTORE_OK');
  assert.equal(structuredCalls, 1);
  assert.equal(originalCalls, 1);
  await assert.rejects(() => fsp.access(restoreTemporary), (error) => error.code === 'ENOENT');

  const compatibleTemporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-release-test-compatible-'));
  structuredCalls = 0;
  const compatible = await restoreCorpus({
    downloadRelease: async () => ({
      manifest: valid, files: new Map(), temporary: compatibleTemporary, ownsTemporary: true
    }),
    ensureDataServices: async () => {},
    inspectLocal: async () => ({ state: 'COMPATIBLE' }),
    restoreStructured: async () => { structuredCalls += 1; },
    reconcileRuntime: async () => reconciledFixture(),
    restoreOriginals: async () => ({ restored: 0, skipped: 1, targetVolume: 'test_uploads' })
  });
  assert.equal(compatible.status, 'CORPUS_ALREADY_RESTORED');
  assert.equal(structuredCalls, 0);
  await assert.rejects(() => fsp.access(compatibleTemporary), (error) => error.code === 'ENOENT');

  const incompatibleTemporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-release-test-incompatible-'));
  await assert.rejects(
    () => restoreCorpus({
      downloadRelease: async () => ({
        manifest: valid, files: new Map(), temporary: incompatibleTemporary, ownsTemporary: true
      }),
      ensureDataServices: async () => {},
      inspectLocal: async () => { throw releaseError('CORPUS_EXISTING_STATE_MISMATCH', 'different'); }
    }),
    (error) => error.code === 'CORPUS_EXISTING_STATE_MISMATCH'
  );
  await assert.rejects(() => fsp.access(incompatibleTemporary), (error) => error.code === 'ENOENT');

  let restoreCalls = 0;
  const off = await bootstrapCorpus({ mode: 'off', restore: async () => { restoreCalls += 1; } });
  assert.equal(off.reason, 'OFF');
  assert.equal(restoreCalls, 0);
  const missing = releaseError('GCS_CREDENTIAL_MISSING', 'secret-value-must-not-appear');
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  let auto;
  try {
    auto = await bootstrapCorpus({
      mode: 'auto', restore: async () => { throw missing; }, inspectLocal: async () => ({ state: 'EMPTY' })
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(auto.status, 'DEGRADED');
  assert(!warnings.join('\n').includes('secret-value-must-not-appear'), 'Bootstrap log leaked an upstream detail.');
  await assert.rejects(
    () => bootstrapCorpus({ mode: 'required', restore: async () => { throw missing; } }),
    (error) => error.code === 'GCS_CREDENTIAL_MISSING'
  );

  const pointerKey = manifestObjectKey(config, pointer.releaseId);
  assert(objectStore.objects.has(pointerKey), 'complete release must contain a manifest object');
  console.log(
    'CORPUS_RELEASE_TEST_OK manifest=validated publish=create-only+manifest-last+idempotent '
    + 'restore=staged+empty+compatible mismatch=blocked bootstrap=off+auto+required'
  );
}

main().catch((error) => {
  console.error(`CORPUS_RELEASE_TEST_FAILED: ${error.code || 'ERROR'} ${error.message}`);
  process.exit(1);
});
