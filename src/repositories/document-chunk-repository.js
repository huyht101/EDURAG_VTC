const pool = require('../configs/db');

function db(executor) {
  return executor || pool;
}

async function deleteByDocument(documentId, executor) {
  await db(executor).execute('DELETE FROM document_chunks WHERE document_id = ?', [documentId]);
}

async function insertManifest(documentId, processingJobId, chunks, executor) {
  const database = db(executor);
  for (const chunk of chunks) {
    await database.execute(
      `INSERT INTO document_chunks
        (document_id, processing_job_id, chunk_index, vector_node_id, chunk_text,
         content_hash, token_count, page_number, section_title, source_locator)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        documentId, processingJobId, chunk.chunkIndex, chunk.vectorNodeId, chunk.chunkText,
        chunk.contentHash, chunk.tokenCount ?? null, chunk.pageNumber ?? null,
        chunk.sectionTitle ?? null,
        chunk.sourceLocator === undefined || chunk.sourceLocator === null
          ? null : JSON.stringify(chunk.sourceLocator)
      ]
    );
  }
}

async function countByJob(processingJobId, executor) {
  const [rows] = await db(executor).execute(
    'SELECT COUNT(*) AS total FROM document_chunks WHERE processing_job_id = ?',
    [processingJobId]
  );
  return Number(rows[0].total);
}

async function findByVectorNodeIds(vectorNodeIds, executor) {
  if (!vectorNodeIds.length) return [];
  const placeholders = vectorNodeIds.map(() => '?').join(',');
  const [rows] = await db(executor).execute(
    `SELECT dc.*, d.title AS document_title, d.processing_status, d.visibility_status
     FROM document_chunks dc
     JOIN documents d ON d.id = dc.document_id
     WHERE dc.vector_node_id IN (${placeholders})`,
    vectorNodeIds
  );
  return rows;
}

module.exports = {
  deleteByDocument,
  insertManifest,
  countByJob,
  findByVectorNodeIds
};
