'use strict';

const assert = require('assert/strict');

const { bootstrapCorpus, inspectBootstrapState } = require('./corpus-manager');
const {
  compose, composeExec, composeProject, delay, docker, redacted
} = require('./remote-test-utils');

function projectResources() {
  const label = `label=com.docker.compose.project=${composeProject}`;
  return [
    ['container', docker(['ps', '-a', '--filter', label, '--format', '{{.ID}}'])],
    ['volume', docker(['volume', 'ls', '--filter', label, '--format', '{{.Name}}'])],
    ['network', docker(['network', 'ls', '--filter', label, '--format', '{{.Name}}'])]
  ].filter(([, value]) => value);
}

function assertProjectUnused() {
  const existing = projectResources();
  assert.equal(
    existing.length,
    0,
    `Refusing to reuse/delete pre-existing Docker resources for ${composeProject}: `
      + existing.map(([kind]) => kind).join(', ')
  );
}

async function waitForSchema() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const count = composeExec('db', ['sh', '-lc', [
        'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"',
        'exec mysql -uroot "$MYSQL_DATABASE" --batch --skip-column-names '
          + '--execute="SELECT COUNT(*) FROM information_schema.tables '
          + 'WHERE table_schema=DATABASE() AND table_name=\'documents\';"'
      ].join('; ')]);
      if (String(count).trim() === '1') return;
    } catch (_error) {
      // MySQL can become healthcheck-ready before initdb scripts finish.
    }
    await delay(500);
  }
  throw new Error('Disposable MySQL did not finish schema bootstrap.');
}

async function main() {
  assert(
    process.env.REMOTE_E2E_CONFIRM_ISOLATED === 'true'
      && composeProject.startsWith('edurag_corpus_partial_'),
    'Partial-state test requires an explicitly confirmed edurag_corpus_partial_* project.'
  );
  assertProjectUnused();
  process.env.MYSQL_HOST_PORT = '0';
  process.env.QDRANT_HTTP_HOST_PORT = '0';
  process.env.QDRANT_GRPC_HOST_PORT = '0';
  try {
    compose(['config', '--quiet']);
    compose(['up', '-d', '--wait', 'db', 'qdrant']);
    await waitForSchema();
    composeExec('db', ['sh', '-lc', [
      'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"',
      'exec mysql -uroot "$MYSQL_DATABASE" --batch --execute="INSERT INTO documents '
        + '(uploaded_by,title,original_filename,storage_type,storage_key,file_type,mime_type,file_size_bytes,'
        + 'checksum_sha256,processing_status,visibility_status,processed_at) '
        + 'SELECT id,\'partial restore marker\',\'partial.txt\',\'LOCAL\',\'documents/partial/partial.txt\','
        + '\'TXT\',\'text/plain\',1,REPEAT(\'0\',64),\'READY\',\'VISIBLE\',UTC_TIMESTAMP(3) '
        + 'FROM users WHERE email=\'admin@example.com\'"'
    ].join('; ')]);
    const previousMode = process.env.CORPUS_BOOTSTRAP;
    process.env.CORPUS_BOOTSTRAP = 'auto';
    try {
      const result = await bootstrapCorpus({
        inspectBootstrap: () => inspectBootstrapState({
          inspectUploads: async () => ({ empty: true, fileCount: 0 })
        })
      });
      assert.equal(result.status, 'CORPUS_RESTORE_SKIPPED_LOCAL_PRESENT');
      assert.equal(result.partial, true);
    } finally {
      if (previousMode === undefined) delete process.env.CORPUS_BOOTSTRAP;
      else process.env.CORPUS_BOOTSTRAP = previousMode;
    }
    console.log('CORPUS_PARTIAL_STATE_TEST_OK auto=retained no_overwrite=true');
  } finally {
    compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
    assertProjectUnused();
  }
}

main().catch((error) => {
  console.error(`CORPUS_PARTIAL_STATE_TEST_FAILED: ${redacted(error.message)}`);
  process.exit(1);
});
