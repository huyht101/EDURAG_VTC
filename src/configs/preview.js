function boundedInteger(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

module.exports = {
  get enabled() {
    return String(process.env.DOCUMENT_PREVIEW_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
  },
  get command() {
    return String(process.env.LIBREOFFICE_COMMAND || 'soffice').trim();
  },
  get timeoutMs() {
    return boundedInteger('DOCUMENT_PREVIEW_TIMEOUT_MS', 120000, 1000, 900000);
  },
  get pollIntervalMs() {
    return boundedInteger('DOCUMENT_PREVIEW_POLL_INTERVAL_MS', 2000, 250, 60000);
  },
  get concurrency() {
    return boundedInteger('DOCUMENT_PREVIEW_CONCURRENCY', 2, 1, 8);
  },
  get retryDelaySeconds() {
    return boundedInteger('DOCUMENT_PREVIEW_RETRY_DELAY_SECONDS', 30, 1, 86400);
  }
};
