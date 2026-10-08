const FixedAsset = require('../../models/fixedAssets');
const asyncHandler = require('express-async-handler');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');

// Helper function to get sort configuration
const getSortConfig = (sortBy, sortOrder) => {
  const validSortFields = ['name', 'bookValue', 'accumulatedDepreciation', 'createdAt'];
  const order = sortOrder === 'asc' ? 1 : -1;

  if (sortBy && validSortFields.includes(sortBy)) {
    return { [sortBy]: order };
  }
  return { createdAt: -1 }; // default sort by creation date, newest first
};

/**
 * Get Fixed Assets Report
 * @route GET /api/reports/fixed-assets
 * @description Retrieve all fixed assets with their values
 */
exports.getFixedAssetsReport = asyncHandler(async (req, res) => {
  const { warehouseId, sortBy, sortOrder } = req.query;

  const query = {};
  if (warehouseId) query.warehouseId = warehouseId;

  const sortConfig = getSortConfig(sortBy, sortOrder);

  const fixedAssets = await FixedAsset.find(query).populate('warehouseId', 'name location').populate('createdBy', 'name').sort(sortConfig);

  const reportData = fixedAssets.map(asset => ({
    name: asset.name,
    bookValue: asset.bookValue,
    accumulatedDepreciation: asset.accumulatedDepreciation || 0,
    warehouse: asset.warehouseId?.name || null,
    // createdBy: asset.createdBy?.name || 'N/A',
    createdAt: asset.createdAt,
  }));

  const summary = {
    totalAssets: fixedAssets.length,
    totalBookValue: fixedAssets.reduce((sum, asset) => sum + asset.bookValue, 0),
    totalAccumulatedDepreciation: fixedAssets.reduce((sum, asset) => sum + (asset.accumulatedDepreciation || 0), 0),
  };

  if (warehouseId && fixedAssets.length > 0) {
    const warehouse = fixedAssets[0]?.warehouseId;
    if (warehouse) {
      summary.warehouse = `${warehouse.name} (${warehouse.location})`;
    }
  }

  res.status(200).json({
    status: 'success',
    data: reportData,
    summary,
  });
});

/**
 * Export Fixed Assets Report to Excel
 * @route POST /api/reports/fixed-assets
 * @description Export fixed assets report to Excel
 */
exports.exportFixedAssetsReport = asyncHandler(async (req, res) => {
  const { warehouseId } = req.body;

  const query = {};
  if (warehouseId) query.warehouseId = warehouseId;

  const fixedAssets = await FixedAsset.find(query).populate('warehouseId', 'name location').populate('createdBy', 'name');

  const headers = ['Asset Name', 'Book Value', 'Accumulated Depreciation', 'Warehouse', 'Created By', 'Created At'];

  const data = fixedAssets.map(asset => [
    asset.name,
    asset.bookValue,
    asset.accumulatedDepreciation || 0,
    asset.warehouseId ? `${asset.warehouseId.name} (${asset.warehouseId.location})` : 'N/A',
    asset.createdBy?.name || 'N/A',
    asset.createdAt.toLocaleDateString(),
  ]);

  if (fixedAssets.length > 0) {
    // Add summary row only if there's data
    data.push([
      'Total',
      fixedAssets.reduce((sum, asset) => sum + asset.bookValue, 0),
      fixedAssets.reduce((sum, asset) => sum + (asset.accumulatedDepreciation || 0), 0),
      warehouseId && fixedAssets[0]?.warehouseId ? `${fixedAssets[0].warehouseId.name} (${fixedAssets[0].warehouseId.location})` : '',
      '',
      '',
    ]);
  }

  await exportToExcel(res, 'Fixed Assets Report', headers, data);
});
