const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { createReadStream } = require('fs');

const uploadConfig = require('../configs/upload');
const appError = require('../utils/app-error');

function resolveStorageKey(storageKey) {
  if (typeof storageKey !== 'string' || !storageKey || path.isAbsolute(storageKey)) {
    throw appError(400, 'INVALID_STORAGE_KEY', 'Storage key không hợp lệ.');
  }
  const segments = storageKey.replace(/\\/g, '/').split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw appError(400, 'INVALID_STORAGE_KEY', 'Storage key không hợp lệ.');
  }
  const resolved = path.resolve(uploadConfig.rootDirectory, ...segments);
  const prefix = `${uploadConfig.rootDirectory}${path.sep}`;
  if (!resolved.startsWith(prefix)) {
    throw appError(400, 'INVALID_STORAGE_KEY', 'Storage key nằm ngoài upload directory.');
  }
  return resolved;
}

async function save(buffer, extension) {
  const now = new Date();
  const key = [
    'documents',
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    `${crypto.randomUUID()}${extension}`
  ].join('/');
  const target = resolveStorageKey(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer, { flag: 'wx' });
  return key;
}

async function remove(storageKey) {
  const target = resolveStorageKey(storageKey);
  try {
    await fs.unlink(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function open(storageKey) {
  const target = resolveStorageKey(storageKey);
  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error('Not a file');
    return { stream: createReadStream(target), size: stat.size };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw appError(404, 'FILE_NOT_FOUND', 'File gốc không còn tồn tại trên storage.');
    }
    throw error;
  }
}

async function exists(storageKey) {
  const target = resolveStorageKey(storageKey);
  try {
    const stat = await fs.stat(target);
    return stat.isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

module.exports = { save, remove, open, exists, resolveStorageKey };
