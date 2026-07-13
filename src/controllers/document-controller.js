const documentService = require('../services/document-service');

async function upload(req, res, next) {
  try {
    const result = await documentService.uploadDocument(req.user, req.file, req.body.title);
    return res.ok('Document đã được tiếp nhận để xử lý.', result, 202);
  } catch (error) {
    return next(error);
  }
}

async function list(req, res, next) {
  try {
    return res.ok('OK', await documentService.listDocuments(req.user, req.query));
  } catch (error) {
    return next(error);
  }
}

async function detail(req, res, next) {
  try {
    return res.ok('OK', await documentService.getDocument(req.user, req.params.id));
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const document = await documentService.updateDocument(req.user, req.params.id, req.body.title);
    return res.ok('Cập nhật document thành công.', document);
  } catch (error) {
    return next(error);
  }
}

async function streamFile(req, res, next) {
  try {
    const result = await documentService.openManagedFile(req.user, req.params.id);
    res.setHeader('Content-Type', result.document.mime_type);
    res.setHeader('Content-Length', result.size);
    res.attachment(result.document.original_filename);
    result.stream.on('error', next);
    return result.stream.pipe(res);
  } catch (error) {
    return next(error);
  }
}

async function jobDetail(req, res, next) {
  try {
    return res.ok('OK', await documentService.getProcessingJob(req.user, req.params.jobId));
  } catch (error) {
    return next(error);
  }
}

function operation(action, message) {
  return async (req, res, next) => {
    try {
      const result = await documentService.operateDocument(req.user, req.params.id, action);
      return res.ok(message, result, 202);
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  upload,
  list,
  detail,
  update,
  streamFile,
  jobDetail,
  hide: operation('hide', 'Hide operation đã được tiếp nhận.'),
  unhide: operation('unhide', 'Unhide operation đã được tiếp nhận.'),
  remove: operation('delete', 'Delete operation đã được tiếp nhận.')
};
