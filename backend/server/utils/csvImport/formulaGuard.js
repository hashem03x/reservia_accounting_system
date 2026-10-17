// Formula-injection guard (docs section "Permissions and Security" - "Protect against... Formula
// injection in downloadable error reports and exported values"). Excel/Sheets/LibreOffice treat a
// cell beginning with =, +, -, or @ as a formula - a malicious CSV value echoed back verbatim into
// a downloadable error report could otherwise execute when the admin opens that report. Prefixing
// with a single quote forces every spreadsheet application to render it as inert literal text.
exports.sanitizeForCsv = function sanitizeForCsv(value) {
  if (value == null) return value;
  const str = String(value);
  return /^[=+\-@]/.test(str) ? `'${str}` : str;
};
