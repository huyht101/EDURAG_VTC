const pool = require('../configs/db');

function db(executor) {
  return executor || pool;
}

async function insertCitation(data, executor) {
  const [result] = await db(executor).execute(
    `INSERT INTO citations
      (message_id, document_id, chunk_id, vector_node_id_snapshot, citation_order,
       document_title_snapshot, page_number_snapshot, section_title_snapshot,
       source_text_snapshot, source_locator_snapshot, retrieval_score, rerank_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.messageId, data.documentId, data.chunkId, data.vectorNodeId,
      data.citationOrder, data.documentTitle, data.pageNumber ?? null,
      data.sectionTitle ?? null, data.sourceText,
      data.sourceLocator === undefined || data.sourceLocator === null
        ? null : JSON.stringify(data.sourceLocator),
      data.retrievalScore ?? null, data.rerankScore ?? null
    ]
  );
  return result.insertId;
}

async function listByMessageIds(messageIds, executor) {
  if (!messageIds.length) return [];
  const placeholders = messageIds.map(() => '?').join(',');
  const [rows] = await db(executor).execute(
    `SELECT id, message_id, document_id, chunk_id, vector_node_id_snapshot,
            citation_order, document_title_snapshot, page_number_snapshot,
            section_title_snapshot, source_text_snapshot, source_locator_snapshot,
            retrieval_score, rerank_score, created_at
     FROM citations WHERE message_id IN (${placeholders})
     ORDER BY message_id, citation_order`,
    messageIds
  );
  return rows;
}

async function findContextById(id, executor) {
  const [rows] = await db(executor).execute(
    `SELECT c.*, m.session_id, s.user_id AS session_user_id, s.deleted_at AS session_deleted_at,
            d.uploaded_by, d.original_filename, d.storage_key, d.mime_type,
            d.processing_status, d.visibility_status
     FROM citations c
     JOIN chat_messages m ON m.id = c.message_id
     JOIN chat_sessions s ON s.id = m.session_id
     LEFT JOIN documents d ON d.id = c.document_id
     WHERE c.id = ?`,
    [id]
  );
  return rows[0] || null;
}

module.exports = { insertCitation, listByMessageIds, findContextById };
