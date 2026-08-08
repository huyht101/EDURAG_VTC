'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const mysql = require('mysql2/promise');

const { delay, redacted, root } = require('./remote-test-utils');

const project = `edurag_rag_production_offline_test_${process.pid}_${Date.now()}`;
const composeFile = path.join(root, 'docker-compose.rag-production-offline-test.yml');
const token = 'offline-production-internal-secret-0123456789abcdef';
const collection = 'edurag_production_offline_e2e';
const envFile = path.join(os.tmpdir(), `${project}.env`);

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 30 * 1024 * 1024,
    env: {
      ...process.env,
      RAG_PRODUCTION_OFFLINE_COMPOSE_PROJECT: project,
      OFFLINE_ACTIVATION_FAILURES: process.env.OFFLINE_ACTIVATION_FAILURES || '0'
    }
  });
  if (result.error || result.status !== 0) {
    if (options.allowFailure) return result;
    throw new Error(redacted(result.stderr || result.stdout || result.error?.message));
  }
  return String(result.stdout || '').trim();
}

function compose(args, options) {
  return docker(['compose', '--env-file', envFile, '-p', project, '-f', composeFile, ...args], options);
}

function resources() {
  const label = `label=com.docker.compose.project=${project}`;
  return [
    docker(['ps', '-a', '--filter', label, '--format', '{{.ID}}']),
    docker(['volume', 'ls', '--filter', label, '--format', '{{.Name}}']),
    docker(['network', 'ls', '--filter', label, '--format', '{{.Name}}'])
  ].filter(Boolean);
}

function port(service, internal) {
  const value = compose(['port', service, String(internal)]);
  const match = value.match(/:(\d+)$/);
  assert(match, `Cannot resolve ${service}:${internal}.`);
  return Number(match[1]);
}

async function request(base, pathname, options = {}, expected = [200]) {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(options.timeoutMs || 30000)
  });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : null;
  if (!expected.includes(response.status)) {
    throw new Error(`${options.method || 'GET'} ${pathname} returned ${response.status} (${payload?.errorCode || 'UNEXPECTED'}).`);
  }
  return { response, payload };
}

function bearer(value, headers = {}) {
  return { authorization: `Bearer ${value}`, ...headers };
}

async function waitUntil(label, callback, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await callback();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await delay(250);
  }
  throw new Error(`${label} timed out${last instanceof Error ? `: ${last.message}` : ''}.`);
}

async function scroll(qdrantBase, documentId) {
  const result = await request(qdrantBase, `/collections/${collection}/points/scroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filter: { must: [{ key: 'doc_id', match: { value: String(documentId) } }] },
      limit: 100,
      with_payload: true,
      with_vector: false
    })
  }, [200, 404]);
  return result.response.status === 404 ? [] : result.payload.result.points;
}

async function waitForJob(appBase, authToken, jobId) {
  return waitUntil(`job ${jobId}`, async () => {
    const value = (await request(appBase, `/api/documents/jobs/${jobId}`, {
      headers: bearer(authToken)
    })).payload.data;
    return ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(value.status) ? value : null;
  }, 90000);
}

async function upload(appBase, authToken, name, content) {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/plain' }), name);
  form.append('title', name);
  return (await request(appBase, '/api/documents', {
    method: 'POST',
    headers: bearer(authToken),
    body: form
  }, [202])).payload.data;
}

async function injectFilteredPoints(qdrantBase, documentId) {
  const points = [
    { id: crypto.randomUUID(), payload: { doc_id: String(documentId), text: 'inactive poison', is_active: false, is_hidden: false } },
    { id: crypto.randomUUID(), payload: { doc_id: String(documentId), text: 'hidden poison', is_active: true, is_hidden: true } },
    { id: crypto.randomUUID(), payload: { doc_id: String(documentId), text: 'legacy poison', is_hidden: false } }
  ].map((item) => ({ ...item, vector: [1, ...Array(767).fill(0)] }));
  await request(qdrantBase, `/collections/${collection}/points?wait=true`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ points })
  });
  return points.map((item) => item.id);
}

async function main() {
  assert.match(project, /^edurag_rag_production_offline_test_[A-Za-z0-9_.-]+$/);
  assert.equal(resources().length, 0, `Refusing to reuse ${project}.`);
  fs.writeFileSync(envFile, `RAG_PRODUCTION_OFFLINE_COMPOSE_PROJECT=${project}\nOFFLINE_ACTIVATION_FAILURES=0\n`, { mode: 0o600 });

  let pool;
  try {
    compose(['config', '--quiet']);
    compose(['up', '-d', '--build', '--wait']);
    const appBase = `http://127.0.0.1:${port('app', 5000)}`;
    let pythonBase = `http://127.0.0.1:${port('rag-service', 8000)}`;
    let qdrantBase = `http://127.0.0.1:${port('qdrant', 6333)}`;
    const proxyBase = `http://127.0.0.1:${port('callback-proxy', 9000)}`;
    pool = mysql.createPool({
      host: '127.0.0.1', port: port('db', 3306), user: 'root',
      password: 'offline-root-password', database: 'edurag', connectionLimit: 2
    });

    const suffix = `${Date.now()}-${crypto.randomInt(1000, 9999)}`;
    const email = `production.offline.${suffix}@smoke.test`;
    const password = `Offline@${crypto.randomInt(100000, 999999)}`;
    await request(appBase, '/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, fullName: 'Production Offline Teacher', role: 'TEACHER' })
    }, [201]);
    const [[teacher], [admin]] = await Promise.all([
      pool.execute('SELECT id FROM users WHERE email=?', [email]).then(([rows]) => rows),
      pool.execute("SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='ADMIN' LIMIT 1").then(([rows]) => rows)
    ]);
    await pool.execute("UPDATE users SET status='ACTIVE', reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP(3) WHERE id=?", [admin.id, teacher.id]);
    const authToken = (await request(appBase, '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    })).payload.data.token;

    await request(proxyBase, '/__test__/hold-next-success', { method: 'POST' });
    const uploaded = await upload(appBase, authToken, 'production-offline.txt', 'The lifecycle beacon is indigo.');
    const documentId = Number(uploaded.document.id);
    const jobId = Number(uploaded.job.id);
    const pending = await waitUntil('held complete-manifest ACK', async () => {
      const state = (await request(proxyBase, '/__test__/state')).payload;
      return state.pending?.jobId === String(jobId) ? state.pending : null;
    });
    assert.equal(pending.attemptCount, 1);
    const [[readyBeforeAck], pointsBeforeAck] = await Promise.all([
      pool.execute('SELECT processing_status FROM documents WHERE id=?', [documentId]).then(([rows]) => rows),
      scroll(qdrantBase, documentId)
    ]);
    assert.equal(readyBeforeAck.processing_status, 'READY', 'Node transaction did not commit before ACK was held.');
    assert(pointsBeforeAck.length > 0 && pointsBeforeAck.every((point) => point.payload.is_active === false));
    await request(proxyBase, '/__test__/release', { method: 'POST' });
    const job = await waitForJob(appBase, authToken, jobId);
    assert.equal(job.status, 'SUCCEEDED');
    const active = await waitUntil('exact-attempt activation', async () => {
      const points = await scroll(qdrantBase, documentId);
      return points.length > 0 && points.every((point) => point.payload.is_active === true) ? points : null;
    });
    assert(active.every((point) => point.payload.ingest_attempt_key === `${documentId}::${jobId}::1`));

    const [chunks] = await pool.execute(
      `SELECT chunk_index, vector_node_id, chunk_text, content_hash,
              token_count, page_number, section_title, source_locator
       FROM document_chunks WHERE document_id=? ORDER BY chunk_index`,
      [documentId]
    );
    const manifest = chunks.map((chunk) => ({
      chunk_index: Number(chunk.chunk_index), vector_node_id: chunk.vector_node_id,
      chunk_text: chunk.chunk_text, content_hash: chunk.content_hash,
      ...(chunk.token_count === null ? {} : { token_count: Number(chunk.token_count) }),
      ...(chunk.page_number === null ? {} : { page_number: Number(chunk.page_number) }),
      ...(chunk.section_title === null ? {} : { section_title: chunk.section_title }),
      ...(chunk.source_locator === null ? {} : {
        source_locator: typeof chunk.source_locator === 'string'
          ? JSON.parse(chunk.source_locator) : chunk.source_locator
      })
    }));
    const replay = (await request(appBase, '/api/internal/rag/processing-callback', {
      method: 'POST', headers: bearer(token, { 'content-type': 'application/json' }),
      body: JSON.stringify({ job_id: String(jobId), doc_id: String(documentId), attempt_count: 1, event_type: 'SUCCEEDED', chunk_manifest: manifest })
    })).payload.data;
    assert.equal(replay.outcome, 'IDEMPOTENT_REPLAY');
    assert.equal(replay.canActivate, true);

    const [[documentRow]] = await pool.execute('SELECT storage_key FROM documents WHERE id=?', [documentId]);
    await request(pythonBase, '/api/ingest', {
      method: 'POST', headers: bearer(token, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        doc_id: String(documentId), job_id: String(jobId), attempt_count: 2,
        subject_id: 'offline-production',
        file_path: `/shared/uploads/${documentRow.storage_key}`,
        callback_url: 'http://callback-proxy:9000/api/internal/rag/processing-callback',
        teacher_metadata: {}
      })
    }, [202]);
    await waitUntil('stale attempt cleanup', async () => {
      const points = await scroll(qdrantBase, documentId);
      return points.length === active.length
        && points.every((point) => point.payload.ingest_attempt_key === `${documentId}::${jobId}::1`) ? points : null;
    });

    const poisonIds = await injectFilteredPoints(qdrantBase, documentId);
    const session = (await request(appBase, '/api/chat/sessions', {
      method: 'POST', headers: bearer(authToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ title: 'Production offline retrieval' })
    }, [201])).payload.data;
    const answer = (await request(appBase, `/api/chat/sessions/${session.id}/messages`, {
      method: 'POST', headers: bearer(authToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({ content: 'What color is the lifecycle beacon?', clientRequestId: crypto.randomUUID() })
    })).payload.data.assistantMessage;
    assert.equal(answer.status, 'COMPLETED');
    assert(answer.citations.length > 0);
    assert(answer.citations.every((citation) => !poisonIds.includes(citation.vectorNodeId)));

    const failed = await upload(appBase, authToken, 'pre-ack-failure.txt', 'OFFLINE_FAIL_BEFORE_ACK');
    const failedJob = await waitForJob(appBase, authToken, failed.job.id);
    assert.equal(failedJob.status, 'FAILED');
    const [[failedDoc], failedPoints] = await Promise.all([
      pool.execute('SELECT processing_status FROM documents WHERE id=?', [failed.document.id]).then(([rows]) => rows),
      scroll(qdrantBase, failed.document.id)
    ]);
    assert.equal(failedDoc.processing_status, 'FAILED');
    assert(!failedPoints.some((point) => point.payload.is_active === true));

    await request(proxyBase, '/__test__/hold-next-success', { method: 'POST' });
    const uncertain = await upload(appBase, authToken, 'uncertain-ack.txt', 'Restart recovery fixture.');
    await waitUntil('uncertain ACK hold', async () => {
      const state = (await request(proxyBase, '/__test__/state')).payload;
      return state.pending?.jobId === String(uncertain.job.id) ? state.pending : null;
    });
    compose(['stop', 'rag-service']);
    await request(proxyBase, '/__test__/release', { method: 'POST' });
    compose(['up', '-d', '--wait', 'rag-service']);
    pythonBase = `http://127.0.0.1:${port('rag-service', 8000)}`;
    await waitUntil('restarted Python health', async () => {
      try { return (await request(pythonBase, '/api/health')).response.ok; } catch (_error) { return false; }
    });
    const inspect = compose([
      'exec', '-T', 'rag-service', 'python', 'scripts/recover_attempt.py',
      '--document-id', String(uncertain.document.id), '--job-id', String(uncertain.job.id),
      '--attempt-count', '1', '--expected-node-status', 'READY'
    ], { allowFailure: true });
    assert.equal(inspect.status, 2);
    assert.match(String(inspect.stdout), /READY_INACTIVE_EXACT_ATTEMPT/);
    compose([
      'exec', '-T', 'rag-service', 'python', 'scripts/recover_attempt.py',
      '--document-id', String(uncertain.document.id), '--job-id', String(uncertain.job.id),
      '--attempt-count', '1', '--expected-node-status', 'READY', '--recover', '--confirm-ready-exact-attempt'
    ]);
    compose([
      'exec', '-T', 'rag-service', 'python', 'scripts/recover_attempt.py',
      '--document-id', String(uncertain.document.id), '--job-id', String(uncertain.job.id),
      '--attempt-count', '1', '--expected-node-status', 'READY'
    ]);
    const originalAfterRecovery = await scroll(qdrantBase, documentId);
    assert(originalAfterRecovery.some((point) => point.payload.ingest_attempt_key === `${documentId}::${jobId}::1` && point.payload.is_active === true));

    compose(['stop', 'qdrant']);
    compose(['up', '-d', '--wait', 'qdrant']);
    qdrantBase = `http://127.0.0.1:${port('qdrant', 6333)}`;
    await waitUntil('restarted Qdrant persistence', async () => {
      try {
        const points = await scroll(qdrantBase, uncertain.document.id);
        return points.some((point) => point.payload.is_active === true);
      } catch (_error) { return false; }
    });

    process.env.OFFLINE_ACTIVATION_FAILURES = '99';
    fs.writeFileSync(envFile, `RAG_PRODUCTION_OFFLINE_COMPOSE_PROJECT=${project}\nOFFLINE_ACTIVATION_FAILURES=99\n`, { mode: 0o600 });
    compose(['up', '-d', '--force-recreate', '--wait', 'rag-service']);
    const activationFailure = await upload(appBase, authToken, 'activation-failure.txt', 'Activation failure fixture.');
    const compensated = await waitForJob(appBase, authToken, activationFailure.job.id);
    assert.equal(compensated.status, 'FAILED');
    const [[compensatedDoc], compensatedPoints] = await Promise.all([
      pool.execute('SELECT processing_status FROM documents WHERE id=?', [activationFailure.document.id]).then(([rows]) => rows),
      scroll(qdrantBase, activationFailure.document.id)
    ]);
    assert.equal(compensatedDoc.processing_status, 'FAILED');
    assert.equal(compensatedPoints.length, 0);
    const logs = compose(['logs', '--no-color', 'rag-service']);
    assert.match(logs, /RAG_ACTIVATION_RETRY code=ACTIVATION_RETRY/);
    assert.match(logs, /RAG_ACTIVATION_FAILED code=ACTIVATION_FAILED/);

    console.log('RAG_PRODUCTION_OFFLINE_E2E_OK production_node=true mysql=true python_http=true qdrant=true callback_transaction=true inactive_before_ack=true exact_activation=true replay=true stale_cleanup=true strict_retrieval=true pre_ack_failure=true restart_consistency=true manual_recovery=true persistence=true activation_compensation=true');
  } finally {
    if (pool) await pool.end();
    compose(['down', '-v', '--remove-orphans', '--rmi', 'local'], { allowFailure: true });
    if (fs.existsSync(envFile)) fs.rmSync(envFile, { force: true });
    assert.equal(resources().length, 0, `Disposable Docker resources remain for ${project}.`);
    delete process.env.OFFLINE_ACTIVATION_FAILURES;
  }
}

main().catch((error) => {
  console.error(`RAG_PRODUCTION_OFFLINE_E2E_FAILED: ${redacted(error.message)}`);
  process.exit(1);
});
