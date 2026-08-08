'use strict';

const path = require('path');
process.env.REMOTE_COMPOSE_PROJECT = process.env.REMOTE_LIFECYCLE_COMPOSE_PROJECT
  || `edurag_remote_test_lifecycle_${process.pid}`;
process.env.REMOTE_E2E_CONFIRM_ISOLATED = 'true';

const assert = require('assert/strict');
const { spawn } = require('child_process');
const net = require('net');

const {
  compose,
  composeProject,
  docker,
  assertRemoteResetAllowed,
  publishedPort,
  redacted,
  resolvedComposeConfig,
  root
} = require('./remote-test-utils');

function freeHostPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function configureIsolatedHostPorts() {
  const names = [
    'APP_HOST_PORT',
    'REMOTE_MYSQL_HOST_PORT',
    'QDRANT_HTTP_HOST_PORT',
    'QDRANT_GRPC_HOST_PORT',
    'PYTHON_HOST_PORT'
  ];
  const used = new Set();
  for (const name of names) {
    let port;
    do {
      port = await freeHostPort();
    } while (used.has(port));
    used.add(port);
    process.env[name] = String(port);
  }
}

function projectResources() {
  const label = `label=com.docker.compose.project=${composeProject}`;
  return [
    docker(['ps', '-a', '--filter', label, '--format', '{{.ID}}']),
    docker(['volume', 'ls', '--filter', label, '--format', '{{.Name}}']),
    docker(['network', 'ls', '--filter', label, '--format', '{{.Name}}'])
  ].filter(Boolean);
}

function occupyLegacyMysqlPort() {
  const name = `${composeProject}-legacy-mysql-port-blocker`;
  const existing = docker(['container', 'inspect', name], { allowFailure: true });
  assert.notEqual(existing.status, 0,
    `Refusing to reuse or remove pre-existing blocker container ${name}.`);
  const started = docker([
    'run', '-d', '--name', name,
    '--label', `edurag.test.owner=${composeProject}`,
    '-p', '127.0.0.1:3306:6333',
    'qdrant/qdrant:v1.18.2'
  ], { allowFailure: true });
  if (typeof started === 'string') {
    console.log('REMOTE_DEV_LEGACY_PORT_BLOCKED port=3306 owner=test');
    return { name, owned: true };
  }
  const detail = redacted(started.stderr || started.stdout || '');
  assert.match(detail, /port|bind|listen|socket|permission/i,
    `Could not establish that port 3306 is unavailable: ${detail}`);
  docker(['rm', '-f', name], { allowFailure: true });
  console.log('REMOTE_DEV_LEGACY_PORT_BLOCKED port=3306 owner=external_or_reserved');
  return { name, owned: false };
}

async function main() {
  assert.equal(process.env.REMOTE_E2E_CONFIRM_ISOLATED, 'true',
    'Lifecycle test requires REMOTE_E2E_CONFIRM_ISOLATED=true.');
  assert.match(composeProject, /^edurag_remote_test_/,
    'Lifecycle test requires an isolated edurag_remote_test_* Compose project.');
  assert.equal(projectResources().length, 0,
    `Lifecycle test project already has Docker resources: ${composeProject}.`);
  await configureIsolatedHostPorts();
  process.env.MYSQL_HOST_PORT = '3306';
  const blocker = occupyLegacyMysqlPort();
  try {
    const config = resolvedComposeConfig();
    const dbHostPort = publishedPort(config, 'db', 3306);
    assert.equal(dbHostPort, Number(process.env.REMOTE_MYSQL_HOST_PORT || 13306));
    assert.notEqual(dbHostPort, 3306,
      'Remote topology must not inherit the base/mock host port 3306.');

    const child = spawn(process.execPath, [path.join(root, 'scripts', 'remote-dev.js')], {
      cwd: root,
      env: {
        ...process.env,
        CORPUS_BOOTSTRAP: 'auto',
        GCS_PROJECT_ID: '',
        GCS_BUCKET: '',
        GCS_OBJECT_PREFIX: '',
        GCS_CREDENTIALS_FILE: '',
        REMOTE_DEV_ALL_LOGS: 'false',
        REMOTE_DEV_TEST_SHUTDOWN_AFTER_ATTACH_MS: '1000'
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let output = '';
    let attached = false;
    const lifecycleTimeoutMs = Number(process.env.REMOTE_DEV_LIFECYCLE_TIMEOUT_MS || 600000);
    assert(Number.isFinite(lifecycleTimeoutMs) && lifecycleTimeoutMs >= 60000,
      'REMOTE_DEV_LIFECYCLE_TIMEOUT_MS must be at least 60000.');
    const deadline = setTimeout(() => {
      if (!child.killed) child.kill('SIGTERM');
    }, lifecycleTimeoutMs);

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
    assert.match(output, new RegExp(
      `REMOTE_DEV_TOPOLOGY db=db:3306 hostDbPort=${dbHostPort} mode=remote`
    ));
    assert.match(output, /REMOTE_DEV_RECREATED service=app mode=remote volumes=retained/);
    assert.match(output, /CORPUS_BOOTSTRAP_SKIPPED reason=GCS_CONFIG_MISSING local=EMPTY/);
    assert.match(output, /REMOTE_DEV_CORPUS state=DEGRADED/);
    assert.match(output, /REMOTE_DEV_STOPPING reason=TEST_SIGNAL/);
    assert.match(output, /REMOTE_DEV_STOPPED volumes=retained/);

    const appId = compose(['ps', '-aq', 'app']).trim();
    assert(appId, 'Stopped app container was not retained for environment inspection.');
    const appEnvironment = JSON.parse(docker([
      'inspect', '--format', '{{json .Config.Env}}', appId
    ]));
    assert(appEnvironment.includes('RAG_MODE=remote'));
    assert(appEnvironment.includes('DB_HOST=db'));
    assert(appEnvironment.includes('DB_PORT=3306'));

    const running = compose(['ps', '--status', 'running', '--services']);
    assert.equal(running.trim(), '', 'Ctrl+C must stop all remote services.');
    for (const suffix of ['mysql_data', 'qdrant_data', 'uploads_data']) {
      docker(['volume', 'inspect', `${composeProject}_${suffix}`]);
    }

    compose(['down', '--remove-orphans']);
    assert.equal(docker([
      'ps', '-a', '--filter', `label=com.docker.compose.project=${composeProject}`, '--format', '{{.ID}}'
    ]).trim(), '', 'down must remove project containers.');
    assert.equal(docker([
      'network', 'ls', '--filter', `label=com.docker.compose.project=${composeProject}`, '--format', '{{.ID}}'
    ]).trim(), '', 'down must remove the project network.');
    for (const suffix of ['mysql_data', 'qdrant_data', 'uploads_data']) {
      docker(['volume', 'inspect', `${composeProject}_${suffix}`]);
    }
    compose(['up', '-d', '--wait', 'db', 'qdrant']);
    compose(['stop']);
    for (const suffix of ['mysql_data', 'qdrant_data', 'uploads_data']) {
      docker(['volume', 'inspect', `${composeProject}_${suffix}`]);
    }
    console.log(
      'REMOTE_DEV_LIFECYCLE_OK legacy_port_3306=unavailable '
      + 'internal_db=db:3306 mode=remote corpus=degraded_empty '
      + 'controlled_shutdown=true down=volumes_retained rerun=true'
    );
  } finally {
    if (blocker.owned) docker(['rm', '-f', blocker.name], { allowFailure: true });
    assertRemoteResetAllowed(['down', '-v', '--remove-orphans']);
    compose(['down', '-v', '--remove-orphans', '--rmi', 'local'], { allowFailure: true });
    assert.equal(projectResources().length, 0,
      `Lifecycle test cleanup left Docker resources for ${composeProject}.`);
  }
}

main().catch((error) => {
  console.error(`REMOTE_DEV_LIFECYCLE_FAILED: ${redacted(error.message)}`);
  process.exit(1);
});
