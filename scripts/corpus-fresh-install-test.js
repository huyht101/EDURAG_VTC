'use strict';

process.env.REMOTE_COMPOSE_PROJECT = process.env.CORPUS_FRESH_COMPOSE_PROJECT
  || `edurag_corpus_fresh_${process.pid}_${Date.now()}`;
process.env.REMOTE_E2E_CONFIRM_ISOLATED = 'true';
process.env.MYSQL_ROOT_PASSWORD = 'offline-corpus-root-password';
process.env.DB_PASSWORD = process.env.MYSQL_ROOT_PASSWORD;
process.env.DB_NAME = 'edurag';
process.env.REMOTE_MYSQL_HOST_PORT = '0';
process.env.APP_HOST_PORT = '0';
process.env.QDRANT_HTTP_HOST_PORT = '0';
process.env.QDRANT_GRPC_HOST_PORT = '0';
process.env.PYTHON_HOST_PORT = '0';
process.env.GOOGLE_API_KEY = 'offline-not-used';
process.env.RAG_INTERNAL_TOKEN = 'offline-corpus-internal-token-0123456789';
process.env.OCR_MODE = 'OFF';
process.env.QDRANT_COLLECTION_NAME = 'education_docs';
process.env.EMBEDDING_DIMENSION = '768';
process.env.GEMINI_EMBEDDING_MODEL = 'models/gemini-embedding-001';

const assert = require('assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  bootstrapCorpus,
  sourceFingerprint,
  verifyLocalSelectedRelease,
  restoreCorpus
} = require('./corpus-manager');
const { runCorpusReset } = require('./corpus-reset');
const {
  buildReleaseManifest,
  sha256Buffer
} = require('./lib/corpus-release');
const runtime = require('./lib/corpus-runtime');
const { DockerUploadVolume } = require('./lib/docker-upload-volume');
const {
  compose, composePort, composeProject, docker, redacted, resolvedComposeConfig
} = require('./remote-test-utils');

const documentId = '1';
const vectorNodeId = '0f56f5b0-bc59-5b95-bad8-9c530fcd7f93';
const storageKey = 'documents/offline/fresh-install.txt';
const chunkText = 'Synthetic offline corpus restore fixture.';
const originalBytes = Buffer.from(`${chunkText}\n`, 'utf8');
const originalSha256 = sha256Buffer(originalBytes);
const contentHash = sha256Buffer(Buffer.from(chunkText, 'utf8'));

function projectResources() {
  const label = `label=com.docker.compose.project=${composeProject}`;
  return [
    docker(['ps', '-a', '--filter', label, '--format', '{{.ID}}']),
    docker(['volume', 'ls', '--filter', label, '--format', '{{.Name}}']),
    docker(['network', 'ls', '--filter', label, '--format', '{{.Name}}'])
  ].filter(Boolean);
}

async function waitForSchema() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const stats = runtime.databaseStats();
      if (Number(stats.users) === 1) return;
    } catch (_error) {
      // MySQL can be healthy before init scripts finish.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Disposable MySQL schema did not become ready.');
}

async function reconcileWithRetry() {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await runtime.reconcileRuntime({ withVectors: true });
    } catch (error) {
      lastError = error;
      if (error.code !== 'CORPUS_QDRANT_REQUEST_FAILED') throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function qdrantRequest(endpoint, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const port = composePort('qdrant', 6333);
      const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
        ...options,
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok && !(options.allowNotFound && response.status === 404)) {
        throw new Error(`Disposable Qdrant returned ${response.status}.`);
      }
      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Disposable Qdrant request ${endpoint} failed: ${lastError?.message || 'unknown'}`);
}

async function seedStructuredFixture() {
  runtime.mysqlInput(`
    UPDATE roles SET created_at='2026-08-08 00:00:00.000', updated_at='2026-08-08 00:00:00.000';
    UPDATE users SET email_verified_at='2026-08-08 00:00:00.000',
      created_at='2026-08-08 00:00:00.000', updated_at='2026-08-08 00:00:00.000';
    UPDATE schema_migrations SET applied_at='2026-08-08 00:00:00.000';
    INSERT INTO documents
      (id, uploaded_by, title, original_filename, storage_type, storage_key, file_type,
       mime_type, file_size_bytes, checksum_sha256, preview_status, processing_status,
       visibility_status, processed_at, created_at, updated_at)
    SELECT 1, id, 'Offline corpus fixture', 'fresh-install.txt', 'LOCAL', '${storageKey}', 'TXT',
      'text/plain', ${originalBytes.length}, '${originalSha256}', 'NOT_APPLICABLE', 'READY',
      'VISIBLE', '2026-08-08 00:00:00.000', '2026-08-08 00:00:00.000', '2026-08-08 00:00:00.000'
    FROM users WHERE email = 'admin@example.com';
    INSERT INTO document_processing_jobs
      (id, document_id, job_type, status, current_stage, attempt_count, max_attempts,
       pipeline_version, parser_name, embedding_model, embedding_dimension, vector_collection,
       total_chunks, started_at, finished_at, callback_received_at, created_at, updated_at)
    VALUES
      (1, 1, 'INGEST', 'SUCCEEDED', 'activation', 1, 3, 'offline-fixture-v1',
       'offline-fixture', 'gemini-embedding-001', 768, 'education_docs', 1,
       '2026-08-08 00:00:00.000', '2026-08-08 00:00:00.000',
       '2026-08-08 00:00:00.000', '2026-08-08 00:00:00.000', '2026-08-08 00:00:00.000');
    INSERT INTO document_chunks
      (id, document_id, processing_job_id, chunk_index, vector_node_id, chunk_text,
       content_hash, token_count, page_number, section_title, source_locator, created_at)
    VALUES
      (1, 1, 1, 0, '${vectorNodeId}', '${chunkText}', '${contentHash}', 5, NULL,
       NULL, NULL, '2026-08-08 00:00:00.000');
  `);
  await qdrantRequest('/collections/education_docs', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ vectors: { size: 768, distance: 'Cosine' } })
  });
  await qdrantRequest('/collections/education_docs/points?wait=true', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ points: [{
      id: vectorNodeId,
      vector: [1, ...Array(767).fill(0)],
      payload: {
        doc_id: documentId,
        text: chunkText,
        is_active: true,
        is_hidden: false,
        ingest_attempt_key: '1::1::1'
      }
    }] })
  });
}

async function clearStructuredFixture() {
  await qdrantRequest('/collections/education_docs', {
    method: 'DELETE', allowNotFound: true
  });
  runtime.mysqlInput(`
    DELETE FROM document_chunks WHERE id = 1;
    DELETE FROM document_processing_jobs WHERE id = 1;
    DELETE FROM documents WHERE id = 1;
  `);
}

async function makeDownloadedFixture(temporary) {
  await seedStructuredFixture();
  const reconciled = await reconcileWithRetry();
  const documentRows = runtime.documentInventory();
  const documents = new Map(documentRows.map((document) => [String(document.documentId), {
    ...document,
    documentId: String(document.documentId),
    sha256: String(document.sha256).toLowerCase(),
    sizeBytes: Number(document.sizeBytes)
  }]));
  const mysqlContentSha256 = runtime.createScopedMysqlExport().contentSha256;
  const inventory = {
    activeDocuments: [documentId],
    chunks: [{
      documentId,
      vectorNodeId,
      contentHash,
      hidden: false
    }]
  };
  const expectedCounts = {
    documents: 1,
    processingJobs: 1,
    chunks: 1,
    citations: 0,
    qdrantPoints: 1
  };
  const compatibility = {
    databaseSchemaVersion: '1.0.0',
    mysqlServerVersion: String(reconciled.stats.mysqlVersion),
    qdrantServerVersion: String(reconciled.qdrant.serverVersion),
    qdrantCollectionName: 'education_docs',
    embeddingModel: 'gemini-embedding-001',
    embeddingDimension: 768,
    pipelineVersion: 'offline-fixture-v1'
  };
  const fingerprint = sourceFingerprint({
    documents,
    inventory,
    expectedCounts,
    compatibility,
    mysqlContentSha256,
    qdrantContentSha256: runtime.qdrantContentSha256(reconciled.points)
  });
  const mysqlBytes = Buffer.from('offline-mysql-artifact', 'utf8');
  const qdrantBytes = Buffer.from('offline-qdrant-artifact', 'utf8');
  const originalFile = path.join(temporary, 'fresh-install.txt');
  await fsp.writeFile(originalFile, originalBytes);
  const config = {
    projectId: 'offline-test-project',
    bucket: 'offline-private-bucket',
    objectPrefix: 'portable-corpus/v1'
  };
  const manifest = buildReleaseManifest({
    config,
    mysql: { sha256: sha256Buffer(mysqlBytes), sizeBytes: mysqlBytes.length },
    qdrant: { sha256: sha256Buffer(qdrantBytes), sizeBytes: qdrantBytes.length },
    documents: [{
      documentId,
      sha256: originalSha256,
      sizeBytes: originalBytes.length,
      localStorageKey: storageKey,
      originalFilename: 'fresh-install.txt',
      mimeType: 'text/plain'
    }],
    compatibility,
    expectedCounts,
    inventory,
    sourceFingerprint: fingerprint,
    sanitization: { secretAndPathScan: 'passed' },
    createdAtUtc: '2026-08-08T00:00:00.000Z'
  });
  const pointer = {
    pointerSchemaVersion: '1.0.0',
    releaseId: manifest.releaseId,
    manifestSha256: sha256Buffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')),
    publishedAtUtc: manifest.createdAtUtc
  };
  const files = new Map();
  for (const [artifact, bytes, filename] of [
    [manifest.artifacts.mysql, mysqlBytes, 'mysql.bin'],
    [manifest.artifacts.qdrant, qdrantBytes, 'qdrant.bin']
  ]) {
    const file = path.join(temporary, filename);
    await fsp.writeFile(file, bytes);
    files.set(artifact.objectKey, file);
  }
  files.set(manifest.artifacts.documents[0].objectKey, originalFile);
  await clearStructuredFixture();
  return {
    manifest,
    pointer,
    files,
    temporary,
    ownsTemporary: false
  };
}

async function main() {
  assert.match(composeProject, /^edurag_corpus_fresh_[A-Za-z0-9_.-]+$/);
  assert.equal(projectResources().length, 0, 'Refusing to reuse a Docker project.');
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'edurag-corpus-fresh-test-'));
  try {
    compose(['config', '--quiet']);
    compose(['up', '-d', '--wait', 'db', 'qdrant']);
    await waitForSchema();
    compose(['build', 'app', 'rag-service']);
    compose(['create', 'app']);
    const volumeStore = new DockerUploadVolume();
    const downloaded = await makeDownloadedFixture(temporary);
    const environment = {
      GCS_PROJECT_ID: 'offline-test-project',
      GCS_BUCKET: 'offline-private-bucket',
      GCS_OBJECT_PREFIX: 'portable-corpus/v1',
      GCS_CREDENTIALS_FILE: 'secrets/offline-not-read.json'
    };
    let downloads = 0;
    const options = {
      mode: 'auto',
      environment,
      pointer: downloaded.pointer,
      readPointer: async () => downloaded.pointer,
      downloadRelease: async () => { downloads += 1; return downloaded; },
      restoreStructured: async () => {
        await seedStructuredFixture();
        return { rollbackRestore: clearStructuredFixture };
      },
      ensureDataServices: async () => {
        compose(['up', '-d', '--wait', 'db', 'qdrant']);
        await waitForSchema();
      },
      volumeStore,
      manageWriterLifecycle: false
    };
    const restored = await bootstrapCorpus(options);
    assert.equal(restored.status, 'CORPUS_RESTORE_OK');
    assert.equal(restored.releaseId, downloaded.manifest.releaseId);
    assert.equal(restored.releaseState, 'VERIFIED');
    assert.equal(downloads, 1);
    const verified = await reconcileWithRetry();
    assert.equal(verified.stats.documents, 1);
    assert.equal(verified.points.length, 1);
    assert.equal(verified.points[0].payload.is_active, true);
    const uploadState = await volumeStore.inspectPresence();
    assert.equal(uploadState.fileCount, 1);
    assert.equal(uploadState.releaseState.releaseId, downloaded.manifest.releaseId);
    const noOp = await bootstrapCorpus({
      ...options,
      downloadRelease: async () => { throw new Error('Selected local no-op read remote unexpectedly.'); }
    });
    assert.equal(noOp.status, 'CORPUS_ALREADY_RESTORED');
    assert.equal(downloads, 1);
    const resetDependencies = {
      complete: true,
      project: composeProject,
      resolveConfig: async () => resolvedComposeConfig(),
      preflightSource: async () => downloaded,
      // The fixture uses deterministic placeholder artifact bytes and injects
      // structured restore directly; production reset validates a real snapshot
      // in a disposable Qdrant before down -v.
      verifySourceLifecycle: async () => ({ status: 'FIXTURE_LIFECYCLE_VERIFIED' }),
      startDataServices: async () => {
        compose(['up', '-d', '--wait', 'db', 'qdrant']);
        await waitForSchema();
        compose(['create', 'app']);
      },
      inspectInventory: async () => {
        let lastError;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          try {
            return await require('./corpus-manager').inspectBootstrapState();
          } catch (error) {
            lastError = error;
            if (error.code !== 'CORPUS_QDRANT_REQUEST_FAILED') throw error;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
        throw lastError;
      },
      confirmReset: async () => { throw new Error('Disposable reset must use --yes.'); },
      stopAndReset: async () => { compose(['down', '-v', '--remove-orphans']); },
      restoreSelected: async (source, capture) => restoreCorpus({
        ...options,
        downloadRelease: async () => ({ ...source, ownsTemporary: false }),
        writeReleaseState: async (state) => { capture.value = state; }
      }),
      startFullStack: async () => { compose(['up', '-d', '--wait']); },
      healthAndConsistency: async (source) => verifyLocalSelectedRelease(source.manifest, { volumeStore }),
      writeReadyState: async (state) => volumeStore.writeReleaseState(state),
      removeTemporary: async () => {}
    };
    const resetFirst = await runCorpusReset({ yes: true, argv: [] }, resetDependencies);
    assert.equal(resetFirst.status, 'CORPUS_RESET_READY');
    assert.equal((await volumeStore.inspectPresence()).releaseState.releaseId, downloaded.manifest.releaseId);
    const resetSecond = await runCorpusReset({ yes: true, argv: [] }, resetDependencies);
    assert.equal(resetSecond.status, 'CORPUS_RESET_READY');
    assert.equal((await reconcileWithRetry()).points[0].payload.is_active, true);
    console.log(
      `CORPUS_FRESH_INSTALL_TEST_OK release=${downloaded.manifest.releaseId} `
      + 'fresh_restore=true marker=true exact_noop=true consistency=true remote_calls=1 '
      + 'one_command_reset=true reset_rerun=true full_stack=true'
    );
  } finally {
    compose(['down', '-v', '--remove-orphans', '--rmi', 'local'], { allowFailure: true });
    await fsp.rm(temporary, { recursive: true, force: true });
    assert.equal(projectResources().length, 0, `Disposable resources remain for ${composeProject}.`);
  }
}

main().catch((error) => {
  console.error(
    `CORPUS_FRESH_INSTALL_TEST_FAILED: code=${error.code || 'UNCLASSIFIED'} `
    + `phase=${error.corpusPhase || 'TEST'} ${redacted(error.message)}`
  );
  process.exit(1);
});
