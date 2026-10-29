const fs = require('fs').promises;
const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const exportToCsv = require('../../utils/exportToCsv');
const { previewImport, commitImport } = require('../../services/csvImport/csvImportRunner');
const schema = require('../../utils/validators/import/crmLeadImportSchema');

const cleanupTempFile = req => fs.unlink(req.file.path).catch(() => {});

exports.previewCrmLeads = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new ApiError('Please upload a CSV file.', 400));
  try {
    const result = await previewImport(req.file, schema);
    res.status(200).json(apiResponse('Preview generated successfully', true, result));
  } finally {
    await cleanupTempFile(req);
  }
});

exports.commitCrmLeads = asyncHandler(async (req, res, next) => {
  if (!req.file) return next(new ApiError('Please upload a CSV file.', 400));
  try {
    const { created, failed } = await commitImport(req.file, schema, { userId: req.user._id });
    if (created.length === 0) {
      return next(new ApiError('No leads could be imported - every row failed validation.', 400, { validationErrors: failed }));
    }
    const status = failed.length > 0 ? 207 : 201;
    res.status(status).json(apiResponse(failed.length > 0 ? 'Leads imported with some errors.' : 'Leads imported successfully.', true, { created, failed }));
  } finally {
    await cleanupTempFile(req);
  }
});

exports.sampleCrmLeads = asyncHandler(async (req, res) => {
  await exportToCsv(res, 'reservia-crm-leads-template.csv', schema.headers, [schema.exampleRow]);
});
