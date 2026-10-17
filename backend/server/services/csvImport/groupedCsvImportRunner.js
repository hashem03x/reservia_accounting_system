const fs = require('fs').promises;
const parseCsv = require('../../utils/parseCsv');
const ApiError = require('../../utils/apiError');
const { MAX_FILE_BYTES, MAX_ROWS } = require('../../utils/csvImport/limits');
const { checkRequiredHeaders, findDuplicateHeaders, getRawHeaderRow } = require('../../utils/csvImport/headerChecks');

// Shared plumbing for CSV imports where MULTIPLE rows combine into ONE logical document - one
// Purchase Order's line items, one Purchase/Sales Invoice's line items (docs section "Recommended
// CSV format" - "Multiple rows with the same... grouping identifier should create one [document]
// with multiple line items, not duplicate [documents]"). Deliberately mirrors
// csvImportRunner.js's exact preview/commit response SHAPE (columns/totalRows/validCount/
// invalidCount/previewRows/errors, created/failed) so the existing ImportWizardModal (built for
// Phase 1's one-row-per-document imports) needs no changes to render a grouped import - each
// "row" in the response is really a GROUP, represented by its first CSV row for the preview
// table, exactly the way a reader of the original file would expect to find it.

async function parseAndGroup(file, schema) {
  const stats = await fs.stat(file.path);
  if (stats.size > MAX_FILE_BYTES) {
    throw new ApiError(`The file is too large (${Math.ceil(stats.size / 1024)} KB). The maximum allowed size is ${Math.ceil(MAX_FILE_BYTES / 1024)} KB.`, 400);
  }

  // Duplicate-header detection on the RAW header line - see headerChecks.js's header comment for
  // why this can never be done from an already-parsed row object.
  const rawFileContent = await fs.readFile(file.path, 'utf-8');
  const rawHeaderRow = await getRawHeaderRow(rawFileContent);
  const duplicateHeaders = findDuplicateHeaders(rawHeaderRow);
  if (duplicateHeaders.length) {
    throw new ApiError(`The file has duplicate column headers: ${duplicateHeaders.join(', ')}.`, 400);
  }

  const rows = await parseCsv(file.path);
  if (!rows || rows.length === 0) throw new ApiError('The CSV file contains no data rows.', 400);
  if (rows.length > MAX_ROWS) {
    throw new ApiError(`The file has ${rows.length} rows, which exceeds the limit of ${MAX_ROWS} rows per import.`, 400);
  }

  const columns = Object.keys(rows[0] || {}).map(c => c.trim());
  const missingHeaders = checkRequiredHeaders(columns, schema.requiredHeaders);
  if (missingHeaders.length) {
    throw new ApiError(`The file is missing required column(s): ${missingHeaders.join(', ')}.`, 400);
  }

  // Group rows by the module's own grouping key, preserving first-seen order - groups do NOT need
  // to be contiguous in the file. A blank/missing key never merges unrelated rows together: each
  // one becomes its own singleton group (keyed by a Symbol, so it can never collide with a real
  // key or with another blank row), so each still gets its own "<column> is required" error
  // instead of several unrelated rows being silently treated as one document.
  const groups = new Map();
  rows.forEach((raw, index) => {
    const rowNumber = index + 2; // row 1 is the header line
    const rawKey = schema.groupKey(raw);
    const key = rawKey == null || String(rawKey).trim() === '' ? Symbol(`blank-key-row-${rowNumber}`) : rawKey;
    if (!groups.has(key)) groups.set(key, { firstRow: rowNumber, rows: [] });
    groups.get(key).rows.push({ row: rowNumber, raw });
  });

  const context = schema.fetchContext ? await schema.fetchContext() : {};

  const groupResults = [];
  for (const group of groups.values()) {
    // eslint-disable-next-line no-await-in-loop
    const { errors, value } = await schema.validateGroup(group.rows, context);
    groupResults.push({ firstRow: group.firstRow, rows: group.rows, errors: errors || [], value: value ?? null });
  }

  return { columns, groupResults, totalRows: rows.length };
}

/** Parses and validates every group WITHOUT writing anything - the "Preview" step. */
async function previewGroupedImport(file, schema) {
  const { columns, groupResults, totalRows } = await parseAndGroup(file, schema);
  const validGroups = groupResults.filter(g => g.errors.length === 0);
  const invalidGroups = groupResults.filter(g => g.errors.length > 0);

  return {
    columns,
    totalRows,
    totalGroups: groupResults.length,
    validCount: validGroups.length,
    invalidCount: invalidGroups.length,
    previewRows: groupResults.slice(0, 20).map(g => ({ row: g.firstRow, data: g.rows[0].raw, errors: g.errors })),
    errors: invalidGroups.map(g => ({ row: g.firstRow, errors: g.errors })),
  };
}

/** Re-validates every group, then creates one real document per valid group, isolated per group -
 * a group that fails never leaves a partially-created document (each group is exactly one
 * `Model.create()` call with its full `items[]` embedded, so MongoDB's own single-document write
 * guarantee makes it atomic with no transaction needed - see each module's createGroup comment). */
async function commitGroupedImport(file, schema, context) {
  const { groupResults } = await parseAndGroup(file, schema);
  const created = [];
  const failed = [];

  for (const g of groupResults) {
    if (g.errors.length > 0 || !g.value) {
      failed.push({ row: g.firstRow, errors: g.errors.length ? g.errors : [{ message: 'This group did not pass validation.' }] });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const doc = await schema.createGroup(g.value, context);
      created.push({ row: g.firstRow, id: doc._id, code: doc.code });
    } catch (err) {
      failed.push({ row: g.firstRow, errors: [{ message: friendlyWriteError(err) }] });
    }
  }

  return { created, failed };
}

function friendlyWriteError(err) {
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return `A record with this ${field} already exists - this group may have already been imported.`;
  }
  if (err && err.name === 'ValidationError' && err.errors) {
    return Object.values(err.errors).map(e => e.message).join('; ');
  }
  // `ApiError` (utils/apiError.js) sets `operational: true` specifically to mark "a safe,
  // predictable, user-facing message" - e.g. createPO's own catch block re-wraps a failed
  // transaction (the atomic over-invoicing guard, a requisition/vendor/project mismatch) into
  // `new ApiError(error.message, ...)` before it ever reaches here. Surfacing that message
  // directly is what keeps an import-time failure as specific as the exact same failure would be
  // through the manual UI, instead of collapsing every createGroup rejection into one generic
  // sentence that hides WHY a group actually failed.
  if (err && err.operational && err.message) {
    return err.message;
  }
  return 'This group could not be created due to an unexpected error.';
}

module.exports = { previewGroupedImport, commitGroupedImport, parseAndGroup };
