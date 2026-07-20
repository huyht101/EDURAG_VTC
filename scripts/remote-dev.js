'use strict';

const {
  assertRemoteEnvironment,
  compose,
  redacted,
  spawnCompose
} = require('./remote-test-utils');
const { main: runPreflight } = require('./remote-preflight');
const { bootstrapCorpus } = require('./corpus-manager');
const { bootstrapOriginalFiles } = require('./corpus-files-manager');

let logProcess = null;
let shuttingDown = false;

function stopStack(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`REMOTE_DEV_STOPPING reason=${reason}`);
  if (logProcess && !logProcess.killed) {
    try { logProcess.kill(); } catch (_error) { /* best effort */ }
  }
  const stopped = compose(['stop'], { allowFailure: true });
  if (typeof stopped !== 'string' && stopped.status !== 0) {
    console.error('REMOTE_DEV_STOP_FAILED: containers may require npm run docker:remote:stop');
    exitCode = exitCode || 1;
  } else {
    console.log('REMOTE_DEV_STOPPED volumes=retained');
  }
  process.exitCode = exitCode;
}

function installSignalHandlers() {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      stopStack(signal, 0);
      process.exit();
    });
  }
}

async function main() {
  installSignalHandlers();
  assertRemoteEnvironment();
  compose(['config', '--quiet']);

  compose(['build', 'app', 'rag-service']);
  compose(['up', '-d', '--wait', 'db', 'qdrant']);
  await bootstrapCorpus();
  compose(['create', 'app']);
  await bootstrapOriginalFiles();
  compose(['up', '-d', '--wait', 'app', 'rag-service']);
  await runPreflight();

  if (process.env.REMOTE_DEV_EXIT_AFTER_PREFLIGHT === 'true') {
    stopStack('PREFLIGHT_TEST_EXIT', 0);
    return;
  }

  const services = process.env.REMOTE_DEV_ALL_LOGS === 'true'
    ? ['db', 'qdrant', 'app', 'rag-service']
    : ['app', 'rag-service'];
  console.log(`REMOTE_DEV_ATTACHED services=${services.join(',')} (Ctrl+C stops containers; volumes are retained)`);
  logProcess = spawnCompose(['logs', '--follow', '--tail', '100', ...services]);
  const testShutdownDelay = Number(process.env.REMOTE_DEV_TEST_SHUTDOWN_AFTER_ATTACH_MS || 0);
  if (Number.isFinite(testShutdownDelay) && testShutdownDelay > 0) {
    setTimeout(() => {
      stopStack('TEST_SIGNAL', 0);
      process.exit();
    }, testShutdownDelay);
  }
  logProcess.once('error', (error) => {
    console.error(`REMOTE_DEV_LOG_FAILED: ${redacted(error.message)}`);
    stopStack('LOG_PROCESS_ERROR', 1);
  });
  logProcess.once('exit', (code) => {
    if (!shuttingDown) stopStack('LOG_PROCESS_EXIT', code || 0);
  });
}

main().catch((error) => {
  console.error(`${error.code || 'REMOTE_DEV_FAILED'}: ${redacted(error.message)}`);
  stopStack('STARTUP_FAILURE', 1);
});
