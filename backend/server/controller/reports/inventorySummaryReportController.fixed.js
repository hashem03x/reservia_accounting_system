const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Product = require('../../models/inventory/productModel');
const Variant = require('../../models/inventory/variantModel');
const SalesOrder = require('../../models/sales/salesOrderModel');
const excel = require('exceljs');
const ApiError = require('../../utils/apiError');

// Helper function to build base query
const buildBaseQuery = queryParams => {
  const query = { isDeleted: false };

  if (queryParams.startDate && queryParams.endDate) {
    query.createdAt = {
      $gte: new Date(queryParams.startDate),
      $lte: new Date(queryParams.endDate),
    };
  }

  if (queryParams.category) {
    query.category = new mongoose.Types.ObjectId(queryParams.category);
  }

  // Support both subcategory and subCategory parameter formats
  const subcategoryValue = queryParams.subcategory || queryParams.subCategory;
  if (subcategoryValue) {
    query.subcategory = new mongoose.Types.ObjectId(subcategoryValue);
  }

  return query;
};

// Helper function to determine stock status based on quantity
const getStockStatus = quantity => {
  if (quantity === 0) return 'out_of_stock';
  if (quantity <= 5) return 'running_low';
  return 'in_stock';
};

// Helper function to get total sold for variants in a specific warehouse
const getVariantsTotalSold = async (variants, warehouse) => {
  if (!variants || variants.length === 0) return 0;

  const variantIds = variants.map(v => v._id.toString());
  const query = {
    'items.variant': { $in: variantIds },
  };

  if (warehouse) {
    query.warehouse = new mongoose.Types.ObjectId(warehouse);
  }

  const salesOrders = await SalesOrder.find(query).populate('items.variant');

  let totalSold = 0;
  for (const order of salesOrders) {
    for (const item of order.items) {
      const variantId = item.variant._id.toString();
      if (variantIds.includes(variantId)) {
        totalSold += item.starterQuantity - (item.returnedQuantity || 0);
      }
    }
  }
  return totalSold;
};

// @desc    Get Inventory Summary Report
// @route   GET /api/v1/reports/inventory-summary
// @access  Private
exports.getInventorySummaryReport = asyncHandler(async (req, res) => {
  const { warehouse, stockStatus, sortBy = 'createdAt', sortOrder = 'desc', ...filters } = req.query;

  // Build base query for product filtering
  const baseQuery = buildBaseQuery(filters);

  // Get product stock data using aggregation (similar to analyticsController approach)
  const stockAnalysis = await Product.aggregate([
    {
      $match: { ...baseQuery },
    },
    {
      $lookup: {
        from: 'variants',
        localField: 'variants',
        foreignField: '_id',
        pipeline: [
          { $match: { isDeleted: false } },
          { $unwind: '$stock' },
          ...(warehouse
            ? [
                {
                  $match: { 'stock.warehouse': new mongoose.Types.ObjectId(warehouse) },
                },
              ]
            : []),
          {
            $group: {
              _id: '$_id',
              stockQuantity: { $sum: '$stock.quantity' },
              sku: { $first: '$sku' },
              color: { $first: '$color' },
              size: { $first: '$size' },
              variantCode: { $first: '$variantCode' },
            },
          },
        ],
        as: 'variantStocks',
      },
    },
    {
      $lookup: {
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'categoryData',
      },
    },
    {
      $lookup: {
        from: 'subcategories',
        localField: 'subcategory',
        foreignField: '_id',
        as: 'subcategoryData',
      },
    },
    {
      $addFields: {
        totalStock: { $sum: '$variantStocks.stockQuantity' },
        categoryName: { $arrayElemAt: ['$categoryData.name', 0] },
        subcategoryName: { $arrayElemAt: ['$subcategoryData.name', 0] },
      },
    },
  ]);

  // Process products to include all required data
  const inventoryItems = await Promise.all(
    stockAnalysis.map(async product => {
      // Calculate total sold
      const totalSold = await getVariantsTotalSold(product.variantStocks, warehouse);

      // Calculate value (handle nulls and zeroes)
      const stockLevel = product.totalStock || 0;
      const cost = product.cost || 0;
      const value = stockLevel * cost;

      return {
        _id: product._id,
        title: product.title,
        description: product.description,
        sku: product.variantStocks.map(v => v.sku).join(', '),
        category: product.categoryName,
        subcategory: product.subcategoryName,
        cost: cost,
        price: product.price,
        stockLevel: stockLevel,
        stockStatus: getStockStatus(stockLevel),
        value: value,
        totalSold: totalSold,
        variants: product.variantStocks.map(v => ({
          ...v,
          variantCode: v.variantCode || '',
        })),
        createdAt: product.createdAt,
      };
    })
  );

  // Filter inventory to only include items with stock in the specified warehouse if warehouse filter is applied
  let processedInventory = inventoryItems;
  if (warehouse) {
    processedInventory = inventoryItems.filter(item => item.stockLevel > 0);
  }

  // Filter by stock status if specified
  const filteredInventory = stockStatus ? processedInventory.filter(item => item.stockStatus === stockStatus) : processedInventory;

  // Apply sorting
  if (sortBy) {
    const sortMultiplier = sortOrder === 'desc' ? -1 : 1;
    filteredInventory.sort((a, b) => {
      let aValue = a[sortBy];
      let bValue = b[sortBy];

      // Handle nested properties like 'title.en'
      if (sortBy.includes('.')) {
        const parts = sortBy.split('.');
        aValue = parts.reduce((obj, key) => (obj && obj[key] !== undefined ? obj[key] : ''), a);
        bValue = parts.reduce((obj, key) => (obj && obj[key] !== undefined ? obj[key] : ''), b);
      }

      if (aValue < bValue) return -1 * sortMultiplier;
      if (aValue > bValue) return 1 * sortMultiplier;
      return 0;
    });
  }

  // Calculate summary statistics using exact same approach as analyticsController
  const totalStock = stockAnalysis.reduce((sum, p) => sum + (p.totalStock || 0), 0);

  // Calculate the total inventory value directly using the same algorithm as in productsReportController.js
  // This will avoid the discrepancy between the two calculation methods
  const productsWithVariants = await Product.find({ isDeleted: false })
    .populate({
      path: 'variants',
      select: 'color size stockLevel stock sku',
      match: { isDeleted: false },
    })
    .lean();

  let totalValue = 0;
  for (const product of productsWithVariants) {
    const stockLevel = product.variants.reduce((sum, variant) => {
      if (warehouse) {
        const warehouseStock = variant.stock.find(s => s.warehouse.toString() === warehouse);
        return sum + (warehouseStock ? warehouseStock.quantity : 0);
      }
      return sum + variant.stockLevel;
    }, 0);

    totalValue += stockLevel * product.cost;
  }
  
  // Format totalValue with comma as thousands separator
  const formattedTotalValue = totalValue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const summary = {
    totalProducts: filteredInventory.length,
    totalValue: formattedTotalValue, // Use the formatted value with commas
    totalStock: totalStock, // Use the directly calculated value from stockAnalysis
    totalSold: filteredInventory.reduce((sum, item) => sum + (item.totalSold || 0), 0),
    byCategory: {},
    byStockStatus: {
      in_stock: 0,
      running_low: 0,
      out_of_stock: 0,
    },
  };

  // Calculate category and status breakdowns
  filteredInventory.forEach(item => {
    // Category breakdown
    const categoryName = item.category;
    if (!summary.byCategory[categoryName]) {
      summary.byCategory[categoryName] = {
        count: 0,
        value: 0,
        stock: 0,
        sold: 0,
      };
    }
    summary.byCategory[categoryName].count++;
    summary.byCategory[categoryName].value += item.value;
    summary.byCategory[categoryName].stock += item.stockLevel;
    summary.byCategory[categoryName].sold += item.totalSold;

    // Stock status breakdown
    summary.byStockStatus[item.stockStatus]++;
  });

  res.status(200).json({
    status: 'success',
    results: filteredInventory.length,
    totalValue: formattedTotalValue,
    data: {
      inventory: filteredInventory,
      summary,
    },
  });
});

// @desc    Generate Inventory Summary Excel Report
// @route   POST /api/v1/reports/inventory-summary/excel
// @access  Private
exports.generateInventorySummaryExcel = asyncHandler(async (req, res) => {
  const { warehouse, stockStatus, ...filters } = req.body;

  // Get inventory data using the same logic as the main report
  const baseQuery = buildBaseQuery(filters);

  // Use aggregation pipeline for consistent stock calculation
  const stockAnalysis = await Product.aggregate([
    {
      $match: { ...baseQuery },
    },
    {
      $lookup: {
        from: 'variants',
        localField: 'variants',
        foreignField: '_id',
        pipeline: [
          { $match: { isDeleted: false } },
          { $unwind: '$stock' },
          ...(warehouse
            ? [
                {
                  $match: { 'stock.warehouse': new mongoose.Types.ObjectId(warehouse) },
                },
              ]
            : []),
          {
            $group: {
              _id: '$_id',
              stockQuantity: { $sum: '$stock.quantity' },
              sku: { $first: '$sku' },
              color: { $first: '$color' },
              size: { $first: '$size' },
              variantCode: { $first: '$variantCode' },
            },
          },
        ],
        as: 'variantStocks',
      },
    },
    {
      $lookup: {
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'categoryData',
      },
    },
    {
      $lookup: {
        from: 'subcategories',
        localField: 'subcategory',
        foreignField: '_id',
        as: 'subcategoryData',
      },
    },
    {
      $addFields: {
        totalStock: { $sum: '$variantStocks.stockQuantity' },
        categoryName: { $arrayElemAt: ['$categoryData.name', 0] },
        subcategoryName: { $arrayElemAt: ['$subcategoryData.name', 0] },
      },
    },
  ]);

  // Process products and create a flat array with one entry per variant
  let flatInventory = [];

  await Promise.all(
    stockAnalysis.map(async product => {
      // Calculate total sold
      const totalSold = await getVariantsTotalSold(product.variantStocks, warehouse);

      // Create an entry for each variant
      for (const variant of product.variantStocks) {
        // Calculate value for this variant
        const variantValue = variant.stockQuantity * product.cost;

        flatInventory.push({
          _id: product._id,
          variantCode: variant.variantCode || '',
          title: product.title?.en || '',
          description: product.description?.en || '',
          sku: variant.sku || '',
          category: product.categoryName?.en || '',
          subcategory: product.subcategoryName?.en || '',
          cost: product.cost,
          price: product.price,
          stockLevel: variant.stockQuantity,
          stockStatus: getStockStatus(variant.stockQuantity),
          value: variantValue,
          totalSold: totalSold, // Using total sold for all variants
          variantDetails: `${variant.color?.name || variant.color || ''} - ${variant.size || ''}`,
          createdAt: product.createdAt,
        });
      }
    })
  );

  // Filter inventory to only include items with stock in the specified warehouse if warehouse filter is applied
  let processedInventory = flatInventory;
  if (warehouse) {
    processedInventory = flatInventory.filter(item => item.stockLevel > 0);
  }

  // Filter by stock status if specified
  const filteredInventory = stockStatus ? processedInventory.filter(item => item.stockStatus === stockStatus) : processedInventory;

  if (filteredInventory.length === 0) {
    throw new ApiError('No inventory data available for export', 404);
  }

  // Apply sorting
  if (req.body.sortBy) {
    const sortMultiplier = req.body.sortOrder === 'desc' ? -1 : 1;
    filteredInventory.sort((a, b) => {
      let aValue = a[req.body.sortBy];
      let bValue = b[req.body.sortBy];

      // Handle nested properties like 'title.en'
      if (req.body.sortBy.includes('.')) {
        const parts = req.body.sortBy.split('.');
        aValue = parts.reduce((obj, key) => (obj && obj[key] !== undefined ? obj[key] : ''), a);
        bValue = parts.reduce((obj, key) => (obj && obj[key] !== undefined ? obj[key] : ''), b);
      }

      if (aValue < bValue) return -1 * sortMultiplier;
      if (aValue > bValue) return 1 * sortMultiplier;
      return 0;
    });
  }

  // Calculate summary statistics using exact same approach as analyticsController
  const totalStock = stockAnalysis.reduce((sum, p) => sum + (p.totalStock || 0), 0);

  // Calculate the total inventory value directly using the same algorithm as in productsReportController.js
  // This will avoid the discrepancy between the two calculation methods
  const productsWithVariants = await Product.find({ isDeleted: false })
    .populate({
      path: 'variants',
      select: 'color size stockLevel stock sku',
      match: { isDeleted: false },
    })
    .lean();

  let totalValue = 0;
  for (const product of productsWithVariants) {
    const stockLevel = product.variants.reduce((sum, variant) => {
      if (warehouse) {
        const warehouseStock = variant.stock.find(s => s.warehouse.toString() === warehouse);
        return sum + (warehouseStock ? warehouseStock.quantity : 0);
      }
      return sum + variant.stockLevel;
    }, 0);

    totalValue += stockLevel * product.cost;
  }
  
  // Format totalValue with comma as thousands separator
  const formattedTotalValue = totalValue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const summary = {
    totalProducts: stockAnalysis.length,
    totalVariants: filteredInventory.length,
    totalValue: formattedTotalValue, // Use the formatted value with commas
    totalStock: totalStock, // Use the directly calculated value from stockAnalysis
    totalSold: filteredInventory.reduce((sum, item) => sum + (item.totalSold || 0), 0),
    byCategory: {},
    byStockStatus: {
      in_stock: 0,
      running_low: 0,
      out_of_stock: 0,
    },
  };

  // Calculate category and status breakdowns
  filteredInventory.forEach(item => {
    // Category breakdown
    const categoryName = item.category;
    if (!summary.byCategory[categoryName]) {
      summary.byCategory[categoryName] = {
        count: 0,
        value: 0,
        stock: 0,
        sold: 0,
      };
    }
    summary.byCategory[categoryName].count++;
    summary.byCategory[categoryName].value += item.value;
    summary.byCategory[categoryName].stock += item.stockLevel;
    summary.byCategory[categoryName].sold += item.totalSold;

    // Stock status breakdown
    summary.byStockStatus[item.stockStatus]++;
  });

  // Create Excel workbook
  const workbook = new excel.Workbook();
  const worksheet = workbook.addWorksheet('Inventory Summary');

  // Define columns
  worksheet.columns = [
    { header: 'Variant Code', key: 'variantCode', width: 15 },
    { header: 'Title', key: 'title', width: 20 },
    { header: 'Description', key: 'description', width: 30 },
    { header: 'SKU', key: 'sku', width: 15 },
    { header: 'Category', key: 'category', width: 15 },
    { header: 'Subcategory', key: 'subcategory', width: 15 },
    { header: 'Variant Details', key: 'variantDetails', width: 15 },
    { header: 'Cost', key: 'cost', width: 10 },
    { header: 'Price', key: 'price', width: 10 },
    { header: 'Stock Level', key: 'stockLevel', width: 10 },
    { header: 'Stock Status', key: 'stockStatus', width: 12 },
    { header: 'Value', key: 'value', width: 12 },
    { header: 'Total Sold', key: 'totalSold', width: 10 },
    { header: 'Created At', key: 'createdAt', width: 20 },
  ];

  // Add data rows
  filteredInventory.forEach(item => {
    worksheet.addRow({
      variantCode: item.variantCode,
      title: item.title,
      description: item.description,
      sku: item.sku,
      category: item.category,
      subcategory: item.subcategory,
      variantDetails: item.variantDetails,
      cost: item.cost,
      price: item.price,
      stockLevel: item.stockLevel,
      stockStatus: item.stockStatus,
      value: item.value,
      totalSold: item.totalSold,
      createdAt: item.createdAt.toLocaleDateString(),
    });
  });

  // Add summary worksheet
  const summarySheet = workbook.addWorksheet('Summary');

  // Add summary data
  summarySheet.addRow(['Total Products', summary.totalProducts]);
  summarySheet.addRow(['Total Variants', summary.totalVariants]);
  summarySheet.addRow(['Total Value', summary.totalValue]);
  summarySheet.addRow(['Total Stock', summary.totalStock]);
  summarySheet.addRow(['Total Sold', summary.totalSold]);

  summarySheet.addRow([]);
  summarySheet.addRow(['Stock Status Breakdown']);
  summarySheet.addRow(['In Stock', summary.byStockStatus.in_stock]);
  summarySheet.addRow(['Running Low', summary.byStockStatus.running_low]);
  summarySheet.addRow(['Out of Stock', summary.byStockStatus.out_of_stock]);

  summarySheet.addRow([]);
  summarySheet.addRow(['Category Breakdown']);
  summarySheet.addRow(['Category', 'Count', 'Value', 'Stock', 'Sold']);

  Object.entries(summary.byCategory).forEach(([category, data]) => {
    summarySheet.addRow([category, data.count, data.value, data.stock, data.sold]);
  });

  // Style header rows
  worksheet.getRow(1).font = { bold: true };

  // Set response headers
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=inventory-summary.xlsx');

  // Write workbook to response
  await workbook.xlsx.write(res);
});
