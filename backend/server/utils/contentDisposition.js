'use strict';

const path = require('path');

// Content-Disposition for every file the API sends (attachments, business documents, backups,
// report exports). A browser names the saved file from this header, so it must always carry the
// real name WITH its extension:
//
//   attachment; filename="Invoice _.pdf"; filename*=UTF-8''Invoice%20%D9%81.pdf
//
// `filename` is an ASCII fallback (non-ASCII and unsafe characters replaced) for old clients;
// `filename*` (RFC 5987/6266) carries the exact UTF-8 name - Arabic names included. Raw
// non-Latin-1 characters must never go into a header (Node rejects them and the response fails).

const MIME_EXTENSIONS = {
  'application/pdf': '.pdf',
  'application/gzip': '.gz',
  'application/zip': '.zip',
  'application/json': '.json',
  'text/csv': '.csv',
  'text/plain': '.txt',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
};

const EXTENSION_TYPES = Object.fromEntries(Object.entries(MIME_EXTENSIONS).map(([type, ext]) => [ext, type]));
Object.assign(EXTENSION_TYPES, { '.jpeg': 'image/jpeg', '.rsvbak': 'application/gzip', '.tgz': 'application/gzip' });

/** The content type for a file name's extension (application/octet-stream when unknown). */
const contentTypeFor = name => EXTENSION_TYPES[path.extname(String(name || '')).toLowerCase()] || 'application/octet-stream';

// A real extension: ".pdf", ".xlsx", ".rsvbak" - not the ".5" of "contract-1712.5".
const hasExtension = name => /\.[a-z][a-z0-9]{0,9}$/i.test(name);

/**
 * A safe display/download name: no directories, no control or reserved characters, at most 180
 * characters, and ending with the extension of its content type when it has none (a PDF stored as
 * "contract-1712" downloads as "contract-1712.pdf"; "backup.rsvbak" stays "backup.rsvbak").
 */
function safeFileName(name, contentType, fallback = 'download') {
  let base = path.basename(String(name || '').replace(/\\/g, '/'));
  base = base
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_') // eslint-disable-line no-control-regex
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  if (!base) base = fallback;
  const wanted =
    MIME_EXTENSIONS[
      String(contentType || '')
        .split(';')[0]
        .trim()
        .toLowerCase()
    ];
  if (wanted && !hasExtension(base)) base += wanted;
  if (base.length > 180) {
    const ext = path.extname(base).slice(0, 16);
    base = base.slice(0, 180 - ext.length) + ext;
  }
  return base;
}

// RFC 5987 attr-char: everything else percent-encoded (encodeURIComponent leaves ' ( ) * ! alone).
const encodeRfc5987 = value => encodeURIComponent(value).replace(/['()*!]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The header value. `type`: "attachment" (save) or "inline" (open in the browser, e.g. a PDF preview). */
function contentDisposition(fileName, type = 'attachment') {
  const name = String(fileName || 'download');
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type === 'inline' ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(name)}`;
}

/** Sets the headers of a file response (type, disposition, length, no sniffing, no shared caching). */
function setFileHeaders(res, { fileName, contentType, size, inline = false }) {
  const type = contentType || contentTypeFor(fileName);
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', contentDisposition(safeFileName(fileName, type), inline ? 'inline' : 'attachment'));
  if (Number.isFinite(size) && size >= 0) res.setHeader('Content-Length', String(size));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
}

module.exports = { contentDisposition, setFileHeaders, safeFileName, contentTypeFor, MIME_EXTENSIONS };
