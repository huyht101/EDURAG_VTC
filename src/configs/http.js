function integerSetting(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function allowedOrigins() {
  const values = String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.includes('*')) throw new Error('CORS_ALLOWED_ORIGINS must not contain wildcard *.');
  return new Set(values.map((value) => {
    let parsed;
    try { parsed = new URL(value); } catch (_error) {
      throw new Error(`CORS_ALLOWED_ORIGINS contains an invalid origin: ${value}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== value.replace(/\/$/, '')) {
      throw new Error(`CORS_ALLOWED_ORIGINS must contain only http(s) origins: ${value}`);
    }
    return parsed.origin;
  }));
}

module.exports = {
  get corsAllowedOrigins() { return allowedOrigins(); },
  get trustProxyHops() { return integerSetting('TRUST_PROXY_HOPS', 0, { max: 2 }); },
  get authRateLimitWindowMs() {
    return integerSetting('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, { min: 1000 });
  },
  get authRateLimitMax() { return integerSetting('AUTH_RATE_LIMIT_MAX', 30, { min: 1 }); },
  get authSensitiveRateLimitWindowMs() {
    return integerSetting('AUTH_SENSITIVE_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, { min: 1000 });
  },
  get authSensitiveRateLimitMax() {
    return integerSetting('AUTH_SENSITIVE_RATE_LIMIT_MAX', 10, { min: 1 });
  }
};
