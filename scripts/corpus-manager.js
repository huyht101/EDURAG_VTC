'use strict';

const crypto = require('crypto');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const runtime = require('./lib/corpus-runtime');
const { DockerUploadVolume } = require('./lib/docker-upload-volume');
const { GcsObjectStore } = require('./lib/gcs-object-store');
const {
  POINTER_SCHEMA_VERSION,
  RELEASE_SCHEMA_VERSION,
  buildReleaseManifest,
  credentialState,
  loadBundleDocuments,
  loadCloudConfig,
  manifestObjectKey,
  readPointer,
  releaseError,
  requireCredential,
  sha256Buffer,
  sha256File,
  validateReleaseManifest,
  writePointer
} = require('./lib/corpus-release');
const { compose, delay, redacted, root } = require('./remote-test-utils');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const LEGACY_BUNDLE_DIRECTORY = path.join(root, 'bootstrap', 'corpus');
const APPROVAL_FILE = path.join(root, 'bootstrap', 'corpus-approved-documents.json');
const MIME_TYPES = Object.freeze({
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  TXT: 'text/plain'
});

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function sourceFingerprint({ documents, inventory, expectedCounts, compatibility }) {
  const value = canonicalJson({
    documents: [...documents.values()].map((document) => ({
      documentId: String(document.documentId),
      sha256: document.sha256,
      sizeBytes: Number(document.sizeBytes),
      localStorageKey: document.localStorageKey
    })).sort((a, b) => a.documentId.localeCompare(b.documentId)),
    inventory: {
      activeDocuments: [...inventory.activeDocuments].map(String).sort(),
      chunks: [...inventory.chunks].map((chunk) => ({
        documentId: String(chunk.documentId),
        vectorNodeId: String(chunk.vectorNodeId),
        contentHash: String(chunk.contentHash).toLowerCase(),
        hidden: Boolean(chunk.hidden)
      })).sort((a, b) => a.vectorNodeId.localeCompare(b.vectorNodeId))
    },
    expectedCounts,
    compatibility
  });
  return sha256Buffer(Buffer.from(JSON.stringify(value), 'utf8'));
}

function splitSqlTuples(value) {
  const tuples = [];
  let quoted = false;
  let escaped = false;
  let depth = 0;
  let start = -1;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === "'") quoted = false;
      continue;
    }
    if (char === "'") quoted = true;
    else if (char === '(') {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0 && start >= 0) tuples.push(value.slice(start, index));
      if (depth < 0) throw releaseError('CORPUS_MYSQL_DUMP_INVALID', 'Invalid SQL tuple syntax.');
    }
  }
  if (quoted || depth !== 0) throw releaseError('CORPUS_MYSQL_DUMP_INVALID', 'Invalid SQL tuple syntax.');
  return tuples;
}

function countTableRows(sql, table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(
    'INSERT\\s+INTO\\s+`?' + escaped + '`?\\s+VALUES\\s+([\\s\\S]*?);',
    'gi'
  );
  let count = 0;
  for (const match of sql.matchAll(expression)) count += splitSqlTuples(match[1]).length;
  return count;
}

async function loadApprovals() {
  let payload;
  try {
    payload = JSON.parse(await fsp.readFile(APPROVAL_FILE, 'utf8'));
  } catch (_error) {
    throw releaseError('CORPUS_APPROVAL_REQUIRED', 'Exact document approval metadata is missing.');
  }
  const approvals = new Map();
  for (const approval of payload.approvals || []) {
    const documentId = String(approval?.documentId || '');
    const checksum = String(approval?.checksum || '').toLowerCase();
    if (!/^\d+$/.test(documentId) || !/^[0-9a-f]{64}$/.test(checksum)
      || approval.purpose !== 'demo portable corpus' || approval.reviewStatus !== 'APPROVED'
      || approval.originalFileIncluded !== false || approvals.has(documentId)) {
      throw releaseError('CORPUS_APPROVAL_REQUIRED', 'Document approval must be exact and non-wildcard.');
    }
    approvals.set(documentId, { ...approval, checksum });
  }
  return approvals;
}

function compatibilityFromLegacy(manifest) {
  return {
    databaseSchemaVersion: manifest.databaseSchemaVersion,
    mysqlServerVersion: manifest.mysqlServerVersion,
    qdrantServerVersion: manifest.qdrantServerVersion,
    qdrantCollectionName: manifest.qdrantCollectionName,
    embeddingModel: manifest.embeddingModel,
    embeddingDimension: Number(manifest.embeddingDimension),
    pipelineVersion: manifest.pipelineVersion || null
  };
}

async function stageFromLegacyBundle(options = {}) {
  const bundleDirectory = options.bundleDirectory || LEGACY_BUNDLE_DIRECTORY;
  const temporary = options.temporaryDirectory
    || await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-corpus-release-stage-'));
  const volume = options.volumeStore || new DockerUploadVolume();
  const legacy = await runtime.verifyBundle(bundleDirectory, { quiet: true });
  const sqlFile = path.join(bundleDirectory, legacy.files.mysqlDump);
  const sql = await fsp.readFile(sqlFile, 'utf8');
  const documents = await loadBundleDocuments(bundleDirectory, legacy);
  const approvals = await loadApprovals();
  for (const [documentId, document] of documents) {
    if (approvals.get(documentId)?.checksum !== document.sha256) {
      throw releaseError('CORPUS_APPROVAL_REQUIRED', `Document ${documentId} lacks exact-checksum approval.`);
    }
  }
  const inventory = JSON.parse(await fsp.readFile(path.join(bundleDirectory, legacy.files.inventory), 'utf8'));
  const expectedCounts = {
    documents: Number(legacy.documentCount),
    processingJobs: countTableRows(sql, 'document_processing_jobs'),
    chunks: Number(legacy.chunkCount),
    citations: countTableRows(sql, 'citations'),
    qdrantPoints: Number(legacy.qdrantPointCount)
  };
  const compatibility = compatibilityFromLegacy(legacy);
  const mysqlDirectory = path.join(temporary, 'mysql');
  const qdrantDirectory = path.join(temporary, 'qdrant');
  const documentDirectory = path.join(temporary, 'documents');
  await Promise.all([
    fsp.mkdir(mysqlDirectory, { recursive: true }),
    fsp.mkdir(qdrantDirectory, { recursive: true }),
    fsp.mkdir(documentDirectory, { recursive: true })
  ]);
  const mysqlFile = path.join(mysqlDirectory, 'corpus.sql.gz');
  await fsp.writeFile(mysqlFile, await gzip(Buffer.from(sql, 'utf8'), { level: 9, mtime: 0 }));
  const qdrantFile = path.join(qdrantDirectory, `${legacy.qdrantCollectionName}.snapshot`);
  await fsp.copyFile(path.join(bundleDirectory, legacy.files.qdrantSnapshot), qdrantFile);

  const stagedDocuments = [];
  for (const document of documents.values()) {
    const file = path.join(documentDirectory, document.documentId);
    await volume.copyOut(document.localStorageKey, file);
    const [stat, checksum] = await Promise.all([fsp.stat(file), sha256File(file)]);
    if (stat.size !== document.sizeBytes || checksum !== document.sha256) {
      throw releaseError('CORPUS_ORIGINAL_SOURCE_MISMATCH', `Approved original ${document.documentId} does not match its checksum.`);
    }
    stagedDocuments.push({
      documentId: document.documentId,
      sha256: checksum,
      sizeBytes: stat.size,
      localStorageKey: document.localStorageKey,
      originalFilename: document.originalFilename,
      mimeType: MIME_TYPES[document.fileType] || 'application/octet-stream',
      file
    });
  }
  const [mysqlStat, qdrantStat, mysqlSha, qdrantSha] = await Promise.all([
    fsp.stat(mysqlFile), fsp.stat(qdrantFile), sha256File(mysqlFile), sha256File(qdrantFile)
  ]);
  const fingerprint = sourceFingerprint({ documents, inventory, expectedCounts, compatibility });
  const manifest = buildReleaseManifest({
    config: options.config,
    mysql: { sha256: mysqlSha, sizeBytes: mysqlStat.size },
    qdrant: { sha256: qdrantSha, sizeBytes: qdrantStat.size },
    documents: stagedDocuments,
    compatibility,
    expectedCounts,
    inventory,
    sourceFingerprint: fingerprint,
    sanitization: legacy.sanitization,
    createdAtUtc: options.createdAtUtc
  });
  const files = new Map([
    [manifest.artifacts.mysql.objectKey, mysqlFile],
    [manifest.artifacts.qdrant.objectKey, qdrantFile]
  ]);
  manifest.artifacts.documents.forEach((entry, index) => files.set(entry.objectKey, stagedDocuments[index].file));
  return { temporary, manifest, files, generatedLegacy: Boolean(options.generatedLegacy) };
}

function releaseArtifacts(manifest) {
  return [manifest.artifacts.mysql, manifest.artifacts.qdrant, ...manifest.artifacts.documents];
}

function releaseSummary(manifest, pointer = null) {
  const artifacts = releaseArtifacts(manifest).map((artifact) => ({
    kind: artifact.kind,
    ...(artifact.documentId === undefined ? {} : { documentId: String(artifact.documentId) }),
    sha256: artifact.sha256,
    sizeBytes: Number(artifact.sizeBytes)
  }));
  return {
    schemaVersion: manifest.schemaVersion,
    compatibility: manifest.compatibility,
    expectedCounts: manifest.expectedCounts,
    artifacts,
    artifactCount: artifacts.length,
    payloadBytes: artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0),
    manifestSha256: pointer?.manifestSha256 || null
  };
}

function verifyObjectMetadata(metadata, artifact, manifest) {
  if (!metadata.exists || metadata.sha256 !== artifact.sha256 || metadata.sizeBytes !== artifact.sizeBytes
    || metadata.kind !== artifact.kind || metadata.releaseId !== manifest.releaseId) {
    throw releaseError('CORPUS_RELEASE_REMOTE_MISMATCH', 'Remote release object metadata does not match the canonical manifest.');
  }
}

async function verifyDownloadedArtifact(file, artifact) {
  const [stat, sha256] = await Promise.all([fsp.stat(file), sha256File(file)]);
  if (stat.size !== artifact.sizeBytes || sha256 !== artifact.sha256) {
    throw releaseError('CORPUS_RELEASE_CHECKSUM_MISMATCH', 'Downloaded release artifact checksum or size mismatch.');
  }
}

function defaultObjectStore(config) {
  requireCredential(config);
  return new GcsObjectStore(config);
}

async function downloadRemoteManifest({ config, objectStore, pointer, directory }) {
  const file = path.join(directory, 'manifest.json');
  const key = manifestObjectKey(config, pointer.releaseId);
  await objectStore.download(key, file);
  const bytes = await fsp.readFile(file);
  if (sha256Buffer(bytes) !== pointer.manifestSha256) {
    throw releaseError('CORPUS_RELEASE_MANIFEST_CHECKSUM_MISMATCH', 'Remote manifest does not match the repository pointer.');
  }
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); } catch (_error) {
    throw releaseError('CORPUS_RELEASE_MANIFEST_INVALID', 'Remote manifest is not valid JSON.');
  }
  validateReleaseManifest(manifest, config);
  if (manifest.releaseId !== pointer.releaseId) {
    throw releaseError('CORPUS_RELEASE_POINTER_MISMATCH', 'Remote manifest release ID differs from the repository pointer.');
  }
  return { manifest, file, key };
}

async function downloadAndVerifyRelease(options = {}) {
  const config = options.config || loadCloudConfig(options);
  const objectStore = options.objectStore || defaultObjectStore(config);
  const pointer = options.pointer || await readPointer(options);
  if (!pointer) throw releaseError('CORPUS_RELEASE_POINTER_MISSING', 'bootstrap/corpus-release.json is missing.');
  const temporary = options.temporaryDirectory
    || await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-corpus-release-download-'));
  const ownsTemporary = !options.temporaryDirectory;
  try {
    const remote = await downloadRemoteManifest({ config, objectStore, pointer, directory: temporary });
    const files = new Map();
    let index = 0;
    for (const artifact of releaseArtifacts(remote.manifest)) {
      const metadata = await objectStore.metadata(artifact.objectKey);
      verifyObjectMetadata(metadata, artifact, remote.manifest);
      const file = path.join(temporary, `artifact-${index}`);
      index += 1;
      await objectStore.download(artifact.objectKey, file);
      await verifyDownloadedArtifact(file, artifact);
      files.set(artifact.objectKey, file);
    }
    return { ...remote, files, temporary, ownsTemporary, config, objectStore, pointer };
  } catch (error) {
    if (ownsTemporary) await fsp.rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function uploadArtifact(objectStore, manifest, artifact, sourceFile) {
  const current = await objectStore.metadata(artifact.objectKey);
  if (current.exists) {
    verifyObjectMetadata(current, artifact, manifest);
    const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-corpus-release-verify-'));
    try {
      const downloaded = path.join(temporary, 'object');
      await objectStore.download(artifact.objectKey, downloaded);
      await verifyDownloadedArtifact(downloaded, artifact);
    } finally {
      await fsp.rm(temporary, { recursive: true, force: true });
    }
    return 'skipped';
  }
  const result = await objectStore.uploadCreateOnly(sourceFile, artifact.objectKey, {
    contentType: artifact.mimeType || 'application/octet-stream',
    documentId: artifact.documentId,
    kind: artifact.kind,
    releaseId: manifest.releaseId,
    schemaVersion: manifest.schemaVersion,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes
  });
  if (result.preconditionFailed) return uploadArtifact(objectStore, manifest, artifact, sourceFile);
  const metadata = await objectStore.metadata(artifact.objectKey);
  verifyObjectMetadata(metadata, artifact, manifest);
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-corpus-release-verify-'));
  try {
    const downloaded = path.join(temporary, 'object');
    await objectStore.download(artifact.objectKey, downloaded);
    await verifyDownloadedArtifact(downloaded, artifact);
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
  return 'uploaded';
}

async function stagePublishSource(options, config) {
  const legacyManifest = path.join(LEGACY_BUNDLE_DIRECTORY, 'manifest.json');
  const exists = await fsp.access(legacyManifest).then(() => true).catch(() => false);
  if (exists) return stageFromLegacyBundle({ ...options, config });
  await runtime.exportCorpus({ quiet: true });
  try {
    return await stageFromLegacyBundle({ ...options, config, generatedLegacy: true });
  } catch (error) {
    await fsp.rm(LEGACY_BUNDLE_DIRECTORY, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function publishCorpus(options = {}) {
  const config = options.config || loadCloudConfig(options);
  const objectStore = options.objectStore || defaultObjectStore(config);
  const staged = await (options.stageSource || stagePublishSource)(options, config);
  let uploaded = 0;
  let skipped = 0;
  try {
    const currentPointer = options.pointer === undefined ? await readPointer(options) : options.pointer;
    if (currentPointer) {
      const current = await downloadAndVerifyRelease({ ...options, config, objectStore, pointer: currentPointer });
      try {
        if (current.manifest.sourceFingerprint === staged.manifest.sourceFingerprint) {
          skipped = releaseArtifacts(current.manifest).length + 1;
          const result = {
            status: 'CORPUS_PUBLISH_OK', releaseId: current.manifest.releaseId,
            uploaded: 0, skipped, objects: skipped, manifestLast: true, checksumVerified: true
          };
          console.log(JSON.stringify(result));
          return result;
        }
      } finally {
        if (current.ownsTemporary) await fsp.rm(current.temporary, { recursive: true, force: true });
      }
    }

    for (const artifact of releaseArtifacts(staged.manifest)) {
      const outcome = await uploadArtifact(objectStore, staged.manifest, artifact, staged.files.get(artifact.objectKey));
      if (outcome === 'uploaded') uploaded += 1; else skipped += 1;
    }

    const manifestBytes = Buffer.from(`${JSON.stringify(staged.manifest, null, 2)}\n`, 'utf8');
    const manifestFile = path.join(staged.temporary, 'manifest.json');
    await fsp.writeFile(manifestFile, manifestBytes);
    const manifestArtifact = {
      kind: 'manifest',
      objectKey: manifestObjectKey(config, staged.manifest.releaseId),
      sha256: sha256Buffer(manifestBytes),
      sizeBytes: manifestBytes.length,
      mimeType: 'application/json'
    };
    const outcome = await uploadArtifact(objectStore, staged.manifest, manifestArtifact, manifestFile);
    if (outcome === 'uploaded') uploaded += 1; else skipped += 1;
    const pointer = {
      pointerSchemaVersion: POINTER_SCHEMA_VERSION,
      releaseId: staged.manifest.releaseId,
      manifestSha256: manifestArtifact.sha256,
      publishedAtUtc: staged.manifest.createdAtUtc
    };
    await (options.writePointer || writePointer)(pointer, options);
    const verified = await downloadAndVerifyRelease({ ...options, config, objectStore, pointer });
    if (verified.ownsTemporary) await fsp.rm(verified.temporary, { recursive: true, force: true });
    const result = {
      status: 'CORPUS_PUBLISH_OK', releaseId: staged.manifest.releaseId,
      uploaded, skipped, objects: releaseArtifacts(staged.manifest).length + 1,
      manifestLast: true, checksumVerified: true
    };
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    if (staged?.manifest?.releaseId) error.cleanupCandidate = staged.manifest.objectPrefix;
    throw error;
  } finally {
    await fsp.rm(staged.temporary, { recursive: true, force: true }).catch(() => {});
    if (staged.generatedLegacy) {
      await fsp.rm(LEGACY_BUNDLE_DIRECTORY, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function writeLegacyRestoreBundle(downloaded) {
  const directory = path.join(downloaded.temporary, 'restore-bundle');
  await fsp.mkdir(path.join(directory, 'mysql'), { recursive: true });
  await fsp.mkdir(path.join(directory, 'qdrant'), { recursive: true });
  const mysqlRelative = 'mysql/edurag.sql';
  const qdrantRelative = `qdrant/${downloaded.manifest.compatibility.qdrantCollectionName}.snapshot`;
  const inventoryRelative = 'inventory.json';
  const mysqlBytes = await gunzip(await fsp.readFile(downloaded.files.get(downloaded.manifest.artifacts.mysql.objectKey)));
  await fsp.writeFile(path.join(directory, mysqlRelative), mysqlBytes);
  await fsp.copyFile(
    downloaded.files.get(downloaded.manifest.artifacts.qdrant.objectKey),
    path.join(directory, qdrantRelative)
  );
  await fsp.writeFile(
    path.join(directory, inventoryRelative),
    `${JSON.stringify(downloaded.manifest.inventory, null, 2)}\n`,
    'utf8'
  );
  const checksums = {
    [mysqlRelative]: await sha256File(path.join(directory, mysqlRelative)),
    [qdrantRelative]: await sha256File(path.join(directory, qdrantRelative)),
    [inventoryRelative]: await sha256File(path.join(directory, inventoryRelative))
  };
  const compatibility = downloaded.manifest.compatibility;
  const legacy = {
    bundleFormatVersion: '1.0.0',
    createdAtUtc: downloaded.manifest.createdAtUtc,
    databaseSchemaVersion: compatibility.databaseSchemaVersion,
    mysqlServerVersion: compatibility.mysqlServerVersion,
    qdrantServerVersion: compatibility.qdrantServerVersion,
    qdrantCollectionName: compatibility.qdrantCollectionName,
    embeddingModel: compatibility.embeddingModel,
    embeddingDimension: compatibility.embeddingDimension,
    pipelineVersion: compatibility.pipelineVersion,
    documentCount: downloaded.manifest.expectedCounts.documents,
    chunkCount: downloaded.manifest.expectedCounts.chunks,
    qdrantPointCount: downloaded.manifest.expectedCounts.qdrantPoints,
    originalFilesIncluded: false,
    files: { mysqlDump: mysqlRelative, qdrantSnapshot: qdrantRelative, inventory: inventoryRelative },
    checksums,
    sanitization: downloaded.manifest.sanitization,
    bundlePayloadBytes: Object.values(downloaded.manifest.artifacts)
      .filter((value) => !Array.isArray(value)).reduce((sum, value) => sum + Number(value.sizeBytes || 0), 0),
    compatibilityNotes: ['Temporary verified restore staging generated from an immutable cloud release.']
  };
  await fsp.writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');
  await fsp.writeFile(
    path.join(directory, 'checksums.sha256'),
    `${Object.entries(checksums).map(([relative, digest]) => `${digest}  ${relative}`).join('\n')}\n`,
    'utf8'
  );
  await runtime.verifyBundle(directory, { quiet: true });
  return directory;
}

function runtimeFingerprint(reconciled, documents, manifest) {
  const inventory = {
    activeDocuments: [...new Set(reconciled.chunks.map((chunk) => String(chunk.documentId)))],
    chunks: reconciled.chunks.map((chunk) => ({
      documentId: String(chunk.documentId),
      vectorNodeId: chunk.vectorNodeId,
      contentHash: chunk.contentHash,
      hidden: chunk.visibilityStatus === 'HIDDEN'
    }))
  };
  const expectedCounts = {
    documents: Number(reconciled.stats.documents),
    processingJobs: Number(reconciled.stats.jobs),
    chunks: Number(reconciled.stats.chunks),
    citations: Number(reconciled.stats.citations),
    qdrantPoints: reconciled.points.length
  };
  return sourceFingerprint({ documents, inventory, expectedCounts, compatibility: manifest.compatibility });
}

async function inspectLocalState(manifest) {
  const reconciled = await runtime.reconcileRuntime();
  const empty = runtime.bootstrapEmpty(reconciled.stats, reconciled.qdrant);
  if (empty.mysqlEmpty !== empty.qdrantEmpty) {
    throw releaseError('CORPUS_PARTIAL_STATE', 'MySQL and Qdrant emptiness differ; cloud restore refuses partial state.');
  }
  if (empty.mysqlEmpty && empty.qdrantEmpty) return { state: 'EMPTY', reconciled };
  if (!manifest) return { state: 'EXISTING_UNVERIFIED', reconciled };
  const documents = new Map(runtime.documentInventory().map((document) => [String(document.documentId), {
    ...document,
    documentId: String(document.documentId),
    sha256: String(document.sha256).toLowerCase(),
    sizeBytes: Number(document.sizeBytes)
  }]));
  const fingerprint = runtimeFingerprint(reconciled, documents, manifest);
  if (fingerprint !== manifest.sourceFingerprint) {
    throw releaseError('CORPUS_EXISTING_STATE_MISMATCH', 'Existing MySQL/Qdrant state differs from the selected cloud release.');
  }
  return { state: 'COMPATIBLE', reconciled };
}

async function inspectLocalStateWithRetry(manifest, options = {}) {
  const inspect = options.inspectLocal || inspectLocalState;
  const attempts = Number(options.localInspectAttempts || 10);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await inspect(manifest);
    } catch (error) {
      lastError = error;
      if (!['CORPUS_DOCKER_COMMAND_FAILED', 'CORPUS_MYSQL_INSPECT_FAILED', 'CORPUS_QDRANT_REQUEST_FAILED']
        .includes(error.code) || attempt === attempts) throw error;
      await delay(Math.min(250 * attempt, 1500));
    }
  }
  throw lastError;
}

async function restoreOriginals(downloaded, options = {}) {
  const volume = options.volumeStore || new DockerUploadVolume();
  let restored = 0;
  let skipped = 0;
  let targetVolume = null;
  for (const document of downloaded.manifest.artifacts.documents) {
    const result = await volume.putAtomic(downloaded.files.get(document.objectKey), document.localStorageKey, document);
    restored += result.restored ? 1 : 0;
    skipped += result.skipped ? 1 : 0;
    targetVolume = result.volumeName || targetVolume;
  }
  return { restored, skipped, targetVolume: targetVolume || 'resolved-upload-volume' };
}

function assertExpectedCounts(reconciled, manifest) {
  const actual = {
    documents: Number(reconciled.stats.documents),
    processingJobs: Number(reconciled.stats.jobs),
    chunks: Number(reconciled.stats.chunks),
    citations: Number(reconciled.stats.citations),
    qdrantPoints: reconciled.points.length
  };
  if (Object.entries(manifest.expectedCounts).some(([name, value]) => Number(actual[name]) !== Number(value))) {
    throw releaseError('CORPUS_RESTORE_COUNT_MISMATCH', 'Restored MySQL/Qdrant counts differ from the cloud manifest.');
  }
  return actual;
}

async function restoreCorpus(options = {}) {
  const downloaded = await (options.downloadRelease || downloadAndVerifyRelease)(options);
  try {
    await (options.ensureDataServices || runtime.ensureDataServices)();
    const inspect = (manifest) => inspectLocalStateWithRetry(manifest, options);
    const local = await inspect(downloaded.manifest);
    let structuredRestored = false;
    if (local.state === 'EMPTY') {
      if (options.restoreStructured) {
        await options.restoreStructured(downloaded);
      } else {
        const bundleDirectory = await writeLegacyRestoreBundle(downloaded);
        await runtime.restoreCorpus({ bundleDirectory, writersAlreadyStopped: true, quiet: true });
      }
      structuredRestored = true;
    }
    const reconciled = await (options.reconcileRuntime || runtime.reconcileRuntime)();
    const counts = assertExpectedCounts(reconciled, downloaded.manifest);
    const verifiedLocal = await inspect(downloaded.manifest);
    if (verifiedLocal.state !== 'COMPATIBLE') {
      throw releaseError('CORPUS_RESTORE_VERIFY_FAILED', 'Restored state is not compatible with the cloud release.');
    }
    const originals = await (options.restoreOriginals || restoreOriginals)(downloaded, options);
    const result = {
      status: structuredRestored ? 'CORPUS_RESTORE_OK' : 'CORPUS_ALREADY_RESTORED',
      releaseId: downloaded.manifest.releaseId,
      mysql: structuredRestored ? 1 : 0,
      qdrant: structuredRestored ? 1 : 0,
      originalsRestored: originals.restored,
      originalsSkipped: originals.skipped,
      targetVolume: originals.targetVolume,
      counts,
      checksumVerified: true
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    if (downloaded.ownsTemporary) await fsp.rm(downloaded.temporary, { recursive: true, force: true });
  }
}

function servicesRunning() {
  const services = String(compose(['ps', '--status', 'running', '--services'], { allowFailure: true }) || '')
    .split(/\r?\n/).filter(Boolean);
  return new Set(services);
}

async function inspectCorpus(options = {}) {
  let config = null;
  let configState = 'AVAILABLE';
  try { config = options.config || loadCloudConfig(options); } catch (error) {
    configState = error.code === 'GCS_CONFIG_MISSING' ? 'MISSING' : 'INVALID';
  }
  const pointer = await readPointer(options);
  const credential = config ? credentialState(config.credentialsFile) : 'NOT_CONFIGURED';
  let remote = pointer ? 'NOT_CHECKED' : 'NO_POINTER';
  let release = null;
  if (pointer && config && credential === 'AVAILABLE') {
    let downloaded = null;
    try {
      downloaded = await downloadAndVerifyRelease({ ...options, config, pointer });
      remote = 'VERIFIED';
      release = releaseSummary(downloaded.manifest, pointer);
    } catch (error) {
      remote = error.code || 'UNAVAILABLE';
    } finally {
      if (downloaded?.ownsTemporary) {
        await fsp.rm(downloaded.temporary, { recursive: true, force: true });
      }
    }
  }
  const running = servicesRunning();
  let local = 'NOT_RUNNING';
  if (running.has('db') && running.has('qdrant')) {
    const state = await inspectLocalState(null);
    local = state.state;
  }
  const result = {
    status: 'CORPUS_INSPECT_OK',
    releaseId: pointer?.releaseId || null,
    pointer: pointer ? 'PRESENT' : 'MISSING',
    legacyRepositoryBundle: await fsp.access(path.join(LEGACY_BUNDLE_DIRECTORY, 'manifest.json'))
      .then(() => 'PRESENT').catch(() => 'ABSENT'),
    config: configState,
    credential,
    remote,
    local,
    release
  };
  console.log(JSON.stringify(result));
  return result;
}

async function verifyCorpus(options = {}) {
  const downloaded = await downloadAndVerifyRelease(options);
  try {
    const running = servicesRunning();
    let local = 'NOT_RUNNING';
    let originals = 'NOT_CHECKED';
    let counts = null;
    if (running.has('db') && running.has('qdrant')) {
      const state = await inspectLocalState(downloaded.manifest);
      local = state.state;
      if (state.state !== 'EMPTY') counts = assertExpectedCounts(state.reconciled, downloaded.manifest);
    }
    const volume = options.volumeStore || new DockerUploadVolume();
    const resolved = typeof volume.resolve === 'function' ? volume.resolve() : { resolvable: true };
    if (resolved.resolvable) {
      originals = 'VERIFIED';
      for (const document of downloaded.manifest.artifacts.documents) {
        const current = await volume.stat(document.localStorageKey);
        if (!current.exists) originals = 'MISSING';
        else if (current.sha256 !== document.sha256 || current.sizeBytes !== document.sizeBytes) {
          throw releaseError('CORPUS_ORIGINAL_LOCAL_MISMATCH', 'Local original differs from the cloud release.');
        }
      }
    }
    const result = {
      status: 'CORPUS_VERIFY_OK', releaseId: downloaded.manifest.releaseId,
      remote: 'VERIFIED', local, originals, counts,
      artifacts: releaseArtifacts(downloaded.manifest).length,
      payloadBytes: releaseSummary(downloaded.manifest).payloadBytes,
      checksumVerified: true
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    if (downloaded.ownsTemporary) await fsp.rm(downloaded.temporary, { recursive: true, force: true });
  }
}

async function bootstrapCorpus(options = {}) {
  const mode = String(options.mode || process.env.CORPUS_BOOTSTRAP || 'auto').trim().toLowerCase();
  if (!['off', 'auto', 'required'].includes(mode)) {
    throw releaseError('CORPUS_BOOTSTRAP_CONFIG_INVALID', 'CORPUS_BOOTSTRAP must be off, auto or required.');
  }
  if (mode === 'off') {
    console.log('CORPUS_BOOTSTRAP_SKIPPED reason=OFF');
    return { status: 'SKIPPED', reason: 'OFF' };
  }
  try {
    return await (options.restore || restoreCorpus)(options);
  } catch (error) {
    const degradable = new Set([
      'GCS_CONFIG_MISSING', 'GCS_CONFIG_INVALID', 'GCS_CREDENTIAL_MISSING', 'GCS_CREDENTIAL_INVALID',
      'GCS_READ_PERMISSION_REQUIRED', 'GCS_REMOTE_READ_FAILED', 'GCS_OBJECT_MISSING',
      'CORPUS_RELEASE_POINTER_MISSING'
    ]);
    if (mode === 'required' || !degradable.has(error.code)) throw error;
    const local = await inspectLocalStateWithRetry(null, options);
    console.warn(`CORPUS_BOOTSTRAP_SKIPPED reason=${error.code} local=${local.state}`);
    return { status: 'DEGRADED', reason: error.code, local: local.state };
  }
}

async function main() {
  const command = process.argv[2];
  if (command === 'inspect') return inspectCorpus();
  if (command === 'publish') return publishCorpus();
  if (command === 'restore') return restoreCorpus();
  if (command === 'verify') return verifyCorpus();
  if (command === 'bootstrap') return bootstrapCorpus();
  throw releaseError('CORPUS_COMMAND_INVALID', 'Use inspect, publish, restore, verify or bootstrap.');
}

if (require.main === module) {
  main().catch((error) => {
    const candidate = error.cleanupCandidate ? ` cleanupCandidate=${error.cleanupCandidate}` : '';
    console.error(`${error.code || 'CORPUS_FAILED'}: ${redacted(error.message)}${candidate}`);
    process.exit(1);
  });
}

module.exports = {
  bootstrapCorpus,
  buildReleaseManifest,
  countTableRows,
  downloadAndVerifyRelease,
  inspectCorpus,
  publishCorpus,
  restoreCorpus,
  sourceFingerprint,
  stageFromLegacyBundle,
  verifyCorpus,
  verifyDownloadedArtifact,
  verifyObjectMetadata
};
