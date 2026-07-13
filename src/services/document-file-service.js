const crypto = require('crypto');
const path = require('path');
const { TextDecoder } = require('util');

const localStorage = require('../storage/local-storage');
const appError = require('../utils/app-error');

const FILE_TYPES = {
  '.pdf': {
    fileType: 'PDF',
    mimeTypes: ['application/pdf'],
    signature: (buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  },
  '.docx': {
    fileType: 'DOCX',
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/octet-stream'
    ],
    signature: (buffer) => buffer.length >= 4
      && buffer[0] === 0x50 && buffer[1] === 0x4b
      && buffer[2] === 0x03 && buffer[3] === 0x04
  },
  '.txt': {
    fileType: 'TXT',
    mimeTypes: ['text/plain', 'application/octet-stream'],
    signature: (buffer) => {
      if (buffer.includes(0)) return false;
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        return true;
      } catch (_error) {
        return false;
      }
    }
  }
};

function validate(file) {
  if (!file?.buffer?.length) throw appError(400, 'FILE_REQUIRED', 'File upload là bắt buộc.');
  const extension = path.extname(file.originalname || '').toLowerCase();
  const rule = FILE_TYPES[extension];
  if (!rule) throw appError(400, 'UNSUPPORTED_FILE_TYPE', 'Chỉ hỗ trợ PDF, DOCX và TXT.');
  if (!rule.mimeTypes.includes(String(file.mimetype || '').toLowerCase())) {
    throw appError(400, 'INVALID_MIME_TYPE', 'MIME type không phù hợp với định dạng file.');
  }
  if (!rule.signature(file.buffer)) {
    throw appError(400, 'INVALID_FILE_SIGNATURE', 'Nội dung file không khớp định dạng khai báo.');
  }
  return {
    extension,
    fileType: rule.fileType,
    mimeType: String(file.mimetype).toLowerCase(),
    originalFilename: path.basename(file.originalname).replace(/[\r\n"]/g, '_'),
    fileSizeBytes: file.size,
    checksumSha256: crypto.createHash('sha256').update(file.buffer).digest('hex')
  };
}

async function persist(file) {
  const metadata = validate(file);
  const storageKey = await localStorage.save(file.buffer, metadata.extension);
  return { ...metadata, storageType: 'LOCAL', storageKey };
}

module.exports = { validate, persist, remove: localStorage.remove, open: localStorage.open };
