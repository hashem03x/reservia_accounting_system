const asyncHandler = require('express-async-handler');
const Product = require('../../models/inventory/productModel');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');

// Helper function to get English title
const getEnglishTitle = title => {
  if (!title) return 'Unknown Product';
  return title.en || Object.values(title)[0] || 'Unknown Product';
};

// @desc    Get Product Price List Report
// @route   GET /api/v1/reports/price-list
// @access  Private
exports.getProductPriceList = asyncHandler(async (req, res) => {
  const { category, subcategory, available } = req.query;

  // Build match stage
  const matchStage = { isDeleted: false };
  if (category) matchStage.category = category;
  if (subcategory) matchStage.subcategory = subcategory;
  if (available !== undefined) matchStage.isAvailable = available === 'true';

  const products = await Product.aggregate([
    {
      $match: matchStage,
    },
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
      $lookup: {
        from: 'variants',
        localField: 'variants',
        foreignField: '_id',
        as: 'variantDetails',
      },
    },
    {
      $addFields: {
        categoryName: { $arrayElemAt: ['$categoryDetails.name.en', 0] },
        subcategoryName: { $arrayElemAt: ['$subcategoryDetails.name.en', 0] },
        totalStock: {
          $reduce: {
            input: '$variantDetails',
            initialValue: 0,
            in: { $add: ['$$value', '$$this.stockLevel'] },
          },
        },
      },
    },
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
        variantDetails: {
          color: 1,
          size: 1,
          sku: 1,
          stockLevel: 1,
        },
      },
    },
    {
      $sort: { 'title.en': 1 },
    },
  ]);

  // Calculate summary statistics
  const summary = {
    totalProducts: products.length,
    totalVariants: products.reduce((sum, p) => sum + p.variantDetails.length, 0),
    averagePrice: products.length > 0 ? 
      (products.reduce((sum, p) => sum + p.price, 0) / products.length).toFixed(2) : 0,
    priceRange: products.length > 0 ? {
      min: Math.min(...products.map(p => p.price)),
      max: Math.max(...products.map(p => p.price)),
    } : { min: 0, max: 0 },
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

  // Build match stage
  const matchStage = { isDeleted: false };
  if (category) matchStage.category = category;
  if (subcategory) matchStage.subcategory = subcategory;
  if (available !== undefined) matchStage.isAvailable = available === 'true';

  const products = await Product.aggregate([
    {
      $match: matchStage,
    },
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
      $lookup: {
        from: 'variants',
        localField: 'variants',
        foreignField: '_id',
        as: 'variantDetails',
      },
    },
    {
      $addFields: {
        categoryName: { $arrayElemAt: ['$categoryDetails.name.en', 0] },
        subcategoryName: { $arrayElemAt: ['$subcategoryDetails.name.en', 0] },
      },
    },
    {
      $sort: { 'title.en': 1 },
    },
  ]);

  if (!products.length) {
    throw new ApiError('No products found', 404);
  }

  // Prepare headers
  const headers = [
    'Product Name',
    'Category',
    'Subcategory',
    'SKU',
    'Color',
    'Size',
    'Cost',
    'Regular Price',
    'Discounted Price',
    'Stock Level',
    'Status',
  ];

  // Format numbers for better readability
  const formatNumber = num => (num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Transform data for excel format - one row per variant
  const data = [];
  products.forEach(product => {
    const baseInfo = {
      name: getEnglishTitle(product.title),
      category: product.categoryName,
      subcategory: product.subcategoryName,
      cost: product.cost,
      price: product.price,
      priceAfterDiscount: product.priceAfterDiscount,
    };

    if (product.variantDetails && product.variantDetails.length > 0) {
      // Add a row for each variant
      product.variantDetails.forEach(variant => {
        data.push([
          baseInfo.name,
          baseInfo.category,
          baseInfo.subcategory,
          variant.sku,
          variant.color,
          variant.size,
          formatNumber(baseInfo.cost),
          formatNumber(baseInfo.price),
          baseInfo.priceAfterDiscount ? formatNumber(baseInfo.priceAfterDiscount) : 'N/A',
          variant.stockLevel,
          product.isAvailable ? 'Available' : 'Not Available',
        ]);
      });
    } else {
      // Add a single row for products without variants
      data.push([
        baseInfo.name,
        baseInfo.category,
        baseInfo.subcategory,
        'N/A',
        'N/A',
        'N/A',
        formatNumber(baseInfo.cost),
        formatNumber(baseInfo.price),
        baseInfo.priceAfterDiscount ? formatNumber(baseInfo.priceAfterDiscount) : 'N/A',
        0,
        product.isAvailable ? 'Available' : 'Not Available',
      ]);
    }
  });

  // Calculate totals
  const totals = data.reduce(
    (acc, row) => ({
      totalProducts: products.length,
      totalVariants: acc.totalVariants + 1,
      totalStock: acc.totalStock + (parseInt(row[9]) || 0),
      averagePrice: products.reduce((sum, p) => sum + p.price, 0) / products.length,
    }),
    { totalVariants: 0, totalStock: 0 }
  );

  // Add summary rows
  const summaryRows = [
    ['', '', '', '', '', '', '', '', '', '', ''], // Empty row
    ['SUMMARY', '', '', '', '', '', '', '', '', '', ''],
    ['Total Products:', totals.totalProducts, '', '', '', '', '', '', '', '', ''],
    ['Total Variants:', totals.totalVariants, '', '', '', '', '', '', '', '', ''],
    ['Total Stock:', totals.totalStock, '', '', '', '', '', '', '', '', ''],
    ['Average Price:', formatNumber(totals.averagePrice), '', '', '', '', '', '', '', '', ''],
  ];

  // Export to Excel
  await exportToExcel(
    res,
    'Product_Price_List.xlsx',
    headers,
    [...data, ...summaryRows]
  );
});
