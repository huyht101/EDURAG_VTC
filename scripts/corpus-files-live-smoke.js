'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const { main: runPreflight } = require('./remote-preflight');
const { reconcileRuntime } = require('./corpus-manager');
const { adminToken, databaseCounts, httpRequest } = require('./restored-corpus-live-smoke');
const { composePort, fetchWithTimeout } = require('./remote-test-utils');

async function binaryRequest(baseUrl, requestPath, token) {
  const response = await fetchWithTimeout(`${baseUrl}${requestPath}`, {
    headers: { authorization: `Bearer ${token}` }
  }, 30000);
  if (response.status !== 200) {
    throw new Error(`GET ${requestPath} returned ${response.status}.`);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || '',
    disposition: response.headers.get('content-disposition') || ''
  };
}

async function main() {
  const expectAvailable = process.env.CORPUS_FILES_EXPECT_AVAILABLE !== 'false';
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
    const [[document]] = await pool.query(
      `SELECT id, file_size_bytes AS sizeBytes, checksum_sha256 AS sha256
       FROM documents WHERE id = 1`
    );
    assert(document, 'Canonical document 1 is missing.');
    const [[citation]] = await pool.query(
      `SELECT id FROM citations WHERE document_id = 1 ORDER BY id LIMIT 1`
    );
    assert(citation, 'Canonical citation for document 1 is missing.');

    const detail = (await httpRequest(baseUrl, `/api/citations/${citation.id}`, {
      headers: { authorization: `Bearer ${token}` }
    })).payload.data;
    const source = (await httpRequest(baseUrl, `/api/citations/${citation.id}/source`, {
      headers: { authorization: `Bearer ${token}` }
    })).payload.data;
    assert.equal(detail.originalAvailable, expectAvailable);
    assert.equal(source.originalAvailable, expectAvailable);
    assert(detail.sourceText && source.sourceText, 'Citation snapshot must remain available.');

    if (expectAvailable) {
      const documentFile = await binaryRequest(baseUrl, '/api/documents/1/file', token);
      const citationFile = await binaryRequest(baseUrl, `/api/citations/${citation.id}/file`, token);
      for (const response of [documentFile, citationFile]) {
        assert.equal(response.bytes.length, Number(document.sizeBytes));
        assert.equal(crypto.createHash('sha256').update(response.bytes).digest('hex'), document.sha256);
        assert.match(response.contentType, /^application\/pdf(?:;|$)/i);
        assert.match(response.disposition, /attachment/i);
      }
    } else {
      await httpRequest(baseUrl, '/api/documents/1/file', {
        headers: { authorization: `Bearer ${token}` }
      }, [404]);
      await httpRequest(baseUrl, `/api/citations/${citation.id}/file`, {
        headers: { authorization: `Bearer ${token}` }
      }, [409]);
    }

    const afterCounts = await databaseCounts(pool);
    const afterStores = await reconcileRuntime();
    assert.deepEqual(afterCounts, beforeCounts, 'Original-file reads must not mutate MySQL counts.');
    assert.equal(afterStores.points.length, beforeStores.points.length, 'Original-file reads must not mutate Qdrant.');

    console.log(JSON.stringify({
      status: 'CORPUS_FILES_LIVE_OK',
      documents: afterCounts.documents,
      jobs: afterCounts.jobs,
      chunks: afterCounts.chunks,
      points: afterStores.points.length,
      citations: afterCounts.citations,
      documentFile: expectAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
      citationFile: expectAvailable ? 'AVAILABLE' : 'UNAVAILABLE',
      checksumVerified: expectAvailable,
      paidProviderCalls: 0
    }));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${error.code || 'CORPUS_FILES_LIVE_FAILED'}: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main };
