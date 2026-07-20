'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  root,
  compose,
  composeCommandArgs,
  composePort,
  redacted
} = require('./remote-test-utils');
const {
  ORIGINAL_FILES_RELATIVE,
  loadBundleDocuments,
  normalizeObjectPrefix,
  preserveOriginalFilesManifest,
  readOptionalOriginalFilesManifest,
  validateBucket,
  validateOriginalFilesManifest
} = require('./lib/corpus-original-files');

const BUNDLE_FORMAT_VERSION = '1.0.0';
const DATABASE_SCHEMA_VERSION = '1.0.0';
const BUNDLE_DIRECTORY = path.join(root, 'bootstrap', 'corpus');
const MANIFEST_FILE = path.join(BUNDLE_DIRECTORY, 'manifest.json');
const CHECKSUM_FILE = path.join(BUNDLE_DIRECTORY, 'checksums.sha256');
const MYSQL_DUMP_RELATIVE = 'mysql/edurag.sql';
const INVENTORY_RELATIVE = 'inventory.json';
const GIT_WARNING_BYTES = 50 * 1024 * 1024;
const GIT_HARD_LIMIT_BYTES = 100 * 1024 * 1024;
const MYSQL_SERVER_SERIES = '8.4.';
const QDRANT_SERVER_VERSION = '1.18.2';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

function corpusError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeIdentifier(value, label) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw corpusError('CORPUS_CONFIG_INVALID', `${label} contains unsupported characters.`);
  }
  return normalized;
}

function collectionName() {
  return safeIdentifier(process.env.QDRANT_COLLECTION_NAME || 'education_docs', 'QDRANT_COLLECTION_NAME');
}

function databaseName() {
  return safeIdentifier(process.env.DB_NAME || 'edurag', 'DB_NAME');
}

function embeddingModel() {
  return String(process.env.GEMINI_EMBEDDING_MODEL || 'models/gemini-embedding-001')
    .replace(/^models\//, '');
}

function embeddingDimension() {
  const dimension = Number(process.env.EMBEDDING_DIMENSION || 768);
  if (!Number.isSafeInteger(dimension) || dimension <= 0) {
    throw corpusError('CORPUS_CONFIG_INVALID', 'EMBEDDING_DIMENSION must be a positive integer.');
  }
  return dimension;
}

function dockerProcess(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: root,
    input: options.input,
    encoding: options.binary ? null : 'utf8',
    windowsHide: true,
    maxBuffer: options.maxBuffer || 512 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    const detail = redacted(result.stderr || result.stdout || result.error?.message)
      .toString().split(/\r?\n/).filter(Boolean).slice(0, 5).join(' | ');
    throw corpusError(options.code || 'CORPUS_DOCKER_COMMAND_FAILED', detail || `Docker exit ${result.status}`);
  }
  return result.stdout;
}

function mysqlCommand(tool, extraArgs = []) {
  const database = databaseName();
  const shell = [
    'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"',
    `exec ${tool} -uroot ${extraArgs.join(' ')} "${database}"`
  ].join('; ');
  return composeCommandArgs(['exec', '-T', 'db', 'sh', '-lc', shell]);
}

function mysqlInput(sql) {
  return dockerProcess(mysqlCommand('mysql', ['--batch', '--raw', '--skip-column-names']), {
    input: Buffer.from(sql, 'utf8')
  });
}

function mysqlJsonRows(sql) {
  const output = String(mysqlInput(sql)).trim();
  if (!output) return [];
  return output.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function mysqlDump(extraArgs) {
  return Buffer.from(dockerProcess(mysqlCommand('mysqldump', extraArgs), {
    binary: true,
    code: 'CORPUS_MYSQL_EXPORT_FAILED'
  }));
}

async function ensureDataServices() {
  compose(['config', '--quiet']);
  compose(['up', '-d', '--wait', 'db', 'qdrant']);
}

function runningServices() {
  const result = compose(['ps', '--status', 'running', '--services'], { allowFailure: true });
  if (typeof result !== 'string') return new Set();
  return new Set(result.split(/\r?\n/).map((item) => item.trim()).filter(Boolean));
}

function freezeWriters() {
  const running = runningServices();
  const writers = ['app', 'rag-service'].filter((service) => running.has(service));
  if (writers.length) compose(['stop', ...writers]);
  return writers;
}

function resumeWriters(services) {
  if (services.length) compose(['start', ...services]);
}

async function qdrantBaseUrl() {
  return `http://127.0.0.1:${composePort('qdrant', 6333)}`;
}

async function qdrantRequest(endpoint, options = {}) {
  const response = await fetch(`${await qdrantBaseUrl()}${endpoint}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 30000)
  });
  if (!response.ok) {
    const message = (await response.text()).split(/\r?\n/, 1)[0].slice(0, 500);
    throw corpusError(
      options.errorCode || 'CORPUS_QDRANT_REQUEST_FAILED',
      `Qdrant ${options.method || 'GET'} ${endpoint} returned ${response.status}: ${message}`
    );
  }
  return response;
}

async function qdrantRuntimeInfo() {
  const rootInfo = await (await qdrantRequest('/')).json();
  const name = collectionName();
  const response = await fetch(`${await qdrantBaseUrl()}/collections/${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(10000)
  });
  if (response.status === 404) {
    return { serverVersion: rootInfo.version, collectionName: name, exists: false, pointCount: 0 };
  }
  if (!response.ok) throw corpusError('CORPUS_QDRANT_INSPECT_FAILED', `Cannot inspect Qdrant collection (${response.status}).`);
  const payload = await response.json();
  const vectors = payload.result.config.params.vectors;
  if (!vectors || typeof vectors.size !== 'number') {
    throw corpusError('CORPUS_QDRANT_CONFIG_UNSUPPORTED', 'Portable corpus requires one unnamed dense vector configuration.');
  }
  return {
    serverVersion: rootInfo.version,
    collectionName: name,
    exists: true,
    pointCount: Number(payload.result.points_count || 0),
    vectorSize: Number(vectors.size),
    distance: vectors.distance
  };
}

async function scrollQdrantPoints() {
  const name = encodeURIComponent(collectionName());
  const points = [];
  let offset = null;
  do {
    const response = await qdrantRequest(`/collections/${name}/points/scroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        limit: 256,
        with_payload: true,
        with_vector: false,
        ...(offset === null ? {} : { offset })
      })
    });
    const body = await response.json();
    points.push(...(body.result?.points || []));
    offset = body.result?.next_page_offset ?? null;
  } while (offset !== null);
  return points;
}

function databaseStats() {
  const rows = mysqlJsonRows(`
    SELECT JSON_OBJECT(
      'mysqlVersion', VERSION(),
      'users', (SELECT COUNT(*) FROM users),
      'nonDemoUsers', (SELECT COUNT(*) FROM users WHERE email <> 'admin@example.com'),
      'authTokens', (SELECT COUNT(*) FROM auth_tokens),
      'documents', (SELECT COUNT(*) FROM documents),
      'jobs', (SELECT COUNT(*) FROM document_processing_jobs),
      'activeJobs', (SELECT COUNT(*) FROM document_processing_jobs WHERE status IN ('QUEUED','RUNNING')),
      'chunks', (SELECT COUNT(*) FROM document_chunks),
      'sessions', (SELECT COUNT(*) FROM chat_sessions),
      'messages', (SELECT COUNT(*) FROM chat_messages),
      'citations', (SELECT COUNT(*) FROM citations),
      'usageRows', (SELECT COUNT(*) FROM llm_usage_logs),
      'pipelineVersion', (SELECT MAX(pipeline_version) FROM document_processing_jobs)
    );
  `);
  if (rows.length !== 1) throw corpusError('CORPUS_MYSQL_INSPECT_FAILED', 'Cannot read MySQL corpus counts.');
  return rows[0];
}

function activeChunkInventory() {
  return mysqlJsonRows(`
    SELECT JSON_OBJECT(
      'documentId', dc.document_id,
      'vectorNodeId', dc.vector_node_id,
      'contentHash', dc.content_hash,
      'processingStatus', d.processing_status,
      'visibilityStatus', d.visibility_status
    )
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE d.processing_status = 'READY' AND d.visibility_status IN ('VISIBLE','HIDDEN')
    ORDER BY dc.document_id, dc.chunk_index;
  `);
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
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

async function approvedDocumentPolicy() {
  const directory = path.join(root, 'tests', 'fixtures', 'remote-e2e');
  const names = await fsp.readdir(directory);
  const fixtureHashes = new Set();
  for (const name of names) {
    const file = path.join(directory, name);
    if ((await fsp.stat(file)).isFile()) fixtureHashes.add(await sha256File(file));
  }
  const approvalFile = path.join(root, 'bootstrap', 'corpus-approved-documents.json');
  const document = JSON.parse(await fsp.readFile(approvalFile, 'utf8'));
  if (!Array.isArray(document.approvals)) {
    throw corpusError('CORPUS_APPROVAL_FILE_INVALID', 'bootstrap/corpus-approved-documents.json is invalid.');
  }
  const approvals = new Map();
  for (const approval of document.approvals) {
    const documentId = String(approval?.documentId || '');
    const checksum = String(approval?.checksum || '').toLowerCase();
    if (!/^\d+$/.test(documentId) || !SHA256.test(checksum)
      || approval.purpose !== 'demo portable corpus'
      || approval.originalFileIncluded !== false
      || approval.reviewStatus !== 'APPROVED'
      || !Number.isFinite(Date.parse(approval.reviewedAtUtc || ''))
      || approvals.has(documentId)) {
      throw corpusError('CORPUS_APPROVAL_FILE_INVALID', 'Corpus approvals must be exact, reviewed document/checksum records.');
    }
    approvals.set(documentId, { ...approval, checksum });
  }
  return { fixtureHashes, approvals };
}

function scanSensitiveText(label, value, options = {}) {
  if (value === null || value === undefined) return;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const rules = [
    ['PRIVATE_KEY', /-----BEGIN [A-Z ]*PRIVATE KEY-----/i],
    ['GOOGLE_KEY', /AIza[0-9A-Za-z_-]{20,}/],
    ['TOKEN_PREFIX', /\b(?:sk|ghp|github_pat)-?[0-9A-Za-z_-]{16,}\b/i],
    ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
    ['AWS_KEY', /\bAKIA[0-9A-Z]{16}\b/],
    ['BEARER', /Bearer\s+[0-9A-Za-z._~-]{12,}/i],
    ['SECRET_ASSIGNMENT', /(?:GOOGLE_API_KEY|LLAMA_CLOUD_API_KEY|RAG_INTERNAL_TOKEN|INTERNAL_SECRET)\s*=/i],
    ['CREDENTIAL_ASSIGNMENT', /(?:password|passwd|pwd|otp|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S{4,}/i],
    ['PHONE_NUMBER', /(?:\+84|0)(?:3|5|7|8|9)\d{8}\b/],
    ['PII_LABEL', /(?:địa chỉ|address|phone|điện thoại|cccd|cmnd)\s*[:=]\s*\S+/i],
    ['WINDOWS_PATH', options.serializedSql ? /\b[A-Za-z]:\\\\[^\s]+/ : /\b[A-Za-z]:\\[^\s]+/],
    ['FILE_URI', /file:\/\//i]
  ];
  for (const [rule, pattern] of rules) {
    if (pattern.test(text)) throw corpusError('CORPUS_SECRET_SCAN_FAILED', `${label} matched ${rule}; export aborted.`);
  }
  for (const match of text.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
    const email = match[0].toLowerCase();
    if (email !== 'admin@example.com' && !email.endsWith('@smoke.test')) {
      throw corpusError('CORPUS_PII_REVIEW_REQUIRED', `${label} contains an unapproved email; export aborted.`);
    }
  }
}

function assertNoAbsolutePayloadPaths(label, value, key = '') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoAbsolutePayloadPaths(`${label}[${index}]`, item, key));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([nestedKey, nestedValue]) => {
      assertNoAbsolutePayloadPaths(`${label}.${nestedKey}`, nestedValue, nestedKey);
    });
    return;
  }
  if (typeof value === 'string' && /(?:path|file|storage_key)/i.test(key)
    && (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.includes('..'))) {
    throw corpusError('CORPUS_ABSOLUTE_PATH_BLOCKED', `${label} contains a machine-specific path; export aborted.`);
  }
}

async function assertSanitizedSource(points = [], options = {}) {
  const requireApproval = options.requireApproval !== false;
  const users = mysqlJsonRows(`
    SELECT JSON_OBJECT('id', id, 'email', email, 'fullName', full_name,
      'phone', phone, 'passwordHash', password_hash)
    FROM users ORDER BY id;
  `);
  if (users.some((user) => user.email !== 'admin@example.com' || user.phone
    || !/^\$2[aby]\$\d{2}\$/.test(user.passwordHash || ''))) {
    throw corpusError(
      'CORPUS_PII_REVIEW_REQUIRED',
      'Only the documented demo Admin with no phone may be exported automatically.'
    );
  }
  users.forEach((user) => {
    scanSensitiveText(`users:${user.id}:email`, user.email);
    scanSensitiveText(`users:${user.id}:fullName`, user.fullName);
  });
  const authTokens = mysqlJsonRows(`
    SELECT JSON_OBJECT('id', id, 'type', token_type, 'hash', token_hash)
    FROM auth_tokens ORDER BY id;
  `);
  if (authTokens.some((token) => !SHA256.test(token.hash || ''))) {
    throw corpusError('CORPUS_SECRET_SCAN_FAILED', 'auth_tokens contains a non-hash token representation.');
  }

  const policy = await approvedDocumentPolicy();
  const documents = mysqlJsonRows(`
    SELECT JSON_OBJECT('id', id, 'title', title, 'filename', original_filename,
      'checksum', checksum_sha256, 'storageKey', storage_key)
    FROM documents ORDER BY id;
  `);
  const documentApprovals = [];
  for (const document of documents) {
    const checksum = String(document.checksum).toLowerCase();
    const exactApproval = policy.approvals.get(String(document.id));
    const approved = policy.fixtureHashes.has(checksum)
      || (exactApproval && exactApproval.checksum === checksum);
    if (requireApproval && !approved) {
      throw corpusError(
        'CORPUS_PII_REVIEW_REQUIRED',
        `documents:${document.id} is not a tracked fixture or reviewed checksum; export aborted without reading it into Git.`
      );
    }
    documentApprovals.push({
      documentId: String(document.id),
      checksum,
      approvalSource: exactApproval ? 'EXACT_REVIEW' : 'TRACKED_FIXTURE',
      reviewedAtUtc: exactApproval?.reviewedAtUtc || null,
      originalFileIncluded: false
    });
    scanSensitiveText(`documents:${document.id}:title`, document.title);
    scanSensitiveText(`documents:${document.id}:filename`, document.filename);
    if (path.isAbsolute(document.storageKey) || /^[A-Za-z]:[\\/]/.test(document.storageKey)
      || document.storageKey.split(/[\\/]/).includes('..')) {
      throw corpusError('CORPUS_ABSOLUTE_PATH_BLOCKED', `documents:${document.id} has an unsafe storage key.`);
    }
  }

  const textRows = mysqlJsonRows(`
    SELECT JSON_OBJECT('kind', 'session', 'id', id, 'value', title) FROM chat_sessions
    UNION ALL
    SELECT JSON_OBJECT('kind', 'message', 'id', id, 'value', content) FROM chat_messages
    UNION ALL
    SELECT JSON_OBJECT('kind', 'citation', 'id', id, 'value', source_text_snapshot) FROM citations
    UNION ALL
    SELECT JSON_OBJECT('kind', 'citation_title', 'id', id, 'value', document_title_snapshot) FROM citations
    UNION ALL
    SELECT JSON_OBJECT('kind', 'citation_section', 'id', id, 'value', section_title_snapshot) FROM citations
    UNION ALL
    SELECT JSON_OBJECT('kind', 'citation_locator', 'id', id, 'value', source_locator_snapshot) FROM citations
    UNION ALL
    SELECT JSON_OBJECT('kind', 'chunk', 'id', id, 'value', chunk_text) FROM document_chunks
    UNION ALL
    SELECT JSON_OBJECT('kind', 'chunk_section', 'id', id, 'value', section_title) FROM document_chunks
    UNION ALL
    SELECT JSON_OBJECT('kind', 'chunk_locator', 'id', id, 'value', source_locator) FROM document_chunks
    UNION ALL
    SELECT JSON_OBJECT('kind', 'usage_provider', 'id', id, 'value', provider) FROM llm_usage_logs
    UNION ALL
    SELECT JSON_OBJECT('kind', 'usage_model', 'id', id, 'value', model) FROM llm_usage_logs
    UNION ALL
    SELECT JSON_OBJECT('kind', 'usage_error', 'id', id, 'value', error_code) FROM llm_usage_logs
    UNION ALL
    SELECT JSON_OBJECT('kind', 'job_error', 'id', id, 'value', error_message) FROM document_processing_jobs;
  `);
  textRows.forEach((row) => scanSensitiveText(`${row.kind}:${row.id}`, row.value));
  points.forEach((point) => {
    scanSensitiveText(`qdrant:${point.id}:payload`, point.payload);
    assertNoAbsolutePayloadPaths(`qdrant:${point.id}:payload`, point.payload);
  });
  return {
    policy: 'demo-admin-and-tracked-fixtures-or-explicit-reviewed-checksums',
    authTokens: 'schema included; all auth token rows excluded',
    clientRequestIds: 'retained as random business idempotency state; not credentials',
    approvedDocumentCount: documents.length,
    documentApprovals,
    authTokenRowsExcluded: authTokens.length,
    secretAndPathScan: 'passed'
  };
}

async function reconcileRuntime() {
  const stats = databaseStats();
  const qdrant = await qdrantRuntimeInfo();
  const chunks = activeChunkInventory();
  if (!qdrant.exists && chunks.length) {
    throw corpusError('CORPUS_CROSS_STORE_MISMATCH', 'Qdrant collection is missing but MySQL has active chunks.');
  }
  if (qdrant.exists && qdrant.vectorSize !== embeddingDimension()) {
    throw corpusError(
      'CORPUS_EMBEDDING_MISMATCH',
      `Qdrant vector size ${qdrant.vectorSize} does not match EMBEDDING_DIMENSION ${embeddingDimension()}.`
    );
  }
  const points = qdrant.exists ? await scrollQdrantPoints() : [];
  const pointMap = new Map(points.map((point) => [String(point.id), point]));
  const chunkIds = new Set(chunks.map((chunk) => chunk.vectorNodeId));
  for (const chunk of chunks) {
    if (!UUID.test(chunk.vectorNodeId) || !SHA256.test(chunk.contentHash)) {
      throw corpusError('CORPUS_MYSQL_MAPPING_INVALID', `Invalid chunk mapping for document ${chunk.documentId}.`);
    }
    const point = pointMap.get(chunk.vectorNodeId);
    if (!point) throw corpusError('CORPUS_CROSS_STORE_MISMATCH', `Qdrant point missing for ${chunk.vectorNodeId}.`);
    if (String(point.payload?.doc_id) !== String(chunk.documentId)) {
      throw corpusError('CORPUS_CROSS_STORE_MISMATCH', `Qdrant doc_id mismatch for ${chunk.vectorNodeId}.`);
    }
    if (typeof point.payload?.text !== 'string'
      || sha256Buffer(Buffer.from(point.payload.text, 'utf8')) !== chunk.contentHash.toLowerCase()) {
      throw corpusError('CORPUS_CROSS_STORE_MISMATCH', `Qdrant text hash mismatch for ${chunk.vectorNodeId}.`);
    }
    const expectedHidden = chunk.visibilityStatus === 'HIDDEN';
    if (Boolean(point.payload?.is_hidden) !== expectedHidden) {
      throw corpusError('CORPUS_CROSS_STORE_MISMATCH', `Qdrant visibility mismatch for ${chunk.vectorNodeId}.`);
    }
  }
  const extras = points.filter((point) => !chunkIds.has(String(point.id)));
  if (extras.length) {
    throw corpusError('CORPUS_CROSS_STORE_MISMATCH', `Qdrant has ${extras.length} point(s) without active MySQL chunks.`);
  }
  return { stats, qdrant, chunks, points };
}

function bootstrapEmpty(stats, qdrant) {
  const mysqlBusinessRows = Number(stats.nonDemoUsers) + Number(stats.authTokens)
    + Number(stats.documents) + Number(stats.jobs) + Number(stats.chunks)
    + Number(stats.sessions) + Number(stats.messages) + Number(stats.citations) + Number(stats.usageRows);
  return {
    mysqlEmpty: mysqlBusinessRows === 0 && Number(stats.users) === 1,
    qdrantEmpty: !qdrant.exists || Number(qdrant.pointCount) === 0
  };
}

function bundleReadme() {
  return `# EDURAG portable corpus\n\nThis directory is a coordinated, sanitized MySQL + Qdrant export. It is not bidirectional synchronization.\n\n- Original PDF/DOCX/TXT files are intentionally excluded.\n- Restore only into bootstrap-empty MySQL/Qdrant volumes with \`npm run corpus:restore\`.\n- Validate checksums and compatibility with \`npm run corpus:verify\`.\n- Query/citation snapshots remain available; original-file download and reprocess require a new upload.\n\nSee [corpus portability](../../docs/architecture/corpus-portability.md) for lifecycle and limitations.\n`;
}

async function createQdrantSnapshot(outputDirectory) {
  const name = collectionName();
  const create = await qdrantRequest(`/collections/${encodeURIComponent(name)}/snapshots`, {
    method: 'POST',
    errorCode: 'CORPUS_QDRANT_SNAPSHOT_FAILED'
  });
  const payload = await create.json();
  const result = payload.result || {};
  if (!result.name || !Number.isFinite(Number(result.size))) {
    throw corpusError('CORPUS_QDRANT_SNAPSHOT_FAILED', 'Qdrant did not return snapshot name/size.');
  }
  const size = Number(result.size);
  if (size >= GIT_HARD_LIMIT_BYTES) {
    await qdrantRequest(`/collections/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(result.name)}`, {
      method: 'DELETE'
    }).catch(() => {});
    throw corpusError('CORPUS_GIT_SIZE_BLOCKED', 'Qdrant snapshot is at least 100 MiB and cannot be tracked in normal GitHub Git.');
  }
  const filename = `${name}.snapshot`;
  const target = path.join(outputDirectory, 'qdrant', filename);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  try {
    const response = await qdrantRequest(
      `/collections/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(result.name)}`,
      { timeoutMs: 120000, errorCode: 'CORPUS_QDRANT_SNAPSHOT_DOWNLOAD_FAILED' }
    );
    await fsp.writeFile(target, Buffer.from(await response.arrayBuffer()));
  } finally {
    await qdrantRequest(`/collections/${encodeURIComponent(name)}/snapshots/${encodeURIComponent(result.name)}`, {
      method: 'DELETE'
    }).catch(() => {});
  }
  return { relative: `qdrant/${filename}`, absolute: target, size };
}

async function writeChecksums(directory, relatives) {
  const entries = [];
  for (const relative of relatives) {
    const digest = await sha256File(path.join(directory, relative));
    entries.push({ relative: relative.replace(/\\/g, '/'), digest });
  }
  await fsp.writeFile(
    path.join(directory, 'checksums.sha256'),
    `${entries.map((entry) => `${entry.digest}  ${entry.relative}`).join('\n')}\n`,
    'utf8'
  );
  return Object.fromEntries(entries.map((entry) => [entry.relative, entry.digest]));
}

async function exportCorpus() {
  const initiallyRunning = runningServices();
  let previouslyRunning = [];
  const temporary = path.join(root, 'bootstrap', `.corpus-build-${crypto.randomUUID()}`);
  let preservedOriginalFiles = null;
  try {
    await ensureDataServices();
    previouslyRunning = freezeWriters();
    const stats = databaseStats();
    if (Number(stats.activeJobs) !== 0) {
      throw corpusError('CORPUS_ACTIVE_JOBS', 'QUEUED/RUNNING processing jobs exist; export requires a quiescent corpus.');
    }
    const reconciled = await reconcileRuntime();
    const sanitization = await assertSanitizedSource(reconciled.points);
    if (!reconciled.qdrant.exists || reconciled.points.length === 0) {
      throw corpusError('CORPUS_EMPTY', 'No Qdrant points are available for a portable corpus bundle.');
    }

    await fsp.rm(temporary, { recursive: true, force: true });
    await fsp.mkdir(path.join(temporary, 'mysql'), { recursive: true });
    const commonDumpArgs = [
      '--default-character-set=utf8mb4', '--no-tablespaces', '--skip-comments',
      '--skip-dump-date', '--set-gtid-purged=OFF', '--column-statistics=0'
    ];
    const schema = mysqlDump([...commonDumpArgs, '--no-data', '--skip-triggers']);
    const data = mysqlDump([
      ...commonDumpArgs,
      '--no-create-info', '--single-transaction', '--quick', '--skip-lock-tables',
      '--skip-add-locks', '--order-by-primary', `--ignore-table="${databaseName()}.auth_tokens"`
    ]);
    const dump = Buffer.concat([
      Buffer.from('-- EDURAG portable corpus: schema 1.0.0 + sanitized data\nSET NAMES utf8mb4;\n', 'utf8'),
      schema,
      Buffer.from('\n', 'utf8'),
      data
    ]);
    await fsp.writeFile(path.join(temporary, MYSQL_DUMP_RELATIVE), dump);

    {
      const documents = await loadBundleDocuments(temporary, { files: { mysqlDump: MYSQL_DUMP_RELATIVE } });
      const policy = await approvedDocumentPolicy();
      preservedOriginalFiles = await preserveOriginalFilesManifest(BUNDLE_DIRECTORY, temporary, {
        bundleFormatVersion: BUNDLE_FORMAT_VERSION,
        documents,
        approvals: policy.approvals,
        expectedBucket: process.env.GCS_BUCKET ? validateBucket(process.env.GCS_BUCKET) : undefined,
        expectedObjectPrefix: process.env.GCS_OBJECT_PREFIX
          ? normalizeObjectPrefix(process.env.GCS_OBJECT_PREFIX)
          : undefined
      });
    }

    const snapshot = await createQdrantSnapshot(temporary);
    const inventory = {
      generatedAtUtc: new Date().toISOString(),
      activeDocuments: [...new Set(reconciled.chunks.map((chunk) => String(chunk.documentId)))],
      chunks: reconciled.chunks.map((chunk) => ({
        documentId: String(chunk.documentId),
        vectorNodeId: chunk.vectorNodeId,
        contentHash: chunk.contentHash,
        hidden: chunk.visibilityStatus === 'HIDDEN'
      }))
    };
    await fsp.writeFile(path.join(temporary, INVENTORY_RELATIVE), `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
    await fsp.writeFile(path.join(temporary, 'README.md'), bundleReadme(), 'utf8');
    const payloadRelatives = [
      MYSQL_DUMP_RELATIVE,
      snapshot.relative,
      INVENTORY_RELATIVE,
      'README.md',
      ...(preservedOriginalFiles ? [ORIGINAL_FILES_RELATIVE] : [])
    ];
    const payloadSizes = Object.fromEntries(await Promise.all(payloadRelatives.map(async (relative) => [
      relative,
      (await fsp.stat(path.join(temporary, relative))).size
    ])));
    const oversized = Object.entries(payloadSizes).find(([, size]) => size >= GIT_HARD_LIMIT_BYTES);
    if (oversized) {
      throw corpusError('CORPUS_GIT_SIZE_BLOCKED', `${oversized[0]} is at least 100 MiB and cannot be tracked in normal GitHub Git.`);
    }
    const payloadBytes = Object.values(payloadSizes).reduce((sum, value) => sum + value, 0);
    const gitSuitability = Object.values(payloadSizes).some((size) => size >= GIT_WARNING_BYTES)
      || payloadBytes >= GIT_HARD_LIMIT_BYTES
      ? 'WARNING_LARGE_REPOSITORY_DELTA'
      : 'SUITABLE_UNDER_50_MIB_PER_FILE';

    const manifest = {
      bundleFormatVersion: BUNDLE_FORMAT_VERSION,
      createdAtUtc: new Date().toISOString(),
      databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
      mysqlServerVersion: String(stats.mysqlVersion),
      qdrantServerVersion: String(reconciled.qdrant.serverVersion),
      qdrantCollectionName: collectionName(),
      embeddingModel: embeddingModel(),
      embeddingDimension: embeddingDimension(),
      pipelineVersion: stats.pipelineVersion || null,
      documentCount: Number(stats.documents),
      chunkCount: Number(stats.chunks),
      qdrantPointCount: reconciled.points.length,
      originalFilesIncluded: false,
      files: {
        mysqlDump: MYSQL_DUMP_RELATIVE,
        qdrantSnapshot: snapshot.relative,
        inventory: INVENTORY_RELATIVE,
        ...(preservedOriginalFiles ? { originalFiles: ORIGINAL_FILES_RELATIVE } : {})
      },
      checksums: {},
      sanitization,
      bundlePayloadBytes: payloadBytes,
      gitSuitability,
      compatibilityNotes: [
        'Restore into MySQL 8.4 and the documented Qdrant server version.',
        preservedOriginalFiles
          ? 'Original uploads are excluded from Git; exact-approved files may be restored separately from private GCS.'
          : 'Original uploads are excluded; original-file APIs may report unavailable.',
        'Document embedding is preserved, but each query still uses query embedding and may use the generation LLM.',
        'Changing embedding model/dimension or incompatible pipeline semantics can require re-embedding.'
      ]
    };
    const initialRelatives = payloadRelatives;
    manifest.checksums = await writeChecksums(temporary, initialRelatives);
    await fsp.writeFile(path.join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await writeChecksums(temporary, [...initialRelatives, 'manifest.json']);

    await verifyBundle(temporary);
    await fsp.mkdir(path.dirname(BUNDLE_DIRECTORY), { recursive: true });
    const previous = path.join(root, 'bootstrap', `.corpus-previous-${crypto.randomUUID()}`);
    const hadPrevious = await fsp.access(BUNDLE_DIRECTORY).then(() => true).catch(() => false);
    if (hadPrevious) await fsp.rename(BUNDLE_DIRECTORY, previous);
    try {
      await fsp.rename(temporary, BUNDLE_DIRECTORY);
    } catch (error) {
      if (hadPrevious) await fsp.rename(previous, BUNDLE_DIRECTORY).catch(() => {});
      throw error;
    }
    if (hadPrevious) await fsp.rm(previous, { recursive: true, force: true }).catch(() => {
      console.warn('CORPUS_PREVIOUS_CLEANUP_WARNING: verified replacement is active; ignored previous directory remains.');
    });
    const totalBytes = (await Promise.all(
      [MYSQL_DUMP_RELATIVE, snapshot.relative, INVENTORY_RELATIVE, 'manifest.json', 'checksums.sha256']
        .map(async (relative) => (await fsp.stat(path.join(BUNDLE_DIRECTORY, relative))).size)
    )).reduce((sum, value) => sum + value, 0);
    console.log(JSON.stringify({
      status: 'CORPUS_EXPORT_OK',
      documents: manifest.documentCount,
      chunks: manifest.chunkCount,
      points: manifest.qdrantPointCount,
      totalBytes,
      gitSuitability: manifest.gitSuitability
    }));
    return manifest;
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true }).catch(() => {});
    resumeWriters(previouslyRunning);
    const newlyStartedDataServices = ['db', 'qdrant'].filter((service) => !initiallyRunning.has(service));
    if (newlyStartedDataServices.length) compose(['stop', ...newlyStartedDataServices], { allowFailure: true });
  }
}

function safeBundlePath(directory, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    throw corpusError('CORPUS_MANIFEST_INVALID', 'Bundle file path must be relative.');
  }
  const resolved = path.resolve(directory, relative);
  const prefix = `${path.resolve(directory)}${path.sep}`;
  if (!resolved.startsWith(prefix)) throw corpusError('CORPUS_MANIFEST_INVALID', 'Bundle path escapes corpus directory.');
  return resolved;
}

async function verifyBundle(directory = BUNDLE_DIRECTORY) {
  const manifestPath = path.join(directory, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  } catch (_error) {
    throw corpusError('CORPUS_BUNDLE_MISSING', 'A valid bootstrap/corpus/manifest.json is required.');
  }
  if (manifest.bundleFormatVersion !== BUNDLE_FORMAT_VERSION
    || manifest.databaseSchemaVersion !== DATABASE_SCHEMA_VERSION
    || manifest.originalFilesIncluded !== false
    || manifest.embeddingModel !== 'gemini-embedding-001'
    || Number(manifest.embeddingDimension) !== 768
    || manifest.qdrantCollectionName !== collectionName()
    || !String(manifest.mysqlServerVersion || '').startsWith(MYSQL_SERVER_SERIES)
    || manifest.qdrantServerVersion !== QDRANT_SERVER_VERSION) {
    throw corpusError('CORPUS_BUNDLE_INCOMPATIBLE', 'Corpus manifest is incompatible with the current schema/model/collection contract.');
  }
  const checksumLines = (await fsp.readFile(path.join(directory, 'checksums.sha256'), 'utf8'))
    .split(/\r?\n/).filter(Boolean);
  const expected = new Map(checksumLines.map((line) => {
    const match = line.match(/^([0-9a-f]{64})  (.+)$/);
    if (!match) throw corpusError('CORPUS_CHECKSUM_INVALID', 'checksums.sha256 contains an invalid line.');
    return [match[2], match[1]];
  }));
  for (const relative of [
    manifest.files?.mysqlDump,
    manifest.files?.qdrantSnapshot,
    manifest.files?.inventory,
    ...(manifest.files?.originalFiles ? [manifest.files.originalFiles] : [])
  ]) {
    if (typeof relative !== 'string' || !SHA256.test(manifest.checksums?.[relative] || '')) {
      throw corpusError('CORPUS_MANIFEST_INVALID', 'Manifest is missing a required bundle file/checksum.');
    }
  }
  for (const [relative, digest] of expected) {
    const actual = await sha256File(safeBundlePath(directory, relative));
    if (actual !== digest) throw corpusError('CORPUS_CHECKSUM_MISMATCH', `Checksum mismatch: ${relative}`);
  }
  for (const [relative, digest] of Object.entries(manifest.checksums || {})) {
    if (expected.get(relative) !== digest) {
      throw corpusError('CORPUS_MANIFEST_INVALID', `Manifest checksum mismatch: ${relative}`);
    }
  }
  const snapshot = safeBundlePath(directory, manifest.files.qdrantSnapshot);
  const snapshotSize = (await fsp.stat(snapshot)).size;
  if (snapshotSize <= 0 || snapshotSize >= GIT_HARD_LIMIT_BYTES) {
    throw corpusError('CORPUS_GIT_SIZE_BLOCKED', 'Qdrant snapshot is empty or exceeds the regular GitHub file limit.');
  }
  const mysqlDump = await fsp.readFile(safeBundlePath(directory, manifest.files.mysqlDump), 'utf8');
  scanSensitiveText('portable MySQL dump', mysqlDump, { serializedSql: true });
  if (/INSERT\s+INTO\s+`?auth_tokens`?/i.test(mysqlDump)
    || /\b(?:CREATE\s+USER|GRANT\s+.+\s+TO|DEFINER\s*=)/i.test(mysqlDump)) {
    throw corpusError('CORPUS_MYSQL_DUMP_UNSAFE', 'MySQL dump contains auth-token data or host privilege statements.');
  }
  let bundleBytes = 0;
  let hasLargeFile = false;
  for (const relative of expected.keys()) {
    const size = (await fsp.stat(safeBundlePath(directory, relative))).size;
    if (size >= GIT_HARD_LIMIT_BYTES) {
      throw corpusError('CORPUS_GIT_SIZE_BLOCKED', `${relative} exceeds the regular GitHub file limit.`);
    }
    bundleBytes += size;
    if (size >= GIT_WARNING_BYTES) hasLargeFile = true;
  }
  const inventory = JSON.parse(await fsp.readFile(safeBundlePath(directory, manifest.files.inventory), 'utf8'));
  if (!Array.isArray(inventory.chunks)
    || inventory.chunks.length !== Number(manifest.qdrantPointCount)
    || Number(manifest.chunkCount) < inventory.chunks.length) {
    throw corpusError('CORPUS_INVENTORY_INVALID', 'Inventory counts do not match the manifest.');
  }
  const ids = new Set();
  for (const chunk of inventory.chunks) {
    if (!UUID.test(chunk.vectorNodeId) || !SHA256.test(chunk.contentHash) || ids.has(chunk.vectorNodeId)) {
      throw corpusError('CORPUS_INVENTORY_INVALID', 'Inventory contains invalid or duplicate chunk mappings.');
    }
    ids.add(chunk.vectorNodeId);
  }
  const originalFiles = await readOptionalOriginalFilesManifest(directory);
  if (Boolean(manifest.files?.originalFiles) !== Boolean(originalFiles)
    || (manifest.files?.originalFiles && manifest.files.originalFiles !== ORIGINAL_FILES_RELATIVE)) {
    throw corpusError(
      'CORPUS_FILES_MANIFEST_INVALID',
      'original-files.json must be referenced and checksummed by the corpus manifest.'
    );
  }
  if (originalFiles) {
    const documents = await loadBundleDocuments(directory, manifest);
    const policy = await approvedDocumentPolicy();
    validateOriginalFilesManifest(originalFiles, {
      bundleFormatVersion: manifest.bundleFormatVersion,
      documents,
      approvals: policy.approvals,
      expectedBucket: process.env.GCS_BUCKET ? validateBucket(process.env.GCS_BUCKET) : undefined,
      expectedObjectPrefix: process.env.GCS_OBJECT_PREFIX
        ? normalizeObjectPrefix(process.env.GCS_OBJECT_PREFIX)
        : undefined
    });
  }
  console.log(JSON.stringify({
    status: 'CORPUS_VERIFY_OK',
    documents: manifest.documentCount,
    chunks: manifest.chunkCount,
    points: manifest.qdrantPointCount,
    snapshotBytes: snapshotSize,
    bundleBytes,
    gitSuitability: hasLargeFile || bundleBytes >= GIT_HARD_LIMIT_BYTES
      ? 'WARNING_LARGE_REPOSITORY_DELTA'
      : 'SUITABLE_UNDER_50_MIB_PER_FILE'
  }));
  return manifest;
}

async function restoreQdrantSnapshot(manifest, bundleDirectory = BUNDLE_DIRECTORY) {
  const name = collectionName();
  const current = await qdrantRuntimeInfo();
  if (current.exists) {
    if (current.pointCount !== 0) throw corpusError('CORPUS_RESTORE_NOT_EMPTY', 'Qdrant collection already contains points.');
    await qdrantRequest(`/collections/${encodeURIComponent(name)}`, { method: 'DELETE' });
  }
  const buffer = await fsp.readFile(safeBundlePath(bundleDirectory, manifest.files.qdrantSnapshot));
  const form = new FormData();
  form.append('snapshot', new Blob([buffer]), path.basename(manifest.files.qdrantSnapshot));
  const snapshotChecksum = manifest.checksums?.[manifest.files.qdrantSnapshot];
  const response = await qdrantRequest(
    `/collections/${encodeURIComponent(name)}/snapshots/upload?priority=snapshot&checksum=${encodeURIComponent(snapshotChecksum)}`,
    {
    method: 'POST',
    body: form,
    timeoutMs: 180000,
    errorCode: 'CORPUS_QDRANT_RESTORE_FAILED'
    }
  );
  const payload = await response.json();
  if (payload.result !== true) {
    throw corpusError('CORPUS_QDRANT_RESTORE_FAILED', 'Qdrant did not confirm snapshot recovery.');
  }
}

async function restoreCorpus(options = {}) {
  const bundleDirectory = options.bundleDirectory || BUNDLE_DIRECTORY;
  const manifest = await verifyBundle(bundleDirectory);
  await ensureDataServices();
  const previouslyRunning = options.writersAlreadyStopped ? [] : freezeWriters();
  try {
    const stats = databaseStats();
    const qdrant = await qdrantRuntimeInfo();
    if (!String(stats.mysqlVersion).startsWith(MYSQL_SERVER_SERIES)
      || String(qdrant.serverVersion) !== String(manifest.qdrantServerVersion)) {
      throw corpusError('CORPUS_RUNTIME_VERSION_MISMATCH', 'Running MySQL/Qdrant versions do not match the bundle contract.');
    }
    const empty = bootstrapEmpty(stats, qdrant);
    if (!empty.mysqlEmpty || !empty.qdrantEmpty) {
      throw corpusError(
        'CORPUS_RESTORE_NOT_EMPTY',
        `Restore requires bootstrap-empty stores (mysqlEmpty=${empty.mysqlEmpty}, qdrantEmpty=${empty.qdrantEmpty}).`
      );
    }
    const sql = await fsp.readFile(safeBundlePath(bundleDirectory, manifest.files.mysqlDump));
    mysqlInput(sql);
    await restoreQdrantSnapshot(manifest, bundleDirectory);
    const reconciled = await reconcileRuntime();
    if (Number(reconciled.stats.documents) !== Number(manifest.documentCount)
      || Number(reconciled.stats.chunks) !== Number(manifest.chunkCount)
      || reconciled.points.length !== Number(manifest.qdrantPointCount)) {
      throw corpusError('CORPUS_RESTORE_VERIFY_FAILED', 'Restored runtime counts do not match the bundle manifest.');
    }
    console.log(JSON.stringify({
      status: 'CORPUS_RESTORE_OK',
      documents: reconciled.stats.documents,
      chunks: reconciled.stats.chunks,
      points: reconciled.points.length,
      originalFilesRestored: false
    }));
    return reconciled;
  } finally {
    resumeWriters(previouslyRunning);
  }
}

async function inspectCorpus() {
  await ensureDataServices();
  const reconciled = await reconcileRuntime();
  const empty = bootstrapEmpty(reconciled.stats, reconciled.qdrant);
  const result = {
    status: 'CORPUS_INSPECT_OK',
    mysql: reconciled.stats,
    qdrant: reconciled.qdrant,
    activeMappedChunks: reconciled.chunks.length,
    bootstrapEmpty: empty
  };
  console.log(JSON.stringify(result));
  return result;
}

async function reviewCorpus() {
  const initiallyRunning = runningServices();
  try {
    await ensureDataServices();
    const reconciled = await reconcileRuntime();
    const sanitization = await assertSanitizedSource(reconciled.points, { requireApproval: false });
    const documents = mysqlJsonRows(`
      SELECT JSON_OBJECT(
        'documentId', id,
        'checksum', checksum_sha256,
        'processingStatus', processing_status,
        'visibilityStatus', visibility_status,
        'fileType', file_type
      )
      FROM documents ORDER BY id;
    `);
    const result = {
      status: 'CORPUS_REVIEW_OK',
      documents,
      mysql: reconciled.stats,
      qdrant: {
        serverVersion: reconciled.qdrant.serverVersion,
        collectionName: reconciled.qdrant.collectionName,
        pointCount: reconciled.points.length,
        vectorSize: reconciled.qdrant.vectorSize,
        distance: reconciled.qdrant.distance
      },
      sanitization
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    const newlyStarted = ['db', 'qdrant'].filter((service) => !initiallyRunning.has(service));
    if (newlyStarted.length) compose(['stop', ...newlyStarted], { allowFailure: true });
  }
}

async function bootstrapCorpus(options = {}) {
  const bundleDirectory = options.bundleDirectory || BUNDLE_DIRECTORY;
  const mode = String(process.env.CORPUS_BOOTSTRAP || 'auto').toLowerCase();
  if (!['auto', 'off', 'required'].includes(mode)) {
    throw corpusError('CORPUS_BOOTSTRAP_CONFIG_INVALID', 'CORPUS_BOOTSTRAP must be auto, off or required.');
  }
  if (mode === 'off') {
    console.log(JSON.stringify({ status: 'CORPUS_BOOTSTRAP_SKIPPED', reason: 'OFF' }));
    return { restored: false, reason: 'OFF' };
  }
  let manifest = null;
  try {
    manifest = await verifyBundle(bundleDirectory);
  } catch (error) {
    if (mode === 'required') throw error;
    if (error.code !== 'CORPUS_BUNDLE_MISSING') throw error;
  }
  const stats = databaseStats();
  const qdrant = await qdrantRuntimeInfo();
  const empty = bootstrapEmpty(stats, qdrant);
  if (!empty.mysqlEmpty || !empty.qdrantEmpty) {
    if (empty.mysqlEmpty !== empty.qdrantEmpty) {
      throw corpusError('CORPUS_PARTIAL_STATE', 'MySQL and Qdrant emptiness differ; auto-bootstrap refuses partial overwrite.');
    }
    console.log(JSON.stringify({ status: 'CORPUS_BOOTSTRAP_SKIPPED', reason: 'DATA_EXISTS' }));
    return { restored: false, reason: 'DATA_EXISTS' };
  }
  if (!manifest) {
    console.log(JSON.stringify({ status: 'CORPUS_BOOTSTRAP_SKIPPED', reason: 'NO_BUNDLE' }));
    return { restored: false, reason: 'NO_BUNDLE' };
  }
  await restoreCorpus({ writersAlreadyStopped: true, bundleDirectory });
  return { restored: true, reason: 'EMPTY_STORES' };
}

async function main() {
  const command = process.argv[2];
  if (command === 'review') return reviewCorpus();
  if (command === 'inspect') return inspectCorpus();
  if (command === 'export') return exportCorpus();
  if (command === 'verify') return verifyBundle();
  if (command === 'restore') return restoreCorpus();
  if (command === 'bootstrap') return bootstrapCorpus();
  throw corpusError('CORPUS_COMMAND_INVALID', 'Use review, inspect, export, verify, restore or bootstrap.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${error.code || 'CORPUS_FAILED'}: ${redacted(error.message)}`);
    process.exit(1);
  });
}

module.exports = {
  BUNDLE_DIRECTORY,
  bootstrapCorpus,
  exportCorpus,
  inspectCorpus,
  reviewCorpus,
  reconcileRuntime,
  restoreCorpus,
  verifyBundle
};
