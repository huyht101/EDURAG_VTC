'use strict';

const { spawnSync } = require('child_process');

const image = `edurag-docx-preview-regression-${process.pid}:local`;

function run(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    windowsHide: true,
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`docker ${args[0]} failed with exit code ${result.status}.`);
    error.code = 'DOCKER_PREVIEW_REGRESSION_FAILED';
    throw error;
  }
}

try {
  run(['build', '--target', 'preview-test', '-t', image, '.']);
  run(['run', '--rm', image, 'node', 'scripts/docx-vietnamese-preview-test.js']);
} finally {
  spawnSync('docker', ['image', 'rm', image], {
    cwd: process.cwd(),
    stdio: 'ignore',
    windowsHide: true
  });
}
