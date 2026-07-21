const crypto = require('crypto');
const path = require('path');
const { TextDecoder } = require('util');

const localStorage = require('../storage/local-storage');
const appError = require('../utils/app-error');

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL_FILE = 0x02014b50;

function validDocxArchive(buffer) {
  const minimumEocd = 22;
  if (!Buffer.isBuffer(buffer) || buffer.length < minimumEocd
    || buffer.readUInt32LE(0) !== 0x04034b50) return false;
  const searchStart = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let offset = buffer.length - minimumEocd; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD) { eocd = offset; break; }
  }
  if (eocd < 0) return false;
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0 || entries > 2048 || centralOffset + centralSize > eocd) return false;
  const names = new Set();
  let totalCompressed = 0;
  let totalUncompressed = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > eocd || buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_FILE) return false;
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const uncompressed = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if ((flags & 1) !== 0 || ![0, 8].includes(method)
      || compressed === 0xffffffff || uncompressed === 0xffffffff
      || localOffset >= centralOffset || next > eocd
      || (((externalAttributes >>> 16) & 0xf000) === 0xa000)) return false;
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (!name || name.includes('\\') || name.startsWith('/')
      || name.split('/').some((part) => part === '..') || names.has(name)) return false;
    names.add(name);
    totalCompressed += compressed;
    totalUncompressed += uncompressed;
    if (uncompressed > 50 * 1024 * 1024
      || (compressed > 0 && uncompressed / compressed > 100)) return false;
    cursor = next;
  }
  if (totalUncompressed > 100 * 1024 * 1024
    || (totalCompressed > 0 && totalUncompressed / totalCompressed > 100)
    || cursor !== centralOffset + centralSize || cursor !== eocd) return false;
  return ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']
    .every((name) => names.has(name));
}

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
    signature: validDocxArchive
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

module.exports = {
  validDocxArchive,
  validate,
  persist,
  remove: localStorage.remove,
  open: localStorage.open,
  exists: localStorage.exists
};
