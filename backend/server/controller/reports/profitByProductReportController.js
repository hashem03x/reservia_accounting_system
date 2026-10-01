const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const SalesOrder = require('../../models/sales/salesOrderModel');
const Product = require('../../models/inventory/productModel');
const Category = require('../../models/categoryModel');
const SubCategory = require('../../models/subCategoryModel');
const exportToExcel = require('../../utils/exportToExcel');

// Helper function to build aggregation pipeline for profit by product report
const buildProfitByProductPipeline = filters => {
  const { startDate, endDate, season, mainCategory, subcategory, warehouse, online, sortBy, sortOrder } = filters;
  const pipeline = [];

  // Match stage for sales orders
  const matchStage = {};

  if (startDate) {
    matchStage.createdAt = { ...matchStage.createdAt, $gte: new Date(startDate) };
  }

  if (endDate) {
    matchStage.createdAt = { ...matchStage.createdAt, $lte: new Date(endDate) };
  }

  if (warehouse && warehouse !== 'all') {
    matchStage.warehouse = mongoose.Types.ObjectId(warehouse);
  }

  if (online) {
    matchStage.isOnlineOrder = online === 'true';
  }

  if (Object.keys(matchStage).length > 0) {
    pipeline.push({ $match: matchStage });
  }

  // Unwind items array
  pipeline.push({ $unwind: '$items' });

  // Lookup product details - items identify their product directly now, no Variant to resolve first
  pipeline.push({
    $lookup: {
      from: 'products',
      localField: 'items.product',
      foreignField: '_id',
      as: 'productDetails',
    },
  });

  // Unwind product details
  pipeline.push({ $unwind: '$productDetails' });

  // Lookup category details
  pipeline.push({
    $lookup: {
      from: 'categories',
      localField: 'productDetails.category',
      foreignField: '_id',
      as: 'categoryDetails',
    },
  });

  // Unwind category details
  pipeline.push({ $unwind: '$categoryDetails' });

  // Lookup subcategory details
  pipeline.push({
    $lookup: {
      from: 'subcategories',
      localField: 'productDetails.subcategory',
      foreignField: '_id',
      as: 'subcategoryDetails',
    },
  });

  // Unwind subcategory details
  pipeline.push({ $unwind: '$subcategoryDetails' });

  // Apply product-level filters
  const productMatchStage = {};

  if (season) {
    productMatchStage['productDetails.season'] = season;
  }

  if (mainCategory) {
    productMatchStage['productDetails.category'] = mongoose.Types.ObjectId(mainCategory);
  }

  if (subcategory) {
    productMatchStage['productDetails.subcategory'] = mongoose.Types.ObjectId(subcategory);
  }

  if (Object.keys(productMatchStage).length > 0) {
    pipeline.push({ $match: productMatchStage });
  }

  // Add calculated fields
  pipeline.push({
    $addFields: {
      quantity: { $subtract: ['$items.starterQuantity', '$items.returnedQuantity'] },
      sales: {
        $multiply: ['$items.unitPriceAfterDiscount', { $subtract: ['$items.starterQuantity', '$items.returnedQuantity'] }],
      },
      cost: {
        $multiply: [{ $ifNull: ['$items.costWhenSold', '$productDetails.cost'] }, { $subtract: ['$items.starterQuantity', '$items.returnedQuantity'] }],
      },
    },
  });

  // Group by product
  pipeline.push({
    $group: {
      _id: '$productDetails._id',
      productName: { $first: { $ifNull: ['$productDetails.title.en', '$productDetails.title'] } },
      category: { $first: { $ifNull: ['$categoryDetails.name.en', '$categoryDetails.name'] } },
      subcategory: { $first: { $ifNull: ['$subcategoryDetails.name.en', '$subcategoryDetails.name'] } },
      season: { $first: '$productDetails.season' },
      price: { $first: '$productDetails.price' },
      cost: { $first: '$productDetails.cost' },
      totalQuantity: { $sum: '$quantity' },
      totalSales: { $sum: '$sales' },
      costOfSales: { $sum: '$cost' },
    },
  });

  // Calculate gross profit
  pipeline.push({
    $addFields: {
      productId: '$_id',
      grossProfit: { $subtract: ['$totalSales', '$costOfSales'] },
    },
  });

  // Apply sorting
  const sortField = sortBy || 'totalSales';
  const sortDirection = sortOrder === 'asc' ? 1 : -1;

  // Handle special case for createdAt sorting (fallback to totalSales)
  if (sortField === 'createdAt') {
    pipeline.push({ $sort: { totalSales: -1 } });
  } else {
    pipeline.push({ $sort: { [sortField]: sortDirection } });
  }

  return pipeline;
};

/**
 * Get Profit by Product Report
 * @route GET /api/reports/profit-by-product
 * @description Retrieve profit analysis for each product
 */
exports.getProfitByProductReport = asyncHandler(async (req, res) => {
  const filters = req.query;

  // Build aggregation pipeline using helper function
  const pipeline = buildProfitByProductPipeline(filters);

  // Add projection to match original response structure
  pipeline.push({
    $project: {
      _id: 0,
      productId: 1,
      productName: 1,
      category: 1,
      subcategory: 1,
      season: 1,
      totalQuantity: 1,
      totalSales: 1,
      costOfSales: 1,
      grossProfit: 1,
      price: 1,
      cost: 1,
    },
  });

  // Execute aggregation
  const profitData = await SalesOrder.aggregate(pipeline);

  res.status(200).json({
    status: 'success',
    results: profitData.length,
    data: profitData,
  });
});

/**
 * Export Profit by Product Report to Excel
 * @route POST /api/reports/profit-by-product
 * @description Export profit by product analysis data to Excel
 */
exports.exportProfitByProductReport = asyncHandler(async (req, res) => {
  const filters = req.query;

  // Build aggregation pipeline using helper function
  const pipeline = buildProfitByProductPipeline(filters);

  // Execute aggregation
  const profitData = await SalesOrder.aggregate(pipeline);

  // Format data for Excel
  const excelData = profitData.map(item => [
    item.productName,
    item.category,
    item.subcategory,
    item.season,
    item.totalQuantity,
    Number(item.totalSales.toFixed(2)),
    Number(item.costOfSales.toFixed(2)),
    Number(item.grossProfit.toFixed(2)),
  ]);

  // Calculate totals
  const totals = profitData.reduce(
    (acc, item) => [
      'Total',
      '',
      '',
      '',
      acc[4] + item.totalQuantity,
      Number((acc[5] + item.totalSales).toFixed(2)),
      Number((acc[6] + item.costOfSales).toFixed(2)),
      Number((acc[7] + item.grossProfit).toFixed(2)),
    ],
    ['Total', '', '', '', 0, 0, 0, 0]
  );

  const headers = ['Product Name', 'Category', 'Subcategory', 'Season', 'Total Quantity', 'Total Sales', 'Cost of Sales', 'Gross Profit'];

  await exportToExcel(res, 'Profit_By_Product_Report', headers, excelData, {
    totalRow: totals,
  });
});
