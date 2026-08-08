'use strict';

const http = require('http');

const target = process.env.OFFLINE_CALLBACK_TARGET || 'http://app:5000';
const port = Number(process.env.OFFLINE_CALLBACK_PROXY_PORT || 9000);

let holdNextSuccess = false;
let pending = null;
let callbacks = 0;

function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function forward(request, response, raw) {
  const upstream = await fetch(new URL(request.url, target), {
    method: request.method,
    headers: {
      authorization: request.headers.authorization || '',
      'content-type': request.headers['content-type'] || 'application/json'
    },
    body: raw,
    signal: AbortSignal.timeout(15000)
  });
  const upstreamBody = Buffer.from(await upstream.arrayBuffer());
  let payload = null;
  try { payload = JSON.parse(raw.toString('utf8')); } catch (_error) { /* Node validates it. */ }
  callbacks += 1;
  const held = holdNextSuccess && payload?.event_type === 'SUCCEEDED';
  if (held) {
    holdNextSuccess = false;
    pending = {
      response,
      status: upstream.status,
      contentType: upstream.headers.get('content-type') || 'application/json',
      body: upstreamBody,
      jobId: String(payload.job_id),
      attemptCount: Number(payload.attempt_count)
    };
    return;
  }
  response.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') || 'application/json'
  });
  response.end(upstreamBody);
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/__test__/health') {
      return json(response, 200, { status: 'OK' });
    }
    if (request.method === 'GET' && request.url === '/__test__/state') {
      return json(response, 200, {
        callbacks,
        pending: pending ? {
          jobId: pending.jobId,
          attemptCount: pending.attemptCount
        } : null
      });
    }
    if (request.method === 'POST' && request.url === '/__test__/hold-next-success') {
      if (pending || holdNextSuccess) return json(response, 409, { code: 'HOLD_ALREADY_PENDING' });
      holdNextSuccess = true;
      return json(response, 200, { status: 'ARMED' });
    }
    if (request.method === 'POST' && request.url === '/__test__/release') {
      if (!pending) return json(response, 409, { code: 'NO_PENDING_ACK' });
      const held = pending;
      pending = null;
      if (!held.response.destroyed) {
        held.response.writeHead(held.status, { 'content-type': held.contentType });
        held.response.end(held.body);
      }
      return json(response, 200, { status: 'RELEASED' });
    }
    if (!request.url.startsWith('/api/internal/rag/')) {
      return json(response, 404, { code: 'NOT_FOUND' });
    }
    return await forward(request, response, await body(request));
  } catch (error) {
    if (!response.headersSent) json(response, 502, { code: 'OFFLINE_PROXY_FAILURE' });
    else response.destroy();
  }
});

server.listen(port, '0.0.0.0');

function shutdown() {
  if (pending && !pending.response.destroyed) {
    pending.response.writeHead(503, { 'content-type': 'application/json' });
    pending.response.end(JSON.stringify({ code: 'OFFLINE_PROXY_SHUTDOWN' }));
  }
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
