'use strict';

const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');

const { compose, composeProject, docker, redacted, root } = require('./remote-test-utils');

async function main() {
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'remote-dev.js')], {
    cwd: root,
    env: {
      ...process.env,
      CORPUS_BOOTSTRAP: 'off',
      REMOTE_DEV_ALL_LOGS: 'false',
      REMOTE_DEV_TEST_SHUTDOWN_AFTER_ATTACH_MS: '1000'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let output = '';
  let attached = false;
  const deadline = setTimeout(() => {
    if (!child.killed) child.kill('SIGTERM');
  }, 300000);

  function capture(chunk) {
    const text = redacted(chunk.toString());
    output += text;
    process.stdout.write(text);
    if (output.includes('REMOTE_DEV_ATTACHED')) attached = true;
  }
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  clearTimeout(deadline);
  assert(attached, 'remote-dev never reached attached logs state.');
  assert.equal(code, 0, `remote-dev exited with ${code}.`);
  assert.match(output, /REMOTE_DEV_STOPPING reason=TEST_SIGNAL/);
  assert.match(output, /REMOTE_DEV_STOPPED volumes=retained/);
  const running = compose(['ps', '--status', 'running', '--services']);
  assert.equal(running.trim(), '', 'Ctrl+C must stop all remote services.');
  for (const suffix of ['mysql_data', 'qdrant_data', 'uploads_data']) {
    docker(['volume', 'inspect', `${composeProject}_${suffix}`]);
  }
  console.log('REMOTE_DEV_LIFECYCLE_OK controlled_shutdown=shared_signal_path containers=stopped volumes=retained');
}

main().catch((error) => {
  console.error(`REMOTE_DEV_LIFECYCLE_FAILED: ${redacted(error.message)}`);
  process.exit(1);
});
