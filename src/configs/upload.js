const path = require('path');

function positiveInteger(value, fallback, name) {
  const parsed = Number(value || fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

module.exports = {
  rootDirectory: path.resolve(process.env.UPLOAD_DIR || 'uploads'),
  maxFileSizeBytes: positiveInteger(process.env.FILE_MAX_SIZE_BYTES, 20 * 1024 * 1024, 'FILE_MAX_SIZE_BYTES')
};
