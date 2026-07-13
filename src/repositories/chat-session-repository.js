const pool = require('../configs/db');
const sqlPageNumbers = require('../utils/pagination');

function db(executor) {
  return executor || pool;
}

async function createSession(userId, title, executor) {
  const [result] = await db(executor).execute(
    'INSERT INTO chat_sessions (user_id, title) VALUES (?, ?)',
    [userId, title || null]
  );
  return result.insertId;
}

async function findById(id, executor) {
  const [rows] = await db(executor).execute('SELECT * FROM chat_sessions WHERE id = ?', [id]);
  return rows[0] || null;
}

async function findOwnedById(id, userId, executor) {
  const [rows] = await db(executor).execute(
    'SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  return rows[0] || null;
}

async function findOwnedByIdForUpdate(id, userId, executor) {
  const [rows] = await db(executor).execute(
    'SELECT * FROM chat_sessions WHERE id = ? AND user_id = ? FOR UPDATE',
    [id, userId]
  );
  return rows[0] || null;
}

async function listSessions(userId, offset, limit, executor) {
  const page = sqlPageNumbers(offset, limit);
  const database = db(executor);
  const [countRows] = await database.execute(
    'SELECT COUNT(*) AS total FROM chat_sessions WHERE user_id = ? AND deleted_at IS NULL',
    [userId]
  );
  const [rows] = await database.execute(
    `SELECT id, title, last_message_at, created_at, updated_at
     FROM chat_sessions
     WHERE user_id = ? AND deleted_at IS NULL
     ORDER BY COALESCE(last_message_at, created_at) DESC, id DESC
     LIMIT ${page.limit} OFFSET ${page.offset}`,
    [userId]
  );
  return { total: Number(countRows[0].total), sessions: rows };
}

async function softDelete(id, executor) {
  await db(executor).execute(
    'UPDATE chat_sessions SET deleted_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
    [id]
  );
}

async function touch(id, executor) {
  await db(executor).execute(
    'UPDATE chat_sessions SET last_message_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
    [id]
  );
}

module.exports = {
  createSession,
  findById,
  findOwnedById,
  findOwnedByIdForUpdate,
  listSessions,
  softDelete,
  touch
};
