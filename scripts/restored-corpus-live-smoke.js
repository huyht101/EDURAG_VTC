'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const { main: runPreflight } = require('./remote-preflight');
const { reconcileRuntime } = require('./lib/corpus-runtime');
const {
  compose,
  composePort,
  delay,
  fetchWithTimeout
} = require('./remote-test-utils');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEMO_ADMIN_EMAIL = 'admin@example.com';
const DEMO_ADMIN_PASSWORD = '123456';

async function httpRequest(baseUrl, requestPath, options = {}, expected = [200]) {
  const response = await fetchWithTimeout(
    `${baseUrl}${requestPath}`,
    options,
    options.timeoutMs || 180000
  );
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  const body = payload === null ? Buffer.from(await response.arrayBuffer()) : null;
  if (!expected.includes(response.status)) {
    const code = payload?.errorCode || payload?.error_code || 'UNEXPECTED_RESPONSE';
    throw new Error(`${options.method || 'GET'} ${requestPath} returned ${response.status} (${code}).`);
  }
  return { status: response.status, payload, body, headers: response.headers };
}

function bearer(token, extra = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

async function adminToken(baseUrl) {
  const startedAt = new Date().toISOString();
  const login = await httpRequest(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: DEMO_ADMIN_EMAIL, password: DEMO_ADMIN_PASSWORD })
  });
  assert.equal(login.payload?.data?.requireOtp, true, 'Demo Admin login did not request OTP.');

  let otpCode = null;
  for (let attempt = 0; attempt < 20 && !otpCode; attempt += 1) {
    const logs = compose(['logs', '--no-color', '--since', startedAt, 'app']);
    const matches = [...logs.matchAll(/\[DEV-ONLY ADMIN OTP\] (\d{6})/g)];
    otpCode = matches.at(-1)?.[1] || null;
    if (!otpCode) await delay(250);
  }
  assert(otpCode, 'Development Admin OTP was not found in the app log.');
  const verified = await httpRequest(baseUrl, '/api/auth/admin/verify-otp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: DEMO_ADMIN_EMAIL, otpCode })
  });
  assert(verified.payload?.data?.token, 'Admin verification did not return a JWT.');
  return verified.payload.data.token;
}

async function databaseCounts(pool) {
  const [rows] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM documents) AS documents,
      (SELECT COUNT(*) FROM document_processing_jobs) AS jobs,
      (SELECT COUNT(*) FROM document_processing_jobs WHERE job_type = 'INGEST') AS ingestJobs,
      (SELECT COUNT(*) FROM document_chunks) AS chunks,
      (SELECT COUNT(*) FROM chat_sessions) AS sessions,
      (SELECT COUNT(*) FROM chat_messages) AS messages,
      (SELECT COUNT(*) FROM citations) AS citations,
      (SELECT COUNT(*) FROM llm_usage_logs) AS usageRows
  `);
  return Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]));
}

async function main() {
  const { nodePort } = await runPreflight();
  const baseUrl = `http://127.0.0.1:${nodePort}`;
  const pool = mysql.createPool({
    host: '127.0.0.1',
    port: composePort('db', 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'edurag',
    timezone: 'Z',
    connectionLimit: 2
  });

  try {
    const token = await adminToken(baseUrl);
    const beforeCounts = await databaseCounts(pool);
    const beforeStores = await reconcileRuntime();
    assert.equal(beforeCounts.documents, 1, 'Restored corpus must contain exactly one demo document.');
    assert.equal(beforeCounts.chunks, 2, 'Restored corpus chunk count differs from the canonical bundle.');
    assert.equal(beforeStores.points.length, 2, 'Restored Qdrant point count differs from the canonical bundle.');

    const verifyExisting = process.env.RESTORED_CORPUS_VERIFY_EXISTING === 'true';
    let result;
    if (verifyExisting) {
      const [messages] = await pool.query(
        `SELECT cm.id, user_message.client_request_id, cm.content, cm.status, cm.no_answer
         FROM chat_messages cm
         JOIN chat_messages user_message
           ON user_message.session_id = cm.session_id
          AND user_message.message_order = cm.message_order - 1
          AND user_message.sender_type = 'USER'
         WHERE cm.sender_type = 'ASSISTANT' AND cm.status = 'COMPLETED'
           AND EXISTS (SELECT 1 FROM citations c WHERE c.message_id = cm.id)
         ORDER BY cm.id DESC LIMIT 1`
      );
      assert(messages[0], 'No persisted live assistant result with citations is available to verify.');
      const [citations] = await pool.execute(
        `SELECT id, document_id AS documentId FROM citations WHERE message_id = ? ORDER BY citation_order`,
        [messages[0].id]
      );
      result = {
        clientRequestId: messages[0].client_request_id,
        assistantMessage: {
          id: messages[0].id,
          content: messages[0].content,
          status: messages[0].status,
          noAnswer: Boolean(messages[0].no_answer),
          citations
        }
      };
    } else {
      const session = (await httpRequest(baseUrl, '/api/chat/sessions', {
        method: 'POST',
        headers: bearer(token, { 'content-type': 'application/json' }),
        body: JSON.stringify({ title: 'Portable corpus restore verification' })
      }, [201])).payload.data;

      // This is intentionally the only live query in this smoke test. It omits
      // clientRequestId to exercise server-generated idempotency state.
      result = (await httpRequest(baseUrl, `/api/chat/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: bearer(token, { 'content-type': 'application/json' }),
        body: JSON.stringify({
          content: 'Theo tài liệu đã khôi phục, Oishi là thương hiệu thuộc quốc gia nào? Hãy trích dẫn nguồn.'
        }),
        timeoutMs: Number(process.env.RAG_QUERY_TIMEOUT_MS || 180000) + 15000
      })).payload.data;
    }

    assert(UUID.test(result.clientRequestId), 'Server-generated clientRequestId is not a UUID.');
    assert.equal(result.assistantMessage?.status, 'COMPLETED');
    assert.equal(result.assistantMessage?.noAnswer, false, 'Restored corpus query unexpectedly returned no_answer.');
    assert(result.assistantMessage?.content, 'Assistant answer is empty.');
    assert(result.assistantMessage.citations?.length > 0, 'Live restored query returned no citation.');

    const citation = result.assistantMessage.citations.find((item) => Number(item.documentId) === 1);
    assert(citation, 'No citation maps to restored document 1.');
    const detail = (await httpRequest(baseUrl, `/api/citations/${citation.id}`, {
      headers: bearer(token)
    })).payload.data;
    const source = (await httpRequest(baseUrl, `/api/citations/${citation.id}/source`, {
      headers: bearer(token)
    })).payload.data;
    assert(detail.sourceText && source.sourceText, 'Citation immutable source snapshot is empty.');
    const expectOriginal = process.env.RESTORED_CORPUS_EXPECT_ORIGINAL === 'true';
    assert.equal(detail.originalAvailable, expectOriginal, 'Restored original availability differs from expectation.');

    const documentFile = await httpRequest(baseUrl, '/api/documents/1/file', {
      headers: bearer(token)
    }, expectOriginal ? [200] : [404]);
    const citationFile = await httpRequest(baseUrl, `/api/citations/${citation.id}/file`, {
      headers: bearer(token)
    }, expectOriginal ? [200] : [409]);
    if (expectOriginal) {
      const [[document]] = await pool.execute(
        'SELECT checksum_sha256 FROM documents WHERE id = ?',
        [1]
      );
      assert(document?.checksum_sha256, 'Restored document checksum metadata is missing.');
      for (const fileResponse of [documentFile, citationFile]) {
        assert.equal(
          crypto.createHash('sha256').update(fileResponse.body).digest('hex'),
          document.checksum_sha256,
          'Restored original API checksum differs from document metadata.'
        );
        assert.match(fileResponse.headers.get('content-disposition') || '', /attachment/i);
        assert(fileResponse.headers.get('content-type'), 'Restored original API has no content type.');
      }
    }

    const [[citationRow], usageRows] = await Promise.all([
      pool.execute(
        `SELECT c.vector_node_id_snapshot, c.source_text_snapshot, dc.id AS chunk_id
         FROM citations c
         JOIN document_chunks dc ON dc.vector_node_id = c.vector_node_id_snapshot
         WHERE c.id = ? AND dc.document_id = 1`,
        [citation.id]
      ).then(([rows]) => rows),
      pool.execute(
        `SELECT operation_type, provider, model, status
         FROM llm_usage_logs WHERE message_id = ? ORDER BY call_index`,
        [result.assistantMessage.id]
      ).then(([rows]) => rows)
    ]);
    assert(citationRow?.vector_node_id_snapshot, 'Citation vector ID does not map to a restored chunk.');
    assert(citationRow.source_text_snapshot, 'Persisted citation snapshot is empty.');
    assert(usageRows.length >= 1, 'Live query usage was not persisted.');
    assert(usageRows.every((row) => row.status === 'SUCCEEDED' && row.model));

    const afterCounts = await databaseCounts(pool);
    const afterStores = await reconcileRuntime();
    assert.equal(afterCounts.ingestJobs, beforeCounts.ingestJobs, 'Live query created an ingest job.');
    assert.equal(afterCounts.jobs, beforeCounts.jobs, 'Live query changed processing job count.');
    assert.equal(afterCounts.chunks, beforeCounts.chunks, 'Live query changed document chunks.');
    assert.equal(afterStores.points.length, beforeStores.points.length, 'Live query changed Qdrant point count.');

    const uploadFiles = compose([
      'exec', '-T', 'app', 'sh', '-lc',
      "find /usr/src/app/uploads -type f -print 2>/dev/null | head -n 1"
    ]);
    assert.equal(Boolean(uploadFiles), expectOriginal, 'Upload-volume original availability differs from expectation.');

    console.log(JSON.stringify({
      status: 'RESTORED_CORPUS_LIVE_OK',
      documentId: 1,
      chunks: afterCounts.chunks,
      points: afterStores.points.length,
      ingestJobs: afterCounts.ingestJobs,
      citationId: citation.id,
      usageRows: usageRows.length,
      queryMode: verifyExisting ? 'persisted-result-verification' : 'single-live-query',
      originalDocumentFileStatus: documentFile.status,
      originalCitationFileStatus: citationFile.status
    }));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${error.code || 'RESTORED_CORPUS_LIVE_FAILED'}: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { adminToken, databaseCounts, httpRequest, main };
