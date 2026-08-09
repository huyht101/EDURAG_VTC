'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const { root } = require('./remote-test-utils');

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(resolved);
    return entry.isFile() && entry.name.endsWith('.md') ? [resolved] : [];
  });
}

function main() {
  const bootstrapDirectory = path.join(root, 'bootstrap');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packageScripts = new Set(Object.keys(packageJson.scripts || {}));
  const files = [
    path.join(root, 'README.md'),
    ...(fs.existsSync(path.join(root, 'secrets', 'README.md'))
      ? [path.join(root, 'secrets', 'README.md')]
      : []),
    ...(fs.existsSync(bootstrapDirectory) ? markdownFiles(bootstrapDirectory) : []),
    ...markdownFiles(path.join(root, 'docs'))
  ];
  const missing = [];
  const absolute = [];
  const missingCommands = [];
  const stale = [];
  const mockAppendixErrors = [];
  const stalePatterns = [
    ['docs/setup/docker-demo.md', 'deleted Docker setup guide'],
    ['docs/status/python-snapshot-source.md', 'merged snapshot status document'],
    ['CORPUS_FILES_BOOTSTRAP', 'superseded split original-file bootstrap mode'],
    ['corpus:files:', 'superseded split original-file command'],
    ['npm run corpus:export', 'superseded local bundle export command'],
    ['bootstrap/corpus/manifest.json', 'removed repository corpus manifest'],
    ['Portable corpus: BLOCKED BY DATA APPROVAL', 'resolved corpus approval status'],
    ['Corpus export/restore | BLOCKED', 'resolved corpus readiness status'],
    ['Remote integration chưa được xác minh', 'obsolete remote verification claim'],
    ['Python snapshot vẫn upsert retrieval-enabled random point IDs', 'obsolete Python point-ID/activation claim'],
    ['Python hiện chỉ trả một final `usage`', 'obsolete Python usage claim']
  ];
  let checkedLinks = 0;
  let checkedCommands = 0;
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    if (/\bfile:\/\//i.test(content) || /\b[A-Za-z]:\\/.test(content)) {
      absolute.push(path.relative(root, file));
    }
    for (const [needle, description] of stalePatterns) {
      if (content.includes(needle)) {
        stale.push(`${path.relative(root, file)}: ${description}`);
      }
    }
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].trim().replace(/^<|>$/g, '');
      if (!target || /^(?:https?:|mailto:|#)/i.test(target)) continue;
      target = target.split('#', 1)[0];
      if (!target) continue;
      try { target = decodeURIComponent(target); } catch (_error) { /* literal path */ }
      checkedLinks += 1;
      if (!fs.existsSync(path.resolve(path.dirname(file), target))) {
        missing.push(`${path.relative(root, file)} -> ${target}`);
      }
    }
    for (const match of content.matchAll(/\bnpm(?:\.cmd)?\s+run\s+([\w:-]+)/g)) {
      const command = match[1];
      checkedCommands += 1;
      if (!packageScripts.has(command)) {
        missingCommands.push(`${path.relative(root, file)} -> npm run ${command}`);
      }
    }
    if (content.includes('npm run docker:mock:up')) {
      const heading = '## Phụ lục — Mock mode (REFERENCE ONLY)';
      const appendix = content.indexOf(heading);
      const remote = content.indexOf('npm run docker:remote:dev');
      const firstMockCommand = content.indexOf('npm run docker:mock:');
      if (appendix < 0 || !/---\r?\n\r?\n$/.test(content.slice(0, appendix))
        || firstMockCommand < appendix
        || content.slice(appendix + heading.length).includes('\n## ')
        || remote < 0 || remote > appendix) {
        mockAppendixErrors.push(path.relative(root, file));
      }
    }
  }
  assert.deepEqual(absolute, [], `Machine-specific paths found in: ${absolute.join(', ')}`);
  assert.deepEqual(missing, [], `Broken Markdown links:\n${missing.join('\n')}`);
  assert.deepEqual(missingCommands, [], `Unknown documented npm commands:\n${missingCommands.join('\n')}`);
  assert.deepEqual(stale, [], `Stale documentation references:\n${stale.join('\n')}`);
  assert.deepEqual(
    mockAppendixErrors,
    [],
    `Mock startup must be the final reference-only appendix after canonical remote setup:\n${mockAppendixErrors.join('\n')}`
  );
  console.log(
    `DOCS_OK files=${files.length} relativeLinks=${checkedLinks} npmCommands=${checkedCommands}`
  );
}

main();
