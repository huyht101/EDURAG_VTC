const pool = require('../configs/db');
const sqlPageNumbers = require('../utils/pagination');

function db(executor) {
  return executor || pool;
}

async function nextMessageOrder(sessionId, executor) {
  const [rows] = await db(executor).execute(
    'SELECT COALESCE(MAX(message_order), 0) + 1 AS next_order FROM chat_messages WHERE session_id = ?',
    [sessionId]
  );
  return Number(rows[0].next_order);
}

async function insertMessage(data, executor) {
  const [result] = await db(executor).execute(
    `INSERT INTO chat_messages
      (session_id, sender_type, message_order, content, status, no_answer,
       client_request_id, error_code, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.sessionId, data.senderType, data.messageOrder, data.content ?? null,
      data.status, Boolean(data.noAnswer), data.clientRequestId || null,
      data.errorCode || null, data.completedAt || null
    ]
  );
  return result.insertId;
}

async function findRequestPair(clientRequestId, executor) {
  const [rows] = await db(executor).execute(
    `SELECT u.id AS user_message_id, u.session_id, u.message_order AS user_message_order,
            u.content AS question, u.client_request_id, a.id AS assistant_message_id, a.content AS answer,
            a.status AS assistant_status, a.no_answer, a.error_code,
            a.created_at AS assistant_created_at
     FROM chat_messages u
     LEFT JOIN chat_messages a
       ON a.session_id = u.session_id
      AND a.message_order = u.message_order + 1
      AND a.sender_type = 'ASSISTANT'
     WHERE u.client_request_id = ? AND u.sender_type = 'USER'`,
    [clientRequestId]
  );
  return rows[0] || null;
}

async function failStalePending(id, timeoutMs, executor) {
  const [result] = await db(executor).execute(
    `UPDATE chat_messages
     SET status = 'FAILED', error_code = 'RAG_PENDING_TIMEOUT', completed_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND sender_type = 'ASSISTANT' AND status = 'PENDING'
       AND TIMESTAMPDIFF(MICROSECOND, created_at, CURRENT_TIMESTAMP(3)) >= ?`,
    [id, timeoutMs * 1000]
  );
  return result.affectedRows === 1;
}

async function updateAssistantCompleted(id, { content, noAnswer }, executor) {
  const [result] = await db(executor).execute(
    `UPDATE chat_messages
     SET content = ?, status = 'COMPLETED', no_answer = ?, error_code = NULL,
         completed_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND sender_type = 'ASSISTANT' AND status = 'PENDING'`,
    [content ?? null, Boolean(noAnswer), id]
  );
  return result.affectedRows === 1;
}

async function updateAssistantFailed(id, errorCode, executor) {
  await db(executor).execute(
    `UPDATE chat_messages
     SET status = 'FAILED', error_code = ?, completed_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND sender_type = 'ASSISTANT' AND status = 'PENDING'`,
    [errorCode || 'RAG_FAILED', id]
  );
}

async function listMessages(sessionId, offset, limit, executor) {
  const page = sqlPageNumbers(offset, limit);
  const database = db(executor);
  const [countRows] = await database.execute(
    'SELECT COUNT(*) AS total FROM chat_messages WHERE session_id = ?',
    [sessionId]
  );
  const [rows] = await database.execute(
    `SELECT id, session_id, sender_type, message_order, content, status,
            no_answer, client_request_id, error_code, completed_at, created_at
     FROM chat_messages
     WHERE session_id = ?
     ORDER BY message_order ASC
     LIMIT ${page.limit} OFFSET ${page.offset}`,
    [sessionId]
  );
  return { total: Number(countRows[0].total), messages: rows };
}

async function loadHistoryWindow(sessionId, beforeOrder, limit, executor) {
  const page = sqlPageNumbers(0, limit);
  const [rows] = await db(executor).execute(
    `SELECT sender_type, content, message_order
     FROM (
       SELECT sender_type, content, message_order
       FROM chat_messages
       WHERE session_id = ? AND message_order < ? AND status = 'COMPLETED' AND content IS NOT NULL
       ORDER BY message_order DESC
       LIMIT ${page.limit}
     ) recent
     ORDER BY message_order ASC`,
    [sessionId, beforeOrder]
  );
  return rows;
}

module.exports = {
  nextMessageOrder,
  insertMessage,
  findRequestPair,
  updateAssistantCompleted,
  updateAssistantFailed,
  failStalePending,
  listMessages,
  loadHistoryWindow
};
