const multer = require('multer');
const uploadConfig = require('../configs/upload');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: uploadConfig.maxFileSizeBytes }
}).single('file');

function documentUploadMiddleware(req, res, next) {
  upload(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      error.status = 413;
      error.code = 'FILE_TOO_LARGE';
      error.message = `File vượt quá giới hạn ${uploadConfig.maxFileSizeBytes} bytes.`;
    } else {
      error.status = 400;
      error.code = error.code || 'INVALID_MULTIPART_UPLOAD';
    }
    return next(error);
  });
}

module.exports = documentUploadMiddleware;
