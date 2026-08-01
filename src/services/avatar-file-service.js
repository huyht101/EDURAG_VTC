const crypto = require('crypto');
const path = require('path');
const sharp = require('sharp');

const localStorage = require('../storage/local-storage');
const appError = require('../utils/app-error');

const FORMATS = {
  jpeg: { mimeType: 'image/jpeg', extension: '.jpg' },
  png: { mimeType: 'image/png', extension: '.png' },
  webp: { mimeType: 'image/webp', extension: '.webp' }
};
const MIME_FORMATS = new Map(Object.entries(FORMATS).map(([format, value]) => [value.mimeType, format]));
const EXTENSION_FORMATS = new Map([
  ['.jpg', 'jpeg'], ['.jpeg', 'jpeg'], ['.png', 'png'], ['.webp', 'webp'], ['.svg', 'svg']
]);
const MAX_INPUT_PIXELS = 16_777_216;

async function validate(file) {
  if (!file?.buffer?.length) throw appError(400, 'AVATAR_REQUIRED', 'Avatar file là bắt buộc.');

  let metadata;
  try {
    const image = sharp(file.buffer, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false
    });
    metadata = await image.metadata();
    await image.clone().raw().toBuffer();
  } catch (_error) {
    throw appError(400, 'INVALID_AVATAR_CONTENT', 'Nội dung avatar không phải ảnh JPEG, PNG hoặc WebP hợp lệ.');
  }

  const rule = FORMATS[metadata.format];
  if (!rule) throw appError(400, 'UNSUPPORTED_AVATAR_TYPE', 'Chỉ hỗ trợ avatar JPEG, PNG và WebP.');
  if (Number(metadata.pages || 1) !== 1) {
    throw appError(400, 'UNSUPPORTED_AVATAR_ANIMATION', 'Avatar động hoặc nhiều trang không được hỗ trợ.');
  }

  const declaredMime = String(file.mimetype || '').trim().toLowerCase();
  if (declaredMime && declaredMime !== 'application/octet-stream') {
    const declaredFormat = MIME_FORMATS.get(declaredMime);
    if (declaredFormat !== metadata.format) {
      throw appError(400, 'AVATAR_TYPE_MISMATCH', 'MIME type không khớp với nội dung avatar.');
    }
  }

  const declaredExtension = path.extname(String(file.originalname || '')).toLowerCase();
  const declaredExtensionFormat = EXTENSION_FORMATS.get(declaredExtension);
  if (declaredExtensionFormat && declaredExtensionFormat !== metadata.format) {
    throw appError(400, 'AVATAR_TYPE_MISMATCH', 'Phần mở rộng không khớp với nội dung avatar.');
  }

  return {
    mimeType: rule.mimeType,
    extension: rule.extension,
    width: metadata.width,
    height: metadata.height
  };
}

async function persist(file) {
  const metadata = await validate(file);
  const storageKey = `avatars/${crypto.randomUUID()}${metadata.extension}`;
  await localStorage.saveBuffer(storageKey, file.buffer);
  return { ...metadata, storageKey };
}

module.exports = {
  validate,
  persist,
  open: localStorage.open,
  remove: localStorage.remove
};
