'use strict';

const assert = require('assert/strict');
const {
  assertRemoteEnvironment,
  remoteRequiredEnvironment
} = require('./remote-test-utils');

const base = Object.freeze({
  GOOGLE_API_KEY: 'offline-google-key',
  RAG_INTERNAL_TOKEN: 'offline-internal-token-0123456789abcdef',
  DB_PASSWORD: 'offline-db-password',
  MYSQL_ROOT_PASSWORD: 'offline-db-password'
});

assert(!remoteRequiredEnvironment({ ...base, OCR_MODE: 'OFF' }).includes('LLAMA_CLOUD_API_KEY'));
assert.doesNotThrow(() => assertRemoteEnvironment({ ...base, OCR_MODE: 'OFF' }));

assert(remoteRequiredEnvironment({ ...base, OCR_MODE: 'AUTO' }).includes('LLAMA_CLOUD_API_KEY'));
assert.throws(
  () => assertRemoteEnvironment({ ...base, OCR_MODE: 'AUTO' }),
  (error) => error.code === 'REMOTE_PREFLIGHT_ENV_MISSING'
    && error.message.includes('LLAMA_CLOUD_API_KEY')
);
assert.doesNotThrow(() => assertRemoteEnvironment({
  ...base,
  OCR_MODE: 'AUTO',
  LLAMA_CLOUD_API_KEY: 'offline-llama-key'
}));

console.log('RAG_CONFIG_OK explicit_ocr_mode=true key_presence_guard=true');
