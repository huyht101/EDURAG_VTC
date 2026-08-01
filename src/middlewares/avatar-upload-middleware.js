const multer = require('multer');

const uploadConfig = require('../configs/upload');
const { normalizeMultipartFilename } = require('../utils/multipart-filename');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: uploadConfig.avatarMaxFileSizeBytes }
}).single('avatar');

function avatarUploadMiddleware(req, res, next) {
  upload(req, res, (error) => {
    if (!error) {
      if (req.file) req.file.originalname = normalizeMultipartFilename(req.file.originalname);
      return next();
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      error.status = 413;
      error.code = 'AVATAR_TOO_LARGE';
      error.message = `Avatar vượt quá giới hạn ${uploadConfig.avatarMaxFileSizeBytes} bytes.`;
    } else {
      error.status = 400;
      error.code = error.code || 'INVALID_AVATAR_UPLOAD';
    }
    error.isOperational = true;
    return next(error);
  });
}

module.exports = avatarUploadMiddleware;
