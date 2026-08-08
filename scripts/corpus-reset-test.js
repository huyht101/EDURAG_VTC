'use strict';

const assert = require('assert/strict');
const { assertLifecyclePoints, runCorpusReset } = require('./corpus-reset');

const project = 'edurag_corpus_reset_contract_test';
const manifest = { releaseId: 'v1-0123456789abcdef01234567' };
const pointer = { releaseId: manifest.releaseId, manifestSha256: 'a'.repeat(64) };

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function fixture(initialState = 'EMPTY', overrides = {}) {
  const events = [];
  const external = { untouched: true };
  let state = initialState;
  let readyState = null;
  const downloaded = { manifest, pointer, ownsTemporary: false };
  const deps = {
    complete: true,
    project,
    resolveConfig: async () => ({ volumes: {
      mysql_data: { name: `${project}_mysql_data` },
      qdrant_data: { name: `${project}_qdrant_data` },
      uploads_data: { name: `${project}_uploads_data` }
    } }),
    preflightSource: async () => downloaded,
    verifySourceLifecycle: async () => { events.push('verify-source'); },
    startDataServices: async () => { events.push('start-data'); },
    inspectInventory: async () => ({ state, stores: { mysql: state, qdrant: state, uploads: state } }),
    confirmReset: async () => { throw new Error('--yes must not prompt'); },
    stopAndReset: async () => { events.push('reset'); state = 'EMPTY'; readyState = null; },
    restoreSelected: async (_source, capture) => {
      events.push('restore');
      state = 'PRESENT';
      capture.value = { releaseId: manifest.releaseId, manifestSha256: pointer.manifestSha256 };
      return { status: 'CORPUS_RESTORE_OK' };
    },
    startFullStack: async () => { events.push('start-full'); },
    healthAndConsistency: async () => { events.push('verify'); },
    writeReadyState: async (value) => { events.push('ready'); readyState = value; },
    removeTemporary: async () => {},
    ...overrides
  };
  return { deps, events, external, get state() { return state; }, get readyState() { return readyState; } };
}

async function expectReady(initialState) {
  const run = fixture(initialState);
  const result = await runCorpusReset({ yes: true, argv: [] }, run.deps);
  assert.equal(result.status, 'CORPUS_RESET_READY');
  assert.deepEqual(run.events, ['verify-source', 'start-data', 'reset', 'start-data', 'restore', 'start-full', 'verify', 'ready']);
  assert.equal(run.readyState.releaseId, manifest.releaseId);
  assert.equal(run.external.untouched, true);
}

async function main() {
  for (const state of ['EMPTY', 'PRESENT_EXACT', 'PRESENT_DIFFERENT', 'PARTIAL']) {
    await expectReady(state);
  }

  for (const code of ['CORPUS_RELEASE_CHECKSUM_MISMATCH', 'CORPUS_RELEASE_INCOMPATIBLE']) {
    const run = fixture('PRESENT', { preflightSource: async () => { throw failure(code); } });
    await assert.rejects(() => runCorpusReset({ yes: true, argv: [] }, run.deps), (error) => error.code === code);
    assert(!run.events.includes('reset'), `${code} reached the destructive boundary.`);
  }
  assert.doesNotThrow(() => assertLifecyclePoints([{
    payload: { is_active: true, is_hidden: false, ingest_attempt_key: '1::2::3' }
  }], 1));
  for (const payload of [
    { is_hidden: false, ingest_attempt_key: '1::2::3' },
    { is_active: true, ingest_attempt_key: '1::2::3' },
    { is_active: true, is_hidden: false }
  ]) {
    assert.throws(
      () => assertLifecyclePoints([{ payload }], 1),
      (error) => error.code === 'CORPUS_QDRANT_LIFECYCLE_INCOMPATIBLE'
    );
  }
  const incompatiblePayload = fixture('PRESENT', {
    verifySourceLifecycle: async () => { throw failure('CORPUS_QDRANT_LIFECYCLE_INCOMPATIBLE'); }
  });
  await assert.rejects(
    () => runCorpusReset({ yes: true, argv: [] }, incompatiblePayload.deps),
    (error) => error.code === 'CORPUS_QDRANT_LIFECYCLE_INCOMPATIBLE'
  );
  assert(!incompatiblePayload.events.includes('reset'));

  let failOnce = true;
  const interrupted = fixture('PARTIAL', {
    restoreSelected: async (_source, capture) => {
      interrupted.events.push('restore');
      if (failOnce) {
        failOnce = false;
        throw failure('CORPUS_RESTORE_APPLY_FAILED');
      }
      capture.value = { releaseId: manifest.releaseId, manifestSha256: pointer.manifestSha256 };
      return { status: 'CORPUS_RESTORE_OK' };
    }
  });
  await assert.rejects(
    () => runCorpusReset({ yes: true, argv: [] }, interrupted.deps),
    (error) => error.code === 'CORPUS_RESTORE_APPLY_FAILED'
  );
  assert.equal(interrupted.readyState, null, 'Interrupted restore wrote a READY marker.');
  const rerun = await runCorpusReset({ yes: true, argv: [] }, interrupted.deps);
  assert.equal(rerun.status, 'CORPUS_RESET_READY');

  const dryRun = fixture('PRESENT_DIFFERENT');
  const plan = await runCorpusReset({ dryRun: true, argv: [] }, dryRun.deps);
  assert.equal(plan.status, 'CORPUS_RESET_PLAN');
  assert.equal(plan.mutation, false);
  assert(!dryRun.events.includes('reset'));

  console.log('CORPUS_RESET_TEST_OK empty=true exact=true different=true partial=true preflight_fail_closed=true lifecycle_payload_preflight=true interrupted_no_ready=true rerun=true stable=true dry_run=true external_untouched=true');
}

main().catch((error) => {
  console.error(`CORPUS_RESET_TEST_FAILED: ${error.code || 'UNCLASSIFIED'} ${error.message}`);
  process.exit(1);
});
