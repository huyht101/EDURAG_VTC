'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const mysql = require('mysql2/promise');

const { main: runPreflight } = require('./remote-preflight');
const {
  root,
  compose,
  composePort,
  delay,
  fetchWithTimeout
} = require('./remote-test-utils');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function httpRequest(baseUrl, path, options = {}, expected = [200]) {
  const response = await fetchWithTimeout(`${baseUrl}${path}`, options, options.timeoutMs || 180000);
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  if (!expected.includes(response.status)) {
    const code = payload?.errorCode || payload?.error_code || 'UNEXPECTED_RESPONSE';
    const message = payload?.message || payload?.error?.message;
    throw new Error(
      `${options.method || 'GET'} ${path} returned ${response.status} (${code})${message ? `: ${message}` : '.'}`
    );
  }
  return { response, payload };
}

function bearer(token, extra = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

async function waitForJob(baseUrl, token, jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = (await httpRequest(baseUrl, `/api/documents/jobs/${jobId}`, {
      headers: bearer(token), timeoutMs: 15000
    })).payload.data;
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(latest.status)) return latest;
    await delay(2000);
  }
  throw new Error(`Job ${jobId} did not reach a terminal state; last status=${latest?.status || 'unknown'}.`);
}

async function createChatAnswer(baseUrl, token, question, title) {
  const session = (await httpRequest(baseUrl, '/api/chat/sessions', {
    method: 'POST',
    headers: bearer(token, { 'content-type': 'application/json' }),
    body: JSON.stringify({ title })
  }, [201])).payload.data;
  const clientRequestId = crypto.randomUUID();
  const answer = (await httpRequest(baseUrl, `/api/chat/sessions/${session.id}/messages`, {
    method: 'POST',
    headers: bearer(token, { 'content-type': 'application/json' }),
    body: JSON.stringify({
      content: question,
      clientRequestId
    }),
    timeoutMs: Number(process.env.RAG_QUERY_TIMEOUT_MS || 180000) + 15000
  })).payload.data;
  return { session, clientRequestId, answer };
}

async function testCallbackEdges({ baseUrl, token, pool, documentId, ingestJob, chunks }) {
  const internalHeaders = bearer(process.env.RAG_INTERNAL_TOKEN, { 'content-type': 'application/json' });
  const manifest = chunks.map((chunk) => ({
    chunk_index: Number(chunk.chunk_index),
    vector_node_id: chunk.vector_node_id,
    chunk_text: chunk.chunk_text,
    content_hash: chunk.content_hash,
    token_count: chunk.token_count === null ? undefined : Number(chunk.token_count),
    page_number: chunk.page_number === null ? undefined : Number(chunk.page_number),
    section_title: chunk.section_title || undefined
  }));
  const terminal = {
    job_id: String(ingestJob.id),
    doc_id: String(documentId),
    attempt_count: Number(ingestJob.attemptCount),
    event_type: 'SUCCEEDED',
    chunk_manifest: manifest
  };

  const duplicate = (await httpRequest(baseUrl, '/api/internal/rag/processing-callback', {
    method: 'POST', headers: internalHeaders, body: JSON.stringify(terminal)
  })).payload.data;
  assert.equal(duplicate.duplicate, true);

  const stale = (await httpRequest(baseUrl, '/api/internal/rag/processing-callback', {
    method: 'POST', headers: internalHeaders,
    body: JSON.stringify({ ...terminal, attempt_count: Number(ingestJob.attemptCount) + 1 })
  })).payload.data;
  assert.equal(stale.ignored, true);
  assert.equal(stale.reason, 'STALE_ATTEMPT');

  await httpRequest(baseUrl, '/api/internal/rag/processing-callback', {
    method: 'POST', headers: internalHeaders,
    body: JSON.stringify({ ...terminal, doc_id: String(Number(documentId) + 999999) })
  }, [400]);
  await httpRequest(baseUrl, '/api/internal/rag/processing-callback', {
    method: 'POST', headers: bearer('invalid-internal-token', { 'content-type': 'application/json' }),
    body: JSON.stringify({ job_id: String(ingestJob.id), attempt_count: 1, event_type: 'PROGRESS' })
  }, [401]);

  const [manualResult] = await pool.execute(
    `INSERT INTO document_processing_jobs
      (document_id, job_type, status, attempt_count, max_attempts, started_at)
     VALUES (?, 'INGEST', 'RUNNING', 1, 3, CURRENT_TIMESTAMP(3))`,
    [documentId]
  );
  const manualJobId = manualResult.insertId;
  const base = { job_id: String(manualJobId), attempt_count: 1, event_type: 'SUCCEEDED' };
  const validChunk = {
    chunk_index: 0,
    vector_node_id: crypto.randomUUID(),
    chunk_text: 'controlled callback edge fixture',
    content_hash: crypto.createHash('sha256').update('controlled callback edge fixture').digest('hex')
  };
  try {
    for (const payload of [
      base,
      { ...base, chunk_manifest: [] },
      { ...base, chunk_manifest: [{ ...validChunk, chunk_text: undefined }] },
      { ...base, chunk_manifest: [{ ...validChunk, content_hash: '0'.repeat(64) }] },
      { ...base, chunk_manifest: [{ ...validChunk, vector_node_id: 'invalid' }] }
    ]) {
      await httpRequest(baseUrl, '/api/internal/rag/processing-callback', {
        method: 'POST', headers: internalHeaders, body: JSON.stringify(payload)
      }, [400]);
    }

    const beforeCount = chunks.length;
    await httpRequest(baseUrl, '/api/internal/rag/processing-callback', {
      method: 'POST', headers: internalHeaders,
      body: JSON.stringify({
        ...base,
        chunk_manifest: [{
          chunk_index: 0,
          vector_node_id: chunks[0].vector_node_id,
          chunk_text: chunks[0].chunk_text,
          content_hash: chunks[0].content_hash
        }]
      })
    }, [500]);
    const [[jobAfter], [documentAfter], [chunkCount]] = await Promise.all([
      pool.execute('SELECT status FROM document_processing_jobs WHERE id = ?', [manualJobId]).then(([rows]) => rows),
      pool.execute('SELECT processing_status FROM documents WHERE id = ?', [documentId]).then(([rows]) => rows),
      pool.execute('SELECT COUNT(*) AS total FROM document_chunks WHERE document_id = ?', [documentId]).then(([rows]) => rows)
    ]);
    assert.equal(jobAfter.status, 'RUNNING');
    assert.equal(documentAfter.processing_status, 'READY');
    assert.equal(Number(chunkCount.total), beforeCount);
  } finally {
    await pool.execute(
      `UPDATE document_processing_jobs
       SET status='CANCELLED', error_code='REMOTE_E2E_EDGE_COMPLETE', finished_at=CURRENT_TIMESTAMP(3)
       WHERE id=? AND status='RUNNING'`,
      [manualJobId]
    );
  }

  await httpRequest(baseUrl, `/api/documents/${documentId}`, { headers: bearer(token) });
}

async function main() {
  assert.equal(process.env.REMOTE_E2E_CONFIRM_ISOLATED, 'true',
    'Set REMOTE_E2E_CONFIRM_ISOLATED=true only for a dedicated Compose project/volume.');
  const preflight = await runPreflight();
  const baseUrl = `http://127.0.0.1:${preflight.nodePort}`;
  const dbPort = composePort('db', 3306);
  const pool = mysql.createPool({
    host: '127.0.0.1',
    port: dbPort,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'edurag',
    timezone: 'Z',
    connectionLimit: 2
  });
  let ragStopped = false;
  const suffix = `${Date.now()}-${crypto.randomInt(1000, 9999)}`;
  const email = `remote.e2e.${suffix}@smoke.test`;
  const password = `RemoteE2E@${crypto.randomInt(100000, 999999)}`;
  const source = fs.readFileSync(`${root}/tests/fixtures/remote-e2e/source.txt`);
  const question = 'According to the indexed test document, what color is the Week 3 validation beacon? Cite the source.';
  const ingestStarted = new Date();

  try {
    await httpRequest(baseUrl, '/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, fullName: 'Remote E2E Teacher', role: 'TEACHER' })
    }, [201]);
    const [[teacher], [admin]] = await Promise.all([
      pool.execute('SELECT id, status FROM users WHERE email = ?', [email]).then(([rows]) => rows),
      pool.execute(
        `SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
         WHERE r.code='ADMIN' AND u.status='ACTIVE' ORDER BY u.id LIMIT 1`
      ).then(([rows]) => rows)
    ]);
    assert(teacher && admin, 'Remote E2E actor fixtures were not created.');
    assert.equal(teacher.status, 'PENDING');
    await pool.execute(
      `UPDATE users SET status='ACTIVE', reviewed_by=?, reviewed_at=CURRENT_TIMESTAMP(3),
                        review_note='REMOTE_E2E_FIXTURE'
       WHERE id=? AND status='PENDING'`,
      [admin.id, teacher.id]
    );
    const token = (await httpRequest(baseUrl, '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    })).payload.data.token;

    const form = new FormData();
    form.append('file', new Blob([source], { type: 'text/plain' }), 'week3-remote-source.txt');
    form.append('title', `Remote E2E ${suffix}`);
    const uploaded = (await httpRequest(baseUrl, '/api/documents', {
      method: 'POST', headers: bearer(token), body: form, timeoutMs: 30000
    }, [202])).payload.data;
    const documentId = Number(uploaded.document.id);
    const ingestJob = await waitForJob(
      baseUrl, token, uploaded.job.id,
      Number(process.env.REMOTE_E2E_INGEST_TIMEOUT_MS || 300000)
    );
    assert.equal(ingestJob.status, 'SUCCEEDED', `Ingest failed with ${ingestJob.errorCode || 'unknown error'}.`);
    const detail = (await httpRequest(baseUrl, `/api/documents/${documentId}`, {
      headers: bearer(token)
    })).payload.data;
    assert.equal(detail.document.processingStatus, 'READY');

    const [chunks] = await pool.execute(
      `SELECT id, processing_job_id, chunk_index, vector_node_id, chunk_text, content_hash,
              token_count, page_number, section_title
       FROM document_chunks WHERE document_id=? ORDER BY chunk_index`,
      [documentId]
    );
    assert(chunks.length > 0, 'Complete manifest was not persisted.');
    const indexes = new Set();
    for (const chunk of chunks) {
      assert.equal(Number(chunk.processing_job_id), Number(ingestJob.id));
      assert(UUID.test(chunk.vector_node_id));
      assert.equal(typeof chunk.chunk_text, 'string');
      assert(chunk.chunk_text.length > 0);
      assert.equal(
        crypto.createHash('sha256').update(chunk.chunk_text).digest('hex'),
        chunk.content_hash.toLowerCase()
      );
      assert(!indexes.has(Number(chunk.chunk_index)));
      indexes.add(Number(chunk.chunk_index));
    }

    if (process.env.REMOTE_E2E_REQUIRE_LLAMAPARSE !== 'false') {
      const logs = compose(['logs', '--no-color', '--since', ingestStarted.toISOString(), 'rag-service']);
      assert(/LlamaParse[^\r\n]*\d+\s+pages/i.test(logs), 'LlamaParse success was not observed in Python logs.');
    }

    await testCallbackEdges({ baseUrl, token, pool, documentId, ingestJob, chunks });

    const initialChat = await createChatAnswer(baseUrl, token, question, `Initial retrieval ${suffix}`);
    assert.equal(initialChat.answer.assistantMessage.status, 'COMPLETED');
    assert.equal(initialChat.answer.assistantMessage.noAnswer, false);
    assert(initialChat.answer.assistantMessage.citations.length > 0, 'Live answer has no structured citations.');
    assert(initialChat.answer.assistantMessage.citations.some(
      (citation) => Number(citation.documentId) === documentId
    ));
    const citation = initialChat.answer.assistantMessage.citations.find(
      (item) => Number(item.documentId) === documentId
    );
    const duplicateChat = (await httpRequest(
      baseUrl, `/api/chat/sessions/${initialChat.session.id}/messages`, {
        method: 'POST', headers: bearer(token, { 'content-type': 'application/json' }),
        body: JSON.stringify({ content: question, clientRequestId: initialChat.clientRequestId })
      }
    )).payload.data;
    assert.equal(duplicateChat.duplicate, true);

    const [[citationRow], usageRows] = await Promise.all([
      pool.execute(
        `SELECT vector_node_id_snapshot, source_text_snapshot FROM citations WHERE id=?`,
        [citation.id]
      ).then(([rows]) => rows),
      pool.execute(
        `SELECT operation_type, provider, model, prompt_tokens, completion_tokens, status
         FROM llm_usage_logs WHERE message_id=? ORDER BY call_index`,
        [initialChat.answer.assistantMessage.id]
      ).then(([rows]) => rows)
    ]);
    assert(citationRow && chunks.some((chunk) => chunk.vector_node_id === citationRow.vector_node_id_snapshot));
    assert(citationRow.source_text_snapshot);
    assert(usageRows.length >= 1, 'Live usage was not persisted.');
    assert(usageRows.every((row) => row.status === 'SUCCEEDED' && row.model));

    const hide = (await httpRequest(baseUrl, `/api/documents/${documentId}/hide`, {
      method: 'POST', headers: bearer(token)
    }, [202])).payload.data;
    assert.equal((await waitForJob(baseUrl, token, hide.job.id,
      Number(process.env.REMOTE_E2E_OPERATION_TIMEOUT_MS || 120000))).status, 'SUCCEEDED');
    const hiddenDetail = (await httpRequest(baseUrl, `/api/documents/${documentId}`, {
      headers: bearer(token)
    })).payload.data;
    assert.equal(hiddenDetail.document.visibilityStatus, 'HIDDEN');
    const hiddenChat = await createChatAnswer(baseUrl, token, question, `Hidden retrieval ${suffix}`);
    assert(!hiddenChat.answer.assistantMessage.citations.some(
      (item) => Number(item.documentId) === documentId
    ), 'Hidden document remained retrievable.');

    const unhide = (await httpRequest(baseUrl, `/api/documents/${documentId}/unhide`, {
      method: 'POST', headers: bearer(token)
    }, [202])).payload.data;
    assert.equal((await waitForJob(baseUrl, token, unhide.job.id,
      Number(process.env.REMOTE_E2E_OPERATION_TIMEOUT_MS || 120000))).status, 'SUCCEEDED');
    const unhiddenChat = await createChatAnswer(baseUrl, token, question, `Unhidden retrieval ${suffix}`);
    assert(unhiddenChat.answer.assistantMessage.citations.some(
      (item) => Number(item.documentId) === documentId
    ), 'Unhidden document was not retrieved.');

    const deletion = (await httpRequest(baseUrl, `/api/documents/${documentId}`, {
      method: 'DELETE', headers: bearer(token)
    }, [202])).payload.data;
    assert.equal((await waitForJob(baseUrl, token, deletion.job.id,
      Number(process.env.REMOTE_E2E_OPERATION_TIMEOUT_MS || 120000))).status, 'SUCCEEDED');
    const deletedDetail = (await httpRequest(baseUrl, `/api/documents/${documentId}`, {
      headers: bearer(token)
    })).payload.data;
    assert.equal(deletedDetail.document.visibilityStatus, 'DELETED');
    const deletedChat = await createChatAnswer(baseUrl, token, question, `Deleted retrieval ${suffix}`);
    assert(!deletedChat.answer.assistantMessage.citations.some(
      (item) => Number(item.documentId) === documentId
    ), 'Deleted document remained retrievable.');

    const snapshot = (await httpRequest(baseUrl, `/api/citations/${citation.id}`, {
      headers: bearer(token)
    })).payload.data;
    assert.equal(snapshot.sourceText, citationRow.source_text_snapshot);
    const history = (await httpRequest(
      baseUrl, `/api/chat/sessions/${initialChat.session.id}/messages`, { headers: bearer(token) }
    )).payload.data;
    assert.equal(history.messages.length, 2);
    assert.deepEqual(history.messages.map((message) => message.messageOrder), [1, 2]);

    if (process.env.REMOTE_E2E_TEST_UNAVAILABLE !== 'false') {
      compose(['stop', 'rag-service']);
      ragStopped = true;
      const failedForm = new FormData();
      failedForm.append('file', new Blob(['controlled unavailable failure'], { type: 'text/plain' }), 'unavailable.txt');
      const failed = (await httpRequest(baseUrl, '/api/documents', {
        method: 'POST', headers: bearer(token), body: failedForm, timeoutMs: 30000
      }, [503])).payload;
      assert(failed.data?.documentId && failed.data?.jobId);
      const failedDocument = (await httpRequest(baseUrl, `/api/documents/${failed.data.documentId}`, {
        headers: bearer(token)
      })).payload.data;
      assert.equal(failedDocument.document.processingStatus, 'FAILED');
      assert.equal(failedDocument.latestJob.status, 'FAILED');
      compose(['start', 'rag-service']);
      ragStopped = false;
    }

    console.log(JSON.stringify({
      status: 'REMOTE_E2E_SMOKE_OK',
      documentId,
      ingestJobId: Number(ingestJob.id),
      chunks: chunks.length,
      citations: initialChat.answer.assistantMessage.citations.length,
      usageRows: usageRows.length,
      noAnswerLiveAssertion: 'NOT_DETERMINISTIC'
    }));
  } finally {
    if (ragStopped) compose(['start', 'rag-service'], { allowFailure: true });
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`REMOTE_E2E_SMOKE_FAILED: ${error.message}`);
  process.exit(1);
});
