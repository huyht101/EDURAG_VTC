'use strict';

const assert = require('assert/strict');

const { bootstrapCorpus } = require('./corpus-manager');
const { compose, composeExec, composeProject, redacted } = require('./remote-test-utils');

async function main() {
  assert(
    process.env.REMOTE_E2E_CONFIRM_ISOLATED === 'true'
      && composeProject.startsWith('edurag_corpus_partial_'),
    'Partial-state test requires an explicitly confirmed edurag_corpus_partial_* project.'
  );
  compose(['config', '--quiet']);
  try {
    compose(['up', '-d', '--wait', 'db', 'qdrant']);
    composeExec('db', ['sh', '-lc', [
      'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"',
      'exec mysql -uroot edurag --batch --execute="INSERT INTO documents '
        + '(uploaded_by,title,original_filename,storage_type,storage_key,file_type,mime_type,file_size_bytes,'
        + 'checksum_sha256,processing_status,visibility_status,processed_at) '
        + 'SELECT id,\'partial restore marker\',\'partial.txt\',\'LOCAL\',\'documents/partial/partial.txt\','
        + '\'TXT\',\'text/plain\',1,REPEAT(\'0\',64),\'READY\',\'VISIBLE\',UTC_TIMESTAMP(3) '
        + 'FROM users WHERE email=\'admin@example.com\'"'
    ].join('; ')]);
    const previousMode = process.env.CORPUS_BOOTSTRAP;
    process.env.CORPUS_BOOTSTRAP = 'auto';
    try {
      const result = await bootstrapCorpus();
      assert.equal(result.status, 'CORPUS_RESTORE_SKIPPED_LOCAL_PRESENT');
      assert.equal(result.partial, true);
    } finally {
      if (previousMode === undefined) delete process.env.CORPUS_BOOTSTRAP;
      else process.env.CORPUS_BOOTSTRAP = previousMode;
    }
    console.log('CORPUS_PARTIAL_STATE_TEST_OK auto=retained no_overwrite=true');
  } finally {
    compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
  }
}

main().catch((error) => {
  console.error(`CORPUS_PARTIAL_STATE_TEST_FAILED: ${redacted(error.message)}`);
  process.exit(1);
});
