const fs = require('fs').promises;
const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const exportToCsv = require('../../utils/exportToCsv');
const { previewGroupedImport, commitGroupedImport } = require('../../services/csvImport/groupedCsvImportRunner');
const schema = require('../../utils/validators/import/poImportSchema');

// Replaces the previous `importPurchaseOrder` controller, which targeted the OLD pre-rename
// concept: it called `PurchaseOrder.create({ vendorId, warehouseId, items, createdBy, notes })`
// with no `project` and no `requisition` - both of which purchaseOrder.js's `pre('save')` hook
// now hard-requires on every new document, so every row of that importer already threw before
// this replacement existed. This importer creates the NEW "Purchase Order" document (internally
// Requisition) instead - the purely operational, pre-invoice document the rest of this phase's
// spec actually means by "Purchase Order".

const cleanupTempFile = req => fs.unlink(req.file.path).catch(() => {});

const previewPurchaseOrders = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new ApiError('Please upload a CSV file.', 400));
  try {
    const result = await previewGroupedImport(req.file, schema);
    res.status(200).json(apiResponse('Preview generated successfully', true, result));
  } finally {
    await cleanupTempFile(req);
  }
});

const commitPurchaseOrders = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new ApiError('Please upload a CSV file.', 400));
  try {
    const { created, failed } = await commitGroupedImport(req.file, schema, { userId: req.user._id });
    if (created.length === 0) {
      return next(new ApiError('No Purchase Orders could be imported - every group failed validation or was already imported.', 400, { validationErrors: failed }));
    }
    const status = failed.length > 0 ? 207 : 201;
    res
      .status(status)
      .json(apiResponse(failed.length > 0 ? 'Purchase Orders imported with some errors.' : 'Purchase Orders imported successfully.', true, { created, failed }));
  } finally {
    await cleanupTempFile(req);
  }
});

const samplePurchaseOrders = asyncHandler(async (req, res) => {
  await exportToCsv(res, 'reservia-purchase-orders-template.csv', schema.headers, schema.exampleRows);
});

module.exports = { previewPurchaseOrders, commitPurchaseOrders, samplePurchaseOrders };
