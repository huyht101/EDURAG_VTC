const { TextDecoder } = require('util');

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Busboy follows the multipart default of latin1 for filename parameters. Modern
 * browsers send UTF-8 bytes there, which arrive as mojibake. Recover only when
 * every received code point is a byte and those bytes form valid UTF-8. This is
 * deliberately conditional so an already-correct Unicode filename is untouched.
 */
function normalizeMultipartFilename(filename) {
  if (typeof filename !== 'string' || !filename) return filename;
  if ([...filename].some((character) => character.codePointAt(0) > 0xff)) return filename;

  let decoded;
  try {
    decoded = utf8Decoder.decode(Buffer.from(filename, 'latin1'));
  } catch (_error) {
    return filename;
  }

  if (decoded === filename) return filename;
  const hasMojibakeMarker = /[\u0080-\u009fÃÂ]/u.test(filename);
  const recoversNonLatinCharacter = [...decoded]
    .some((character) => character.codePointAt(0) > 0xff);
  return hasMojibakeMarker || recoversNonLatinCharacter ? decoded : filename;
}

module.exports = { normalizeMultipartFilename };
