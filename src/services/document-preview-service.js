const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const previewConfig = require('../configs/preview');
const JOB_TYPES = require('../constants/job-types');
const JOB_STATUSES = require('../constants/job-statuses');
const PREVIEW_STATUSES = require('../constants/preview-statuses');
const DOCUMENT_STATUSES = require('../constants/document-statuses');
const withTransaction = require('../database/transaction');
const documentRepo = require('../repositories/document-repository');
const jobRepo = require('../repositories/processing-job-repository');
const fileService = require('./document-file-service');
const ingestService = require('./document-ingest-service');

function runProcess(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const error = new Error('LibreOffice conversion timed out.');
      error.code = 'PREVIEW_TIMEOUT';
      reject(error);
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 2000) stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      error.code = error.code === 'ENOENT' ? 'LIBREOFFICE_NOT_FOUND' : 'PREVIEW_PROCESS_ERROR';
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const error = new Error(`LibreOffice exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}.`);
      error.code = 'PREVIEW_CONVERSION_FAILED';
      error.details = stderr.trim().slice(0, 500) || null;
      return reject(error);
    });
  });
}

async function convertDocxToPdf(sourcePath, temporaryDirectory, dependencies = {}) {
  const run = dependencies.runProcess || runProcess;
  const command = dependencies.command || previewConfig.command;
  const timeoutMs = dependencies.timeoutMs || previewConfig.timeoutMs;
  await run(command, [
    '--headless',
    `-env:UserInstallation=${pathToFileURL(path.join(temporaryDirectory, 'profile')).href}`,
    '--convert-to',
    'pdf',
    '--outdir',
    temporaryDirectory,
    sourcePath
  ], timeoutMs);
  const expected = path.join(
    temporaryDirectory,
    `${path.basename(sourcePath, path.extname(sourcePath))}.pdf`
  );
  const stat = await fs.stat(expected).catch(() => null);
  if (!stat?.isFile() || stat.size < 1) {
    const error = new Error('LibreOffice did not produce a PDF.');
    error.code = 'PREVIEW_OUTPUT_MISSING';
    throw error;
  }
  return expected;
}

async function claimNext(dependencies = {}) {
  const runTransaction = dependencies.withTransaction || withTransaction;
  const jobs = dependencies.jobRepo || jobRepo;
  const retryDelaySeconds = dependencies.retryDelaySeconds ?? previewConfig.retryDelaySeconds;
  return runTransaction(async (connection) => {
    const candidate = await jobs.findNextRunnableByTypeForUpdate(
      JOB_TYPES.GENERATE_PDF_PREVIEW,
      retryDelaySeconds,
      connection
    );
    if (!candidate) return null;
    if (!(await jobs.markRunning(candidate.id, connection))) return null;
    return jobs.findById(candidate.id, connection);
  });
}

async function markPreviewFailure(job, error, dependencies = {}) {
  const runTransaction = dependencies.withTransaction || withTransaction;
  const jobs = dependencies.jobRepo || jobRepo;
  const documents = dependencies.documentRepo || documentRepo;
  await runTransaction(async (connection) => {
    const currentJob = await jobs.findByIdForUpdate(job.id, connection);
    if (!currentJob || currentJob.status !== JOB_STATUSES.RUNNING
      || Number(currentJob.attempt_count) !== Number(job.attempt_count)) return;
    const document = await documents.findByIdForUpdate(job.document_id, connection);
    if (document && document.preview_status !== PREVIEW_STATUSES.READY) {
      await documents.updatePreview(document.id, {
        status: PREVIEW_STATUSES.FAILED,
        storageKey: null,
        mimeType: null,
        pageCount: null
      }, connection);
    }
    await jobs.markFailed(
      job.id,
      error.code || 'PREVIEW_GENERATION_FAILED',
      String(error.message || 'Preview generation failed.').slice(0, 2000),
      connection
    );
    if (document && document.processing_status === DOCUMENT_STATUSES.processing.UPLOADED
      && Number(currentJob.attempt_count) >= Number(currentJob.max_attempts)) {
      const ingestJob = await jobs.findLatestByType(document.id, JOB_TYPES.INGEST, connection);
      if (ingestJob?.status === JOB_STATUSES.QUEUED) {
        await jobs.markFailed(
          ingestJob.id,
          'CANONICAL_ARTIFACT_FAILED',
          'Canonical PDF conversion failed before ingest dispatch.',
          connection
        );
      }
      await documents.updateProcessingStatus(
        document.id,
        DOCUMENT_STATUSES.processing.FAILED,
        connection
      );
    }
  });
}

async function dispatchDocumentIngest(documentId, dependencies = {}) {
  const jobs = dependencies.jobRepo || jobRepo;
  const dispatcher = dependencies.ingestService || ingestService;
  const ingestJob = await jobs.findLatestByType(documentId, JOB_TYPES.INGEST);
  if (!ingestJob) {
    const error = new Error('Document has no INGEST job.');
    error.code = 'INGEST_JOB_MISSING';
    throw error;
  }
  return dispatcher.dispatchIngest(ingestJob.id, dependencies.ingestDependencies || {});
}

async function finishPreviewJob(job, dependencies = {}) {
  const runTransaction = dependencies.withTransaction || withTransaction;
  const jobs = dependencies.jobRepo || jobRepo;
  return runTransaction(async (connection) => {
    const currentJob = await jobs.findByIdForUpdate(job.id, connection);
    if (!currentJob || currentJob.status !== JOB_STATUSES.RUNNING
      || Number(currentJob.attempt_count) !== Number(job.attempt_count)) return false;
    await jobs.markSucceeded(job.id, { currentStage: 'PREVIEW_READY' }, connection);
    return true;
  });
}

async function processClaimedJob(job, dependencies = {}) {
  const files = dependencies.fileService || fileService;
  const jobs = dependencies.jobRepo || jobRepo;
  const documents = dependencies.documentRepo || documentRepo;
  const runTransaction = dependencies.withTransaction || withTransaction;
  const makeTemp = dependencies.makeTemp
    || (() => fs.mkdtemp(path.join(os.tmpdir(), 'edurag-preview-')));
  const convert = dependencies.convert || convertDocxToPdf;
  const document = await documents.findById(job.document_id);
  if (!document || document.file_type !== 'DOCX' || document.visibility_status === 'DELETED') {
    const error = new Error('Preview job document is missing, deleted, or not DOCX.');
    error.code = 'PREVIEW_DOCUMENT_INVALID';
    await markPreviewFailure(job, error, dependencies);
    return { status: 'FAILED', error };
  }

  if (document.preview_status === PREVIEW_STATUSES.READY
    && document.preview_storage_key
    && await files.exists(document.preview_storage_key)) {
    let dispatchError = null;
    try {
      await dispatchDocumentIngest(document.id, dependencies);
    } catch (error) {
      dispatchError = error;
    }
    const accepted = await finishPreviewJob(job, dependencies);
    return accepted
      ? { status: 'SUCCEEDED', reused: true, dispatchError }
      : { status: 'IGNORED' };
  }

  if (document.processing_status !== DOCUMENT_STATUSES.processing.UPLOADED) {
    const error = new Error('Canonical PDF cannot be generated after ingest dispatch.');
    error.code = 'PREVIEW_ARTIFACT_LOCKED';
    await markPreviewFailure(job, error, dependencies);
    return { status: 'FAILED', error };
  }

  let temporaryDirectory = null;
  let publishedKey = null;
  let artifactPersisted = false;
  try {
    temporaryDirectory = await makeTemp();
    const sourcePath = files.resolveStorageKey(document.storage_key);
    const convertedPath = await convert(sourcePath, temporaryDirectory, dependencies);
    const pdfBuffer = await fs.readFile(convertedPath);
    const pageCount = await files.countPdfPages(pdfBuffer);
    publishedKey = `previews/${document.id}/${crypto.randomUUID()}.pdf`;
    await files.publish(convertedPath, publishedKey);

    const accepted = await runTransaction(async (connection) => {
      const currentJob = await jobs.findByIdForUpdate(job.id, connection);
      const currentDocument = await documents.findByIdForUpdate(document.id, connection);
      if (!currentJob || currentJob.status !== JOB_STATUSES.RUNNING
        || Number(currentJob.attempt_count) !== Number(job.attempt_count)
        || !currentDocument || currentDocument.visibility_status === 'DELETED'
        || currentDocument.processing_status !== DOCUMENT_STATUSES.processing.UPLOADED
        || currentDocument.preview_status === PREVIEW_STATUSES.READY) return false;
      await documents.updatePreview(document.id, {
        status: PREVIEW_STATUSES.READY,
        storageKey: publishedKey,
        mimeType: 'application/pdf',
        pageCount
      }, connection);
      return true;
    });
    if (!accepted) {
      await files.remove(publishedKey);
      return { status: 'IGNORED' };
    }
    artifactPersisted = true;
    let dispatchError = null;
    try {
      await dispatchDocumentIngest(document.id, dependencies);
    } catch (error) {
      dispatchError = error;
    }
    if (!(await finishPreviewJob(job, dependencies))) {
      return { status: 'IGNORED' };
    }
    return {
      status: 'SUCCEEDED',
      pageCount,
      storageKey: publishedKey,
      dispatchError
    };
  } catch (error) {
    if (publishedKey && !artifactPersisted) await files.remove(publishedKey).catch(() => {});
    await markPreviewFailure(job, error, dependencies);
    return { status: 'FAILED', error };
  } finally {
    if (temporaryDirectory) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function processNext(dependencies = {}) {
  const job = await claimNext(dependencies);
  if (!job) return null;
  return processClaimedJob(job, dependencies);
}

async function ensureQueued(documentId, dependencies = {}) {
  const runTransaction = dependencies.withTransaction || withTransaction;
  const jobs = dependencies.jobRepo || jobRepo;
  const documents = dependencies.documentRepo || documentRepo;
  return runTransaction(async (connection) => {
    const document = await documents.findByIdForUpdate(documentId, connection);
    if (!document || document.file_type !== 'DOCX') return null;
    if (document.processing_status !== DOCUMENT_STATUSES.processing.UPLOADED) return null;
    if (document.preview_status === PREVIEW_STATUSES.READY
      && document.preview_storage_key) return null;
    const latest = await jobs.findLatestByType(
      document.id,
      JOB_TYPES.GENERATE_PDF_PREVIEW,
      connection
    );
    if (latest && ['QUEUED', 'RUNNING'].includes(latest.status)) return latest.id;
    if (latest?.status === 'FAILED') {
      return Number(latest.attempt_count) < Number(latest.max_attempts) ? latest.id : null;
    }
    await documents.updatePreview(document.id, {
      status: PREVIEW_STATUSES.PENDING,
      storageKey: null,
      mimeType: null,
      pageCount: null
    }, connection);
    return jobs.createJob({
      documentId: document.id,
      jobType: JOB_TYPES.GENERATE_PDF_PREVIEW,
      jobConfig: { sourceFileType: 'DOCX', backfill: true }
    }, connection);
  });
}

module.exports = {
  runProcess,
  convertDocxToPdf,
  claimNext,
  processClaimedJob,
  processNext,
  ensureQueued,
  markPreviewFailure,
  dispatchDocumentIngest,
  finishPreviewJob
};
