'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ORIGINAL_FILES_RELATIVE = 'original-files.json';
const ORIGINAL_FILES_MANIFEST_VERSION = '1.0.0';
const SHA256 = /^[0-9a-f]{64}$/;

function originalFilesError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeObjectPrefix(value) {
  const prefix = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  const segments = prefix.split('/');
  if (!prefix || segments.some((segment) => !segment || segment === '.' || segment === '..'
    || !/^[A-Za-z0-9._-]+$/.test(segment))) {
    throw originalFilesError('GCS_CONFIG_INVALID', 'GCS_OBJECT_PREFIX is invalid.');
  }
  return prefix;
}

function validateBucket(value) {
  const bucket = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw originalFilesError('GCS_CONFIG_INVALID', 'GCS_BUCKET is invalid.');
  }
  return bucket;
}

function validateLocalStorageKey(value) {
  const key = String(value || '').replace(/\\/g, '/');
  const segments = key.split('/');
  if (!key || path.posix.isAbsolute(key) || /^[A-Za-z]:\//.test(key)
    || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw originalFilesError('CORPUS_FILES_STORAGE_KEY_INVALID', 'localStorageKey is invalid.');
  }
  return key;
}

function safeOriginalFilename(value, storageKey) {
  const fallback = path.posix.basename(validateLocalStorageKey(storageKey));
  const basename = path.posix.basename(String(value || '').replace(/\\/g, '/')).trim() || fallback;
  const extension = path.posix.extname(basename).toLowerCase();
  const stem = basename.slice(0, basename.length - extension.length)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'document';
  const safeExtension = /^\.(?:pdf|docx|txt)$/.test(extension)
    ? extension
    : path.posix.extname(fallback).toLowerCase();
  if (!/^\.(?:pdf|docx|txt)$/.test(safeExtension)) {
    throw originalFilesError('CORPUS_FILES_FILENAME_INVALID', 'Original filename extension is unsupported.');
  }
  return `${stem}${safeExtension}`;
}

function immutableObjectKey(prefix, documentId, sha256, filename) {
  return `${normalizeObjectPrefix(prefix)}/documents/${documentId}/${sha256}/${filename}`;
}

function parseSqlScalar(raw) {
  const value = raw.trim();
  if (value === 'NULL') return null;
  if (!value.startsWith("'") || !value.endsWith("'")) return value;
  return value.slice(1, -1)
    .replace(/\\0/g, '\0')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
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
    } else {
      current += character;
    }
  }
  if (quoted) throw originalFilesError('CORPUS_MYSQL_DUMP_INVALID', 'Unterminated SQL string in documents dump.');
  fields.push(parseSqlScalar(current));
  return fields;
}

function splitSqlTuples(valueList) {
  const tuples = [];
  let quoted = false;
  let escaped = false;
  let depth = 0;
  let start = -1;
  for (let index = 0; index < valueList.length; index += 1) {
    const character = valueList[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === '\\') {
      escaped = true;
      continue;
    }
    if (character === "'") {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === '(') {
      if (depth === 0) start = index + 1;
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0 && start >= 0) tuples.push(valueList.slice(start, index));
      if (depth < 0) throw originalFilesError('CORPUS_MYSQL_DUMP_INVALID', 'Invalid documents tuple syntax.');
    }
  }
  if (quoted || depth !== 0) throw originalFilesError('CORPUS_MYSQL_DUMP_INVALID', 'Invalid documents tuple syntax.');
  return tuples;
}

function parseDocumentsFromDump(sql) {
  const statement = String(sql).split(/\r?\n/)
    .find((line) => line.startsWith('INSERT INTO `documents` VALUES '));
  if (!statement) return new Map();
  const valueList = statement.slice(statement.indexOf(' VALUES ') + 8).replace(/;\s*$/, '');
  const documents = new Map();
  for (const tuple of splitSqlTuples(valueList)) {
    const fields = splitSqlTuple(tuple);
    if (fields.length < 16) {
      throw originalFilesError('CORPUS_MYSQL_DUMP_INVALID', 'Documents row does not match schema 1.0.0.');
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
      throw originalFilesError('CORPUS_MYSQL_DUMP_INVALID', 'Documents dump contains invalid portable-file metadata.');
    }
    documents.set(document.documentId, document);
  }
  return documents;
}

async function loadBundleDocuments(bundleDirectory, bundleManifest) {
  const relative = bundleManifest?.files?.mysqlDump;
  if (typeof relative !== 'string' || path.isAbsolute(relative)) {
    throw originalFilesError('CORPUS_MANIFEST_INVALID', 'Corpus manifest does not identify the MySQL dump.');
  }
  const dumpPath = path.resolve(bundleDirectory, relative);
  const prefix = `${path.resolve(bundleDirectory)}${path.sep}`;
  if (!dumpPath.startsWith(prefix)) {
    throw originalFilesError('CORPUS_MANIFEST_INVALID', 'MySQL dump path escapes the corpus directory.');
  }
  return parseDocumentsFromDump(await fsp.readFile(dumpPath, 'utf8'));
}

function buildOriginalFilesManifest({ bundleFormatVersion, bucket, objectPrefix, documents, createdAtUtc }) {
  const normalizedBucket = validateBucket(bucket);
  const normalizedPrefix = normalizeObjectPrefix(objectPrefix);
  const files = [...documents.values()].sort((left, right) => Number(left.documentId) - Number(right.documentId))
    .map((document) => {
      const filename = safeOriginalFilename(document.originalFilename, document.localStorageKey);
      return {
        documentId: document.documentId,
        sha256: document.sha256,
        sizeBytes: document.sizeBytes,
        bucket: normalizedBucket,
        objectKey: immutableObjectKey(
          normalizedPrefix,
          document.documentId,
          document.sha256,
          filename
        ),
        localStorageKey: document.localStorageKey,
        originalFilename: filename,
        originalFileIncludedInGit: false
      };
    });
  return {
    manifestVersion: ORIGINAL_FILES_MANIFEST_VERSION,
    provider: 'gcs',
    bundleFormatVersion,
    createdAtUtc: createdAtUtc || new Date().toISOString(),
    bucket: normalizedBucket,
    objectPrefix: normalizedPrefix,
    originalFilesIncludedInGit: false,
    files
  };
}

function validateOriginalFilesManifest(manifest, options = {}) {
  if (!manifest || manifest.manifestVersion !== ORIGINAL_FILES_MANIFEST_VERSION
    || manifest.provider !== 'gcs' || typeof manifest.bundleFormatVersion !== 'string'
    || !Number.isFinite(Date.parse(manifest.createdAtUtc || ''))
    || manifest.originalFilesIncludedInGit !== false || !Array.isArray(manifest.files)) {
    throw originalFilesError('CORPUS_FILES_MANIFEST_INVALID', 'original-files.json header is invalid.');
  }
  const bucket = validateBucket(manifest.bucket);
  const objectPrefix = normalizeObjectPrefix(manifest.objectPrefix);
  if (options.bundleFormatVersion && manifest.bundleFormatVersion !== options.bundleFormatVersion) {
    throw originalFilesError('CORPUS_FILES_MANIFEST_INVALID', 'Original-files bundle version mismatch.');
  }
  if (options.expectedBucket && bucket !== validateBucket(options.expectedBucket)) {
    throw originalFilesError('CORPUS_FILES_CONFIG_MISMATCH', 'Manifest bucket differs from GCS_BUCKET.');
  }
  if (options.expectedObjectPrefix
    && objectPrefix !== normalizeObjectPrefix(options.expectedObjectPrefix)) {
    throw originalFilesError('CORPUS_FILES_CONFIG_MISMATCH', 'Manifest prefix differs from GCS_OBJECT_PREFIX.');
  }
  const documentIds = new Set();
  const objectKeys = new Set();
  const storageKeys = new Set();
  for (const entry of manifest.files) {
    const documentId = String(entry?.documentId || '');
    const sha256 = String(entry?.sha256 || '');
    const sizeBytes = Number(entry?.sizeBytes);
    const localStorageKey = validateLocalStorageKey(entry?.localStorageKey);
    const originalFilename = safeOriginalFilename(entry?.originalFilename, localStorageKey);
    const objectKey = String(entry?.objectKey || '');
    if (!/^\d+$/.test(documentId) || !SHA256.test(sha256)
      || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0
      || entry.bucket !== bucket || entry.originalFilename !== originalFilename
      || entry.originalFileIncludedInGit !== false
      || objectKey !== immutableObjectKey(objectPrefix, documentId, sha256, originalFilename)
      || documentIds.has(documentId) || objectKeys.has(objectKey) || storageKeys.has(localStorageKey)) {
      throw originalFilesError('CORPUS_FILES_MANIFEST_INVALID', 'Original-files mapping is invalid or duplicated.');
    }
    const document = options.documents?.get(documentId);
    if (document && (document.sha256 !== sha256 || document.sizeBytes !== sizeBytes
      || document.localStorageKey !== localStorageKey)) {
      throw originalFilesError('CORPUS_FILES_MAPPING_STALE', `Original mapping is stale for document ${documentId}.`);
    }
    if (options.documents && !document) {
      throw originalFilesError('CORPUS_FILES_MAPPING_STALE', `Original mapping references missing document ${documentId}.`);
    }
    const approval = options.approvals?.get(documentId);
    if (options.approvals && (!approval || approval.checksum !== sha256)) {
      throw originalFilesError('CORPUS_FILES_APPROVAL_REQUIRED', `Document ${documentId} lacks exact-checksum approval.`);
    }
    documentIds.add(documentId);
    objectKeys.add(objectKey);
    storageKeys.add(localStorageKey);
  }
  return manifest;
}

async function readOptionalOriginalFilesManifest(bundleDirectory) {
  const file = path.join(bundleDirectory, ORIGINAL_FILES_RELATIVE);
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw originalFilesError('CORPUS_FILES_MANIFEST_INVALID', 'Cannot parse original-files.json.');
  }
}

async function preserveOriginalFilesManifest(sourceDirectory, targetDirectory, options) {
  const manifest = await readOptionalOriginalFilesManifest(sourceDirectory);
  if (!manifest) return null;
  validateOriginalFilesManifest(manifest, options);
  await fsp.writeFile(
    path.join(targetDirectory, ORIGINAL_FILES_RELATIVE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  return manifest;
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

async function writeBundleChecksums(bundleDirectory, manifest) {
  const payloadRelatives = Object.keys(manifest.checksums || {});
  if (!payloadRelatives.includes(ORIGINAL_FILES_RELATIVE)) payloadRelatives.push(ORIGINAL_FILES_RELATIVE);
  const checksums = {};
  let payloadBytes = 0;
  for (const relative of payloadRelatives) {
    const absolute = path.resolve(bundleDirectory, relative);
    const prefix = `${path.resolve(bundleDirectory)}${path.sep}`;
    if (!absolute.startsWith(prefix)) {
      throw originalFilesError('CORPUS_MANIFEST_INVALID', 'Corpus checksum path escapes bundle directory.');
    }
    checksums[relative] = await sha256File(absolute);
    payloadBytes += (await fsp.stat(absolute)).size;
  }
  manifest.files = { ...manifest.files, originalFiles: ORIGINAL_FILES_RELATIVE };
  manifest.checksums = checksums;
  manifest.bundlePayloadBytes = payloadBytes;
  manifest.compatibilityNotes = [
    ...(manifest.compatibilityNotes || []).filter((note) => !/Original uploads are excluded/i.test(note)),
    'Original uploads are excluded from Git; exact-approved files may be restored separately from private GCS.'
  ];
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fsp.writeFile(path.join(bundleDirectory, 'manifest.json'), manifestBytes);
  const lines = [];
  for (const [relative, digest] of Object.entries(checksums)) lines.push(`${digest}  ${relative}`);
  lines.push(`${crypto.createHash('sha256').update(manifestBytes).digest('hex')}  manifest.json`);
  await fsp.writeFile(path.join(bundleDirectory, 'checksums.sha256'), `${lines.join('\n')}\n`, 'utf8');
  return manifest;
}

module.exports = {
  ORIGINAL_FILES_MANIFEST_VERSION,
  ORIGINAL_FILES_RELATIVE,
  SHA256,
  buildOriginalFilesManifest,
  immutableObjectKey,
  loadBundleDocuments,
  normalizeObjectPrefix,
  originalFilesError,
  parseDocumentsFromDump,
  preserveOriginalFilesManifest,
  readOptionalOriginalFilesManifest,
  safeOriginalFilename,
  sha256File,
  validateBucket,
  validateLocalStorageKey,
  validateOriginalFilesManifest,
  writeBundleChecksums
};
