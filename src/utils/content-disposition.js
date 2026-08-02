'use strict';

const UNSAFE_HEADER_FILENAME = /[\u0000-\u001f\u007f-\u009f"\\/]/g;

function toWellFormed(value) {
  if (typeof value.toWellFormed === 'function') return value.toWellFormed();
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] + value[index + 1];
        index += 1;
      } else {
        result += '\ufffd';
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      result += '\ufffd';
    } else {
      result += value[index];
    }
  }
  return result;
}

function sanitizeFilename(value) {
  return (toWellFormed(String(value ?? '')).normalize('NFC')
    .replace(UNSAFE_HEADER_FILENAME, '_')
    .trim() || 'preview.pdf');
}

function asciiFallback(value) {
  return (value.normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\/;=]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '') || 'preview.pdf');
}

function encodeRfc5987(value) {
  return encodeURIComponent(value)
    .replace(/['()*]/g, (character) => (
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    ));
}

function contentDisposition(disposition, filename) {
  const safe = sanitizeFilename(filename);
  return `${disposition}; filename="${asciiFallback(safe)}"; filename*=UTF-8''${encodeRfc5987(safe)}`;
}

function inlineContentDisposition(filename) {
  return contentDisposition('inline', filename);
}

function attachmentContentDisposition(filename) {
  return contentDisposition('attachment', filename);
}

module.exports = {
  attachmentContentDisposition,
  inlineContentDisposition,
  sanitizeFilename
};
