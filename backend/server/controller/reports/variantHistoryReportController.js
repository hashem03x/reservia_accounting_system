const asyncHandler = require('express-async-handler');
const Variant = require('../../models/inventory/variantModel');
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

// Get variant history report
exports.getVariantHistoryReport = asyncHandler(async (req, res) => {
  const { color, size, stockStatus, warehouseId, sortBy, sortOrder, startDate, endDate } = req.query;

  // Build match stage based on filters
  let matchStage = { isDeleted: false };
  if (color) matchStage.color = color;
  if (size) matchStage.size = size;
  if (stockStatus) matchStage.stockStatus = stockStatus;

  // Add date range filter if provided
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = new Date(startDate);
    if (endDate) matchStage.createdAt.$lte = new Date(endDate);
  }

  const variants = await Variant.aggregate([
    {
      $match: matchStage,
    },
    {
      $lookup: {
        from: 'products',
        localField: 'productId',
        foreignField: '_id',
        as: 'productDetails',
        pipeline: [
          {
            $project: {
              'title.en': 1,
            },
          },
        ],
      },
    },
    // Filter by warehouse if provided
    ...(warehouseId
      ? [
          {
            $match: {
              'stock.warehouse': warehouseId,
            },
          },
        ]
      : []),
    {
      $lookup: {
        from: 'warehouses',
        localField: 'stock.warehouse',
        foreignField: '_id',
        as: 'warehouseDetails',
        pipeline: [
          {
            $project: {
              name: 1,
            },
          },
        ],
      },
    },
    {
      $addFields: {
        productName: { $arrayElemAt: ['$productDetails.title.en', 0] },
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
      $project: {
        productDetails: 0,
        warehouseDetails: 0,
      },
    },
    {
      $sort: getSortConfig(sortBy, sortOrder),
    },
  ]);

  res.status(200).json({
    status: 'success',
    results: variants.length,
    data: variants,
  });
});

// Export variant history report to Excel
exports.exportVariantHistoryReportExcel = asyncHandler(async (req, res) => {
  const { color, size, stockStatus, warehouseId, sortBy, sortOrder, startDate, endDate } = req.query;

  // Build match stage based on filters
  let matchStage = { isDeleted: false };
  if (color) matchStage.color = color;
  if (size) matchStage.size = size;
  if (stockStatus) matchStage.stockStatus = stockStatus;

  // Add date range filter if provided
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = new Date(startDate);
    if (endDate) matchStage.createdAt.$lte = new Date(endDate);
  }

  const variants = await Variant.aggregate([
    {
      $match: matchStage,
    },
    {
      $lookup: {
        from: 'products',
        localField: 'productId',
        foreignField: '_id',
        as: 'productDetails',
        pipeline: [
          {
            $project: {
              'title.en': 1,
            },
          },
        ],
      },
    },
    // Filter by warehouse if provided
    ...(warehouseId
      ? [
          {
            $match: {
              'stock.warehouse': warehouseId,
            },
          },
        ]
      : []),
    {
      $lookup: {
        from: 'warehouses',
        localField: 'stock.warehouse',
        foreignField: '_id',
        as: 'warehouseDetails',
        pipeline: [
          {
            $project: {
              name: 1,
            },
          },
        ],
      },
    },
    {
      $addFields: {
        productName: { $arrayElemAt: ['$productDetails.title.en', 0] },
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
      $sort: getSortConfig(sortBy, sortOrder),
    },
  ]);

  if (!variants.length) {
    throw new ApiError('No variant data found', 404);
  }

  // Prepare headers
  const headers = ['SKU', 'Product', 'Color', 'Size', 'Stock Status', 'Total Stock', 'Warehouses', 'Created At'];

  // Transform data for excel format
  const data = variants.map(variant => {
    const warehouseInfo = variant.warehouseNames
      .map(w => {
        const warehouseName = w.warehouse?.name?.en || w.warehouse?.name || 'Unknown Warehouse';
        return `${warehouseName}: ${w.quantity}`;
      })
      .join('; ');

    return [
      variant.sku,
      variant.productName || 'Unknown Product',
      variant.color,
      variant.size,
      variant.stockStatus,
      variant.stockLevel,
      warehouseInfo,
      variant.createdAt ? new Date(variant.createdAt).toLocaleDateString() : '',
    ];
  });

  // Calculate totals
  const totals = variants.reduce(
    (acc, variant) => ({
      totalStock: (acc.totalStock || 0) + (variant.stockLevel || 0),
    }),
    {}
  );

  // Prepare total row
  const totalRow = ['Total', '', '', '', '', totals.totalStock, '', ''];

  // Export to Excel
  await exportToExcel(res, 'variant_history_report.xlsx', headers, data, { totalRow });
});
