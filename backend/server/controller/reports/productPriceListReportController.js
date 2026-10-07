const asyncHandler = require('express-async-handler');
const Product = require('../../models/inventory/productModel');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');

// Helper function to get English title
const getEnglishTitle = title => {
  if (!title) return 'Unknown Product';
  return title.en || Object.values(title)[0] || 'Unknown Product';
};

const buildPriceListAggregation = ({ category, subcategory, available }) => {
  const matchStage = { isDeleted: false };
  if (category) matchStage.category = category;
  if (subcategory) matchStage.subcategory = subcategory;
  if (available !== undefined) matchStage.isAvailable = available === 'true';

  return [
    { $match: matchStage },
    {
      $lookup: {
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'categoryDetails',
      },
    },
    {
      $lookup: {
        from: 'subcategories',
        localField: 'subcategory',
        foreignField: '_id',
        as: 'subcategoryDetails',
      },
    },
    {
      $addFields: {
        categoryName: { $arrayElemAt: ['$categoryDetails.name.en', 0] },
        subcategoryName: { $arrayElemAt: ['$subcategoryDetails.name.en', 0] },
        // A product carries its own stock directly now (see docs/entities/products.md) - no
        // separate Variant lookup needed to total it up.
        totalStock: { $sum: '$stock.quantity' },
      },
    },
    { $sort: { 'title.en': 1 } },
  ];
};

// @desc    Get Product Price List Report
// @route   GET /api/v1/reports/price-list
// @access  Private
exports.getProductPriceList = asyncHandler(async (req, res) => {
  const { category, subcategory, available } = req.query;

  const products = await Product.aggregate([
    ...buildPriceListAggregation({ category, subcategory, available }),
    {
      $project: {
        title: 1,
        cost: 1,
        price: 1,
        priceAfterDiscount: 1,
        isAvailable: 1,
        categoryName: 1,
        subcategoryName: 1,
        totalStock: 1,
        sku: 1,
        barcode: 1,
      },
    },
  ]);

  // Calculate summary statistics
  const summary = {
    totalProducts: products.length,
    averagePrice: products.length > 0 ? (products.reduce((sum, p) => sum + p.price, 0) / products.length).toFixed(2) : 0,
    priceRange:
      products.length > 0
        ? {
            min: Math.min(...products.map(p => p.price)),
            max: Math.max(...products.map(p => p.price)),
          }
        : { min: 0, max: 0 },
    categoryBreakdown: products.reduce((acc, p) => {
      acc[p.categoryName] = (acc[p.categoryName] || 0) + 1;
      return acc;
    }, {}),
  };

  res.status(200).json({
    status: 'success',
    results: products.length,
    data: {
      products,
      summary,
    },
  });
});

// @desc    Generate Product Price List Excel
// @route   POST /api/v1/reports/price-list
// @access  Private
exports.generateProductPriceListExcel = asyncHandler(async (req, res) => {
  const { category, subcategory, available } = req.body;

  const products = await Product.aggregate(buildPriceListAggregation({ category, subcategory, available }));

  if (!products.length) {
    throw new ApiError('No products found', 404);
  }

  // Prepare headers - one row per product now (a product has a single sku/stock total, no
  // separate color/size variants to break out into extra rows)
  const headers = ['Product Name', 'Category', 'Subcategory', 'SKU', 'Barcode', 'Cost', 'Regular Price', 'Discounted Price', 'Stock Level', 'Status'];

  // Format numbers for better readability
  const formatNumber = num => (num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const data = products.map(product => [
    getEnglishTitle(product.title),
    product.categoryName,
    product.subcategoryName,
    product.sku || 'N/A',
    product.barcode || 'N/A',
    formatNumber(product.cost),
    formatNumber(product.price),
    product.priceAfterDiscount ? formatNumber(product.priceAfterDiscount) : 'N/A',
    product.totalStock || 0,
    product.isAvailable ? 'Available' : 'Not Available',
  ]);

  // Calculate totals
  const totals = {
    totalProducts: products.length,
    totalStock: products.reduce((sum, p) => sum + (p.totalStock || 0), 0),
    averagePrice: products.reduce((sum, p) => sum + p.price, 0) / products.length,
  };

  // Add summary rows
  const summaryRows = [
    ['', '', '', '', '', '', '', '', '', ''], // Empty row
    ['SUMMARY', '', '', '', '', '', '', '', '', ''],
    ['Total Products:', totals.totalProducts, '', '', '', '', '', '', '', ''],
    ['Total Stock:', totals.totalStock, '', '', '', '', '', '', '', ''],
    ['Average Price:', formatNumber(totals.averagePrice), '', '', '', '', '', '', '', ''],
  ];

  // Export to Excel
  await exportToExcel(res, 'Product_Price_List.xlsx', headers, [...data, ...summaryRows]);
});
