const processingCallbackService = require('../services/processing-callback-service');

async function processingCallback(req, res, next) {
  try {
    const result = await processingCallbackService.handleCallback(req.body);
    return res.ok('Callback acknowledged.', result);
  } catch (error) {
    return next(error);
  }
}

module.exports = { processingCallback };
