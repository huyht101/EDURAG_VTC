'use strict';

const assert = require('assert/strict');
const spec = require('../src/configs/swagger');

const expectedTags = [
  'Authentication', 'Profile', 'Admin - Users', 'Documents', 'Document Processing',
  'Chat Sessions', 'Chat Messages', 'Citations', 'Admin Dashboard', 'Internal RAG'
];
const actualTags = spec.tags.map((tag) => tag.name);
assert.deepEqual(actualTags.slice(0, expectedTags.length), expectedTags);

const methods = ['get', 'post', 'put', 'patch', 'delete'];
let operations = 0;
for (const [path, pathItem] of Object.entries(spec.paths)) {
  for (const method of methods) {
    const operation = pathItem[method];
    if (!operation) continue;
    operations += 1;
    assert(operation.summary?.trim(), `${method.toUpperCase()} ${path} lacks summary.`);
    assert(operation.description?.trim(), `${method.toUpperCase()} ${path} lacks description.`);
    assert(operation.tags?.length === 1, `${method.toUpperCase()} ${path} must have one domain tag.`);
    assert(Object.keys(operation.responses || {}).length, `${method.toUpperCase()} ${path} lacks responses.`);
  }
}

const chatBody = spec.components.schemas.ChatMessageBody;
assert.deepEqual(chatBody.required, ['content']);
assert(!Object.hasOwn(chatBody.properties.clientRequestId, 'default'));
assert.equal(chatBody.properties.clientRequestId.nullable, true);
const chatPost = spec.paths['/api/chat/sessions/{id}/messages'].post;
assert(chatPost.requestBody.content['application/json'].examples.simple.value.content);
assert(!Object.hasOwn(chatPost.requestBody.content['application/json'].examples.simple.value, 'clientRequestId'));
assert.match(chatPost.requestBody.content['application/json'].examples.safeRetry.value.clientRequestId, /^[0-9a-f-]{36}$/i);
assert(chatPost.responses[200].content['application/json'].example.data.clientRequestId);
assert(chatPost.responses[200].content['application/json'].example.data.assistantMessage.citations.length > 0);
assert.match(chatPost.description, /structured citation/i);

assert(spec.paths['/ready'].get.responses[503]);
for (const path of [
  '/api/auth/register', '/api/auth/login', '/api/auth/admin/verify-otp',
  '/api/auth/forgot-password', '/api/auth/reset-password'
]) {
  assert(spec.paths[path].post.responses[429], `${path} must document rate limiting.`);
}
assert.match(spec.paths['/api/citations/{id}'].get.description, /owner của chat session/);

const callback = spec.paths['/api/internal/rag/processing-callback'].post;
assert.deepEqual(callback.security, [{ internalBearer: [] }]);
assert.match(callback.description, /Service-to-service only/);
assert.match(callback.description, /không dùng user JWT/i);
assert(!callback.security.some((item) => Object.hasOwn(item, 'bearerAuth')));

const upload = spec.paths['/api/documents'].post;
assert.match(upload.description, /poll GET \/api\/documents\/jobs\/\{jobId\}/);
assert.match(upload.responses[202].description, /not complete/i);
assert.equal(spec.paths['/api/documents/jobs/{jobId}'].get.tags[0], 'Document Processing');
assert.match(spec.paths['/api/citations/{id}/file'].get.description, /portable corpus/i);

JSON.stringify(spec);
console.log(`OPENAPI_OK operations=${operations} tags=${actualTags.length}`);
