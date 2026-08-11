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
  isDegradableRemoteReadFailure,
  markCorpusFailure,
  normalizeRemoteReadError
} = require('./lib/corpus-bootstrap-errors');
const {
  POINTER_SCHEMA_VERSION,
  RELEASE_SCHEMA_VERSION,
  assertPublishableDocuments,
  buildReleaseManifest,
  loadBundleDocuments,
  loadCloudConfig,
  manifestObjectKey,
  readPointer,
  releaseIdFromFingerprint,
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
const MIME_TYPES = Object.freeze({
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  TXT: 'text/plain'
});
const LOCAL_RELEASE_STATE_SCHEMA_VERSION = '1.0.0';
const SHA256 = /^[0-9a-f]{64}$/i;

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function sourceFingerprint({
  documents, inventory, expectedCounts, compatibility,
  mysqlContentSha256, qdrantContentSha256
}) {
  const value = canonicalJson({
    ...(mysqlContentSha256 ? { mysqlContentSha256 } : {}),
    ...(qdrantContentSha256 ? { qdrantContentSha256 } : {}),
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
      else if (char === "'" && value[index + 1] === "'") index += 1;
      else if (char === "'") quoted = false;
      continue;
    }
    if (char === "'") {
      if (depth === 0) throw releaseError('CORPUS_MYSQL_DUMP_INVALID', 'Invalid SQL tuple syntax.');
      quoted = true;
    } else if (char === '(') {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0 && start >= 0) tuples.push(value.slice(start, index));
      if (depth < 0) throw releaseError('CORPUS_MYSQL_DUMP_INVALID', 'Invalid SQL tuple syntax.');
    } else if (depth === 0 && char !== ',' && !/\s/.test(char)) {
      throw releaseError('CORPUS_MYSQL_DUMP_INVALID', 'Invalid SQL tuple syntax.');
    }
  }
  if (quoted || escaped || depth !== 0 || tuples.length === 0) {
    throw releaseError('CORPUS_MYSQL_DUMP_INVALID', 'Invalid SQL tuple syntax.');
  }
  return tuples;
}

function splitSqlStatements(sql) {
  const statements = [];
  let quoted = false;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === "'" && sql[index + 1] === "'") index += 1;
      else if (char === "'") quoted = false;
      continue;
    }
    if (char === "'") quoted = true;
    else if (char === ';') {
      statements.push({ text: sql.slice(start, index), terminated: true });
      start = index + 1;
    }
  }
  if (quoted || escaped) {
    throw releaseError('CORPUS_MYSQL_DUMP_INVALID', 'Unterminated SQL string literal.');
  }
  const remainder = sql.slice(start);
  if (remainder.trim()) statements.push({ text: remainder, terminated: false });
  return statements;
}

function countTableRows(sql, table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(
    '^\\s*INSERT\\s+INTO\\s+`?' + escaped + '`?\\s+VALUES\\s*',
    'i'
  );
  let count = 0;
  for (const statement of splitSqlStatements(sql)) {
    const match = expression.exec(statement.text);
    if (!match) continue;
    if (!statement.terminated) {
      throw releaseError('CORPUS_MYSQL_DUMP_INVALID', 'Unterminated SQL INSERT statement.');
    }
    count += splitSqlTuples(statement.text.slice(match[0].length)).length;
  }
  return count;
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

async function stageOriginalFile(volume, document, targetFile) {
  await volume.copyOut(document.localStorageKey, targetFile);
  const [stat, checksum] = await Promise.all([fsp.stat(targetFile), sha256File(targetFile)]);
  if (stat.size !== document.sizeBytes || checksum !== document.sha256) {
    throw releaseError(
      'CORPUS_ORIGINAL_SOURCE_MISMATCH',
      `Original ${document.documentId} does not match its database checksum/size.`
    );
  }
  return { stat, checksum };
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
  assertPublishableDocuments(documents);
  if (documents.size !== Number(legacy.documentCount)) {
    throw releaseError('CORPUS_DOCUMENT_COUNT_MISMATCH', 'MySQL document rows do not match the staged corpus manifest.');
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
    const { stat, checksum } = await stageOriginalFile(volume, document, file);
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
  const mysqlContentSha256 = String(inventory.mysqlContentSha256
    || sha256Buffer(Buffer.from(sql, 'utf8'))).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(mysqlContentSha256)) {
    throw releaseError('CORPUS_INVENTORY_INVALID', 'Staged MySQL content identity is invalid.');
  }
  const qdrantContentSha256 = String(inventory.qdrantContentSha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(qdrantContentSha256)) {
    throw releaseError('CORPUS_INVENTORY_INVALID', 'Staged Qdrant content identity is missing or invalid.');
  }
  const fingerprint = sourceFingerprint({
    documents, inventory, expectedCounts, compatibility,
    mysqlContentSha256, qdrantContentSha256
  });
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
  return {
    temporary,
    manifest,
    files,
    generatedLegacy: Boolean(options.generatedLegacy),
    publishDocuments: [...documents.values()].map((document) => ({
      documentId: document.documentId,
      title: document.title,
      originalFilename: document.originalFilename,
      processingStatus: document.processingStatus,
      visibilityStatus: document.visibilityStatus,
      sha256: document.sha256,
      sizeBytes: document.sizeBytes
    }))
  };
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

function localReleaseState(manifest, pointer) {
  if (!pointer || pointer.releaseId !== manifest.releaseId
    || !SHA256.test(String(pointer.manifestSha256 || ''))) {
    throw releaseError(
      'CORPUS_RELEASE_STATE_INVALID',
      'A verified selected-release pointer is required before recording local corpus state.'
    );
  }
  return {
    stateSchemaVersion: LOCAL_RELEASE_STATE_SCHEMA_VERSION,
    releaseId: manifest.releaseId,
    manifestSha256: pointer.manifestSha256,
    sourceFingerprint: manifest.sourceFingerprint,
    contentIdentityVersion: manifest.contentIdentityVersion,
    compatibility: manifest.compatibility,
    expectedCounts: manifest.expectedCounts,
    documents: manifest.artifacts.documents.map((document) => ({
      documentId: String(document.documentId),
      localStorageKey: document.localStorageKey,
      sha256: document.sha256,
      sizeBytes: Number(document.sizeBytes)
    }))
  };
}

function manifestFromLocalReleaseState(state, pointer, options = {}) {
  if (!state || state.stateSchemaVersion !== LOCAL_RELEASE_STATE_SCHEMA_VERSION
    || typeof state.releaseId !== 'string'
    || !SHA256.test(String(state.manifestSha256 || ''))
    || !SHA256.test(String(state.sourceFingerprint || ''))
    || !state.compatibility || !state.expectedCounts || !Array.isArray(state.documents)) {
    throw releaseError('CORPUS_RELEASE_STATE_INVALID', 'Local corpus release-state marker is invalid.');
  }
  if (options.requireSelected !== false && (!pointer || state.releaseId !== pointer.releaseId
    || state.manifestSha256 !== pointer.manifestSha256)) {
    throw releaseError(
      'CORPUS_EXISTING_STATE_MISMATCH',
      'Local corpus release-state marker differs from bootstrap/corpus-release.json.'
    );
  }
  return {
    releaseId: state.releaseId,
    sourceFingerprint: state.sourceFingerprint,
    contentIdentityVersion: state.contentIdentityVersion,
    compatibility: state.compatibility,
    expectedCounts: state.expectedCounts,
    artifacts: {
      documents: state.documents.map((document) => ({
        kind: 'document',
        documentId: String(document.documentId),
        localStorageKey: document.localStorageKey,
        sha256: document.sha256,
        sizeBytes: Number(document.sizeBytes)
      }))
    }
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

async function downloadRemoteManifest({ config, objectStore, pointer, directory, setPhase = () => {} }) {
  const file = path.join(directory, 'manifest.json');
  const key = manifestObjectKey(config, pointer.releaseId);
  setPhase('REMOTE_READ');
  await objectStore.download(key, file);
  setPhase('VERIFY');
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
  let phase = 'REMOTE_READ';
  let temporary = options.temporaryDirectory || null;
  const ownsTemporary = !options.temporaryDirectory;
  try {
    const config = options.config || loadCloudConfig(options);
    const objectStore = options.objectStore || defaultObjectStore(config);
    const pointer = options.pointer || await readPointer(options);
    if (!pointer) throw releaseError('CORPUS_RELEASE_POINTER_MISSING', 'bootstrap/corpus-release.json is missing.');
    phase = 'STAGE';
    temporary = temporary || await (options.createTemporaryDirectory || fsp.mkdtemp)(
      path.join(os.tmpdir(), 'edurag-corpus-release-download-')
    );
    const setPhase = (value) => { phase = value; };
    const remote = await downloadRemoteManifest({
      config, objectStore, pointer, directory: temporary, setPhase
    });
    const files = new Map();
    let index = 0;
    for (const artifact of releaseArtifacts(remote.manifest)) {
      phase = 'REMOTE_READ';
      const metadata = await objectStore.metadata(artifact.objectKey);
      phase = 'VERIFY';
      verifyObjectMetadata(metadata, artifact, remote.manifest);
      const file = path.join(temporary, `artifact-${index}`);
      index += 1;
      phase = 'REMOTE_READ';
      await objectStore.download(artifact.objectKey, file);
      phase = 'VERIFY';
      await verifyDownloadedArtifact(file, artifact);
      files.set(artifact.objectKey, file);
    }
    return { ...remote, files, temporary, ownsTemporary, config, objectStore, pointer };
  } catch (error) {
    if (ownsTemporary && temporary) {
      try {
        await (options.removeTemporaryDirectory || fsp.rm)(temporary, { recursive: true, force: true });
      } catch (_cleanupError) {
        throw markCorpusFailure(releaseError(
          'CORPUS_TEMP_CLEANUP_FAILED',
          'The temporary remote corpus staging directory could not be removed safely.'
        ), { phase: 'FINALIZE', localMutationStarted: false, rollbackConfirmed: false });
      }
    }
    const normalized = phase === 'REMOTE_READ' ? normalizeRemoteReadError(error) : error;
    throw markCorpusFailure(normalized, {
      phase, localMutationStarted: false, rollbackConfirmed: false
    });
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
  // A publish always stages the current quiescent runtime. Reusing a leftover
  // ignored bundle could silently publish stale data after an interrupted run.
  await runtime.exportCorpus({
    quiet: true,
    reviewConfirmed: options.confirmReviewed === true
  });
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-corpus-release-stage-'));
  try {
    return await stageFromLegacyBundle({
      ...options,
      config,
      generatedLegacy: true,
      temporaryDirectory
    });
  } catch (error) {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(LEGACY_BUNDLE_DIRECTORY, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function validatePublishIntent(options = {}) {
  const dryRun = options.dryRun === true;
  const confirmReviewed = options.confirmReviewed === true;
  if (dryRun && confirmReviewed) {
    throw releaseError(
      'CORPUS_PUBLISH_OPTIONS_INVALID',
      '--dry-run and --confirm-reviewed are mutually exclusive; review the plan before publishing.'
    );
  }
  if (!dryRun && !confirmReviewed) {
    throw releaseError(
      'CORPUS_REVIEW_CONFIRMATION_REQUIRED',
      'Publishing requires the exact --confirm-reviewed flag after reviewing the dry-run plan.'
    );
  }
  return { dryRun, confirmReviewed };
}

function buildPublishPlan(staged, config, currentPointer) {
  const documentArtifacts = staged.manifest.artifacts?.documents || [];
  return {
    status: 'CORPUS_PUBLISH_READY',
    mutation: false,
    identity: staged.provisional ? 'PROVISIONAL_UNTIL_FROZEN_EXPORT' : 'FINAL',
    publicationPolicy: 'PRIVATE_INTERNAL',
    containsAccountData: true,
    publicDistribution: 'FORBIDDEN',
    currentReleaseId: currentPointer?.releaseId || null,
    proposedReleaseId: staged.manifest.releaseId,
    targetPrefix: staged.manifest.objectPrefix,
    documents: (staged.publishDocuments || documentArtifacts.map((document) => ({
      documentId: document.documentId,
      originalFilename: document.originalFilename,
      processingStatus: 'READY',
      visibilityStatus: 'UNKNOWN',
      sha256: document.sha256,
      sizeBytes: document.sizeBytes
    }))).map((document) => ({
      ...document,
      title: safePlanText(document.title),
      originalFilename: safePlanText(document.originalFilename)
    })),
    expectedCounts: staged.manifest.expectedCounts,
    artifactCount: staged.manifest.artifacts
      ? releaseArtifacts(staged.manifest).length + 1
      : documentArtifacts.length + 3,
    reviewRequired: [
      'PII_OR_PERSONAL_DATA',
      'CREDENTIAL_OR_SECRET',
      'SHARING_RIGHTS',
      'PROJECT_SCOPE'
    ],
    bucket: config.bucket
  };
}

function installWriterSignalGuard(pausedWriters, resumeWriters) {
  if (!pausedWriters.length) return () => {};
  const handlers = new Map();
  for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    const handler = () => {
      try { resumeWriters(pausedWriters); } finally {
        console.error(`CORPUS_PUBLISH_INTERRUPTED signal=${signal} writers=RESUMED`);
        process.exit(exitCode);
      }
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return () => handlers.forEach((handler, signal) => process.removeListener(signal, handler));
}

async function inspectReadOnlyPublishSource(options, config) {
  const local = await (options.publishPreflight || inspectPublishSource)({
    ...options,
    manageDataServices: false
  });
  const reconciled = await (options.reconcileRuntime || runtime.reconcileRuntime)({ withVectors: true });
  if (!reconciled.qdrant.exists || reconciled.points.length === 0) {
    throw releaseError('CORPUS_EMPTY', 'No Qdrant points are available for a corpus release.');
  }
  const mysqlExport = await (options.createScopedMysqlExport || runtime.createScopedMysqlExport)();
  const sql = mysqlExport.dump;
  runtime.assertSafeMysqlDump(sql);
  await (options.assertSanitizedSource || runtime.assertSanitizedSource)(reconciled.points, {
    reviewConfirmed: false
  });
  const documents = new Map((options.documentRows || runtime.documentInventory()).map((document) => [
    String(document.documentId),
    {
      ...document,
      documentId: String(document.documentId),
      sha256: String(document.sha256 || '').toLowerCase(),
      sizeBytes: Number(document.sizeBytes)
    }
  ]));
  assertPublishableDocuments(documents);
  const inventory = {
    activeDocuments: [...new Set(reconciled.chunks.map((chunk) => String(chunk.documentId)))],
    chunks: reconciled.chunks.map((chunk) => ({
      documentId: String(chunk.documentId),
      vectorNodeId: chunk.vectorNodeId,
      contentHash: chunk.contentHash,
      hidden: chunk.visibilityStatus === 'HIDDEN'
    })),
    qdrantContentSha256: runtime.qdrantContentSha256(reconciled.points)
  };
  const expectedCounts = {
    documents: Number(reconciled.stats.documents),
    processingJobs: Number(reconciled.stats.jobs),
    chunks: Number(reconciled.stats.chunks),
    citations: Number(reconciled.stats.citations),
    qdrantPoints: reconciled.points.length
  };
  const compatibility = {
    databaseSchemaVersion: '1.0.0',
    mysqlServerVersion: String(reconciled.stats.mysqlVersion),
    qdrantServerVersion: String(reconciled.qdrant.serverVersion),
    qdrantCollectionName: reconciled.qdrant.collectionName,
    embeddingModel: String(process.env.GEMINI_EMBEDDING_MODEL || 'models/gemini-embedding-001')
      .replace(/^models\//, ''),
    embeddingDimension: Number(process.env.EMBEDDING_DIMENSION || 768),
    pipelineVersion: reconciled.stats.pipelineVersion || null
  };
  const fingerprint = sourceFingerprint({
    documents,
    inventory,
    expectedCounts,
    compatibility,
    mysqlContentSha256: mysqlExport.contentSha256,
    qdrantContentSha256: inventory.qdrantContentSha256
  });
  const releaseId = releaseIdFromFingerprint(fingerprint);
  return {
    provisional: true,
    manifest: {
      releaseId,
      sourceFingerprint: fingerprint,
      objectPrefix: `${config.objectPrefix}/releases/${releaseId}`,
      expectedCounts,
      artifacts: { documents: [...documents.values()] }
    },
    publishDocuments: local.documents
  };
}

function safePlanText(value) {
  const text = redacted(String(value || '').replace(/[\r\n\t]+/g, ' ')).slice(0, 255);
  const sensitive = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    /AIza[0-9A-Za-z_-]{20,}/,
    /\b(?:sk|ghp|github_pat)-?[0-9A-Za-z_-]{16,}\b/i,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    /Bearer\s+[0-9A-Za-z._~-]{12,}/i,
    /(?:GOOGLE_API_KEY|LLAMA_CLOUD_API_KEY|RAG_INTERNAL_TOKEN|INTERNAL_SECRET)\s*=/i
  ];
  return sensitive.some((pattern) => pattern.test(text)) ? '[REDACTED]' : text;
}

async function inspectPublishSource(options = {}) {
  const manageServices = options.manageDataServices !== false && !options.databaseStats;
  const initiallyRunning = manageServices ? servicesRunning() : new Set();
  if (manageServices) await runtime.ensureDataServices();
  try {
    const stats = await (options.databaseStats || runtime.databaseStats)();
    const rows = await (options.documentInventory || runtime.documentInventory)();
    const volume = options.volumeStore || new DockerUploadVolume();
    const documents = [];
    const blockers = [];

    if (Number(stats.activeJobs || 0) > 0) blockers.push('CORPUS_ACTIVE_JOBS');
    for (const raw of rows) {
      const document = {
        ...raw,
        documentId: String(raw.documentId),
        sha256: String(raw.sha256 || '').toLowerCase(),
        sizeBytes: Number(raw.sizeBytes)
      };
      let eligibility = 'READY';
      try {
        assertPublishableDocuments(new Map([[document.documentId, document]]));
      } catch (error) {
        eligibility = error.code || 'CORPUS_DOCUMENT_NOT_PUBLISHABLE';
        blockers.push(`${eligibility}:${document.documentId}`);
      }

      let original = 'NOT_CHECKED';
      if (eligibility === 'READY') {
        const current = await volume.stat(document.localStorageKey);
        if (!current.exists) {
          original = 'MISSING';
          blockers.push(`CORPUS_ORIGINAL_SOURCE_MISSING:${document.documentId}`);
        } else if (current.sha256 !== document.sha256 || current.sizeBytes !== document.sizeBytes) {
          original = 'MISMATCH';
          blockers.push(`CORPUS_ORIGINAL_SOURCE_MISMATCH:${document.documentId}`);
        } else original = 'VERIFIED';
      }
      documents.push({
        documentId: document.documentId,
        title: safePlanText(document.title),
        originalFilename: safePlanText(document.originalFilename),
        processingStatus: document.processingStatus,
        visibilityStatus: document.visibilityStatus,
        sha256: document.sha256,
        sizeBytes: document.sizeBytes,
        eligibility,
        original
      });
    }
    if (documents.length === 0) blockers.push('CORPUS_EMPTY');

    const result = {
      status: blockers.length ? 'CORPUS_PUBLISH_PLAN_BLOCKED' : 'CORPUS_PUBLISH_LOCAL_READY',
      mutation: false,
      documents,
      blockers: [...new Set(blockers)]
    };
    if (blockers.length) {
      console.log(JSON.stringify(result));
      const error = releaseError('CORPUS_PUBLISH_PLAN_BLOCKED', 'Local corpus does not satisfy publish requirements.');
      error.plan = result;
      throw error;
    }
    return result;
  } finally {
    if (manageServices) {
      const newlyStarted = ['db', 'qdrant'].filter((service) => !initiallyRunning.has(service));
      if (newlyStarted.length) compose(['stop', ...newlyStarted], { allowFailure: true });
    }
  }
}

async function publishCorpus(options = {}) {
  const intent = validatePublishIntent(options);
  const config = options.config || loadCloudConfig(options);
  if (intent.dryRun) {
    const planned = await (options.planSource
      || (options.stageSource ? options.stageSource : inspectReadOnlyPublishSource))(options, config);
    const objectStore = options.objectStore || defaultObjectStore(config);
    if (typeof objectStore.assertPrivateTarget !== 'function') {
      throw releaseError(
        'GCS_BUCKET_PRIVACY_UNVERIFIED',
        'Corpus dry-run requires a read-only private-target verification.'
      );
    }
    await objectStore.assertPrivateTarget();
    const currentPointer = options.pointer === undefined ? await readPointer(options) : options.pointer;
    const plan = buildPublishPlan(planned, config, currentPointer);
    console.log(JSON.stringify(plan));
    return plan;
  }
  if (!options.stageSource || options.publishPreflight) {
    await (options.publishPreflight || inspectPublishSource)(options);
  }
  const manageWriterLifecycle = options.manageWriterLifecycle ?? !options.stageSource;
  const pausedWriters = manageWriterLifecycle
    ? await (options.freezeWriters || runtime.freezeWriters)()
    : [];
  const resumeWriterServices = options.resumeWriters || runtime.resumeWriters;
  const removeSignalGuard = installWriterSignalGuard(pausedWriters, resumeWriterServices);
  let staged = null;
  let uploaded = 0;
  let skipped = 0;
  try {
    staged = await (options.stageSource || stagePublishSource)(options, config);
    const currentPointer = options.pointer === undefined ? await readPointer(options) : options.pointer;
    console.warn(
      'CORPUS_REVIEW_CONFIRMED scope=PRIVATE_INTERNAL '
      + 'operator=PII+SECRETS+SHARING_RIGHTS+PROJECT_SCOPE'
    );
    const objectStore = options.objectStore || defaultObjectStore(config);
    const verifyRelease = options.downloadRelease || downloadAndVerifyRelease;
    if (typeof objectStore.assertPrivateTarget === 'function') {
      await objectStore.assertPrivateTarget();
    } else if (!options.objectStore) {
      throw releaseError('GCS_BUCKET_PRIVACY_UNVERIFIED', 'The GCS transport cannot verify bucket privacy.');
    }
    if (currentPointer) {
      const current = await verifyRelease({ ...options, config, objectStore, pointer: currentPointer });
      try {
        if (current.manifest.releaseId === staged.manifest.releaseId
          && current.manifest.sourceFingerprint === staged.manifest.sourceFingerprint) {
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
    // Verify the complete immutable package before changing the repository
    // pointer. A failed verification leaves the previously selected release.
    const verified = await verifyRelease({ ...options, config, objectStore, pointer });
    if (verified.ownsTemporary) await fsp.rm(verified.temporary, { recursive: true, force: true });
    await (options.writePointer || writePointer)(pointer, options);
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
    removeSignalGuard();
    if (staged?.temporary) await fsp.rm(staged.temporary, { recursive: true, force: true }).catch(() => {});
    if (staged?.generatedLegacy) {
      await fsp.rm(LEGACY_BUNDLE_DIRECTORY, { recursive: true, force: true }).catch(() => {});
    }
    if (manageWriterLifecycle) {
      await resumeWriterServices(pausedWriters);
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

function runtimeFingerprint(reconciled, documents, manifest, mysqlContentSha256 = null) {
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
  if (manifest.contentIdentityVersion === '2') {
    inventory.qdrantContentSha256 = runtime.qdrantContentSha256(reconciled.points);
  }
  return sourceFingerprint({
    documents,
    inventory,
    expectedCounts,
    compatibility: manifest.compatibility,
    mysqlContentSha256: manifest.contentIdentityVersion === '2' ? mysqlContentSha256 : null,
    qdrantContentSha256: manifest.contentIdentityVersion === '2'
      ? inventory.qdrantContentSha256
      : null
  });
}

async function inspectLocalState(manifest) {
  const reconciled = await runtime.reconcileRuntime({ withVectors: manifest?.contentIdentityVersion === '2' });
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
  const mysqlContentSha256 = manifest.contentIdentityVersion === '2'
    ? runtime.createScopedMysqlExport().contentSha256
    : null;
  const fingerprint = runtimeFingerprint(reconciled, documents, manifest, mysqlContentSha256);
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

function classifyBootstrapState(stats, qdrant, uploads) {
  if (!stats || !qdrant || !uploads || typeof uploads.empty !== 'boolean') {
    return {
      state: 'UNKNOWN',
      stores: { mysql: 'UNKNOWN', qdrant: 'UNKNOWN', uploads: 'UNKNOWN' },
      reason: 'CORPUS_LOCAL_STATE_UNKNOWN'
    };
  }
  const empty = runtime.bootstrapEmpty(stats, qdrant);
  const activeJobs = Number(stats.activeJobs || 0);
  const inProgressDocuments = Number(stats.inProgressDocuments || 0);
  const readyDocuments = Number(stats.readyDocuments || 0);
  const activeChunks = Number(stats.activeChunks || 0);
  const qdrantPoints = Number(qdrant.pointCount || 0);

  const stores = {
    mysql: empty.mysqlEmpty ? 'EMPTY' : 'PRESENT',
    qdrant: empty.qdrantEmpty ? 'EMPTY' : 'PRESENT',
    uploads: uploads.empty ? 'EMPTY' : 'PRESENT'
  };
  if (Object.values(stores).every((state) => state === 'EMPTY')) {
    return {
      state: 'EMPTY', stores, activeJobs, uploads: uploads.fileCount || 0, partial: false,
      releaseState: uploads.releaseState || null
    };
  }
  const inProgress = activeJobs > 0 || inProgressDocuments > 0;
  const partial = new Set(Object.values(stores)).size > 1
    || (stores.mysql === 'PRESENT' && stores.qdrant === 'PRESENT' && activeJobs === 0
      && (activeChunks !== qdrantPoints || Number(stats.documents || 0) === 0));
  return {
    state: 'PRESENT',
    stores,
    activeJobs,
    uploads: uploads.fileCount || 0,
    inProgress,
    partial,
    exactRelease: 'NOT_CHECKED',
    releaseState: uploads.releaseState || null,
    diagnostics: {
      readyDocuments,
      activeChunks,
      qdrantPoints
    }
  };
}

async function inspectBootstrapState(options = {}) {
  const stats = await (options.databaseStats || runtime.databaseStats)();
  const qdrant = await (options.qdrantInfo || runtime.qdrantRuntimeInfo)();
  const volume = options.volumeStore || new DockerUploadVolume();
  const uploads = await (options.inspectUploads
    ? options.inspectUploads()
    : volume.inspectPresence());
  return classifyBootstrapState(stats, qdrant, uploads);
}

async function inspectOriginalsState(manifest, options = {}) {
  const volume = options.volumeStore || new DockerUploadVolume();
  const documents = manifest.artifacts.documents;
  let present = 0;
  for (const document of documents) {
    const current = await volume.stat(document.localStorageKey);
    if (!current.exists) continue;
    present += 1;
    if (current.sha256 !== document.sha256 || Number(current.sizeBytes) !== Number(document.sizeBytes)) {
      throw releaseError(
        'CORPUS_ORIGINAL_LOCAL_MISMATCH',
        'A local original differs from the selected release.'
      );
    }
  }
  if (present === 0) return { state: 'EMPTY', present, expected: documents.length };
  if (present !== documents.length) {
    throw releaseError(
      'CORPUS_PARTIAL_STATE',
      'Only part of the selected release original-file inventory exists locally.'
    );
  }
  return { state: 'COMPATIBLE', present, expected: documents.length };
}

async function verifyLocalSelectedRelease(manifest, options = {}) {
  const structured = await inspectLocalStateWithRetry(manifest, options);
  const originals = await (options.inspectOriginals || inspectOriginalsState)(manifest, options);
  if (structured.state !== 'COMPATIBLE' || originals.state !== 'COMPATIBLE') {
    throw releaseError(
      'CORPUS_EXISTING_STATE_MISMATCH',
      'Local MySQL, Qdrant and originals do not all match the selected release.'
    );
  }
  return { structured, originals };
}

async function inspectBootstrapStateWithRetry(options = {}) {
  const inspect = options.inspectBootstrap || inspectBootstrapState;
  const attempts = Number(options.localInspectAttempts || 10);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await inspect(options);
    } catch (error) {
      lastError = error;
      if (!['CORPUS_DOCKER_COMMAND_FAILED', 'CORPUS_MYSQL_INSPECT_FAILED', 'CORPUS_QDRANT_REQUEST_FAILED',
        'CORPUS_UPLOAD_STATE_UNKNOWN'].includes(error.code) || attempt === attempts) throw error;
      await delay(Math.min(250 * attempt, 1500));
    }
  }
  throw lastError;
}

function localStateUnknown(error, message) {
  const sourceCode = error.code || 'CORPUS_LOCAL_STATE_ERROR';
  const detail = safePlanText(error.message);
  const wrapped = releaseError(
    'CORPUS_LOCAL_STATE_UNKNOWN',
    `${message} (${sourceCode}${detail ? `: ${detail}` : ''}).`
  );
  Object.assign(wrapped, {
    cause: error,
    corpusPhase: 'LOCAL_INSPECT',
    method: error.method,
    target: error.target,
    qdrantPhase: error.qdrantPhase,
    causeCode: error.causeCode,
    causeSummary: error.causeSummary,
    status: error.status,
    responseBody: error.responseBody
  });
  return wrapped;
}

function validateOptionalCloudConfiguration(options = {}) {
  const environment = options.environment || process.env;
  const names = ['GCS_PROJECT_ID', 'GCS_BUCKET', 'GCS_OBJECT_PREFIX', 'GCS_CREDENTIALS_FILE'];
  const present = names.filter((name) => String(environment[name] || '').trim()).length;
  if (present === 0) return { state: 'NOT_CONFIGURED' };
  if (present !== names.length) {
    throw releaseError(
      'GCS_CONFIG_INVALID',
      'GCS configuration is partial; configure all required fields or remove all of them for local-only auto mode.'
    );
  }
  loadCloudConfig({ ...options, environment });
  return { state: 'CONFIGURED' };
}

async function restoreOriginals(downloaded, options = {}) {
  const volume = options.volumeStore || new DockerUploadVolume();
  let restored = 0;
  let skipped = 0;
  let targetVolume = null;
  const applied = [];
  try {
    for (const document of downloaded.manifest.artifacts.documents) {
      const result = await volume.putAtomic(downloaded.files.get(document.objectKey), document.localStorageKey, document);
      restored += result.restored ? 1 : 0;
      skipped += result.skipped ? 1 : 0;
      targetVolume = result.volumeName || targetVolume;
      if (result.restored) applied.push(document);
    }
  } catch (error) {
    try {
      for (const document of applied.reverse()) {
        await volume.removeExact(document.localStorageKey, document);
      }
    } catch (_rollbackError) {
      throw releaseError(
        'CORPUS_RESTORE_ROLLBACK_FAILED',
        'Original restore failed and exact rollback could not be completed safely.'
      );
    }
    throw error;
  }
  let rolledBack = false;
  const rollbackOriginals = async () => {
    if (rolledBack) return;
    for (const document of [...applied].reverse()) {
      await volume.removeExact(document.localStorageKey, document);
    }
    rolledBack = true;
  };
  return {
    restored,
    skipped,
    targetVolume: targetVolume || 'resolved-upload-volume',
    rollbackOriginals
  };
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
  let phase = 'REMOTE_READ';
  let localMutationStarted = false;
  let rollbackConfirmed = false;
  let downloaded;
  try {
    downloaded = await (options.downloadRelease || downloadAndVerifyRelease)(options);
  } catch (error) {
    if (error?.corpusPhase) throw error;
    const normalized = normalizeRemoteReadError(error);
    throw markCorpusFailure(normalized, { phase, localMutationStarted, rollbackConfirmed });
  }
  const manageWriterLifecycle = options.manageWriterLifecycle ?? !options.restoreStructured;
  let pausedWriters = [];
  let structuredState = null;
  let originalsState = null;
  let removeSignalGuard = () => {};
  try {
    phase = 'STAGE';
    await (options.ensureDataServices || runtime.ensureDataServices)();
    if (manageWriterLifecycle) {
      pausedWriters = await (options.freezeWriters || runtime.freezeWriters)();
      removeSignalGuard = installWriterSignalGuard(
        pausedWriters,
        options.resumeWriters || runtime.resumeWriters
      );
    }
    const volume = options.volumeStore || new DockerUploadVolume();
    const scopedOptions = { ...options, volumeStore: volume };
    const uploadPresence = await (options.inspectUploads
      ? options.inspectUploads()
      : volume.inspectPresence());
    if (uploadPresence.releaseState) {
      const recorded = manifestFromLocalReleaseState(
        uploadPresence.releaseState,
        downloaded.pointer || options.pointer
      );
      if (recorded.sourceFingerprint !== downloaded.manifest.sourceFingerprint) {
        throw releaseError(
          'CORPUS_EXISTING_STATE_MISMATCH',
          'Local release-state marker does not match the downloaded selected manifest.'
        );
      }
    }
    const inspect = (manifest) => inspectLocalStateWithRetry(manifest, scopedOptions);
    const local = await inspect(downloaded.manifest);
    const originalsBefore = await (options.inspectOriginals || inspectOriginalsState)(
      downloaded.manifest,
      scopedOptions
    );
    let structuredRestored = false;
    if (local.state === 'EMPTY') {
      if (uploadPresence.releaseState || !uploadPresence.empty || originalsBefore.state !== 'EMPTY') {
        throw releaseError(
          'CORPUS_PARTIAL_STATE',
          'Structured stores are empty but upload storage or its release marker is not empty.'
        );
      }
      phase = 'APPLY';
      localMutationStarted = true;
      if (options.restoreStructured) {
        structuredState = await options.restoreStructured(downloaded);
      } else {
        const bundleDirectory = await writeLegacyRestoreBundle(downloaded);
        structuredState = await runtime.restoreCorpus({
          bundleDirectory, writersAlreadyStopped: true, quiet: true, retainRecovery: true
        });
      }
      structuredRestored = true;
    } else if (local.state !== 'COMPATIBLE' || originalsBefore.state !== 'COMPATIBLE') {
      throw releaseError(
        'CORPUS_EXISTING_STATE_MISMATCH',
        'Local MySQL, Qdrant and originals do not all match the selected release.'
      );
    }
    phase = 'FINALIZE';
    if (structuredRestored) {
      originalsState = await (options.restoreOriginals || restoreOriginals)(
        downloaded,
        { ...scopedOptions, retainRecovery: true }
      );
    } else {
      originalsState = {
        restored: 0,
        skipped: originalsBefore.present,
        targetVolume: 'resolved-upload-volume',
        rollbackOriginals: async () => {}
      };
    }
    const verified = await verifyLocalSelectedRelease(downloaded.manifest, scopedOptions);
    const counts = assertExpectedCounts(verified.structured.reconciled, downloaded.manifest);
    const state = localReleaseState(downloaded.manifest, downloaded.pointer || options.pointer);
    const writeState = options.writeReleaseState
      || ((value) => volume.writeReleaseState(value));
    await writeState(state);
    const result = {
      status: structuredRestored ? 'CORPUS_RESTORE_OK' : 'CORPUS_ALREADY_RESTORED',
      releaseId: downloaded.manifest.releaseId,
      mysql: structuredRestored ? 1 : 0,
      qdrant: structuredRestored ? 1 : 0,
      originalsRestored: originalsState.restored,
      originalsSkipped: originalsState.skipped,
      targetVolume: originalsState.targetVolume,
      counts,
      checksumVerified: true,
      releaseState: 'VERIFIED'
    };
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    if (localMutationStarted) {
      phase = 'ROLLBACK';
      try {
        if (typeof originalsState?.rollbackOriginals === 'function') {
          await originalsState.rollbackOriginals();
        }
        if (typeof structuredState?.rollbackRestore === 'function') {
          await structuredState.rollbackRestore();
        }
        rollbackConfirmed = true;
      } catch (_rollbackError) {
        throw markCorpusFailure(releaseError(
          'CORPUS_RESTORE_ROLLBACK_FAILED',
          'Cloud restore failed and the previous empty state could not be recovered safely.'
        ), { phase: 'ROLLBACK', localMutationStarted, rollbackConfirmed: false });
      }
    }
    throw markCorpusFailure(error, { phase, localMutationStarted, rollbackConfirmed });
  } finally {
    removeSignalGuard();
    if (manageWriterLifecycle) {
      await (options.resumeWriters || runtime.resumeWriters)(pausedWriters);
    }
    if (downloaded.ownsTemporary) await fsp.rm(downloaded.temporary, { recursive: true, force: true });
  }
}

function servicesRunning() {
  const services = String(compose(['ps', '--status', 'running', '--services'], { allowFailure: true }) || '')
    .split(/\r?\n/).filter(Boolean);
  return new Set(services);
}

async function inspectCorpus(options = {}) {
  const pointer = await (options.readPointer || readPointer)(options);
  const running = (options.servicesRunning || servicesRunning)();
  let local = 'NOT_RUNNING';
  if (running.has('db') && running.has('qdrant')) {
    const state = await (options.inspectLocalState || inspectLocalState)(null);
    local = state.state;
  }
  const result = {
    status: 'CORPUS_INSPECT_OK',
    mutation: false,
    mode: 'LOCAL_ONLY',
    releaseId: pointer?.releaseId || null,
    pointer: pointer ? 'PRESENT' : 'MISSING',
    legacyRepositoryBundle: await fsp.access(path.join(LEGACY_BUNDLE_DIRECTORY, 'manifest.json'))
      .then(() => 'PRESENT').catch(() => 'ABSENT'),
    credential: 'NOT_READ',
    remote: pointer ? 'NOT_CHECKED_LOCAL_ONLY' : 'NO_POINTER',
    local
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
  let initialLocal = null;
  if (mode === 'auto') {
    if (!options.inspectBootstrap) {
      await (options.ensureDataServices || runtime.ensureDataServices)();
    }
    let local;
    try {
      local = await inspectBootstrapStateWithRetry(options);
    } catch (error) {
      throw localStateUnknown(error, 'Local corpus state could not be verified');
    }
    if (local.state === 'UNKNOWN') {
      throw releaseError('CORPUS_LOCAL_STATE_UNKNOWN', 'Local corpus state could not be verified as empty.');
    }
    initialLocal = local;
    if (local.state === 'EMPTY' && local.releaseState) {
      throw releaseError(
        'CORPUS_RELEASE_STATE_STALE',
        'Local release-state marker exists while all corpus stores are empty.'
      );
    }
    if (local.state !== 'EMPTY' && local.partial) {
      throw releaseError(
        'CORPUS_PARTIAL_STATE',
        'Local MySQL, originals and Qdrant are not a complete consistent set.'
      );
    }
    if (local.state !== 'EMPTY' && (local.inProgress || Number(local.activeJobs || 0) > 0)) {
      throw releaseError(
        'CORPUS_LOCAL_STATE_BUSY',
        'Local corpus has in-progress processing and cannot be treated as a selected-release no-op.'
      );
    }
    if (local.state !== 'EMPTY' && local.releaseState) {
      const pointer = options.pointer || await (options.readPointer || readPointer)(options);
      if (!pointer) {
        throw releaseError(
          'CORPUS_RELEASE_POINTER_MISSING',
          'bootstrap/corpus-release.json is required to verify local corpus state.'
        );
      }
      const selectedMatches = local.releaseState.releaseId === pointer.releaseId
        && local.releaseState.manifestSha256 === pointer.manifestSha256;
      const differentRelease = local.releaseState.releaseId !== pointer.releaseId;
      const manifest = manifestFromLocalReleaseState(
        local.releaseState,
        pointer,
        { requireSelected: !differentRelease }
      );
      const verified = await (options.verifyMarkedLocalRelease || verifyLocalSelectedRelease)(
        manifest,
        options
      );
      const counts = assertExpectedCounts(verified.structured.reconciled, manifest);
      const result = {
        status: selectedMatches ? 'CORPUS_ALREADY_RESTORED' : 'CORPUS_LOCAL_RELEASE_RETAINED',
        releaseId: manifest.releaseId,
        selectedReleaseId: pointer.releaseId,
        local: 'COMPATIBLE',
        originals: 'COMPATIBLE',
        counts,
        checksumVerified: true,
        releaseState: 'VERIFIED'
      };
      if (!selectedMatches) {
        console.warn(
          `CORPUS_LOCAL_PRESENT mode=auto action=RETAIN_VALID_LOCAL_RELEASE `
          + `localRelease=${manifest.releaseId} selectedRelease=${pointer.releaseId}`
        );
      }
      console.log(JSON.stringify(result));
      return result;
    }
    if (local.state !== 'EMPTY') {
      console.log('CORPUS_LOCAL_PRESENT mode=auto action=VERIFY_SELECTED_RELEASE');
    } else {
      let cloud;
      try {
        cloud = validateOptionalCloudConfiguration(options);
      } catch (error) {
        if (!['GCS_CONFIG_MISSING', 'GCS_CONFIG_INVALID', 'GCS_CREDENTIAL_MISSING', 'GCS_CREDENTIAL_INVALID']
          .includes(error.code)) throw error;
        console.warn(`CORPUS_BOOTSTRAP_SKIPPED reason=${error.code} local=EMPTY`);
        return { status: 'DEGRADED', code: error.code, reason: error.code, local: 'EMPTY', phase: 'REMOTE_READ' };
      }
      if (cloud.state === 'NOT_CONFIGURED') {
        console.warn('CORPUS_BOOTSTRAP_SKIPPED reason=GCS_CONFIG_MISSING local=EMPTY');
        return {
          status: 'DEGRADED', code: 'GCS_CONFIG_MISSING', reason: 'GCS_CONFIG_MISSING',
          local: 'EMPTY', phase: 'REMOTE_READ'
        };
      }
      console.log('CORPUS_LOCAL_EMPTY mode=auto action=RESTORE_SELECTED_RELEASE');
    }
  }
  try {
    return await (options.restore || restoreCorpus)(options);
  } catch (error) {
    if (mode === 'required' || initialLocal?.state !== 'EMPTY'
      || !isDegradableRemoteReadFailure(error)) throw error;
    let local;
    try {
      local = await inspectBootstrapStateWithRetry(options);
    } catch (inspectError) {
      throw localStateUnknown(
        inspectError,
        'Local corpus state could not be re-confirmed after the remote-read failure'
      );
    }
    if (local.state === 'UNKNOWN') {
      throw releaseError(
        'CORPUS_LOCAL_STATE_UNKNOWN',
        'Local corpus state could not be re-confirmed as empty after the remote-read failure.'
      );
    }
    if (local.state !== 'EMPTY') {
      throw releaseError(
        'CORPUS_LOCAL_STATE_CHANGED',
        'Local corpus state changed during remote bootstrap; empty-state fallback is unsafe.'
      );
    }
    console.warn(`CORPUS_BOOTSTRAP_SKIPPED reason=${error.code} local=${local.state}`);
    return {
      status: 'DEGRADED', code: error.code, reason: error.code,
      local: local.state, phase: error.corpusPhase
    };
  }
}

function parseCommandLine(argv = process.argv.slice(2)) {
  const [command, ...flags] = argv;
  if (!['inspect', 'publish', 'restore', 'verify', 'bootstrap'].includes(command)) {
    throw releaseError('CORPUS_COMMAND_INVALID', 'Use inspect, publish, restore, verify or bootstrap.');
  }
  if (command !== 'publish' && flags.length > 0) {
    throw releaseError('CORPUS_OPTION_INVALID', `${command} does not accept command-line options.`);
  }
  const allowed = new Set(['--dry-run', '--confirm-reviewed']);
  if (flags.some((flag) => !allowed.has(flag)) || new Set(flags).size !== flags.length) {
    throw releaseError(
      'CORPUS_OPTION_INVALID',
      'Publish accepts each exact flag at most once: --dry-run or --confirm-reviewed.'
    );
  }
  return {
    command,
    dryRun: flags.includes('--dry-run'),
    confirmReviewed: flags.includes('--confirm-reviewed')
  };
}

async function main() {
  const parsed = parseCommandLine();
  const { command } = parsed;
  if (command === 'inspect') return inspectCorpus();
  if (command === 'publish') return publishCorpus(parsed);
  if (command === 'restore') return restoreCorpus();
  if (command === 'verify') return verifyCorpus();
  if (command === 'bootstrap') return bootstrapCorpus();
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
  buildPublishPlan,
  classifyBootstrapState,
  countTableRows,
  downloadAndVerifyRelease,
  inspectCorpus,
  inspectBootstrapState,
  inspectOriginalsState,
  localReleaseState,
  manifestFromLocalReleaseState,
  inspectReadOnlyPublishSource,
  installWriterSignalGuard,
  inspectPublishSource,
  parseCommandLine,
  publishCorpus,
  restoreOriginals,
  restoreCorpus,
  sourceFingerprint,
  stageFromLegacyBundle,
  stageOriginalFile,
  validatePublishIntent,
  validateOptionalCloudConfiguration,
  verifyLocalSelectedRelease,
  verifyCorpus,
  verifyDownloadedArtifact,
  verifyObjectMetadata
};
