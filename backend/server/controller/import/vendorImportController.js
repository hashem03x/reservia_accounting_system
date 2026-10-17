const fs = require('fs').promises;
const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const exportToCsv = require('../../utils/exportToCsv');
const { previewImport, commitImport } = require('../../services/csvImport/csvImportRunner');
const schema = require('../../utils/validators/import/vendorImportSchema');

// Replaces the previous `importVendors` (Vendor.insertMany-based) controller - that version
// silently mutated the vendor name (stripped "&"/"."), dropped taxInfo/bankInfo/paymentInfo/
// cashFlowActivity, and required a `type` column with no default even though manual creation
// defaults it to 'current'. See vendorImportSchema.js's header comment for the full list of fixes.

const cleanupTempFile = req => fs.unlink(req.file.path).catch(() => {});

const previewVendors = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new ApiError('Please upload a CSV file.', 400));
  try {
    const result = await previewImport(req.file, schema);
    res.status(200).json(apiResponse('Preview generated successfully', true, result));
  } finally {
    await cleanupTempFile(req);
  }
});

const commitVendors = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new ApiError('Please upload a CSV file.', 400));
  try {
    const { created, failed } = await commitImport(req.file, schema);
    if (created.length === 0) {
      return next(new ApiError('No vendors could be imported - every row failed validation or already exists.', 400, { validationErrors: failed }));
    }
    const status = failed.length > 0 ? 207 : 201;
    res
      .status(status)
      .json(apiResponse(failed.length > 0 ? 'Vendors imported with some errors.' : 'Vendors imported successfully.', true, { created, failed }));
  } finally {
    await cleanupTempFile(req);
  }
});

const sampleVendors = asyncHandler(async (req, res) => {
  await exportToCsv(res, 'reservia-vendors-template.csv', schema.headers, [schema.exampleRow]);
});

module.exports = { previewVendors, commitVendors, sampleVendors };
