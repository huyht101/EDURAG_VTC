'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fsp = require('fs/promises');
const readline = require('readline/promises');

function resetError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseResetOptions(argv = process.argv.slice(2)) {
  const allowed = new Set(['--yes', '--dry-run']);
  for (const flag of argv) {
    if (!allowed.has(flag)) throw resetError('CORPUS_RESET_OPTION_INVALID', `Unsupported option: ${flag}`);
  }
  return { yes: argv.includes('--yes'), dryRun: argv.includes('--dry-run') };
}

function assertManagedProject(project, config) {
  if (!/^edurag_[A-Za-z0-9_.-]+$/.test(project)) {
    throw resetError('CORPUS_RESET_PROJECT_UNSAFE', 'Corpus reset requires an explicit EDURAG Compose project name.');
  }
  const volumes = Object.values(config.volumes || {}).map((volume) => volume.name).filter(Boolean);
  if (volumes.length < 3 || volumes.some((name) => !String(name).startsWith(`${project}_`))) {
    throw resetError(
      'CORPUS_RESET_PROJECT_UNSAFE',
      'Resolved named volumes are not exclusively scoped to the selected Compose project.'
    );
  }
  return volumes;
}

function assertLifecyclePoints(points, expectedCount) {
  if (!Array.isArray(points) || points.length !== Number(expectedCount)) {
    throw resetError(
      'CORPUS_QDRANT_LIFECYCLE_INCOMPATIBLE',
      'Selected Qdrant snapshot point count does not match its verified manifest.'
    );
  }
  for (const point of points) {
    const payload = point?.payload;
    if (payload?.is_active !== true || typeof payload?.is_hidden !== 'boolean'
      || typeof payload?.ingest_attempt_key !== 'string' || !payload.ingest_attempt_key) {
      throw resetError(
        'CORPUS_QDRANT_LIFECYCLE_INCOMPATIBLE',
        'Selected Qdrant snapshot lacks the exact-attempt active/hidden payload contract.'
      );
    }
  }
}

async function verifyDownloadedQdrantLifecycle(downloaded, options = {}) {
  const remote = options.remote || require('./remote-test-utils');
  const docker = options.docker || remote.docker;
  const fetchImpl = options.fetch || fetch;
  const artifact = downloaded.manifest?.artifacts?.qdrant;
  const snapshot = artifact && downloaded.files?.get(artifact.objectKey);
  if (!artifact || !snapshot) {
    throw resetError('CORPUS_QDRANT_LIFECYCLE_INCOMPATIBLE', 'Verified release is missing its Qdrant snapshot.');
  }
  const name = `edurag-corpus-reset-preflight-${crypto.randomUUID()}`;
  let started = false;
  try {
    docker([
      'run', '-d', '--name', name, '-p', '127.0.0.1::6333',
      'qdrant/qdrant:v1.18.2'
    ]);
    started = true;
    const portOutput = docker(['port', name, '6333/tcp']);
    const match = String(portOutput).match(/:(\d+)$/);
    if (!match) throw resetError('CORPUS_QDRANT_PREFLIGHT_FAILED', 'Disposable Qdrant port is unavailable.');
    const base = `http://127.0.0.1:${match[1]}`;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetchImpl(`${base}/healthz`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) { ready = true; break; }
      } catch (_error) { /* Disposable Qdrant is still starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw resetError('CORPUS_QDRANT_PREFLIGHT_FAILED', 'Disposable Qdrant did not become healthy.');
    const form = new FormData();
    form.append('snapshot', new Blob([await fsp.readFile(snapshot)]), 'selected.snapshot');
    const collection = encodeURIComponent(downloaded.manifest.compatibility.qdrantCollectionName);
    const restored = await fetchImpl(
      `${base}/collections/${collection}/snapshots/upload?priority=snapshot&checksum=${artifact.sha256}`,
      { method: 'POST', body: form, signal: AbortSignal.timeout(180000) }
    );
    if (!restored.ok || (await restored.json()).result !== true) {
      throw resetError('CORPUS_QDRANT_PREFLIGHT_FAILED', 'Disposable Qdrant rejected the selected snapshot.');
    }
    const points = [];
    let offset = null;
    do {
      const response = await fetchImpl(`${base}/collections/${collection}/points/scroll`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 256, with_payload: true, with_vector: false, ...(offset === null ? {} : { offset }) }),
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw resetError('CORPUS_QDRANT_PREFLIGHT_FAILED', 'Cannot inspect disposable Qdrant payload.');
      const body = (await response.json()).result;
      points.push(...body.points);
      offset = body.next_page_offset ?? null;
    } while (offset !== null);
    assertLifecyclePoints(points, downloaded.manifest.expectedCounts.qdrantPoints);
    return { status: 'CORPUS_QDRANT_LIFECYCLE_VERIFIED', points: points.length };
  } finally {
    if (started) {
      const removed = docker(['rm', '-f', name], { allowFailure: true });
      if (typeof removed !== 'string' && removed?.status !== 0) {
        throw resetError('CORPUS_QDRANT_PREFLIGHT_CLEANUP_FAILED', 'Disposable Qdrant cleanup failed.');
      }
    }
  }
}

async function confirmReset(project, prompt = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `Replace the local MySQL, originals and Qdrant stores for ${project}? Type RESET to continue: `
    );
    if (answer.trim() !== 'RESET') {
      throw resetError('CORPUS_RESET_CANCELLED', 'Corpus reset was cancelled; no local stores were changed.');
    }
  } finally {
    rl.close();
  }
}

function defaultDependencies() {
  const manager = require('./corpus-manager');
  const runtime = require('./lib/corpus-runtime');
  const { DockerUploadVolume } = require('./lib/docker-upload-volume');
  const remote = require('./remote-test-utils');
  const preflight = require('./remote-preflight');
  const volumeStore = new DockerUploadVolume();
  return {
    project: remote.composeProject,
    resolveConfig: () => remote.resolvedComposeConfig(),
    readPointer: () => manager.downloadAndVerifyRelease({}).then((downloaded) => downloaded.pointer),
    preflightSource: () => manager.downloadAndVerifyRelease({}),
    verifySourceLifecycle: (downloaded) => verifyDownloadedQdrantLifecycle(downloaded),
    inspectInventory: () => manager.inspectBootstrapState(),
    stopAndReset: () => remote.compose(['down', '-v', '--remove-orphans']),
    startDataServices: () => runtime.ensureDataServices(),
    restoreSelected: async (downloaded, captureState) => manager.restoreCorpus({
      downloadRelease: async () => ({ ...downloaded, ownsTemporary: false }),
      volumeStore,
      writeReleaseState: async (state) => { captureState.value = state; }
    }),
    startFullStack: () => remote.compose(['up', '-d', '--build', '--wait']),
    healthAndConsistency: async (downloaded) => {
      await preflight.main();
      return manager.verifyLocalSelectedRelease(downloaded.manifest, { volumeStore });
    },
    writeReadyState: (state) => volumeStore.writeReleaseState(state),
    removeTemporary: (directory) => fsp.rm(directory, { recursive: true, force: true }),
    confirmReset
  };
}

async function runCorpusReset(options = {}, supplied = {}) {
  const deps = supplied.complete === true ? supplied : { ...defaultDependencies(), ...supplied };
  const flags = { ...parseResetOptions(options.argv || []), ...options };
  const config = await deps.resolveConfig();
  const volumeNames = assertManagedProject(deps.project, config);
  let downloaded;
  try {
    // The immutable selected release is fully downloaded and verified before
    // the confirmation or any destructive Compose operation.
    downloaded = await deps.preflightSource();
    assert(downloaded.pointer, 'Verified selected-release pointer is required.');
    assert.equal(downloaded.pointer.releaseId, downloaded.manifest.releaseId);
    await deps.verifySourceLifecycle(downloaded);
    await deps.startDataServices();
    const inventory = await deps.inspectInventory();
    const plan = {
      status: 'CORPUS_RESET_PLAN',
      project: deps.project,
      selectedReleaseId: downloaded.manifest.releaseId,
      localState: inventory.state,
      stores: inventory.stores || null,
      volumes: volumeNames,
      mutation: !flags.dryRun
    };
    console.log(JSON.stringify(plan));
    if (flags.dryRun) return plan;
    if (!flags.yes) await deps.confirmReset(deps.project);

    await deps.stopAndReset();
    await deps.startDataServices();
    const captured = { value: null };
    const restored = await deps.restoreSelected(downloaded, captured);
    if (!captured.value || restored.status !== 'CORPUS_RESTORE_OK') {
      throw resetError('CORPUS_RESET_RESTORE_INCOMPLETE', 'Restore did not produce a verified local release state.');
    }
    await deps.startFullStack();
    await deps.healthAndConsistency(downloaded);
    await deps.writeReadyState(captured.value);
    const result = {
      status: 'CORPUS_RESET_READY',
      project: deps.project,
      releaseId: downloaded.manifest.releaseId,
      checksumVerified: true,
      consistency: 'VERIFIED'
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    if (downloaded?.ownsTemporary && downloaded.temporary) {
      await deps.removeTemporary(downloaded.temporary);
    }
  }
}

async function main() {
  try {
    await runCorpusReset(parseResetOptions());
  } catch (error) {
    const { redacted } = require('./remote-test-utils');
    console.error(`${error.code || 'CORPUS_RESET_FAILED'}: ${redacted(error.message)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertLifecyclePoints,
  assertManagedProject,
  parseResetOptions,
  runCorpusReset,
  verifyDownloadedQdrantLifecycle
};

if (require.main === module) main();
