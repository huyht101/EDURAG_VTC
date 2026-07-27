const previewConfig = require('../configs/preview');
const JOB_TYPES = require('../constants/job-types');
const jobRepo = require('../repositories/processing-job-repository');
const previewService = require('../services/document-preview-service');

let timer = null;
let active = new Set();
let stopping = false;

async function tick() {
  if (stopping) return;
  const launches = [];
  const available = previewConfig.concurrency - active.size;
  for (let index = 0; index < available; index += 1) {
    const promise = previewService.processNext();
    active.add(promise);
    launches.push(promise.catch((error) => {
      console.error('[PREVIEW] Worker error:', error.code || error.message);
      return null;
    }).finally(() => active.delete(promise)));
  }
  await Promise.allSettled(launches);
}

async function start() {
  if (!previewConfig.enabled || timer) return;
  stopping = false;
  const staleSeconds = Math.ceil(previewConfig.timeoutMs / 1000) + previewConfig.retryDelaySeconds;
  const recovered = await jobRepo.recoverRunningByType(
    JOB_TYPES.GENERATE_PDF_PREVIEW,
    staleSeconds
  );
  if (recovered) console.warn(`[PREVIEW] Recovered ${recovered} interrupted job(s).`);
  timer = setInterval(() => {
    tick().catch((error) => console.error('[PREVIEW] Poll failed:', error.code || error.message));
  }, previewConfig.pollIntervalMs);
  timer.unref();
  tick().catch((error) => console.error('[PREVIEW] Initial poll failed:', error.code || error.message));
}

async function stop() {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  await Promise.allSettled([...active]);
}

module.exports = { start, stop, tick };
