const fs = require('fs').promises;
const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const exportToCsv = require('../../utils/exportToCsv');
const { previewGroupedImport, commitGroupedImport } = require('../../services/csvImport/groupedCsvImportRunner');
const schema = require('../../utils/validators/import/poInvoiceImportSchema');

// Purchase Invoice CSV import (docs section "Purchase Invoice CSV Import", new - no previous
// importer existed for this document). Every commit calls the REAL createPO controller per group
// (see poInvoiceImportSchema.js#createGroup) - never a second accounting path.

const cleanupTempFile = req => fs.unlink(req.file.path).catch(() => {});

const previewPurchaseInvoices = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new ApiError('Please upload a CSV file.', 400));
  try {
    const result = await previewGroupedImport(req.file, schema);
    res.status(200).json(apiResponse('Preview generated successfully', true, result));
  } finally {
    await cleanupTempFile(req);
  }
});

const commitPurchaseInvoices = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new ApiError('Please upload a CSV file.', 400));
  try {
    const { created, failed } = await commitGroupedImport(req.file, schema, { userId: req.user._id });
    if (created.length === 0) {
      return next(new ApiError('No Purchase Invoices could be imported - every group failed validation or was already imported.', 400, { validationErrors: failed }));
    }
    const status = failed.length > 0 ? 207 : 201;
    res
      .status(status)
      .json(apiResponse(failed.length > 0 ? 'Purchase Invoices imported with some errors.' : 'Purchase Invoices imported successfully.', true, { created, failed }));
  } finally {
    await cleanupTempFile(req);
  }
});

const samplePurchaseInvoices = asyncHandler(async (req, res) => {
  await exportToCsv(res, 'reservia-purchase-invoices-template.csv', schema.headers, schema.exampleRows);
});

module.exports = { previewPurchaseInvoices, commitPurchaseInvoices, samplePurchaseInvoices };
