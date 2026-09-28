const asyncHandler = require('express-async-handler');
const Variant = require('../../models/inventory/variantModel');
const Warehouse = require('../../models/inventory/warehouseModel');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');

// Helper function to get English title
const getEnglishTitle = title => {
  if (!title) return 'Unknown Product';
  return title.en || Object.values(title)[0] || 'Unknown Product';
};

// @desc    Get Variant Stock Report
// @route   GET /api/v1/reports/variant-stock
// @access  Private
exports.getVariantStockReport = asyncHandler(async (req, res) => {
  const { warehouse, color, size, stockStatus } = req.query;

  // Build match stage
  const matchStage = { isDeleted: false };
  if (color) matchStage.color = color;
  if (size) matchStage.size = size;
  if (stockStatus) matchStage.stockStatus = stockStatus;

  // Build warehouse filter if provided
  const warehouseFilter = warehouse ? { 'stock.warehouse': warehouse } : {};

  const variants = await Variant.aggregate([
    {
      $match: {
        ...matchStage,
        ...warehouseFilter,
      },
    },
    {
      $lookup: {
        from: 'products',
        localField: 'productId',
        foreignField: '_id',
        as: 'product',
      },
    },
    {
      $unwind: '$product',
    },
    {
      $lookup: {
        from: 'categories',
        localField: 'product.category',
        foreignField: '_id',
        as: 'category',
      },
    },
    {
      $lookup: {
        from: 'subcategories',
        localField: 'product.subcategory',
        foreignField: '_id',
        as: 'subcategory',
      },
    },
    {
      $lookup: {
        from: 'warehouses',
        localField: 'stock.warehouse',
        foreignField: '_id',
        as: 'warehouseDetails',
      },
    },
    {
      $addFields: {
        categoryName: { $arrayElemAt: ['$category.name.en', 0] },
        subcategoryName: { $arrayElemAt: ['$subcategory.name.en', 0] },
        totalStock: { $sum: '$stock.quantity' },
      },
    },
    {
      $project: {
        sku: 1,
        color: 1,
        size: 1,
        variantCode: 1,
        stockStatus: 1,
        totalStock: 1,
        stock: {
          $map: {
            input: '$stock',
            as: 'stockItem',
            in: {
              warehouse: {
                $arrayElemAt: [
                  {
                    $filter: {
                      input: '$warehouseDetails',
                      as: 'w',
                      cond: { $eq: ['$$w._id', '$$stockItem.warehouse'] },
                    },
                  },
                  0,
                ],
              },
              quantity: '$$stockItem.quantity',
            },
          },
        },
        'product.title': 1,
        'product.price': 1,
        'product.priceAfterDiscount': 1,
        categoryName: 1,
        subcategoryName: 1,
      },
    },
    {
      $sort: { 'product.title.en': 1, color: 1, size: 1 },
    },
  ]);

  // Get all warehouses for the summary
  const warehouses = await Warehouse.find({ isDeleted: false }).select('name location');

  // Calculate summary statistics
  const summary = {
    totalVariants: variants.length,
    totalStock: variants.reduce((sum, v) => sum + v.totalStock, 0),
    byWarehouse: warehouses.map(wh => ({
      warehouse: wh.name,
      location: wh.location,
      totalStock: variants.reduce((sum, v) => {
        const warehouseStock = v.stock.find(s => s.warehouse?._id.toString() === wh._id.toString());
        return sum + (warehouseStock?.quantity || 0);
      }, 0),
    })),
    byStockStatus: variants.reduce((acc, v) => {
      acc[v.stockStatus] = (acc[v.stockStatus] || 0) + 1;
      return acc;
    }, {}),
  };

  res.status(200).json({
    status: 'success',
    results: variants.length,
    data: {
      variants,
      summary,
    },
  });
});

// @desc    Generate Variant Stock Report Excel
// @route   POST /api/v1/reports/variant-stock
// @access  Private
exports.generateVariantStockReportExcel = asyncHandler(async (req, res) => {
  const { warehouse, color, size, stockStatus } = req.body;

  // Build match stage
  const matchStage = { isDeleted: false };
  if (color) matchStage.color = color;
  if (size) matchStage.size = size;
  if (stockStatus) matchStage.stockStatus = stockStatus;

  // Build warehouse filter if provided
  const warehouseFilter = warehouse ? { 'stock.warehouse': warehouse } : {};

  const variants = await Variant.aggregate([
    {
      $match: {
        ...matchStage,
        ...warehouseFilter,
      },
    },
    {
      $lookup: {
        from: 'products',
        localField: 'productId',
        foreignField: '_id',
        as: 'product',
      },
    },
    {
      $unwind: '$product',
    },
    {
      $lookup: {
        from: 'warehouses',
        localField: 'stock.warehouse',
        foreignField: '_id',
        as: 'warehouseDetails',
      },
    },
    {
      $addFields: {
        totalStock: { $sum: '$stock.quantity' },
      },
    },
  ]);

  if (!variants.length) {
    throw new ApiError('No variants found', 404);
  }

  // Get all warehouses for columns
  const warehouses = await Warehouse.find({ isDeleted: false }).select('name location').sort('name');

  // Prepare headers
  const headers = [
    'Product Name',
    'SKU',
    'Color',
    'Size',
    'Variant Code',
    'Total Stock',
    'Stock Status',
    ...warehouses.map(w => `${w.name} (${w.location})`),
    'Regular Price',
    'Discounted Price',
  ];

  // Format numbers for better readability
  const formatNumber = num => (num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Transform data for excel format
  const data = variants.map(variant => {
    const baseData = [
      getEnglishTitle(variant.product.title),
      variant.sku,
      variant.color,
      variant.size,
      variant.variantCode,
      variant.totalStock,
      variant.stockStatus,
    ];

    // Add stock quantities for each warehouse
    const warehouseStocks = warehouses.map(wh => {
      const stockItem = variant.stock.find(s => s.warehouse.toString() === wh._id.toString());
      return stockItem ? stockItem.quantity : 0;
    });

    return [
      ...baseData,
      ...warehouseStocks,
      formatNumber(variant.product.price),
      variant.product.priceAfterDiscount ? formatNumber(variant.product.priceAfterDiscount) : 'N/A',
    ];
  });

  // Calculate totals
  const totals = {
    totalVariants: variants.length,
    totalStock: variants.reduce((sum, v) => sum + v.totalStock, 0),
    warehouseTotals: warehouses.map(wh => ({
      warehouse: wh.name,
      total: variants.reduce((sum, v) => {
        const stockItem = v.stock.find(s => s.warehouse.toString() === wh._id.toString());
        return sum + (stockItem ? stockItem.quantity : 0);
      }, 0),
    })),
  };

  // Add summary rows
  const summaryRows = [
    ['', '', '', '', '', '', '', '', '', ''], // Empty row
    ['SUMMARY', '', '', '', '', '', '', '', '', ''],
    ['Total Variants:', totals.totalVariants, '', '', '', '', '', '', '', ''],
    ['Total Stock:', totals.totalStock, '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', ''], // Empty row
    ['WAREHOUSE BREAKDOWN', '', '', '', '', '', '', '', '', ''],
    ...totals.warehouseTotals.map(wt => [
      `${wt.warehouse}:`,
      wt.total,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]),
    ['', '', '', '', '', '', '', '', '', ''], // Empty row
    ['STOCK STATUS BREAKDOWN', '', '', '', '', '', '', '', '', ''],
    ...Object.entries(
      variants.reduce((acc, v) => {
        acc[v.stockStatus] = (acc[v.stockStatus] || 0) + 1;
        return acc;
      }, {})
    ).map(([status, count]) => [
      `${status}:`,
      count,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]),
  ];

  // Export to Excel
  await exportToExcel(
    res,
    'Variant_Stock_Report.xlsx',
    headers,
    [...data, ...summaryRows]
  );
});
