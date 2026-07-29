const libraryService = require('../services/library-service');
const { inlineContentDisposition } = require('../utils/content-disposition');

async function list(req, res, next) {
  try {
    return res.ok('OK', await libraryService.listDocuments(req.query));
  } catch (error) {
    return next(error);
  }
}

async function detail(req, res, next) {
  try {
    return res.ok('OK', await libraryService.getDocument(req.params.id));
  } catch (error) {
    return next(error);
  }
}

async function streamSource(req, res, next) {
  try {
    const result = await libraryService.openSource(req.params.id);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Length', result.size);
    res.attachment(result.filename);
    result.stream.on('error', next);
    return result.stream.pipe(res);
  } catch (error) {
    return next(error);
  }
}

async function streamPreview(req, res, next) {
  try {
    const result = await libraryService.openPreview(req.params.id);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Length', result.size);
    res.setHeader('Content-Disposition', inlineContentDisposition(result.filename));
    result.stream.on('error', next);
    return result.stream.pipe(res);
  } catch (error) {
    return next(error);
  }
}

module.exports = { list, detail, streamSource, streamPreview };
