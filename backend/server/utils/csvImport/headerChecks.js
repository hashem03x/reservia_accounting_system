// Shared header validation for every CSV importer - required-header and duplicate-header checks,
// tolerant of leading/trailing whitespace (parseCsv.js already trims each header, but a caller
// handed raw column names, e.g. from req.file directly, still benefits from trimming here too).
//
// IMPORTANT: `findDuplicateHeaders` must be called with the RAW header row (e.g. from
// `getRawHeaderRow` below), never with `Object.keys(someParsedRow)` - csv-parse's `columns: true`
// mode builds each row as a plain object keyed by header name, so a genuine duplicate header
// (two "Email" columns) silently collapses into a single object key before any caller could ever
// see two of them. By the time a row has been parsed into an object, the duplicate is already
// gone - this is not a theoretical risk, it was the actual reason an earlier version of this
// check never caught a duplicate-header file.

const csv = require('csv-parse');

function normalize(header) {
  return String(header || '').trim();
}

/** The literal first line of the file, as an array of raw column names - before any row-object
 * collapsing can hide a duplicate. */
exports.getRawHeaderRow = function getRawHeaderRow(fileContent) {
  let content = fileContent;
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  return new Promise((resolve, reject) => {
    csv.parse(content, { to_line: 1 }, (err, data) => {
      if (err) return reject(err);
      resolve((data[0] || []).map(normalize));
    });
  });
};

exports.checkRequiredHeaders = function checkRequiredHeaders(columns, required) {
  const normalized = columns.map(normalize);
  return required.filter(r => !normalized.includes(r));
};

exports.findDuplicateHeaders = function findDuplicateHeaders(columns) {
  const counts = new Map();
  for (const raw of columns) {
    const header = normalize(raw);
    counts.set(header, (counts.get(header) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([header]) => header);
};
