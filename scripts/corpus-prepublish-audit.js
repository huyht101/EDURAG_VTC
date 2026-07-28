'use strict';

const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');

const { downloadAndVerifyRelease } = require('./corpus-manager');
const documentFiles = require('../src/services/document-file-service');

const SUPPORTED = Object.freeze({
  '.pdf': { fileType: 'PDF', mimeType: 'application/pdf' },
  '.docx': {
    fileType: 'DOCX',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  },
  '.txt': { fileType: 'TXT', mimeType: 'text/plain' }
});

function hash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizedFilename(value) {
  return path.basename(String(value || '')).normalize('NFKC').trim().toLocaleLowerCase('en');
}

function nearDuplicateKey(value) {
  const extension = path.extname(value).toLocaleLowerCase('en');
  const stem = path.basename(value, extension).normalize('NFKC').toLocaleLowerCase('en')
    .replace(/\s+/g, ' ').trim()
    .replace(/(?:[\s_-]+(?:copy|backup)|\s*\(\d+\)|[\s_-]+v?\d+)$/u, '');
  return `${stem}${extension}`;
}

function publicFinding(severity, code, documentId = null) {
  return { severity, code, ...(documentId === null ? {} : { documentId: String(documentId) }) };
}

function suspiciousSecret(buffer) {
  const ascii = buffer.toString('latin1');
  return [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bAIza[0-9A-Za-z_-]{30,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bBearer\s+[0-9A-Za-z._~-]{12,}/i,
    /\b(?:password|passwd|otp|api[_ -]?key|secret|cloud[_ -]?credential|reset[_ -]?token|access[_ -]?token|refresh[_ -]?token|authorization)\s*[:=]\s*\S{4,}/i
  ].some((pattern) => pattern.test(ascii));
}

function lowQualityText(buffer) {
  const value = buffer.toString('utf8');
  const visible = value.replace(/\s/g, '');
  if (visible.length < 20) return 'NEAR_EMPTY_TEXT';
  const controls = [...value].filter((character) => {
    const code = character.codePointAt(0);
    return code < 32 && !['\n', '\r', '\t'].includes(character);
  }).length;
  if (controls / Math.max(1, value.length) > 0.01) return 'CONTROL_CHARACTER_RATIO';
  return null;
}

async function auditDownloadedRelease(downloaded, options = {}) {
  const manifest = downloaded.manifest;
  const documents = manifest.artifacts.documents;
  const environment = options.environment || process.env;
  const findings = [];
  const types = { PDF: 0, DOCX: 0, TXT: 0 };
  const hashes = new Map();
  const names = new Map();
  const nearNames = new Map();
  let totalBytes = 0;
  let mechanicallyValid = 0;
  let extractionChecked = 0;

  for (const document of documents) {
    const documentId = String(document.documentId);
    const file = downloaded.files.get(document.objectKey);
    const extension = path.extname(document.originalFilename).toLocaleLowerCase('en');
    const supported = SUPPORTED[extension];
    if (!file || !supported) {
      findings.push(publicFinding('BLOCKER', file ? 'UNSUPPORTED_EXTENSION' : 'ARTIFACT_NOT_DOWNLOADED', documentId));
      continue;
    }

    const buffer = await fsp.readFile(file);
    totalBytes += buffer.length;
    types[supported.fileType] += 1;
    if (buffer.length === 0 || buffer.length !== Number(document.sizeBytes)
      || hash(buffer) !== String(document.sha256).toLocaleLowerCase('en')) {
      findings.push(publicFinding('BLOCKER', 'SIZE_OR_CHECKSUM_MISMATCH', documentId));
      continue;
    }

    try {
      const metadata = documentFiles.validate({
        buffer,
        originalname: document.originalFilename,
        mimetype: document.mimeType,
        size: buffer.length
      });
      if (metadata.fileType !== supported.fileType || document.mimeType !== supported.mimeType) {
        findings.push(publicFinding('BLOCKER', 'TYPE_OR_MIME_MISMATCH', documentId));
        continue;
      }
      if (metadata.fileType === 'PDF') await documentFiles.countPdfPages(buffer);
      if (metadata.fileType === 'TXT') {
        extractionChecked += 1;
        const quality = lowQualityText(buffer);
        if (quality) findings.push(publicFinding('WARNING', quality, documentId));
      }
      mechanicallyValid += 1;
    } catch (_error) {
      findings.push(publicFinding('BLOCKER', 'UNREADABLE_OR_INVALID_DOCUMENT', documentId));
      continue;
    }

    if (suspiciousSecret(buffer)) {
      findings.push(publicFinding('BLOCKER', 'POTENTIAL_SECRET', documentId));
    }
    for (const [map, key, code] of [
      [hashes, document.sha256, 'DUPLICATE_CONTENT'],
      [names, normalizedFilename(document.originalFilename), 'DUPLICATE_FILENAME'],
      [nearNames, nearDuplicateKey(document.originalFilename), 'NEAR_DUPLICATE_FILENAME']
    ]) {
      if (map.has(key)) findings.push(publicFinding('WARNING', code, documentId));
      else map.set(key, documentId);
    }
  }

  const documentIds = new Set(documents.map((document) => String(document.documentId)));
  for (const chunk of manifest.inventory.chunks) {
    if (!documentIds.has(String(chunk.documentId))) {
      findings.push(publicFinding('BLOCKER', 'ORPHAN_VECTOR_DOCUMENT_MAPPING', chunk.documentId));
    }
  }
  for (const documentId of manifest.inventory.activeDocuments) {
    if (!documentIds.has(String(documentId))) {
      findings.push(publicFinding('BLOCKER', 'ORPHAN_ACTIVE_DOCUMENT', documentId));
    }
  }

  if (manifest.sanitization?.secretAndPathScan !== 'passed') {
    findings.push(publicFinding('BLOCKER', 'RELEASE_SANITIZATION_NOT_PASSED'));
  }
  const approved = environment.CORPUS_APPROVED_BUNDLE_CONFIRMED === 'true'
    && String(environment.CORPUS_APPROVED_RELEASE_ID || '') === manifest.releaseId;
  if (!approved) {
    findings.push(publicFinding('WARNING', 'APPROVAL_AND_PROVENANCE_REQUIRE_OWNER_CONFIRMATION'));
  }
  if (types.PDF > 0) findings.push(publicFinding('WARNING', 'PDF_TEXT_AND_SCAN_ONLY_DETECTION_NOT_AVAILABLE'));
  if (types.DOCX > 0) findings.push(publicFinding('WARNING', 'DOCX_TEXT_EXTRACTION_NOT_AVAILABLE'));

  let bucketInventory = {
    selectedObjects: null,
    expectedObjects: documents.length + 3,
    unexpectedObjects: null,
    releaseVersions: null
  };
  if (typeof downloaded.objectStore?.list === 'function') {
    const selected = await downloaded.objectStore.list(manifest.objectPrefix);
    const expectedKeys = new Set([
      downloaded.key,
      manifest.artifacts.mysql.objectKey,
      manifest.artifacts.qdrant.objectKey,
      ...documents.map((document) => document.objectKey)
    ]);
    const selectedKeys = new Set(selected.map((object) => object.objectKey));
    const missing = [...expectedKeys].filter((key) => !selectedKeys.has(key));
    const unexpected = [...selectedKeys].filter((key) => !expectedKeys.has(key));
    if (missing.length) findings.push(publicFinding('BLOCKER', 'BUCKET_SELECTED_RELEASE_OBJECT_MISSING'));
    if (unexpected.length) findings.push(publicFinding('BLOCKER', 'BUCKET_SELECTED_RELEASE_HAS_UNEXPECTED_OBJECT'));
    const allReleases = await downloaded.objectStore.list(`${downloaded.config.objectPrefix}/releases`);
    const releasePrefix = `${downloaded.config.objectPrefix}/releases/`;
    const releaseVersions = new Set(allReleases.map((object) =>
      object.objectKey.slice(releasePrefix.length).split('/', 1)[0]).filter(Boolean));
    bucketInventory = {
      selectedObjects: selectedKeys.size,
      expectedObjects: expectedKeys.size,
      unexpectedObjects: unexpected.length,
      releaseVersions: releaseVersions.size
    };
  } else {
    findings.push(publicFinding('WARNING', 'OUTSIDE_MANIFEST_OBJECT_LIST_NOT_VERIFIED'));
  }

  const blockers = findings.filter((finding) => finding.severity === 'BLOCKER').length;
  return {
    status: blockers === 0 ? 'CORPUS_PREPUBLISH_AUDIT_CONDITIONAL' : 'CORPUS_PREPUBLISH_AUDIT_BLOCKED',
    mutation: false,
    releaseId: manifest.releaseId,
    inventory: {
      documents: documents.length,
      byType: types,
      totalBytes,
      manifestArtifacts: documents.length + 2,
      checksumCoverage: `${documents.length}/${documents.length}`,
      mechanicalValidationCoverage: `${mechanicallyValid}/${documents.length}`,
      textExtractionCoverage: `${extractionChecked}/${documents.length}`,
      qdrantPoints: Number(manifest.expectedCounts.qdrantPoints),
      bucket: bucketInventory
    },
    distribution: {
      access: 'PRIVATE',
      containsAccountData: true,
      publicDistribution: 'FORBIDDEN'
    },
    findings
  };
}

async function main() {
  const downloaded = await downloadAndVerifyRelease();
  try {
    const result = await auditDownloadedRelease(downloaded);
    console.log(JSON.stringify(result));
    if (result.status === 'CORPUS_PREPUBLISH_AUDIT_BLOCKED') process.exitCode = 1;
  } finally {
    if (downloaded.ownsTemporary) {
      await fsp.rm(downloaded.temporary, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${error.code || 'CORPUS_PREPUBLISH_AUDIT_FAILED'}: corpus audit could not complete`);
    process.exit(1);
  });
}

module.exports = { auditDownloadedRelease, nearDuplicateKey, normalizedFilename };
