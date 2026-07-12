const pool = require('../configs/db');

function executorOrPool(executor) {
  return executor || pool;
}

async function saveToken({ userId, tokenType, tokenHash, expiresAt }, executor) {
  const [result] = await executorOrPool(executor).execute(
    `INSERT INTO auth_tokens (user_id, token_type, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [userId, tokenType, tokenHash, expiresAt]
  );
  return result.insertId;
}

async function findValidToken({ userId, tokenType, tokenHash, forUpdate = false }, executor) {
  const lockClause = forUpdate ? ' FOR UPDATE' : '';
  const [rows] = await executorOrPool(executor).execute(
    `SELECT id, user_id, token_type, expires_at, used_at, revoked_at, attempt_count
     FROM auth_tokens
     WHERE user_id = ?
       AND token_type = ?
       AND token_hash = ?
       AND used_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP(3)${lockClause}`,
    [userId, tokenType, tokenHash]
  );
  return rows[0] || null;
}

async function findActiveTokenByUserAndType(userId, tokenType, executor) {
  const [rows] = await executorOrPool(executor).execute(
    `SELECT id, user_id, token_type, token_hash, expires_at, used_at, revoked_at, attempt_count
     FROM auth_tokens
     WHERE user_id = ?
       AND token_type = ?
       AND used_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP(3)
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [userId, tokenType]
  );
  return rows[0] || null;
}

async function markTokenAsUsed(id, executor) {
  await executorOrPool(executor).execute(
    'UPDATE auth_tokens SET used_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
    [id]
  );
}

async function revokeTokensByUserAndType(userId, tokenType, executor) {
  await executorOrPool(executor).execute(
    `UPDATE auth_tokens
     SET revoked_at = CURRENT_TIMESTAMP(3)
     WHERE user_id = ? AND token_type = ? AND used_at IS NULL AND revoked_at IS NULL`,
    [userId, tokenType]
  );
}

async function recordFailedAttempt(id, maxAttempts, executor) {
  await executorOrPool(executor).execute(
    `UPDATE auth_tokens
     SET attempt_count = attempt_count + 1,
         revoked_at = CASE
           WHEN attempt_count + 1 >= ? THEN CURRENT_TIMESTAMP(3)
           ELSE revoked_at
         END
     WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL`,
    [maxAttempts, id]
  );
}

module.exports = {
  saveToken,
  findValidToken,
  findActiveTokenByUserAndType,
  markTokenAsUsed,
  revokeTokensByUserAndType,
  recordFailedAttempt
};
