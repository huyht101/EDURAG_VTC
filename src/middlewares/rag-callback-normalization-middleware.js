const { normalizeProcessingCallback } = require('../clients/rag-contract');

function normalizeRagCallback(req, _res, next) {
  try {
    req.body = normalizeProcessingCallback(req.body);
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = normalizeRagCallback;
