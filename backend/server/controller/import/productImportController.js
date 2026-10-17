const fs = require('fs').promises;
const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const exportToCsv = require('../../utils/exportToCsv');
const { previewImport, commitImport } = require('../../services/csvImport/csvImportRunner');
const schema = require('../../utils/validators/import/productImportSchema');

// Replaces the previous `importProductAndVariant` controller (utils/validators/import/
// importProductAndVariantValidator.js + controller/import/importProductController.js) - that
// version predated the Product/Service split (no `type` column, always required category/
// subcategory, grouped CSV rows into a separate per-warehouse "rows" shape). See
// productImportSchema.js's header comment for the full rationale.

const cleanupTempFile = req => fs.unlink(req.file.path).catch(() => {});

const previewProducts = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new ApiError('Please upload a CSV file.', 400));
  try {
    const result = await previewImport(req.file, schema);
    res.status(200).json(apiResponse('Preview generated successfully', true, result));
  } finally {
    await cleanupTempFile(req);
  }
});

const commitProducts = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new ApiError('Please upload a CSV file.', 400));
  try {
    const { created, failed } = await commitImport(req.file, schema, { userId: req.user._id });
    if (created.length === 0) {
      return next(new ApiError('No products could be imported - every row failed validation or already exists.', 400, { validationErrors: failed }));
    }
    const status = failed.length > 0 ? 207 : 201;
    res
      .status(status)
      .json(apiResponse(failed.length > 0 ? 'Products imported with some errors.' : 'Products imported successfully.', true, { created, failed }));
  } finally {
    await cleanupTempFile(req);
  }
});

const sampleProducts = asyncHandler(async (req, res) => {
  await exportToCsv(res, 'reservia-products-template.csv', schema.headers, schema.exampleRows);
});

module.exports = { previewProducts, commitProducts, sampleProducts };
