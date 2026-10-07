const asyncHandler = require('express-async-handler');
// Route/export names here still say "variant" (see routes/reportsRoute.js, which wires these exact
// export names to the /reports/variant-history endpoint) - the report itself is now a per-product
// stock/warehouse breakdown, since Product carries its own stock directly (see
// docs/entities/products.md) and there's no separate Variant to report on.
const Product = require('../../models/inventory/productModel');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');

// Helper function to get sort configuration
const getSortConfig = (sortBy, sortOrder) => {
  const validSortFields = ['stockLevel', 'createdAt'];
  const order = sortOrder === 'asc' ? 1 : -1;

  if (sortBy && validSortFields.includes(sortBy)) {
    return { [sortBy]: order };
  }
  return { _id: -1 }; // default sort
};

const buildProductHistoryAggregation = ({ stockStatus, warehouseId, startDate, endDate }) => {
  const matchStage = { isDeleted: false };

  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = new Date(startDate);
    if (endDate) matchStage.createdAt.$lte = new Date(endDate);
  }

  return [
    { $match: matchStage },
    // Filter by warehouse if provided
    ...(warehouseId ? [{ $match: { 'stock.warehouse': warehouseId } }] : []),
    {
      $lookup: {
        from: 'warehouses',
        localField: 'stock.warehouse',
        foreignField: '_id',
        as: 'warehouseDetails',
        pipeline: [{ $project: { name: 1 } }],
      },
    },
    {
      $addFields: {
        productName: '$title.en',
        stockLevel: { $sum: '$stock.quantity' },
        warehouseNames: {
          $map: {
            input: '$stock',
            as: 'stockItem',
            in: {
              warehouse: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: '$warehouseDetails',
                      as: 'wh',
                      cond: { $eq: ['$$wh._id', '$$stockItem.warehouse'] },
                    },
                  },
                  0,
                ],
              },
              quantity: '$$stockItem.quantity',
            },
          },
        },
      },
    },
    {
      $addFields: {
        stockStatus: { $cond: [{ $gt: ['$stockLevel', 0] }, 'In Stock', 'Out of Stock'] },
      },
    },
    ...(stockStatus ? [{ $match: { stockStatus } }] : []),
    { $sort: getSortConfig(null, null) },
  ];
};

// Get product history report
exports.getVariantHistoryReport = asyncHandler(async (req, res) => {
  const { stockStatus, warehouseId, sortBy, sortOrder, startDate, endDate } = req.query;

  const products = await Product.aggregate(buildProductHistoryAggregation({ stockStatus, warehouseId, startDate, endDate }).concat([{ $sort: getSortConfig(sortBy, sortOrder) }]));

  res.status(200).json({
    status: 'success',
    results: products.length,
    data: products,
  });
});

// Export product history report to Excel
exports.exportVariantHistoryReportExcel = asyncHandler(async (req, res) => {
  const { stockStatus, warehouseId, sortBy, sortOrder, startDate, endDate } = req.query;

  const products = await Product.aggregate(buildProductHistoryAggregation({ stockStatus, warehouseId, startDate, endDate }).concat([{ $sort: getSortConfig(sortBy, sortOrder) }]));

  if (!products.length) {
    throw new ApiError('No product data found', 404);
  }

  // Prepare headers
  const headers = ['SKU', 'Barcode', 'Product', 'Stock Status', 'Total Stock', 'Warehouses', 'Created At'];

  // Transform data for excel format
  const data = products.map(product => {
    const warehouseInfo = product.warehouseNames
      .map(w => {
        const warehouseName = w.warehouse?.name?.en || w.warehouse?.name || 'Unknown Warehouse';
        return `${warehouseName}: ${w.quantity}`;
      })
      .join('; ');

    return [product.sku, product.barcode, product.productName || 'Unknown Product', product.stockStatus, product.stockLevel, warehouseInfo, product.createdAt ? new Date(product.createdAt).toLocaleDateString() : ''];
  });

  // Calculate totals
  const totals = products.reduce(
    (acc, product) => ({
      totalStock: (acc.totalStock || 0) + (product.stockLevel || 0),
    }),
    {}
  );

  // Prepare total row
  const totalRow = ['Total', '', '', '', totals.totalStock, '', ''];

  // Export to Excel
  await exportToExcel(res, 'product_history_report.xlsx', headers, data, { totalRow });
});
