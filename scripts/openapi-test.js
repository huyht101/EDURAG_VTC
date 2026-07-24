'use strict';

const assert = require('assert/strict');
const spec = require('../src/configs/swagger');

const expectedTags = [
  'Authentication', 'Profile', 'Admin - Users', 'Documents', 'Document Library', 'Document Processing',
  'Chat Sessions', 'Chat Messages', 'Citations', 'Admin Dashboard', 'Internal RAG'
];
const actualTags = spec.tags.map((tag) => tag.name);
assert.deepEqual(actualTags.slice(0, expectedTags.length), expectedTags);

const methods = ['get', 'post', 'put', 'patch', 'delete'];
let operations = 0;
const documentedOperations = new Set();
for (const [path, pathItem] of Object.entries(spec.paths)) {
  for (const method of methods) {
    const operation = pathItem[method];
    if (!operation) continue;
    operations += 1;
    documentedOperations.add(`${method.toUpperCase()} ${path}`);
    assert(operation.summary?.trim(), `${method.toUpperCase()} ${path} lacks summary.`);
    assert(operation.description?.trim(), `${method.toUpperCase()} ${path} lacks description.`);
    assert(operation.tags?.length === 1, `${method.toUpperCase()} ${path} must have one domain tag.`);
    assert(Object.keys(operation.responses || {}).length, `${method.toUpperCase()} ${path} lacks responses.`);
  }
}

const runtimeOperations = new Set(['GET /health', 'GET /ready']);
for (const [prefix, router] of [
  ['/api/auth', require('../src/routes/auth-routes')],
  ['/api', require('../src/routes/user-routes')],
  ['/api/documents', require('../src/routes/document-routes')],
  ['/api/library/documents', require('../src/routes/library-routes')],
  ['/api/internal/rag', require('../src/routes/internal-rag-routes')],
  ['/api/chat', require('../src/routes/chat-routes')],
  ['/api/citations', require('../src/routes/citation-routes')],
  ['/api/admin/dashboard', require('../src/routes/dashboard-routes')]
]) {
  for (const layer of router.stack) {
    if (!layer.route || typeof layer.route.path !== 'string') continue;
    const expressPath = layer.route.path === '/' ? prefix : `${prefix}${layer.route.path}`;
    const path = expressPath.replace(/:([^/]+)/g, '{$1}');
    for (const method of methods) {
      if (layer.route.methods[method]) runtimeOperations.add(`${method.toUpperCase()} ${path}`);
    }
  }
}
assert.deepEqual(
  [...documentedOperations].sort(),
  [...runtimeOperations].sort(),
  'OpenAPI operations must exactly match mounted public/internal API routes.'
);

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
assert.deepEqual(Object.keys(chatPost.requestBody.content), ['application/json']);
assert.match(chatPost.description, /không (nhận|có) multipart\/image/i);
assert(!Object.hasOwn(
  chatPost.responses[200].content['application/json'].example.data.assistantMessage.citations[0],
  'vectorNodeId'
));
assert.match(chatPost.responses[200].description, /PENDING\/COMPLETED\/FAILED/);

const chatHistory = spec.paths['/api/chat/sessions/{id}/messages'].get.responses[200]
  .content['application/json'].example.data;
assert(Array.isArray(chatHistory.messages));
assert(Object.hasOwn(chatHistory.messages[0], 'senderType'));
assert(!Object.hasOwn(chatHistory.messages[0], 'role'));

const documentFile = spec.paths['/api/documents/{id}/file'].get.responses[200];
assert(documentFile.headers['Content-Disposition']);
assert(documentFile.headers['Content-Length']);
assert.match(documentFile.description, /no Range\/206/i);
assert.match(spec.components.schemas.RegisterBody.properties.email.description, /does not enforce @student\.edu\.vn/i);
assert.match(spec.components.schemas.CitationSnapshot.description, /not serialized/i);
assert(!Object.hasOwn(spec.components.schemas.CitationSnapshot.properties, 'fileUrl'));
assert(spec.components.schemas.CitationSnapshot.required.includes('documentId'));
for (const internal of ['vectorNodeId', 'storageKey', 'jobId']) {
  assert(!Object.hasOwn(spec.components.schemas.CitationSnapshot.properties, internal));
}
assert.deepEqual(
  spec.paths['/api/citations/{id}/source'].get.responses[200].content['application/json'].example,
  spec.paths['/api/citations/{id}'].get.responses[200].content['application/json'].example
);

assert(spec.paths['/ready'].get.responses[503]);
for (const path of [
  '/api/auth/register', '/api/auth/login', '/api/auth/admin/verify-otp',
  '/api/auth/forgot-password', '/api/auth/reset-password'
]) {
  assert(spec.paths[path].post.responses[429], `${path} must document rate limiting.`);
}
assert.match(spec.paths['/api/citations/{id}'].get.description, /owner của chat session/);

const libraryList = spec.paths['/api/library/documents'].get;
assert.equal(libraryList.tags[0], 'Document Library');
assert.match(libraryList.description, /READY \+ VISIBLE/);
assert.match(libraryList.description, /STUDENT, TEACHER (?:hoặc|và) ADMIN/);
assert.deepEqual(
  libraryList.parameters.map((parameter) => parameter.name),
  ['offset', 'limit', 'search']
);
const libraryProperties = Object.keys(spec.components.schemas.LibraryDocument.properties).sort();
assert.deepEqual(
  libraryProperties,
  ['createdAt', 'fileSize', 'fileType', 'id', 'originalAvailable', 'pageCount', 'title']
);
assert(spec.paths['/api/library/documents/{id}'].get.responses[404]);
assert(spec.paths['/api/library/documents/{id}/source'].get.responses[404]);
assert(spec.paths['/api/library/documents/{id}/source'].get.responses[409]);
for (const path of [
  '/api/library/documents',
  '/api/library/documents/{id}',
  '/api/library/documents/{id}/source'
]) {
  assert(spec.paths[path].get.responses[401], `${path} must document unauthenticated access.`);
}
assert.match(spec.paths['/api/documents'].get.description, /STUDENT bị từ chối/);
for (const [method, path] of [
  ['get', '/api/documents'],
  ['post', '/api/documents'],
  ['get', '/api/documents/{id}'],
  ['patch', '/api/documents/{id}'],
  ['delete', '/api/documents/{id}'],
  ['get', '/api/documents/{id}/file'],
  ['get', '/api/documents/jobs/{jobId}'],
  ['post', '/api/documents/{id}/hide'],
  ['post', '/api/documents/{id}/unhide']
]) {
  assert(spec.paths[path][method].responses[403], `${method.toUpperCase()} ${path} must document STUDENT denial.`);
}

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
