'use strict';

const { execFileSync } = require('child_process');
const { readdirSync } = require('fs');
const { join } = require('path');

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : [];
  });
}

for (const file of [...javascriptFiles(join(__dirname, '..', 'src')), ...javascriptFiles(__dirname)]) {
  if (file === __filename) continue;
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log('JavaScript syntax check passed.');
