const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
// Route/export names here still say "variant" (see routes/reportsRoute.js, which wires these exact
// export names to the /reports/variant-stock endpoint) - the report itself is now a per-product
// stock breakdown, since Product carries its own stock directly (see docs/entities/products.md)
// and there's no separate Variant to report on.
const Product = require('../../models/inventory/productModel');
const Warehouse = require('../../models/inventory/warehouseModel');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');

// Helper function to get English title
const getEnglishTitle = title => {
  if (!title) return 'Unknown Product';
  return title.en || Object.values(title)[0] || 'Unknown Product';
};

const getStockStatus = quantity => (quantity > 0 ? 'In Stock' : 'Out of Stock');

// @desc    Get Product Stock Report
// @route   GET /api/v1/reports/variant-stock
// @access  Private
exports.getVariantStockReport = asyncHandler(async (req, res) => {
  const { warehouse } = req.query;

  const products = await Product.aggregate([
    {
      $match: { isDeleted: false, ...(warehouse ? { 'stock.warehouse': new mongoose.Types.ObjectId(warehouse) } : {}) },
    },
    {
      $lookup: {
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'category',
      },
    },
    {
      $lookup: {
        from: 'subcategories',
        localField: 'subcategory',
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
        barcode: 1,
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
        title: 1,
        price: 1,
        priceAfterDiscount: 1,
        categoryName: 1,
        subcategoryName: 1,
      },
    },
    {
      $sort: { 'title.en': 1 },
    },
  ]);

  const products2 = products.map(p => ({ ...p, stockStatus: getStockStatus(p.totalStock) }));

  // Get all warehouses for the summary
  const warehouses = await Warehouse.find({ isDeleted: false }).select('name location');

  const summary = {
    totalProducts: products2.length,
    totalStock: products2.reduce((sum, p) => sum + p.totalStock, 0),
    byWarehouse: warehouses.map(wh => ({
      warehouse: wh.name,
      location: wh.location,
      totalStock: products2.reduce((sum, p) => {
        const warehouseStock = p.stock.find(s => s.warehouse?._id.toString() === wh._id.toString());
        return sum + (warehouseStock?.quantity || 0);
      }, 0),
    })),
    byStockStatus: products2.reduce((acc, p) => {
      acc[p.stockStatus] = (acc[p.stockStatus] || 0) + 1;
      return acc;
    }, {}),
  };

  res.status(200).json({
    status: 'success',
    results: products2.length,
    data: {
      variants: products2,
      summary,
    },
  });
});

// @desc    Generate Product Stock Report Excel
// @route   POST /api/v1/reports/variant-stock
// @access  Private
exports.generateVariantStockReportExcel = asyncHandler(async (req, res) => {
  const { warehouse } = req.body;

  const products = await Product.aggregate([
    {
      $match: { isDeleted: false, ...(warehouse ? { 'stock.warehouse': new mongoose.Types.ObjectId(warehouse) } : {}) },
    },
    {
      $addFields: {
        totalStock: { $sum: '$stock.quantity' },
      },
    },
  ]);

  if (!products.length) {
    throw new ApiError('No products found', 404);
  }

  // Get all warehouses for columns
  const warehouses = await Warehouse.find({ isDeleted: false }).select('name location').sort('name');

  // Prepare headers
  const headers = ['Product Name', 'SKU', 'Barcode', 'Total Stock', 'Stock Status', ...warehouses.map(w => `${w.name} (${w.location})`), 'Regular Price', 'Discounted Price'];

  // Format numbers for better readability
  const formatNumber = num => (num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Transform data for excel format
  const data = products.map(product => {
    const baseData = [getEnglishTitle(product.title), product.sku, product.barcode, product.totalStock, getStockStatus(product.totalStock)];

    // Add stock quantities for each warehouse
    const warehouseStocks = warehouses.map(wh => {
      const stockItem = (product.stock || []).find(s => s.warehouse.toString() === wh._id.toString());
      return stockItem ? stockItem.quantity : 0;
    });

    return [...baseData, ...warehouseStocks, formatNumber(product.price), product.priceAfterDiscount ? formatNumber(product.priceAfterDiscount) : 'N/A'];
  });

  // Calculate totals
  const totals = {
    totalProducts: products.length,
    totalStock: products.reduce((sum, p) => sum + p.totalStock, 0),
    warehouseTotals: warehouses.map(wh => ({
      warehouse: wh.name,
      total: products.reduce((sum, p) => {
        const stockItem = (p.stock || []).find(s => s.warehouse.toString() === wh._id.toString());
        return sum + (stockItem ? stockItem.quantity : 0);
      }, 0),
    })),
  };

  const emptyRow = Array(8).fill('');

  // Add summary rows
  const summaryRows = [
    emptyRow,
    ['SUMMARY', ...emptyRow.slice(1)],
    ['Total Products:', totals.totalProducts, ...emptyRow.slice(2)],
    ['Total Stock:', totals.totalStock, ...emptyRow.slice(2)],
    emptyRow,
    ['WAREHOUSE BREAKDOWN', ...emptyRow.slice(1)],
    ...totals.warehouseTotals.map(wt => [`${wt.warehouse}:`, wt.total, ...emptyRow.slice(2)]),
    emptyRow,
    ['STOCK STATUS BREAKDOWN', ...emptyRow.slice(1)],
    ...Object.entries(
      products.reduce((acc, p) => {
        const status = getStockStatus(p.totalStock);
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {})
    ).map(([status, count]) => [`${status}:`, count, ...emptyRow.slice(2)]),
  ];

  // Export to Excel
  await exportToExcel(res, 'Product_Stock_Report.xlsx', headers, [...data, ...summaryRows]);
});
