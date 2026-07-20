'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const { GcsObjectStore } = require('./lib/gcs-object-store');
const { DockerUploadVolume } = require('./lib/docker-upload-volume');
const {
  ORIGINAL_FILES_RELATIVE,
  buildOriginalFilesManifest,
  loadBundleDocuments,
  normalizeObjectPrefix,
  originalFilesError,
  readOptionalOriginalFilesManifest,
  sha256File,
  validateBucket,
  validateOriginalFilesManifest,
  writeBundleChecksums
} = require('./lib/corpus-original-files');
const { BUNDLE_DIRECTORY, verifyBundle } = require('./corpus-manager');
const { redacted, root } = require('./remote-test-utils');

const MIME_TYPES = Object.freeze({
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain'
});

function credentialState(credentialsFile) {
  if (!credentialsFile || !fs.existsSync(credentialsFile)) return { state: 'MISSING' };
  try {
    const value = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
    if (value?.type !== 'service_account' || typeof value.client_email !== 'string'
      || typeof value.private_key !== 'string' || !value.private_key.includes('PRIVATE KEY')) {
      return { state: 'INVALID' };
    }
    return { state: 'PRESENT' };
  } catch (_error) {
    return { state: 'INVALID' };
  }
}

function resolveCredentialsFile(rootDirectory, value) {
  const configured = String(value || '').trim();
  if (!configured || path.isAbsolute(configured)) {
    throw originalFilesError('GCS_CONFIG_INVALID', 'GCS_CREDENTIALS_FILE must be repository-relative.');
  }
  const resolved = path.resolve(rootDirectory, configured);
  const secretsDirectory = path.resolve(rootDirectory, 'secrets');
  if (!resolved.startsWith(`${secretsDirectory}${path.sep}`)) {
    throw originalFilesError('GCS_CONFIG_INVALID', 'GCS_CREDENTIALS_FILE must stay under secrets/.');
  }
  return resolved;
}

function loadGcsConfig(options = {}) {
  const environment = options.environment || process.env;
  const rootDirectory = options.rootDirectory || root;
  const names = ['GCS_PROJECT_ID', 'GCS_BUCKET', 'GCS_OBJECT_PREFIX', 'GCS_CREDENTIALS_FILE'];
  const missing = names.filter((name) => !String(environment[name] || '').trim());
  if (missing.length) {
    throw originalFilesError('GCS_CONFIG_MISSING', `Missing GCS configuration: ${missing.join(', ')}.`);
  }
  const projectId = String(environment.GCS_PROJECT_ID).trim();
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) {
    throw originalFilesError('GCS_CONFIG_INVALID', 'GCS_PROJECT_ID is invalid.');
  }
  return {
    projectId,
    bucket: validateBucket(environment.GCS_BUCKET),
    objectPrefix: normalizeObjectPrefix(environment.GCS_OBJECT_PREFIX),
    credentialsFile: resolveCredentialsFile(rootDirectory, environment.GCS_CREDENTIALS_FILE)
  };
}

async function loadApprovals(rootDirectory = root) {
  let value;
  try {
    value = JSON.parse(await fsp.readFile(
      path.join(rootDirectory, 'bootstrap', 'corpus-approved-documents.json'),
      'utf8'
    ));
  } catch (_error) {
    throw originalFilesError('CORPUS_FILES_APPROVAL_REQUIRED', 'Exact corpus approval metadata is missing.');
  }
  if (!Array.isArray(value.approvals)) {
    throw originalFilesError('CORPUS_FILES_APPROVAL_REQUIRED', 'Exact corpus approval metadata is invalid.');
  }
  const approvals = new Map();
  for (const approval of value.approvals) {
    const documentId = String(approval?.documentId || '');
    const checksum = String(approval?.checksum || '').toLowerCase();
    if (!/^\d+$/.test(documentId) || !/^[0-9a-f]{64}$/.test(checksum)
      || approval.purpose !== 'demo portable corpus' || approval.reviewStatus !== 'APPROVED'
      || approval.originalFileIncluded !== false || approvals.has(documentId)) {
      throw originalFilesError('CORPUS_FILES_APPROVAL_REQUIRED', 'Corpus approval must be exact and non-wildcard.');
    }
    approvals.set(documentId, { ...approval, checksum });
  }
  return approvals;
}

async function loadContext(options = {}) {
  if (options.context) return options.context;
  const bundleDirectory = options.bundleDirectory || BUNDLE_DIRECTORY;
  const bundleManifest = await (options.verifyBundle || verifyBundle)(bundleDirectory);
  const documents = await loadBundleDocuments(bundleDirectory, bundleManifest);
  const approvals = await loadApprovals(options.rootDirectory || root);
  const approvedDocuments = new Map();
  for (const [documentId, document] of documents) {
    const approval = approvals.get(documentId);
    if (approval?.checksum === document.sha256) approvedDocuments.set(documentId, document);
  }
  if (!approvedDocuments.size) {
    throw originalFilesError('CORPUS_FILES_APPROVAL_REQUIRED', 'No exact-approved corpus original is available.');
  }
  return { bundleDirectory, bundleManifest, documents, approvals, approvedDocuments };
}

function validateCredential(config) {
  const state = credentialState(config.credentialsFile);
  if (state.state === 'MISSING') {
    throw originalFilesError('GCS_CREDENTIAL_MISSING', 'GCS credential file is missing.');
  }
  if (state.state !== 'PRESENT') {
    throw originalFilesError('GCS_CREDENTIAL_INVALID', 'GCS credential file is invalid.');
  }
}

function defaultObjectStore(config) {
  validateCredential(config);
  return new GcsObjectStore(config);
}

async function verifyDownloadedFile(file, entry) {
  const stat = await fsp.stat(file);
  const sha256 = await sha256File(file);
  if (stat.size !== entry.sizeBytes || sha256 !== entry.sha256) {
    throw originalFilesError('GCS_OBJECT_CONTENT_MISMATCH', 'Remote original checksum or size does not match the manifest.');
  }
  return { sizeBytes: stat.size, sha256 };
}

function verifyRemoteMetadata(metadata, entry) {
  if (!metadata.exists || metadata.sizeBytes !== entry.sizeBytes
    || metadata.sha256 !== entry.sha256 || metadata.documentId !== entry.documentId) {
    throw originalFilesError('GCS_OBJECT_METADATA_MISMATCH', 'Remote original metadata does not match the manifest.');
  }
}

async function verifyRemoteEntry(objectStore, entry, temporaryDirectory) {
  const metadata = await objectStore.metadata(entry.objectKey);
  verifyRemoteMetadata(metadata, entry);
  const downloaded = path.join(temporaryDirectory, `remote-${entry.documentId}`);
  await objectStore.download(entry.objectKey, downloaded);
  await verifyDownloadedFile(downloaded, entry);
  return metadata;
}

async function inspectOriginalFiles(options = {}) {
  const context = await loadContext(options);
  const manifest = await readOptionalOriginalFilesManifest(context.bundleDirectory);
  let config = null;
  let configState = 'PRESENT';
  try {
    config = options.config || loadGcsConfig(options);
  } catch (error) {
    configState = error.code === 'GCS_CONFIG_MISSING' ? 'MISSING' : 'INVALID';
  }
  let manifestState = 'MISSING';
  if (manifest) {
    validateOriginalFilesManifest(manifest, {
      bundleFormatVersion: context.bundleManifest.bundleFormatVersion,
      documents: context.documents,
      approvals: context.approvals,
      expectedBucket: config?.bucket,
      expectedObjectPrefix: config?.objectPrefix
    });
    manifestState = 'PRESENT';
  }
  const volume = options.volumeStore || new DockerUploadVolume();
  const target = typeof volume.resolve === 'function'
    ? volume.resolve()
    : { resolvable: true, volumeName: 'test-volume' };
  const local = [];
  if (target.resolvable) {
    for (const document of context.approvedDocuments.values()) {
      try {
        const current = await volume.stat(document.localStorageKey);
        local.push({
          documentId: document.documentId,
          state: !current.exists
            ? 'MISSING'
            : (current.sha256 === document.sha256 && current.sizeBytes === document.sizeBytes
              ? 'VERIFIED'
              : 'MISMATCH')
        });
      } catch (_error) {
        local.push({ documentId: document.documentId, state: 'UNAVAILABLE' });
      }
    }
  }
  const result = {
    status: 'CORPUS_FILES_INSPECT_OK',
    manifest: manifestState,
    mappedFiles: manifest?.files?.length || 0,
    approvedDocuments: context.approvedDocuments.size,
    localSources: local,
    credential: config ? credentialState(config.credentialsFile).state : 'NOT_CONFIGURED',
    gcsConfig: configState,
    uploadVolume: target.resolvable ? 'RESOLVABLE' : target.reason
  };
  console.log(JSON.stringify(result));
  return result;
}

async function publishOriginalFiles(options = {}) {
  const context = await loadContext(options);
  const config = options.config || loadGcsConfig(options);
  if (!options.objectStore) validateCredential(config);
  const objectStore = options.objectStore || defaultObjectStore(config);
  const volume = options.volumeStore || new DockerUploadVolume();
  const expectedManifest = buildOriginalFilesManifest({
    bundleFormatVersion: context.bundleManifest.bundleFormatVersion,
    bucket: config.bucket,
    objectPrefix: config.objectPrefix,
    documents: context.approvedDocuments,
    createdAtUtc: options.createdAtUtc
  });
  validateOriginalFilesManifest(expectedManifest, {
    bundleFormatVersion: context.bundleManifest.bundleFormatVersion,
    documents: context.documents,
    approvals: context.approvals,
    expectedBucket: config.bucket,
    expectedObjectPrefix: config.objectPrefix
  });
  const currentManifest = await readOptionalOriginalFilesManifest(context.bundleDirectory);
  if (currentManifest) {
    validateOriginalFilesManifest(currentManifest, {
      bundleFormatVersion: context.bundleManifest.bundleFormatVersion,
      documents: context.documents,
      approvals: context.approvals,
      expectedBucket: config.bucket,
      expectedObjectPrefix: config.objectPrefix
    });
    const currentMappings = JSON.stringify(currentManifest.files);
    if (currentMappings !== JSON.stringify(expectedManifest.files)) {
      throw originalFilesError('CORPUS_FILES_MAPPING_STALE', 'Existing original-files mapping differs from the approved corpus.');
    }
  }
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-corpus-files-publish-'));
  let uploaded = 0;
  let skipped = 0;
  try {
    for (const entry of expectedManifest.files) {
      const local = path.join(temporary, `local-${entry.documentId}`);
      await volume.copyOut(entry.localStorageKey, local);
      await verifyDownloadedFile(local, entry);
      const existing = await objectStore.metadata(entry.objectKey);
      if (existing.exists) {
        await verifyRemoteEntry(objectStore, entry, temporary);
        skipped += 1;
        continue;
      }
      const result = await objectStore.uploadCreateOnly(local, entry.objectKey, {
        contentType: MIME_TYPES[path.extname(entry.originalFilename).toLowerCase()] || 'application/octet-stream',
        documentId: entry.documentId,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
        bundleVersion: context.bundleManifest.bundleFormatVersion
      });
      if (result.preconditionFailed) {
        await verifyRemoteEntry(objectStore, entry, temporary);
        skipped += 1;
      } else {
        await verifyRemoteEntry(objectStore, entry, temporary);
        uploaded += 1;
      }
    }
    if (!currentManifest) {
      const target = path.join(context.bundleDirectory, ORIGINAL_FILES_RELATIVE);
      const temporaryManifest = `${target}.tmp`;
      await fsp.writeFile(temporaryManifest, `${JSON.stringify(expectedManifest, null, 2)}\n`, { flag: 'wx' });
      await fsp.rename(temporaryManifest, target);
      await writeBundleChecksums(context.bundleDirectory, context.bundleManifest);
      await (options.verifyBundle || verifyBundle)(context.bundleDirectory);
    }
    const result = {
      status: 'CORPUS_FILES_PUBLISH_OK',
      documents: expectedManifest.files.length,
      objects: expectedManifest.files.length,
      uploaded,
      skipped,
      checksumVerified: true
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
}

async function restoreOriginalFiles(options = {}) {
  const context = await loadContext(options);
  const config = options.config || loadGcsConfig(options);
  if (!options.objectStore) validateCredential(config);
  const objectStore = options.objectStore || defaultObjectStore(config);
  const volume = options.volumeStore || new DockerUploadVolume();
  const manifest = await readOptionalOriginalFilesManifest(context.bundleDirectory);
  if (!manifest) throw originalFilesError('CORPUS_FILES_MANIFEST_MISSING', 'original-files.json is missing.');
  validateOriginalFilesManifest(manifest, {
    bundleFormatVersion: context.bundleManifest.bundleFormatVersion,
    documents: context.documents,
    approvals: context.approvals,
    expectedBucket: config.bucket,
    expectedObjectPrefix: config.objectPrefix
  });
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-corpus-files-restore-'));
  let restored = 0;
  let skipped = 0;
  let volumeName = null;
  try {
    for (const entry of manifest.files) {
      const downloaded = path.join(temporary, `download-${entry.documentId}`);
      await objectStore.download(entry.objectKey, downloaded);
      await verifyDownloadedFile(downloaded, entry);
      const result = await volume.putAtomic(downloaded, entry.localStorageKey, entry);
      restored += result.restored ? 1 : 0;
      skipped += result.skipped ? 1 : 0;
      volumeName = result.volumeName || volumeName;
    }
    const result = {
      status: 'CORPUS_FILES_RESTORE_OK',
      restored,
      skipped,
      checksumVerified: true,
      targetVolume: volumeName || 'resolved-upload-volume'
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
}

async function verifyOriginalFiles(options = {}) {
  const context = await loadContext(options);
  const manifest = await readOptionalOriginalFilesManifest(context.bundleDirectory);
  if (!manifest) throw originalFilesError('CORPUS_FILES_MANIFEST_MISSING', 'original-files.json is missing.');
  let config = null;
  try {
    config = options.config || loadGcsConfig(options);
  } catch (error) {
    if (error.code !== 'GCS_CONFIG_MISSING') throw error;
  }
  validateOriginalFilesManifest(manifest, {
    bundleFormatVersion: context.bundleManifest.bundleFormatVersion,
    documents: context.documents,
    approvals: context.approvals,
    expectedBucket: config?.bucket,
    expectedObjectPrefix: config?.objectPrefix
  });
  const volume = options.volumeStore || new DockerUploadVolume();
  const target = typeof volume.resolve === 'function'
    ? volume.resolve()
    : { resolvable: true };
  let local = 'SKIPPED';
  if (target.resolvable) {
    local = 'VERIFIED';
    for (const entry of manifest.files) {
      const current = await volume.stat(entry.localStorageKey);
      if (!current.exists) local = 'MISSING';
      else if (current.sha256 !== entry.sha256 || current.sizeBytes !== entry.sizeBytes) {
        throw originalFilesError('CORPUS_FILES_LOCAL_MISMATCH', 'Local original differs from the manifest.');
      }
    }
  }
  let remote = 'SKIPPED';
  if (options.objectStore || (config && credentialState(config.credentialsFile).state === 'PRESENT')) {
    const objectStore = options.objectStore || defaultObjectStore(config);
    const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-corpus-files-verify-'));
    try {
      for (const entry of manifest.files) await verifyRemoteEntry(objectStore, entry, temporary);
      remote = 'VERIFIED';
    } finally {
      await fsp.rm(temporary, { recursive: true, force: true });
    }
  }
  const result = {
    status: 'CORPUS_FILES_VERIFY_OK',
    mappedFiles: manifest.files.length,
    manifest: 'VERIFIED',
    local,
    remote
  };
  console.log(JSON.stringify(result));
  return result;
}

async function bootstrapOriginalFiles(options = {}) {
  const mode = String(options.mode || process.env.CORPUS_FILES_BOOTSTRAP || 'auto').trim().toLowerCase();
  if (!['off', 'auto', 'required'].includes(mode)) {
    throw originalFilesError('CORPUS_FILES_BOOTSTRAP_CONFIG_INVALID', 'CORPUS_FILES_BOOTSTRAP must be off, auto or required.');
  }
  if (mode === 'off') {
    console.log('CORPUS_FILES_SKIPPED reason=OFF');
    return { restored: false, reason: 'OFF' };
  }
  try {
    const result = await (options.restore || restoreOriginalFiles)(options);
    return { restored: result.restored > 0, reason: 'RESTORED', ...result };
  } catch (error) {
    if (mode === 'required') throw error;
    const nonBlocking = new Set([
      'GCS_CONFIG_MISSING', 'GCS_CONFIG_INVALID', 'GCS_CREDENTIAL_MISSING', 'GCS_CREDENTIAL_INVALID',
      'GCS_READ_PERMISSION_REQUIRED', 'GCS_OBJECT_MISSING', 'GCS_REMOTE_READ_FAILED',
      'CORPUS_FILES_MANIFEST_MISSING', 'CORPUS_FILES_UPLOAD_VOLUME_UNAVAILABLE'
    ]);
    if (!nonBlocking.has(error.code)) throw error;
    console.warn(`CORPUS_FILES_SKIPPED reason=${error.code}`);
    return { restored: false, reason: error.code };
  }
}

async function main() {
  const command = process.argv[2];
  if (command === 'inspect') return inspectOriginalFiles();
  if (command === 'publish') return publishOriginalFiles();
  if (command === 'restore') return restoreOriginalFiles();
  if (command === 'verify') return verifyOriginalFiles();
  if (command === 'bootstrap') return bootstrapOriginalFiles();
  throw originalFilesError('CORPUS_FILES_COMMAND_INVALID', 'Use inspect, publish, restore, verify or bootstrap.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${error.code || 'CORPUS_FILES_FAILED'}: ${redacted(error.message)}`);
    process.exit(1);
  });
}

module.exports = {
  bootstrapOriginalFiles,
  credentialState,
  inspectOriginalFiles,
  loadGcsConfig,
  publishOriginalFiles,
  restoreOriginalFiles,
  verifyDownloadedFile,
  verifyOriginalFiles,
  verifyRemoteMetadata
};
