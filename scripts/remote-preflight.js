'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const {
  docker,
  compose,
  composeExec,
  composePort,
  requiredEnvironment,
  fetchWithTimeout
} = require('./remote-test-utils');

function resolvedModels() {
  return {
    generation: process.env.GEMINI_LLM_MODEL || 'models/gemini-3.5-flash',
    embedding: process.env.GEMINI_EMBEDDING_MODEL || 'models/gemini-embedding-001'
  };
}

async function main() {
  const missing = requiredEnvironment([
    'GOOGLE_API_KEY', 'LLAMA_CLOUD_API_KEY', 'RAG_INTERNAL_TOKEN',
    'DB_PASSWORD', 'MYSQL_ROOT_PASSWORD'
  ]);
  if (missing.length) {
    const error = new Error(`Missing required environment variables: ${missing.join(', ')}`);
    error.code = 'REMOTE_PREFLIGHT_ENV_MISSING';
    throw error;
  }
  assert(process.env.RAG_INTERNAL_TOKEN.length >= 32, 'RAG_INTERNAL_TOKEN must contain at least 32 characters.');
  assert.equal(process.env.DB_PASSWORD, process.env.MYSQL_ROOT_PASSWORD,
    'Remote demo uses the MySQL root user, so DB_PASSWORD and MYSQL_ROOT_PASSWORD must match.');

  const models = resolvedModels();
  assert.equal(models.embedding.replace(/^models\//, ''), 'gemini-embedding-001');
  assert.match(models.generation, /flash/i, 'GEMINI_LLM_MODEL must resolve to a Gemini Flash model.');

  docker(['info', '--format', '{{.ServerVersion}}']);
  const running = new Set(compose(['ps', '--status', 'running', '--services']).split(/\r?\n/).filter(Boolean));
  for (const service of ['db', 'app', 'rag-service', 'qdrant']) {
    assert(running.has(service), `${service} is not running.`);
  }

  const nodePort = composePort('app', 5000);
  const pythonPort = composePort('rag-service', 8000);
  const qdrantPort = composePort('qdrant', 6333);
  const [nodeHealth, pythonHealth, qdrantHealth] = await Promise.all([
    fetchWithTimeout(`http://127.0.0.1:${nodePort}/health`),
    fetchWithTimeout(`http://127.0.0.1:${pythonPort}/api/health`),
    fetchWithTimeout(`http://127.0.0.1:${qdrantPort}/healthz`)
  ]);
  assert.equal(nodeHealth.status, 200, 'Node health failed.');
  assert.equal(pythonHealth.status, 200, 'Python health failed.');
  assert.equal(qdrantHealth.status, 200, 'Qdrant health failed.');

  composeExec('app', ['node', '-e', [
    "if(process.env.RAG_MODE!=='remote') throw new Error('RAG_MODE is not remote')",
    "if(process.env.RAG_SERVICE_URL!=='http://rag-service:8000') throw new Error('RAG_SERVICE_URL is not container-safe')",
    "fetch(process.env.RAG_SERVICE_URL+'/api/query',{method:'POST',headers:{authorization:'Bearer '+process.env.RAG_INTERNAL_TOKEN,'content-type':'application/json'},body:'{}'}).then(r=>{if(r.status!==422)throw new Error('Node to Python auth/reachability status '+r.status);console.log('NODE_TO_PYTHON_OK')})"
  ].join(';')]);

  composeExec('rag-service', ['python', '-c', [
    'import json, os, urllib.error, urllib.request',
    "url=os.environ['NODE_CALLBACK_URL']",
    "token=os.environ['INTERNAL_SECRET']",
    "req=urllib.request.Request(url,data=b'{}',headers={'Content-Type':'application/json','Authorization':'Bearer '+token},method='POST')",
    'try:\n urllib.request.urlopen(req,timeout=10)\n raise RuntimeError("Node accepted invalid callback payload")\nexcept urllib.error.HTTPError as exc:\n assert exc.code == 400, exc.code',
    "bad=urllib.request.Request(url,data=b'{}',headers={'Content-Type':'application/json','Authorization':'Bearer invalid-token'},method='POST')",
    'try:\n urllib.request.urlopen(bad,timeout=10)\n raise RuntimeError("Node accepted invalid internal token")\nexcept urllib.error.HTTPError as exc:\n assert exc.code == 401, exc.code',
    "assert urllib.request.urlopen(os.environ['QDRANT_URL']+'/healthz',timeout=10).status == 200",
    "print('PYTHON_TO_NODE_AND_QDRANT_OK')"
  ].join('\n')]);

  const probe = `.remote-preflight-${crypto.randomUUID()}.txt`;
  try {
    composeExec('app', ['node', '-e', [
      "const fs=require('fs'),path=require('path')",
      `fs.writeFileSync(path.join(process.env.UPLOAD_DIR,${JSON.stringify(probe)}),'remote-shared-volume-probe',{flag:'wx'})`
    ].join(';')]);
    composeExec('rag-service', ['python', '-c', [
      'import os, pathlib',
      `p=pathlib.Path(os.environ['PYTHON_SHARED_UPLOAD_DIR'])/${JSON.stringify(probe)}`,
      "assert p.is_file() and p.read_text() == 'remote-shared-volume-probe'",
      "print('SHARED_VOLUME_OK')"
    ].join(';')]);
  } finally {
    composeExec('app', ['node', '-e', [
      "const fs=require('fs'),path=require('path')",
      `fs.rmSync(path.join(process.env.UPLOAD_DIR,${JSON.stringify(probe)}),{force:true})`
    ].join(';')]);
  }

  console.log(`REMOTE_PREFLIGHT_OK generation=${models.generation} embedding=${models.embedding}`);
  return { models, nodePort, pythonPort, qdrantPort };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${error.code || 'REMOTE_PREFLIGHT_FAILED'}: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main, resolvedModels };
