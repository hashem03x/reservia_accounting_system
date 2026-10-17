const fs = require('fs').promises;
const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const exportToCsv = require('../../utils/exportToCsv');
const { previewGroupedImport, commitGroupedImport } = require('../../services/csvImport/groupedCsvImportRunner');
const schema = require('../../utils/validators/import/salesInvoiceImportSchema');

// Sales Invoice CSV import (docs section "Sales Invoice CSV Import", new - no previous importer
// existed for this document). Every commit calls the REAL createSalesOrder service per group (see
// salesInvoiceImportSchema.js#createGroup) - never a second accounting path, never a duplicated
// stock/journal-entry/executed-percentage calculation.

const cleanupTempFile = req => fs.unlink(req.file.path).catch(() => {});

const previewSalesInvoices = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new ApiError('Please upload a CSV file.', 400));
  try {
    const result = await previewGroupedImport(req.file, schema);
    res.status(200).json(apiResponse('Preview generated successfully', true, result));
  } finally {
    await cleanupTempFile(req);
  }
});

const commitSalesInvoices = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new ApiError('Please upload a CSV file.', 400));
  try {
    const { created, failed } = await commitGroupedImport(req.file, schema, { userId: req.user._id });
    if (created.length === 0) {
      return next(new ApiError('No Sales Invoices could be imported - every group failed validation or was already imported.', 400, { validationErrors: failed }));
    }
    const status = failed.length > 0 ? 207 : 201;
    res
      .status(status)
      .json(apiResponse(failed.length > 0 ? 'Sales Invoices imported with some errors.' : 'Sales Invoices imported successfully.', true, { created, failed }));
  } finally {
    await cleanupTempFile(req);
  }
});

const sampleSalesInvoices = asyncHandler(async (req, res) => {
  await exportToCsv(res, 'reservia-sales-invoices-template.csv', schema.headers, schema.exampleRows);
});

module.exports = { previewSalesInvoices, commitSalesInvoices, sampleSalesInvoices };
