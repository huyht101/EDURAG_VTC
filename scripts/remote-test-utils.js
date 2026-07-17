'use strict';

const { spawnSync } = require('child_process');
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
      .split(/\r?\n/).filter(Boolean).slice(0, 3).join(' | ');
    throw new Error(`Docker command failed: ${detail || `exit ${result.status}`}`);
  }
  return String(result.stdout || '').trim();
}

function compose(args, options) {
  return docker([...composePrefix, ...args], options);
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
  composeExec,
  composePort,
  REMOTE_REQUIRED_ENVIRONMENT,
  assertRemoteEnvironment,
  delay,
  fetchWithTimeout
};
