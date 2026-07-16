const path = require('path');

const localStorage = require('./local-storage');
const appError = require('../utils/app-error');

function pathImplementation(rootDirectory) {
  if (/^[A-Za-z]:[\\/]/.test(rootDirectory) || rootDirectory.startsWith('\\\\')) {
    return path.win32;
  }
  if (rootDirectory.startsWith('/')) return path.posix;
  throw appError(
    500,
    'RAG_SHARED_UPLOAD_DIR_INVALID',
    'RAG_SHARED_UPLOAD_DIR must be an absolute Python-visible path.'
  );
}

function resolveSharedUploadPath(storageKey, sharedRootDirectory) {
  // Reuse the local adapter's containment rules before constructing a second view of the key.
  localStorage.resolveStorageKey(storageKey);

  if (typeof sharedRootDirectory !== 'string' || !sharedRootDirectory.trim()) {
    throw appError(
      500,
      'RAG_SHARED_UPLOAD_DIR_INVALID',
      'RAG_SHARED_UPLOAD_DIR is required for remote ingest.'
    );
  }

  const implementation = pathImplementation(sharedRootDirectory.trim());
  const root = implementation.resolve(sharedRootDirectory.trim());
  const segments = storageKey.replace(/\\/g, '/').split('/');
  const resolved = implementation.resolve(root, ...segments);
  const relative = implementation.relative(root, resolved);

  if (!relative || relative === '..' || relative.startsWith(`..${implementation.sep}`)
    || implementation.isAbsolute(relative)) {
    throw appError(
      400,
      'INVALID_STORAGE_KEY',
      'Storage key cannot be mapped outside the shared upload directory.'
    );
  }
  return resolved;
}

module.exports = { resolveSharedUploadPath };
