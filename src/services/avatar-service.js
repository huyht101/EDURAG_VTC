const withTransaction = require('../database/transaction');
const userRepo = require('../repositories/user-repository');
const avatarFiles = require('./avatar-file-service');
const appError = require('../utils/app-error');

function descriptor(avatar) {
  const available = Boolean(avatar?.storageKey && avatar?.mimeType);
  return {
    avatarAvailable: available,
    avatarUrl: available ? '/api/profile/avatar' : null,
    avatarMimeType: available ? avatar.mimeType : null
  };
}

function safeCleanupLog(action, userId, error) {
  const cause = String(error?.code || error?.name || 'Error').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  console.error(`[AVATAR_CLEANUP] action=${action} user=${Number(userId)} cause=${cause}`);
}

async function uploadMyAvatar(userId, file, dependencies = {}) {
  const files = dependencies.avatarFiles || avatarFiles;
  const users = dependencies.userRepo || userRepo;
  const transaction = dependencies.withTransaction || withTransaction;
  const saved = await files.persist(file);
  let previous = null;
  try {
    await transaction(async (connection) => {
      previous = await users.findAvatarByIdForUpdate(userId, connection);
      if (!previous) throw appError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.');
      await users.updateAvatar(userId, saved, connection);
    });
  } catch (error) {
    await files.remove(saved.storageKey).catch((cleanupError) => {
      safeCleanupLog('new-after-db-failure', userId, cleanupError);
    });
    throw error;
  }

  if (previous.avatar_storage_key && previous.avatar_storage_key !== saved.storageKey) {
    await files.remove(previous.avatar_storage_key).catch((error) => {
      safeCleanupLog('old-after-replace', userId, error);
    });
  }
  return descriptor(saved);
}

async function openMyAvatar(userId, role, dependencies = {}) {
  const files = dependencies.avatarFiles || avatarFiles;
  const users = dependencies.userRepo || userRepo;
  const profile = await users.findProfileDetail(userId, role);
  if (!profile) throw appError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.');
  if (!profile.avatar_storage_key || !profile.avatar_mime_type) {
    throw appError(404, 'AVATAR_NOT_FOUND', 'Người dùng chưa có avatar.');
  }
  const opened = await files.open(profile.avatar_storage_key);
  return { ...opened, mimeType: profile.avatar_mime_type };
}

async function deleteMyAvatar(userId, dependencies = {}) {
  const files = dependencies.avatarFiles || avatarFiles;
  const users = dependencies.userRepo || userRepo;
  const transaction = dependencies.withTransaction || withTransaction;
  let previous = null;
  await transaction(async (connection) => {
    previous = await users.findAvatarByIdForUpdate(userId, connection);
    if (!previous) throw appError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.');
    if (previous.avatar_storage_key || previous.avatar_mime_type) {
      await users.updateAvatar(userId, null, connection);
    }
  });

  if (previous.avatar_storage_key) {
    await files.remove(previous.avatar_storage_key).catch((error) => {
      safeCleanupLog('old-after-delete', userId, error);
    });
  }
  return descriptor(null);
}

module.exports = { descriptor, uploadMyAvatar, openMyAvatar, deleteMyAvatar };
