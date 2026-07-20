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
  const stalePatterns = [
    ['docs/setup/docker-demo.md', 'deleted Docker setup guide'],
    ['docs/status/python-snapshot-source.md', 'merged snapshot status document'],
    ['Portable corpus: BLOCKED BY DATA APPROVAL', 'resolved corpus approval status'],
    ['Corpus export/restore | BLOCKED', 'resolved corpus readiness status'],
    ['Remote integration chưa được xác minh', 'obsolete remote verification claim']
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
  }
  assert.deepEqual(absolute, [], `Machine-specific paths found in: ${absolute.join(', ')}`);
  assert.deepEqual(missing, [], `Broken Markdown links:\n${missing.join('\n')}`);
  assert.deepEqual(missingCommands, [], `Unknown documented npm commands:\n${missingCommands.join('\n')}`);
  assert.deepEqual(stale, [], `Stale documentation references:\n${stale.join('\n')}`);
  console.log(
    `DOCS_OK files=${files.length} relativeLinks=${checkedLinks} npmCommands=${checkedCommands}`
  );
}

main();
