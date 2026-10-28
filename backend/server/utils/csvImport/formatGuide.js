const asyncHandler = require('express-async-handler');
const exportToCsv = require('../exportToCsv');
const { MAX_FILE_BYTES, MAX_ROWS } = require('./limits');

// Import format guides (client requirement "Import Files - Format Documentation"): for every CSV
// importer, each column's purpose, whether it is required, accepted format / values, maximum length
// and an example. The specs live NEXT TO each importer's validation (`fieldSpecs` in
// utils/validators/import/*ImportSchema.js) and test/import/importFormatGuides.test.js fails if a
// spec and the importer's real columns ever disagree - so the guide always matches the parser.
//
// The guide is a SEPARATE download (…/format-guide), never extra rows inside the data template:
// the importers read every row after the header as data, so an instruction row there would be
// imported (or rejected) as a record.

const GENERAL_RULES = [
  ['File', `CSV (comma separated), UTF-8 - Arabic text is supported. At most ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB and ${MAX_ROWS} data rows.`],
  ['Header row', 'The first row must contain the column names exactly as listed below (letter case matters). Column order does not matter; required columns must be present; a column may not appear twice.'],
  ['Data rows', 'One record (or one line of a document) per row, from the second row on. Do not add notes, totals or instruction rows to the data file - every row is imported.'],
  ['Empty values', 'Leave optional cells empty when not used. Spaces around values are ignored.'],
  ['Numbers', 'Plain digits with an optional decimal point (e.g. 1500 or 1500.75) - no thousands separators, currency symbols or percent signs.'],
  ['Formulas', 'Cells starting with = + - @ are not evaluated; export values, not spreadsheet formulas.'],
  ['Errors', 'Preview validates every row first and lists each error with its row number and column - nothing is saved until you confirm, and rows with errors are never imported.'],
];

const REQUIRED_LABEL = { yes: 'Required', no: 'Optional', conditional: 'Conditional' };

function guideRows(schema) {
  return [
    ...GENERAL_RULES.map(([topic, text]) => ({ section: 'General', column: topic, required: '', description: text, format: '', maxLength: '', example: '' })),
    ...schema.fieldSpecs.map(spec => ({
      section: 'Columns',
      column: spec.column,
      required: REQUIRED_LABEL[spec.required] || spec.required,
      description: spec.description,
      format: spec.format || '',
      maxLength: spec.maxLength != null ? String(spec.maxLength) : '',
      example: spec.example != null ? String(spec.example) : '',
    })),
  ];
}

/** Structural check of a schema's specs against its real columns - see the test above. */
function specProblems(schema) {
  const problems = [];
  const specColumns = (schema.fieldSpecs || []).map(s => s.column);
  const headers = schema.headers || [];
  headers.filter(h => !specColumns.includes(h)).forEach(h => problems.push(`column "${h}" has no spec`));
  specColumns.filter(c => !headers.includes(c)).forEach(c => problems.push(`spec "${c}" is not a column`));
  (schema.requiredHeaders || []).forEach(h => {
    const spec = schema.fieldSpecs.find(s => s.column === h);
    if (spec && spec.required !== 'yes') problems.push(`"${h}" is a required column but its spec says ${spec.required}`);
  });
  schema.fieldSpecs.filter(s => s.required === 'yes' && !(schema.requiredHeaders || []).includes(s.column)).forEach(s => problems.push(`spec "${s.column}" says required but the importer does not require the column`));
  schema.fieldSpecs.filter(s => !s.description).forEach(s => problems.push(`spec "${s.column}" has no description`));
  return problems;
}

/**
 * GET …/format-guide - the guide as JSON (for the import wizard), or as a CSV download with
 * ?format=csv.
 */
function formatGuideHandler(schema, filename) {
  return asyncHandler(async (req, res) => {
    const rows = guideRows(schema);
    if (req.query.format === 'csv') {
      await exportToCsv(
        res,
        filename,
        ['Section', 'Column', 'Required', 'Description', 'Format / allowed values', 'Max length', 'Example'],
        rows.map(r => [r.section, r.column, r.required, r.description, r.format, r.maxLength, r.example])
      );
      return;
    }
    res.status(200).json({ status: 'success', data: { general: GENERAL_RULES.map(([topic, text]) => ({ topic, text })), columns: schema.fieldSpecs, headers: schema.headers } });
  });
}

module.exports = { formatGuideHandler, guideRows, specProblems, GENERAL_RULES };
