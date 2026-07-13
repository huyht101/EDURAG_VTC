const citationService = require('../services/citation-service');

async function detail(req, res, next) {
  try {
    return res.ok('OK', await citationService.getCitation(req.user, req.params.id));
  } catch (error) { return next(error); }
}

async function streamFile(req, res, next) {
  try {
    const result = await citationService.openOriginal(req.user, req.params.id);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Length', result.size);
    res.attachment(result.filename);
    result.stream.on('error', next);
    return result.stream.pipe(res);
  } catch (error) { return next(error); }
}

module.exports = { detail, streamFile };
