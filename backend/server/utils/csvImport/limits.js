// Shared file-size / row-count ceilings for every CSV importer (docs section "CSV Parsing and
// Validation" - "Apply explicit file-size and row-count limits consistent with the deployment
// environment"). One place to tune, rather than a per-module magic number.
exports.MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
exports.MAX_ROWS = 5000;
