'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  bootstrapOriginalFiles,
  credentialState,
  loadGcsConfig,
  publishOriginalFiles,
  restoreOriginalFiles,
  verifyOriginalFiles
} = require('./corpus-files-manager');
const {
  buildOriginalFilesManifest,
  preserveOriginalFilesManifest,
  validateOriginalFilesManifest
} = require('./lib/corpus-original-files');

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

class FakeObjectStore {
  constructor() {
    this.objects = new Map();
    this.createOnlyCalls = 0;
    this.writeError = null;
  }

  async metadata(key) {
    const object = this.objects.get(key);
    return object ? { exists: true, ...object.metadata } : { exists: false };
  }

  async uploadCreateOnly(source, key, metadata) {
    this.createOnlyCalls += 1;
    if (this.writeError) throw this.writeError;
    if (this.objects.has(key)) return { uploaded: false, preconditionFailed: true };
    this.objects.set(key, {
      bytes: await fsp.readFile(source),
      metadata: {
        sizeBytes: metadata.sizeBytes,
        sha256: metadata.sha256,
        documentId: metadata.documentId,
        generation: 'test-generation'
      }
    });
    return { uploaded: true };
  }

  async download(key, destination) {
    const object = this.objects.get(key);
    if (!object) {
      const error = new Error('missing');
      error.code = 'GCS_OBJECT_MISSING';
      throw error;
    }
    await fsp.writeFile(destination, object.bytes);
  }
}

class FakeVolumeStore {
  constructor(sourceFiles = new Map()) {
    this.files = new Map(sourceFiles);
    this.lastTemporaryPath = null;
  }

  resolve() {
    return { resolvable: true, volumeName: 'isolated-test_uploads_data' };
  }

  async stat(key) {
    const bytes = this.files.get(key);
    return bytes
      ? { exists: true, sizeBytes: bytes.length, sha256: hash(bytes) }
      : { exists: false };
  }

  async copyOut(key, destination) {
    const bytes = this.files.get(key);
    if (!bytes) {
      const error = new Error('missing');
      error.code = 'CORPUS_FILES_LOCAL_SOURCE_MISSING';
      throw error;
    }
    this.lastTemporaryPath = destination;
    await fsp.writeFile(destination, bytes);
  }

  async putAtomic(source, key, expected) {
    const bytes = await fsp.readFile(source);
    const current = this.files.get(key);
    if (current) {
      if (current.length === expected.sizeBytes && hash(current) === expected.sha256) {
        return { restored: false, skipped: true, volumeName: 'isolated-test_uploads_data' };
      }
      const error = new Error('mismatch');
      error.code = 'CORPUS_FILES_LOCAL_MISMATCH';
      throw error;
    }
    this.files.set(key, bytes);
    return { restored: true, skipped: false, volumeName: 'isolated-test_uploads_data' };
  }
}

function testContext(directory, bytes) {
  const sha256 = hash(bytes);
  const document = {
    documentId: '1',
    originalFilename: 'Demo lesson.pdf',
    storageType: 'LOCAL',
    localStorageKey: 'documents/2026/07/demo.pdf',
    fileType: 'PDF',
    mimeType: 'application/pdf',
    sizeBytes: bytes.length,
    sha256
  };
  const documents = new Map([['1', document]]);
  const approvals = new Map([['1', { documentId: '1', checksum: sha256 }]]);
  return {
    bundleDirectory: directory,
    bundleManifest: {
      bundleFormatVersion: '1.0.0',
      files: {},
      checksums: {},
      compatibilityNotes: []
    },
    documents,
    approvals,
    approvedDocuments: documents
  };
}

async function main() {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-corpus-files-test-'));
  try {
    const bytes = Buffer.from('approved portable original fixture');
    const context = testContext(directory, bytes);
    const config = {
      projectId: 'demo-project-12345',
      bucket: 'demo-private-bucket',
      objectPrefix: 'portable-corpus/v1',
      credentialsFile: path.join(directory, 'unused.json')
    };
    const volume = new FakeVolumeStore(new Map([
      [context.documents.get('1').localStorageKey, bytes]
    ]));
    const objectStore = new FakeObjectStore();
    const verifyBundle = async () => context.bundleManifest;

    const firstPublish = await publishOriginalFiles({
      context, config, volumeStore: volume, objectStore, verifyBundle,
      createdAtUtc: '2026-07-21T00:00:00.000Z'
    });
    assert.equal(firstPublish.uploaded, 1);
    assert.equal(firstPublish.skipped, 0);
    assert.equal(objectStore.createOnlyCalls, 1, 'publish must use the create-only transport boundary.');
    assert.equal(await fsp.access(path.dirname(volume.lastTemporaryPath)).then(() => true).catch(() => false), false,
      'publish temporary directory must be removed.');

    const secondPublish = await publishOriginalFiles({
      context, config, volumeStore: volume, objectStore, verifyBundle,
      createdAtUtc: '2026-07-21T00:00:00.000Z'
    });
    assert.equal(secondPublish.uploaded, 0);
    assert.equal(secondPublish.skipped, 1);
    assert.equal(objectStore.createOnlyCalls, 1, 'existing verified object must not be uploaded again.');

    const restoreVolume = new FakeVolumeStore();
    const firstRestore = await restoreOriginalFiles({
      context, config, volumeStore: restoreVolume, objectStore, verifyBundle
    });
    assert.equal(firstRestore.restored, 1);
    const secondRestore = await restoreOriginalFiles({
      context, config, volumeStore: restoreVolume, objectStore, verifyBundle
    });
    assert.equal(secondRestore.skipped, 1);
    await verifyOriginalFiles({
      context, config, volumeStore: restoreVolume, objectStore, verifyBundle
    });

    restoreVolume.files.set(context.documents.get('1').localStorageKey, Buffer.from('wrong local file'));
    await assert.rejects(
      () => restoreOriginalFiles({ context, config, volumeStore: restoreVolume, objectStore, verifyBundle }),
      (error) => error.code === 'CORPUS_FILES_LOCAL_MISMATCH'
    );

    const mismatchVolume = new FakeVolumeStore(new Map([
      [context.documents.get('1').localStorageKey, Buffer.from('wrong approved source')]
    ]));
    await assert.rejects(
      () => publishOriginalFiles({ context, config, volumeStore: mismatchVolume, objectStore, verifyBundle }),
      (error) => error.code === 'GCS_OBJECT_CONTENT_MISMATCH'
    );

    const entry = JSON.parse(await fsp.readFile(path.join(directory, 'original-files.json'), 'utf8')).files[0];
    const saved = objectStore.objects.get(entry.objectKey);
    saved.metadata.sha256 = '0'.repeat(64);
    await assert.rejects(
      () => publishOriginalFiles({ context, config, volumeStore: volume, objectStore, verifyBundle }),
      (error) => error.code === 'GCS_OBJECT_METADATA_MISMATCH'
    );
    saved.metadata.sha256 = entry.sha256;
    saved.bytes = Buffer.from('remote content differs despite metadata');
    await assert.rejects(
      () => publishOriginalFiles({ context, config, volumeStore: volume, objectStore, verifyBundle }),
      (error) => error.code === 'GCS_OBJECT_CONTENT_MISMATCH'
    );
    saved.bytes = bytes;

    const preservedDirectory = path.join(directory, 'preserved');
    await fsp.mkdir(preservedDirectory);
    await preserveOriginalFilesManifest(directory, preservedDirectory, {
      bundleFormatVersion: '1.0.0',
      documents: context.documents,
      approvals: context.approvals,
      expectedBucket: config.bucket,
      expectedObjectPrefix: config.objectPrefix
    });
    assert.equal(
      await fsp.access(path.join(preservedDirectory, 'original-files.json')).then(() => true).catch(() => false),
      true,
      'corpus export preservation must retain a valid cloud mapping.'
    );
    const changedDocuments = new Map(context.documents);
    changedDocuments.set('1', { ...context.documents.get('1'), sha256: 'f'.repeat(64) });
    await assert.rejects(
      () => preserveOriginalFilesManifest(directory, preservedDirectory, {
        bundleFormatVersion: '1.0.0',
        documents: changedDocuments,
        approvals: context.approvals
      }),
      (error) => error.code === 'CORPUS_FILES_MAPPING_STALE'
    );

    objectStore.objects.clear();
    const permission = new Error('writer denied');
    permission.code = 'GCS_WRITE_PERMISSION_REQUIRED';
    objectStore.writeError = permission;
    await assert.rejects(
      () => publishOriginalFiles({ context, config, volumeStore: volume, objectStore, verifyBundle }),
      (error) => error.code === 'GCS_WRITE_PERMISSION_REQUIRED'
    );
    objectStore.writeError = null;

    const validManifest = buildOriginalFilesManifest({
      bundleFormatVersion: '1.0.0',
      bucket: config.bucket,
      objectPrefix: config.objectPrefix,
      documents: context.documents,
      createdAtUtc: '2026-07-21T00:00:00.000Z'
    });
    const traversal = structuredClone(validManifest);
    traversal.files[0].localStorageKey = '../outside.pdf';
    assert.throws(() => validateOriginalFilesManifest(traversal),
      (error) => error.code === 'CORPUS_FILES_STORAGE_KEY_INVALID');
    const duplicate = structuredClone(validManifest);
    duplicate.files.push(structuredClone(duplicate.files[0]));
    assert.throws(() => validateOriginalFilesManifest(duplicate),
      (error) => error.code === 'CORPUS_FILES_MANIFEST_INVALID');

    assert.throws(
      () => loadGcsConfig({ rootDirectory: directory, environment: {} }),
      (error) => error.code === 'GCS_CONFIG_MISSING' && !error.message.includes('secret-value')
    );
    const secrets = path.join(directory, 'secrets');
    await fsp.mkdir(secrets);
    await fsp.writeFile(path.join(secrets, 'malformed.json'), '{}');
    assert.equal(credentialState(path.join(secrets, 'missing.json')).state, 'MISSING');
    assert.equal(credentialState(path.join(secrets, 'malformed.json')).state, 'INVALID');

    let restoreCalls = 0;
    await bootstrapOriginalFiles({ mode: 'off', restore: async () => { restoreCalls += 1; } });
    assert.equal(restoreCalls, 0);
    const missingCredential = Object.assign(new Error('missing'), { code: 'GCS_CREDENTIAL_MISSING' });
    const auto = await bootstrapOriginalFiles({ mode: 'auto', restore: async () => { throw missingCredential; } });
    assert.equal(auto.reason, 'GCS_CREDENTIAL_MISSING');
    await assert.rejects(
      () => bootstrapOriginalFiles({ mode: 'required', restore: async () => { throw missingCredential; } }),
      (error) => error.code === 'GCS_CREDENTIAL_MISSING'
    );

    console.log(
      'CORPUS_FILES_TEST_OK manifest=pass publish=create-only+idempotent restore=atomic+idempotent '
      + 'mismatch=blocked credentials=redacted bootstrap=off+auto+required'
    );
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`CORPUS_FILES_TEST_FAILED: ${error.code || 'ERROR'} ${error.message}`);
  process.exit(1);
});
