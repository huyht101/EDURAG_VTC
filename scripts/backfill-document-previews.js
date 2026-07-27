const fs = require('fs/promises');

const pool = require('../src/configs/db');
const documentRepo = require('../src/repositories/document-repository');
const PREVIEW_STATUSES = require('../src/constants/preview-statuses');
const fileService = require('../src/services/document-file-service');
const previewService = require('../src/services/document-preview-service');

function integerArgument(name, fallback, minimum, maximum) {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find((value) => value.startsWith(prefix));
  const value = raw ? Number(raw.slice(prefix.length)) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

async function backfillDocument(document, dryRun, dependencies = {}) {
  const files = dependencies.fileService || fileService;
  const documents = dependencies.documentRepo || documentRepo;
  const previews = dependencies.previewService || previewService;
  const readFile = dependencies.readFile || fs.readFile;
  if (document.file_type === 'PDF') {
    if (dryRun) return 'updated';
    const buffer = await readFile(files.resolveStorageKey(document.storage_key));
    const pageCount = await files.countPdfPages(buffer);
    await documents.updatePreview(document.id, {
      status: PREVIEW_STATUSES.READY,
      storageKey: null,
      mimeType: 'application/pdf',
      pageCount
    });
    return 'updated';
  }
  if (document.file_type === 'DOCX') {
    if (dryRun) return 'updated';
    const jobId = await previews.ensureQueued(document.id);
    return jobId ? 'updated' : 'skipped';
  }
  return 'skipped';
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const batchSize = integerArgument('batch-size', 100, 1, 1000);
  const concurrency = integerArgument('concurrency', 4, 1, 16);
  const stats = { scanned: 0, updated: 0, skipped: 0, failed: 0 };
  let afterId = 0;
  for (;;) {
    const documents = await documentRepo.listForPreviewBackfill({ afterId, limit: batchSize });
    if (!documents.length) break;
    afterId = Number(documents[documents.length - 1].id);
    for (let start = 0; start < documents.length; start += concurrency) {
      const slice = documents.slice(start, start + concurrency);
      await Promise.all(slice.map(async (document) => {
        stats.scanned += 1;
        try {
          const outcome = await backfillDocument(document, dryRun);
          stats[outcome] += 1;
        } catch (error) {
          stats.failed += 1;
          if (!dryRun && document.file_type === 'PDF') {
            await documentRepo.updatePreview(document.id, {
              status: PREVIEW_STATUSES.FAILED,
              storageKey: null,
              mimeType: null,
              pageCount: null
            }).catch(() => {});
          }
          console.error(`[BACKFILL] document=${document.id} failed: ${error.code || error.message}`);
        }
      }));
    }
  }
  console.log(JSON.stringify({ dryRun, ...stats }));
  return stats;
}

if (require.main === module) {
  run().catch((error) => {
    console.error('[BACKFILL] FAILED:', error.message);
    process.exitCode = 1;
  }).finally(() => pool.end());
}

module.exports = { run, backfillDocument, integerArgument };
