const fs = require('fs').promises;
const parseCsv = require('../../utils/parseCsv');
const ApiError = require('../../utils/apiError');
const { MAX_FILE_BYTES, MAX_ROWS } = require('../../utils/csvImport/limits');
const { checkRequiredHeaders, findDuplicateHeaders, getRawHeaderRow } = require('../../utils/csvImport/headerChecks');
const { findDuplicatesInFile } = require('../../utils/csvImport/duplicateDetection');

// The shared plumbing every CSV importer needs (docs section "Reusable Architecture") - parsing,
// header checks, size/row limits, per-row validation dispatch, and in-file duplicate detection.
// Each module supplies its OWN `schema` object (requiredHeaders/exampleRow/validateRow/createOne)
// - this file never contains module-specific business rules, so accounting/business validation
// stays easy to find in each module's own schema file, not buried in a generic engine.
//
// Preview and commit call the EXACT same `parseAndValidate` - the two can never see different row
// sets, and commit NEVER trusts a client-supplied "this was valid in preview" claim; it re-parses
// and re-validates the freshly re-uploaded file from scratch (docs section "Import Safety... -
// recheck critical conditions on the backend during commit").

async function parseAndValidate(file, schema) {
  const stats = await fs.stat(file.path);
  if (stats.size > MAX_FILE_BYTES) {
    throw new ApiError(`The file is too large (${Math.ceil(stats.size / 1024)} KB). The maximum allowed size is ${Math.ceil(MAX_FILE_BYTES / 1024)} KB.`, 400);
  }

  // Duplicate-header detection MUST happen on the raw header line, before csv-parse's
  // `columns: true` mode (used by parseCsv below) silently collapses two same-named columns into
  // one object key - see headerChecks.js's header comment.
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

  const context = schema.fetchContext ? await schema.fetchContext() : {};

  const rowResults = [];
  for (let i = 0; i < rows.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { errors, value } = await schema.validateRow(rows[i], context);
    // Row 1 is the header line in the original file, so the first DATA row is "row 2" - this is
    // what the user sees if they open the CSV in Excel and count down to the reported row.
    rowResults.push({ row: i + 2, raw: rows[i], errors: errors || [], value: value ?? null });
  }

  // Duplicate business identifiers WITHIN this file (docs section "Duplicate records within the
  // uploaded file") - additive to whatever per-row errors already exist; a row that duplicates an
  // earlier row's key is never allowed to proceed even if it was otherwise well-formed.
  for (const dup of schema.dedupeKeys || []) {
    const found = findDuplicatesInFile(rows, dup.keyFn);
    for (const d of found) {
      const target = rowResults[d.row - 1];
      if (!target) continue;
      target.errors = [
        ...target.errors,
        { column: dup.column, value: d.key, message: `Duplicate ${dup.column} - already used on row ${d.firstRow + 1} of this file.` },
      ];
      target.value = null;
    }
  }

  return { columns, rowResults, totalRows: rows.length };
}

/** Parses and validates WITHOUT writing anything - the "Preview" step. */
async function previewImport(file, schema) {
  const { columns, rowResults, totalRows } = await parseAndValidate(file, schema);
  const validRows = rowResults.filter(r => r.errors.length === 0);
  const invalidRows = rowResults.filter(r => r.errors.length > 0);

  return {
    columns,
    totalRows,
    validCount: validRows.length,
    invalidCount: invalidRows.length,
    // A bounded sample of every row (valid or not) for the UI's "detected columns and sample
    // rows" preview table - never the full file, which could be thousands of rows.
    previewRows: rowResults.slice(0, 20).map(r => ({ row: r.row, data: r.raw, errors: r.errors })),
    errors: invalidRows.map(r => ({ row: r.row, errors: r.errors })),
  };
}

/** Re-validates, then creates one real record per valid row, isolated per row. */
async function commitImport(file, schema, context) {
  const { rowResults } = await parseAndValidate(file, schema);
  const created = [];
  const failed = [];

  for (const r of rowResults) {
    if (r.errors.length > 0 || !r.value) {
      failed.push({ row: r.row, errors: r.errors.length ? r.errors : [{ message: 'This row did not pass validation.' }] });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const doc = await schema.createOne(r.value, context);
      created.push({ row: r.row, id: doc._id });
    } catch (err) {
      failed.push({ row: r.row, errors: [{ message: friendlyWriteError(err) }] });
    }
  }

  return { created, failed };
}

// Never leak a raw stack trace or internal driver error to the client (docs section "Permissions
// and Security" - "Do not... expose internal error details to users") - translate the two error
// shapes that actually occur here (a Mongo unique-index violation, a Mongoose schema validation
// failure) into a plain sentence; anything else becomes a generic, safe message.
function friendlyWriteError(err) {
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return `A record with this ${field} already exists.`;
  }
  if (err && err.name === 'ValidationError' && err.errors) {
    return Object.values(err.errors).map(e => e.message).join('; ');
  }
  return 'This row could not be created due to an unexpected error.';
}

module.exports = { previewImport, commitImport, parseAndValidate };
