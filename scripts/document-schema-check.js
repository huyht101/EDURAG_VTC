'use strict';

const documentRepo = require('../src/repositories/document-repository');
const libraryRepo = require('../src/repositories/library-repository');

const REQUIRED_DOCUMENT_COLUMNS = Object.freeze([
  'description',
  'author',
  'page_count',
  'preview_status',
  'preview_storage_key',
  'preview_mime_type'
]);

async function checkDocumentSchema(executor) {
  const [columnRows] = await executor.execute(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documents'`
  );
  const columns = new Set(columnRows.map((row) => String(row.COLUMN_NAME || row.column_name)));
  const missing = REQUIRED_DOCUMENT_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length) {
    const error = new Error(
      `Document schema is missing required columns: ${missing.join(', ')}. `
      + 'Run the versioned database migration before starting this Node release.'
    );
    error.code = 'DOCUMENT_SCHEMA_MIGRATION_REQUIRED';
    error.missingColumns = missing;
    throw error;
  }

  const filters = { offset: 0, limit: 1, sort: 'newest' };
  await documentRepo.listDocuments(filters, executor);
  await libraryRepo.listEligibleDocuments(filters, executor);
  await documentRepo.findById(0, executor);
  await libraryRepo.findEligibleById(0, executor);
  return { requiredColumns: REQUIRED_DOCUMENT_COLUMNS.length, repositoryQueries: 4 };
}

async function main() {
  const pool = require('../src/configs/db');
  try {
    const result = await checkDocumentSchema(pool);
    console.log(
      `DOCUMENT_SCHEMA_OK requiredColumns=${result.requiredColumns} `
      + `repositoryQueries=${result.repositoryQueries}`
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${error.code || 'DOCUMENT_SCHEMA_CHECK_FAILED'}: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { REQUIRED_DOCUMENT_COLUMNS, checkDocumentSchema };
