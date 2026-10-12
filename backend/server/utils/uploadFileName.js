'use strict';

/**
 * The real name of an uploaded file. Multer 1.x parses multipart headers as latin1, so a UTF-8 name
 * (Arabic, accented letters) arrives as mojibake - "ÙØ§ØªÙˆØ±Ø©.pdf" for "فاتورة.pdf". The bytes are
 * re-read as UTF-8 when they form valid UTF-8; a name that is not (a genuine latin1 name) is kept.
 * Browsers also percent-encode a double quote in the multipart name (WHATWG: %22), which is undone.
 */
function decodeUploadName(name) {
  let value = String(name || '');
  // eslint-disable-next-line no-control-regex
  if (/[\u0080-ÿ]/.test(value) && !/[^\u0000-ÿ]/.test(value)) {
    const utf8 = Buffer.from(value, 'latin1').toString('utf8');
    if (!utf8.includes('�')) value = utf8;
  }
  return value.replace(/%22/g, '"');
}

module.exports = { decodeUploadName };
