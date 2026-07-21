'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { root } = require('../remote-test-utils');

const RELEASE_SCHEMA_VERSION = '1.0.0';
const POINTER_SCHEMA_VERSION = '1.0.0';
const DATABASE_SCHEMA_VERSION = '1.0.0';
const POINTER_FILE = path.join(root, 'bootstrap', 'corpus-release.json');
const SHA256 = /^[0-9a-f]{64}$/;
const RELEASE_ID = /^v1-[0-9a-f]{24}$/;

function releaseError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function normalizeObjectPrefix(value) {
  const normalized = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.includes('..') || normalized.includes('\\')
    || !/^[A-Za-z0-9._/-]+$/.test(normalized)) {
    throw releaseError('GCS_CONFIG_INVALID', 'GCS_OBJECT_PREFIX is invalid.');
  }
  return normalized;
}

function validateBucket(value) {
  const bucket = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw releaseError('GCS_CONFIG_INVALID', 'GCS_BUCKET is invalid.');
  }
  return bucket;
}

function validateLocalStorageKey(value) {
  const normalized = String(value || '').trim().replace(/\\/g, '/');
  if (!normalized || path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')
    || !normalized.startsWith('documents/')) {
    throw releaseError('CORPUS_STORAGE_KEY_INVALID', 'Document local storage key is invalid.');
  }
  return normalized;
}

function safeOriginalFilename(value, storageKey) {
  const extension = path.extname(storageKey).toLowerCase();
  if (!['.pdf', '.docx', '.txt'].includes(extension)) {
    throw releaseError('CORPUS_ORIGINAL_FILENAME_INVALID', 'Original filename extension is unsupported.');
  }
  const base = path.basename(String(value || ''), path.extname(String(value || '')))
    .normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'document';
  return `${base}${extension}`;
}

function parseSqlScalar(raw) {
  const value = raw.trim();
  if (value === 'NULL') return null;
  if (!value.startsWith("'") || !value.endsWith("'")) return value;
  return value.slice(1, -1)
    .replace(/\\0/g, '\0').replace(/\\n/g, '\n').replace(/\\r/g, '\r')
    .replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function splitSqlTuple(body) {
  const fields = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const character of body) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (quoted && character === '\\') {
      current += character;
      escaped = true;
    } else if (character === "'") {
      current += character;
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      fields.push(parseSqlScalar(current));
      current = '';
    } else current += character;
  }
  if (quoted) throw releaseError('CORPUS_MYSQL_DUMP_INVALID', 'Unterminated SQL string in documents dump.');
  fields.push(parseSqlScalar(current));
  return fields;
}

function splitSqlValueTuples(valueList) {
  const tuples = [];
  let quoted = false;
  let escaped = false;
  let depth = 0;
  let start = -1;
  for (let index = 0; index < valueList.length; index += 1) {
    const character = valueList[index];
    if (escaped) escaped = false;
    else if (quoted && character === '\\') escaped = true;
    else if (character === "'") quoted = !quoted;
    else if (!quoted && character === '(') {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (!quoted && character === ')') {
      depth -= 1;
      if (depth === 0 && start >= 0) tuples.push(valueList.slice(start, index));
      if (depth < 0) throw releaseError('CORPUS_MYSQL_DUMP_INVALID', 'Invalid documents tuple syntax.');
    }
  }
  if (quoted || depth !== 0) throw releaseError('CORPUS_MYSQL_DUMP_INVALID', 'Invalid documents tuple syntax.');
  return tuples;
}

function parseDocumentsFromDump(sql) {
  const statement = String(sql).split(/\r?\n/)
    .find((line) => line.startsWith('INSERT INTO `documents` VALUES '));
  if (!statement) return new Map();
  const valueList = statement.slice(statement.indexOf(' VALUES ') + 8).replace(/;\s*$/, '');
  const documents = new Map();
  for (const tuple of splitSqlValueTuples(valueList)) {
    const fields = splitSqlTuple(tuple);
    if (fields.length < 16) {
      throw releaseError('CORPUS_MYSQL_DUMP_INVALID', 'Documents row does not match schema 1.0.0.');
    }
    const document = {
      documentId: String(fields[0]),
      originalFilename: String(fields[3]),
      storageType: String(fields[4]),
      localStorageKey: validateLocalStorageKey(fields[5]),
      fileType: String(fields[6]),
      mimeType: String(fields[7]),
      sizeBytes: Number(fields[8]),
      sha256: String(fields[9]).toLowerCase()
    };
    if (!/^\d+$/.test(document.documentId) || document.storageType !== 'LOCAL'
      || !Number.isSafeInteger(document.sizeBytes) || document.sizeBytes <= 0
      || !SHA256.test(document.sha256) || documents.has(document.documentId)) {
      throw releaseError('CORPUS_MYSQL_DUMP_INVALID', 'Documents dump contains invalid portable-file metadata.');
    }
    documents.set(document.documentId, document);
  }
  return documents;
}

async function loadBundleDocuments(bundleDirectory, bundleManifest) {
  const relative = bundleManifest?.files?.mysqlDump;
  if (typeof relative !== 'string' || path.isAbsolute(relative)) {
    throw releaseError('CORPUS_RELEASE_MANIFEST_INVALID', 'Corpus source does not identify the MySQL dump.');
  }
  const dumpPath = path.resolve(bundleDirectory, relative);
  if (!dumpPath.startsWith(`${path.resolve(bundleDirectory)}${path.sep}`)) {
    throw releaseError('CORPUS_RELEASE_MANIFEST_INVALID', 'MySQL dump path escapes the staging directory.');
  }
  return parseDocumentsFromDump(await fsp.readFile(dumpPath, 'utf8'));
}

function resolveCredentialsFile(rootDirectory, value) {
  const configured = String(value || '').trim();
  if (!configured || path.isAbsolute(configured)) {
    throw releaseError('GCS_CONFIG_INVALID', 'GCS_CREDENTIALS_FILE must be repository-relative.');
  }
  const resolved = path.resolve(rootDirectory, configured);
  const secretsDirectory = path.resolve(rootDirectory, 'secrets');
  if (!resolved.startsWith(`${secretsDirectory}${path.sep}`)) {
    throw releaseError('GCS_CONFIG_INVALID', 'GCS_CREDENTIALS_FILE must stay under secrets/.');
  }
  return resolved;
}

function credentialState(credentialsFile) {
  if (!credentialsFile || !fs.existsSync(credentialsFile)) return 'MISSING';
  try {
    const value = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
    if (value?.type !== 'service_account' || typeof value.client_email !== 'string'
      || typeof value.private_key !== 'string' || !value.private_key.includes('PRIVATE KEY')) {
      return 'INVALID';
    }
    return 'AVAILABLE';
  } catch (_error) {
    return 'INVALID';
  }
}

function loadCloudConfig(options = {}) {
  const environment = options.environment || process.env;
  const rootDirectory = options.rootDirectory || root;
  const required = ['GCS_PROJECT_ID', 'GCS_BUCKET', 'GCS_OBJECT_PREFIX', 'GCS_CREDENTIALS_FILE'];
  const missing = required.filter((name) => !String(environment[name] || '').trim());
  if (missing.length) {
    throw releaseError('GCS_CONFIG_MISSING', `Missing GCS configuration: ${missing.join(', ')}.`);
  }
  const projectId = String(environment.GCS_PROJECT_ID).trim();
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) {
    throw releaseError('GCS_CONFIG_INVALID', 'GCS_PROJECT_ID is invalid.');
  }
  return {
    projectId,
    bucket: validateBucket(environment.GCS_BUCKET),
    objectPrefix: normalizeObjectPrefix(environment.GCS_OBJECT_PREFIX),
    credentialsFile: resolveCredentialsFile(rootDirectory, environment.GCS_CREDENTIALS_FILE)
  };
}

function requireCredential(config) {
  const state = credentialState(config.credentialsFile);
  if (state === 'MISSING') throw releaseError('GCS_CREDENTIAL_MISSING', 'GCS credential file is missing.');
  if (state !== 'AVAILABLE') throw releaseError('GCS_CREDENTIAL_INVALID', 'GCS credential file is invalid.');
}

function releasePrefix(config, releaseId) {
  if (!RELEASE_ID.test(String(releaseId || ''))) {
    throw releaseError('CORPUS_RELEASE_ID_INVALID', 'Cloud corpus release ID is invalid.');
  }
  return `${config.objectPrefix}/releases/${releaseId}`;
}

function validateObjectKey(objectKey, expectedPrefix) {
  const value = String(objectKey || '');
  if (!value.startsWith(`${expectedPrefix}/`) || value.includes('..') || value.includes('\\')
    || !/^[A-Za-z0-9._/-]+$/.test(value)) {
    throw releaseError('CORPUS_RELEASE_OBJECT_KEY_INVALID', 'Release object key escapes the configured release prefix.');
  }
  return value;
}

function normalizeArtifact(artifact, kind) {
  const sha256 = String(artifact?.sha256 || '').toLowerCase();
  const sizeBytes = Number(artifact?.sizeBytes);
  if (!SHA256.test(sha256) || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw releaseError('CORPUS_RELEASE_MANIFEST_INVALID', `${kind} checksum or size is invalid.`);
  }
  return { ...artifact, kind, sha256, sizeBytes };
}

function deriveReleaseId(input) {
  const stable = {
    mysql: { sha256: input.mysql.sha256, sizeBytes: input.mysql.sizeBytes },
    qdrant: { sha256: input.qdrant.sha256, sizeBytes: input.qdrant.sizeBytes },
    documents: input.documents.map((entry) => ({
      documentId: String(entry.documentId), sha256: entry.sha256, sizeBytes: entry.sizeBytes,
      localStorageKey: entry.localStorageKey
    })).sort((a, b) => a.documentId.localeCompare(b.documentId)),
    compatibility: input.compatibility,
    expectedCounts: input.expectedCounts,
    sourceFingerprint: input.sourceFingerprint
  };
  return `v1-${sha256Buffer(Buffer.from(JSON.stringify(stable))).slice(0, 24)}`;
}

function buildReleaseManifest(input) {
  const mysql = normalizeArtifact(input.mysql, 'mysql');
  const qdrant = normalizeArtifact(input.qdrant, 'qdrant');
  const documents = input.documents.map((entry) => normalizeArtifact({
    ...entry,
    documentId: String(entry.documentId),
    localStorageKey: validateLocalStorageKey(entry.localStorageKey),
    originalFilename: safeOriginalFilename(entry.originalFilename, entry.localStorageKey)
  }, 'document'));
  const releaseId = deriveReleaseId({ ...input, mysql, qdrant, documents });
  const prefix = releasePrefix(input.config, releaseId);
  const manifest = {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    releaseId,
    createdAtUtc: input.createdAtUtc || new Date().toISOString(),
    provider: 'gcs',
    bucket: input.config.bucket,
    objectPrefix: prefix,
    sourceFingerprint: input.sourceFingerprint,
    compatibility: input.compatibility,
    expectedCounts: input.expectedCounts,
    inventory: input.inventory,
    artifacts: {
      mysql: {
        ...mysql,
        objectKey: `${prefix}/mysql/corpus.sql.gz`,
        format: 'mysql-logical-sql',
        compression: 'gzip'
      },
      qdrant: {
        ...qdrant,
        objectKey: `${prefix}/qdrant/${input.compatibility.qdrantCollectionName}.snapshot`,
        collection: input.compatibility.qdrantCollectionName,
        vectorDimension: input.compatibility.embeddingDimension
      },
      documents: documents.map((entry) => ({
        ...entry,
        objectKey: `${prefix}/documents/${entry.documentId}/${entry.sha256}/${entry.originalFilename}`
      }))
    },
    sanitization: input.sanitization
  };
  validateReleaseManifest(manifest, input.config);
  return manifest;
}

function validateReleaseManifest(manifest, config) {
  if (!manifest || manifest.schemaVersion !== RELEASE_SCHEMA_VERSION || manifest.provider !== 'gcs'
    || !RELEASE_ID.test(String(manifest.releaseId || ''))
    || !Number.isFinite(Date.parse(manifest.createdAtUtc || ''))
    || !SHA256.test(String(manifest.sourceFingerprint || ''))
    || manifest.bucket !== config.bucket
    || manifest.objectPrefix !== releasePrefix(config, manifest.releaseId)) {
    throw releaseError('CORPUS_RELEASE_MANIFEST_INVALID', 'Cloud corpus manifest header is invalid.');
  }
  const compatibility = manifest.compatibility || {};
  if (compatibility.databaseSchemaVersion !== DATABASE_SCHEMA_VERSION
    || !String(compatibility.mysqlServerVersion || '').startsWith('8.4.')
    || compatibility.qdrantServerVersion !== '1.18.2'
    || compatibility.qdrantCollectionName !== 'education_docs'
    || compatibility.embeddingModel !== 'gemini-embedding-001'
    || Number(compatibility.embeddingDimension) !== 768) {
    throw releaseError('CORPUS_RELEASE_INCOMPATIBLE', 'Cloud corpus compatibility metadata is unsupported.');
  }
  const countNames = ['documents', 'processingJobs', 'chunks', 'citations', 'qdrantPoints'];
  if (countNames.some((name) => !Number.isSafeInteger(Number(manifest.expectedCounts?.[name]))
    || Number(manifest.expectedCounts[name]) < 0)) {
    throw releaseError('CORPUS_RELEASE_MANIFEST_INVALID', 'Cloud corpus expected counts are invalid.');
  }
  const mysql = normalizeArtifact(manifest.artifacts?.mysql, 'mysql');
  const qdrant = normalizeArtifact(manifest.artifacts?.qdrant, 'qdrant');
  if (mysql.format !== 'mysql-logical-sql' || mysql.compression !== 'gzip'
    || qdrant.collection !== compatibility.qdrantCollectionName
    || Number(qdrant.vectorDimension) !== Number(compatibility.embeddingDimension)) {
    throw releaseError('CORPUS_RELEASE_MANIFEST_INVALID', 'Structured artifact metadata is invalid.');
  }
  const expectedPrefix = manifest.objectPrefix;
  validateObjectKey(mysql.objectKey, expectedPrefix);
  validateObjectKey(qdrant.objectKey, expectedPrefix);
  const documentIds = new Set();
  const objectKeys = new Set([mysql.objectKey, qdrant.objectKey]);
  const storageKeys = new Set();
  if (!Array.isArray(manifest.artifacts?.documents)) {
    throw releaseError('CORPUS_RELEASE_MANIFEST_INVALID', 'Document artifact list is invalid.');
  }
  for (const raw of manifest.artifacts.documents) {
    const entry = normalizeArtifact(raw, 'document');
    const documentId = String(entry.documentId || '');
    const storageKey = validateLocalStorageKey(entry.localStorageKey);
    if (!/^\d+$/.test(documentId) || documentIds.has(documentId) || storageKeys.has(storageKey)
      || objectKeys.has(entry.objectKey) || safeOriginalFilename(entry.originalFilename, storageKey) !== entry.originalFilename) {
      throw releaseError('CORPUS_RELEASE_MANIFEST_INVALID', 'Document artifact mapping is invalid or duplicated.');
    }
    validateObjectKey(entry.objectKey, expectedPrefix);
    documentIds.add(documentId);
    storageKeys.add(storageKey);
    objectKeys.add(entry.objectKey);
  }
  if (documentIds.size !== Number(manifest.expectedCounts.documents)) {
    throw releaseError('CORPUS_RELEASE_MANIFEST_INVALID', 'Document artifact count does not match expected counts.');
  }
  if (!Array.isArray(manifest.inventory?.activeDocuments) || !Array.isArray(manifest.inventory?.chunks)
    || manifest.inventory.chunks.length !== Number(manifest.expectedCounts.qdrantPoints)
    || Number(manifest.expectedCounts.chunks) < manifest.inventory.chunks.length) {
    throw releaseError('CORPUS_RELEASE_MANIFEST_INVALID', 'Cloud corpus inventory count is invalid.');
  }
  const vectorIds = new Set();
  for (const chunk of manifest.inventory.chunks) {
    if (!/^\d+$/.test(String(chunk.documentId || ''))
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(chunk.vectorNodeId || ''))
      || !SHA256.test(String(chunk.contentHash || '').toLowerCase())
      || typeof chunk.hidden !== 'boolean' || vectorIds.has(String(chunk.vectorNodeId))) {
      throw releaseError('CORPUS_RELEASE_MANIFEST_INVALID', 'Cloud corpus chunk inventory is invalid.');
    }
    vectorIds.add(String(chunk.vectorNodeId));
  }
  return manifest;
}

function manifestObjectKey(config, releaseId) {
  return `${releasePrefix(config, releaseId)}/manifest.json`;
}

function validatePointer(pointer) {
  if (!pointer || pointer.pointerSchemaVersion !== POINTER_SCHEMA_VERSION
    || !RELEASE_ID.test(String(pointer.releaseId || ''))
    || !SHA256.test(String(pointer.manifestSha256 || ''))
    || !Number.isFinite(Date.parse(pointer.publishedAtUtc || ''))) {
    throw releaseError('CORPUS_RELEASE_POINTER_INVALID', 'bootstrap/corpus-release.json is invalid.');
  }
  return pointer;
}

async function readPointer(options = {}) {
  const file = options.pointerFile || POINTER_FILE;
  try {
    return validatePointer(JSON.parse(await fsp.readFile(file, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code) throw error;
    throw releaseError('CORPUS_RELEASE_POINTER_INVALID', 'Cannot parse bootstrap/corpus-release.json.');
  }
}

async function writePointer(pointer, options = {}) {
  const file = options.pointerFile || POINTER_FILE;
  validatePointer(pointer);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(pointer, null, 2)}\n`, { flag: 'w' });
  await fsp.rename(temporary, file);
}

module.exports = {
  DATABASE_SCHEMA_VERSION,
  POINTER_FILE,
  POINTER_SCHEMA_VERSION,
  RELEASE_SCHEMA_VERSION,
  SHA256,
  buildReleaseManifest,
  credentialState,
  loadCloudConfig,
  loadBundleDocuments,
  manifestObjectKey,
  normalizeObjectPrefix,
  parseDocumentsFromDump,
  readPointer,
  releaseError,
  releasePrefix,
  requireCredential,
  safeOriginalFilename,
  sha256Buffer,
  sha256File,
  validateBucket,
  validateLocalStorageKey,
  validatePointer,
  validateReleaseManifest,
  writePointer
};
