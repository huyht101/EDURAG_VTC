'use strict';

const { spawn, spawnSync } = require('child_process');
const net = require('net');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rootEnvFile = path.join(root, '.env');
require('dotenv').config({ path: rootEnvFile });

const composeProject = process.env.REMOTE_COMPOSE_PROJECT || 'edurag_remote_e2e';
const composePrefix = [
  'compose', '--profile', 'rag', '-p', composeProject,
  '-f', path.join(root, 'docker-compose.yml'),
  '-f', path.join(root, 'docker-compose.remote.yml')
];

const REMOTE_REQUIRED_ENVIRONMENT = Object.freeze([
  'GOOGLE_API_KEY',
  'LLAMA_CLOUD_API_KEY',
  'RAG_INTERNAL_TOKEN',
  'DB_PASSWORD',
  'MYSQL_ROOT_PASSWORD'
]);

function redacted(value) {
  let text = String(value || '');
  for (const name of [
    'GOOGLE_API_KEY', 'LLAMA_CLOUD_API_KEY', 'RAG_INTERNAL_TOKEN', 'INTERNAL_SECRET',
    'JWT_SECRET', 'TOKEN_HMAC_PEPPER', 'DB_PASSWORD', 'MYSQL_ROOT_PASSWORD'
  ]) {
    const secret = process.env[name];
    if (secret) text = text.split(secret).join('[REDACTED]');
  }
  return text;
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    if (options.allowFailure) return result;
    const detail = redacted(result.stderr || result.stdout || result.error?.message)
      .split(/\r?\n/).filter(Boolean).slice(-5).join(' | ');
    throw new Error(`Docker command failed: ${detail || `exit ${result.status}`}`);
  }
  return String(result.stdout || '').trim();
}

function compose(args, options) {
  return docker([...composePrefix, ...args], options);
}

function composeCommandArgs(args = []) {
  return [...composePrefix, ...args];
}

function spawnCompose(args, options = {}) {
  return spawn('docker', composeCommandArgs(args), {
    cwd: root,
    stdio: options.stdio || 'inherit',
    windowsHide: options.windowsHide ?? false,
    env: options.env || process.env
  });
}

function runComposeCli() {
  const result = spawnSync('docker', composeCommandArgs(process.argv.slice(2)), {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: process.env
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function composeExec(service, command) {
  return compose(['exec', '-T', service, ...command]);
}

function composePort(service, containerPort) {
  const output = compose(['port', service, String(containerPort)]).split(/\r?\n/)[0].trim();
  const match = output.match(/:(\d+)$/);
  if (!match) throw new Error(`Cannot resolve published port for ${service}:${containerPort}.`);
  return Number(match[1]);
}

function resolvedComposeConfig() {
  return JSON.parse(compose(['config', '--format', 'json']));
}

function publishedPort(config, service, containerPort) {
  const ports = config.services?.[service]?.ports || [];
  const mapping = ports.find((entry) => Number(entry.target) === Number(containerPort));
  return mapping ? Number(mapping.published) : null;
}

function existingProjectDbUsesPort(port) {
  const result = compose(['ps', '-q', 'db'], { allowFailure: true });
  if (typeof result !== 'string' || !result.trim()) return false;
  const bindings = JSON.parse(docker([
    'inspect', '--format', '{{json .NetworkSettings.Ports}}', result.trim()
  ]));
  return (bindings['3306/tcp'] || []).some((binding) => Number(binding.HostPort) === port);
}

async function assertRemoteDbHostPortAvailable() {
  const port = publishedPort(resolvedComposeConfig(), 'db', 3306);
  if (!port || existingProjectDbUsesPort(port)) return port;
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (cause) => {
      const error = new Error(
        `Remote MySQL host port ${port} is unavailable (${cause.code || 'bind failed'}). `
        + 'Set REMOTE_MYSQL_HOST_PORT to a free loopback port and rerun '
        + '`npm run docker:remote:dev`.'
      );
      error.code = 'REMOTE_DB_HOST_PORT_UNAVAILABLE';
      reject(error);
    });
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(resolve);
    });
  });
  return port;
}

function assertRemoteEnvironment() {
  const missing = REMOTE_REQUIRED_ENVIRONMENT.filter((name) => !process.env[name]);
  if (missing.length) {
    const error = new Error(`Missing required environment variables: ${missing.join(', ')}`);
    error.code = 'REMOTE_PREFLIGHT_ENV_MISSING';
    throw error;
  }
  if (process.env.RAG_INTERNAL_TOKEN.length < 32) {
    const error = new Error('RAG_INTERNAL_TOKEN must contain at least 32 characters.');
    error.code = 'REMOTE_PREFLIGHT_TOKEN_INVALID';
    throw error;
  }
  if (process.env.DB_PASSWORD !== process.env.MYSQL_ROOT_PASSWORD) {
    const error = new Error(
      'Remote demo uses the MySQL root user, so DB_PASSWORD and MYSQL_ROOT_PASSWORD must match.'
    );
    error.code = 'REMOTE_PREFLIGHT_DATABASE_CONFIG_INVALID';
    throw error;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  return fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(timeoutMs) });
}

module.exports = {
  root,
  composeProject,
  redacted,
  docker,
  compose,
  composeCommandArgs,
  spawnCompose,
  composeExec,
  composePort,
  resolvedComposeConfig,
  publishedPort,
  assertRemoteDbHostPortAvailable,
  REMOTE_REQUIRED_ENVIRONMENT,
  assertRemoteEnvironment,
  delay,
  fetchWithTimeout
};

if (require.main === module) runComposeCli();
