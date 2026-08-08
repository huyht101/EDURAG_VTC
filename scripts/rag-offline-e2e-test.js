'use strict';

const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');

const { delay, redacted, root } = require('./remote-test-utils');

const project = process.env.RAG_OFFLINE_COMPOSE_PROJECT
  || `edurag_rag_offline_test_${process.pid}_${Date.now()}`;
const composeFile = path.join(root, 'docker-compose.rag-offline-test.yml');
const internalToken = 'offline-rag-internal-secret-0123456789abcdef';

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, RAG_OFFLINE_COMPOSE_PROJECT: project }
  });
  if (result.error || result.status !== 0) {
    if (options.allowFailure) return result;
    throw new Error(redacted(result.stderr || result.stdout || result.error?.message));
  }
  return String(result.stdout || '').trim();
}

function compose(args, options) {
  return docker(['compose', '-p', project, '-f', composeFile, ...args], options);
}

function projectResources() {
  const label = `label=com.docker.compose.project=${project}`;
  return [
    docker(['ps', '-a', '--filter', label, '--format', '{{.ID}}']),
    docker(['volume', 'ls', '--filter', label, '--format', '{{.Name}}']),
    docker(['network', 'ls', '--filter', label, '--format', '{{.Name}}'])
  ].filter(Boolean);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch (_error) {
      // Disposable services may still be booting.
    }
    await delay(500);
  }
  throw new Error(`${label} did not become ready.`);
}

async function qdrantPoints(qdrantBase, documentId) {
  const response = await fetch(`${qdrantBase}/collections/edurag_test_offline_e2e/points/scroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filter: { must: [{ key: 'doc_id', match: { value: documentId } }] },
      limit: 100,
      with_payload: true,
      with_vector: false
    })
  });
  if (response.status === 404) return [];
  assert.equal(response.status, 200);
  return (await response.json()).result.points;
}

async function waitForCallback(events, startIndex, jobId, attemptCount, eventType) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const event = events.slice(startIndex).find((candidate) => (
      candidate.job_id === jobId
      && candidate.attempt_count === attemptCount
      && candidate.event_type === eventType
    ));
    if (event) return event;
    await delay(250);
  }
  throw new Error(`Callback ${eventType} was not observed for ${jobId}/${attemptCount}.`);
}

async function waitForPoints(qdrantBase, documentId, predicate, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const points = await qdrantPoints(qdrantBase, documentId);
    if (predicate(points)) return points;
    await delay(250);
  }
  throw new Error(`${label} did not reach the expected Qdrant state.`);
}

async function putInactivePoint(qdrantBase, documentId, jobId, attemptCount) {
  const pointId = '2a59aee5-e124-559b-a98b-c921746ccae9';
  const response = await fetch(
    `${qdrantBase}/collections/edurag_test_offline_e2e/points?wait=true`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ points: [{
        id: pointId,
        vector: [1, ...Array(767).fill(0)],
        payload: {
          doc_id: documentId,
          text: 'manual recovery fixture',
          is_active: false,
          is_hidden: false,
          ingest_attempt_key: `${documentId}::${jobId}::${attemptCount}`
        }
      }] })
    }
  );
  assert.equal(response.status, 200);
}

async function main() {
  assert.match(project, /^edurag_rag_offline_test_[A-Za-z0-9_.-]+$/);
  assert.equal(projectResources().length, 0, `Refusing to reuse Docker project ${project}.`);

  const callbackPort = await freePort();
  const events = [];
  const acceptedAttempts = new Set();
  const attemptDocuments = new Map();
  let qdrantBase = null;
  let inactiveBeforeAckObservations = 0;
  const callbackErrors = [];
  let ackMode = 'accepted';
  const callbackServer = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', async () => {
      try {
        assert.equal(request.headers.authorization, `Bearer ${internalToken}`);
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        events.push(payload);
        const key = `${payload.job_id}::${payload.attempt_count}`;
        if (payload.event_type === 'SUCCEEDED') {
          const documentId = attemptDocuments.get(key);
          assert(documentId && qdrantBase, 'Callback arrived without an exact attempt fixture.');
          await waitForPoints(
            qdrantBase,
            documentId,
            (items) => items.length > 0
              && items.every((item) => item.payload.is_active === false),
            'Pre-ACK inactive points'
          );
          inactiveBeforeAckObservations += 1;
        }
        let outcome = 'ACCEPTED';
        let attemptCount = payload.attempt_count;
        let canActivate = payload.event_type === 'SUCCEEDED';
        if (payload.event_type === 'SUCCEEDED' && ackMode === 'stale') {
          outcome = 'STALE_ATTEMPT';
          attemptCount += 1;
          canActivate = false;
        } else if (payload.event_type === 'SUCCEEDED' && acceptedAttempts.has(key)) {
          outcome = 'IDEMPOTENT_REPLAY';
        }
        if (payload.event_type === 'SUCCEEDED') acceptedAttempts.add(key);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data: {
          jobId: payload.job_id,
          attemptCount,
          outcome,
          canActivate,
          status: payload.event_type === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
          reason: null
        } }));
      } catch (error) {
        callbackErrors.push(error);
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'OFFLINE_CALLBACK_ASSERTION_FAILED' } }));
      }
    });
  });
  await new Promise((resolve) => callbackServer.listen(callbackPort, '127.0.0.1', resolve));

  try {
    process.env.OFFLINE_ACTIVATION_FAILURES = '0';
    compose(['config', '--quiet']);
    compose(['up', '-d', '--build', '--wait']);
    let pythonPort = Number(compose(['port', 'rag-service', '8000']).match(/:(\d+)$/)[1]);
    let qdrantPort = Number(compose(['port', 'qdrant', '6333']).match(/:(\d+)$/)[1]);
    let pythonBase = `http://127.0.0.1:${pythonPort}`;
    qdrantBase = `http://127.0.0.1:${qdrantPort}`;
    await waitFor(`${pythonBase}/api/health`, 'Offline Python');
    await waitFor(`${qdrantBase}/healthz`, 'Disposable Qdrant');

    const ingest = async (documentId, jobId, attemptCount) => {
      attemptDocuments.set(`${jobId}::${attemptCount}`, documentId);
      const response = await fetch(`${pythonBase}/api/ingest`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${internalToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          doc_id: documentId,
          job_id: jobId,
          attempt_count: attemptCount,
          subject_id: 'offline-subject',
          file_path: '/offline/canonical.pdf',
          callback_url: `http://host.docker.internal:${callbackPort}/callback`,
          teacher_metadata: {}
        })
      });
      assert.equal(response.status, 202);
    };

    let eventIndex = events.length;
    await ingest('offline-doc', 'offline-job', 1);
    await waitForCallback(events, eventIndex, 'offline-job', 1, 'SUCCEEDED');
    let points = await waitForPoints(
      qdrantBase,
      'offline-doc',
      (items) => items.length === 1 && items[0].payload.is_active === true,
      'Initial exact attempt activation'
    );
    assert.equal(points.length, 1);
    assert.equal(points[0].payload.is_active, true);
    eventIndex = events.length;
    await ingest('offline-doc', 'offline-job', 1);
    await waitForCallback(events, eventIndex, 'offline-job', 1, 'SUCCEEDED');
    points = await waitForPoints(
      qdrantBase,
      'offline-doc',
      (items) => items.length === 1 && items[0].payload.is_active === true,
      'Exact attempt replay'
    );
    assert.equal(points.length, 1, 'Exact replay created duplicate points.');
    assert.equal(points[0].payload.is_active, true);

    compose(['stop', 'qdrant']);
    compose(['start', 'qdrant']);
    qdrantPort = Number(compose(['port', 'qdrant', '6333']).match(/:(\d+)$/)[1]);
    qdrantBase = `http://127.0.0.1:${qdrantPort}`;
    await waitFor(`${qdrantBase}/healthz`, 'Restarted disposable Qdrant');
    points = await qdrantPoints(qdrantBase, 'offline-doc');
    assert.equal(points.length, 1);
    assert.equal(points[0].payload.is_active, true, 'Qdrant volume did not retain activation state.');

    ackMode = 'stale';
    eventIndex = events.length;
    await ingest('stale-doc', 'stale-job', 1);
    await waitForCallback(events, eventIndex, 'stale-job', 1, 'SUCCEEDED');
    await waitForPoints(
      qdrantBase,
      'stale-doc',
      (items) => items.length === 0,
      'Stale attempt cleanup'
    );
    ackMode = 'accepted';

    process.env.OFFLINE_ACTIVATION_FAILURES = '99';
    compose(['up', '-d', '--force-recreate', '--wait', 'rag-service']);
    pythonPort = Number(compose(['port', 'rag-service', '8000']).match(/:(\d+)$/)[1]);
    pythonBase = `http://127.0.0.1:${pythonPort}`;
    await waitFor(`${pythonBase}/api/health`, 'Failure-injection Python');
    eventIndex = events.length;
    await ingest('activation-failure-doc', 'activation-failure-job', 1);
    const failure = await waitForCallback(
      events,
      eventIndex,
      'activation-failure-job',
      1,
      'FAILED'
    );
    assert.equal(failure.error?.code, 'ACTIVATION_FAILED');
    await waitForPoints(
      qdrantBase,
      'activation-failure-doc',
      (items) => items.length === 0,
      'Activation failure cleanup'
    );
    const logs = compose(['logs', '--no-color', 'rag-service']);
    assert.match(logs, /RAG_ACTIVATION_RETRY code=ACTIVATION_RETRY/);
    assert.match(logs, /RAG_ACTIVATION_FAILED code=ACTIVATION_FAILED/);

    const recoveryDoc = 'manual-recovery-doc';
    const recoveryJob = 'manual-recovery-job';
    await putInactivePoint(qdrantBase, recoveryDoc, recoveryJob, 2);
    const check = compose([
      'exec', '-T', 'rag-service', 'python', 'scripts/recover_attempt.py',
      '--document-id', recoveryDoc, '--job-id', recoveryJob, '--attempt-count', '2',
      '--expected-node-status', 'READY'
    ], { allowFailure: true });
    assert.equal(check.status, 2);
    assert.match(String(check.stdout), /READY_INACTIVE_EXACT_ATTEMPT/);
    compose([
      'exec', '-T', 'rag-service', 'python', 'scripts/recover_attempt.py',
      '--document-id', recoveryDoc, '--job-id', recoveryJob, '--attempt-count', '2',
      '--expected-node-status', 'READY', '--recover', '--confirm-ready-exact-attempt'
    ]);
    compose([
      'exec', '-T', 'rag-service', 'python', 'scripts/recover_attempt.py',
      '--document-id', recoveryDoc, '--job-id', recoveryJob, '--attempt-count', '2',
      '--expected-node-status', 'READY'
    ]);
    assert.equal(callbackErrors.length, 0, callbackErrors[0]?.message);
    assert(inactiveBeforeAckObservations >= 4);

    console.log(
      'RAG_OFFLINE_E2E_OK node_http=true qdrant=true inactive_before_ack=true '
      + 'exact_replay=true stale_cleanup=true restart_persistence=true '
      + 'activation_retry=true consistency=true manual_recovery=true'
    );
  } finally {
    await new Promise((resolve) => callbackServer.close(resolve));
    compose(['down', '-v', '--remove-orphans', '--rmi', 'local'], { allowFailure: true });
    assert.equal(projectResources().length, 0, `Disposable Docker resources remain for ${project}.`);
    delete process.env.OFFLINE_ACTIVATION_FAILURES;
  }
}

main().catch((error) => {
  console.error(`RAG_OFFLINE_E2E_FAILED: ${redacted(error.message)}`);
  process.exit(1);
});
