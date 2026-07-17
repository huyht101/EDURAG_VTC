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
      'exec mysql -uroot edurag --batch --execute="INSERT INTO auth_tokens (user_id, token_type, token_hash, expires_at) SELECT id, \'PASSWORD_RESET\', REPEAT(\'0\', 64), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR) FROM users WHERE email=\'admin@example.com\'"'
    ].join('; ')]);
    const previousMode = process.env.CORPUS_BOOTSTRAP;
    process.env.CORPUS_BOOTSTRAP = 'auto';
    try {
      await assert.rejects(
        () => bootstrapCorpus(),
        (error) => error.code === 'CORPUS_PARTIAL_STATE'
      );
    } finally {
      if (previousMode === undefined) delete process.env.CORPUS_BOOTSTRAP;
      else process.env.CORPUS_BOOTSTRAP = previousMode;
    }
    console.log('CORPUS_PARTIAL_STATE_TEST_OK auto=blocked no_overwrite=true');
  } finally {
    compose(['down', '-v', '--remove-orphans'], { allowFailure: true });
  }
}

main().catch((error) => {
  console.error(`CORPUS_PARTIAL_STATE_TEST_FAILED: ${redacted(error.message)}`);
  process.exit(1);
});
