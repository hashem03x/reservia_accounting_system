const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Product = require('../../models/inventory/productModel');
const SalesOrder = require('../../models/sales/salesOrderModel');
const excel = require('exceljs');
const ApiError = require('../../utils/apiError');

// Helper function to build base query
const buildBaseQuery = queryParams => {
  const query = { isDeleted: false };

  // Date range filter - handle case when only startDate is provided
  if (queryParams.startDate) {
    try {
      const startDate = new Date(queryParams.startDate);

      // If endDate is missing, use current date as endDate
      const endDate = queryParams.endDate ? new Date(queryParams.endDate) : new Date();

      // Check if dates are in the future (likely test data)
      const currentYear = new Date().getFullYear();
      const isStartDateFuture = startDate.getFullYear() > currentYear;
      const isEndDateFuture = endDate.getFullYear() > currentYear;

      if (isStartDateFuture || isEndDateFuture) {
        // Skip adding date filter for future dates to show all products
      } else {
        // Set start time to beginning of day (00:00:00) and end time to end of day (23:59:59)
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);

        query.createdAt = {
          $gte: startDate,
          $lte: endDate,
        };
      }
    } catch (err) {
      // Error parsing date range
    }
  }

  // Category filter
  if (queryParams.category) {
    try {
      query.category = new mongoose.Types.ObjectId(queryParams.category);
    } catch (err) {
      // Error parsing category ID
    }
  }

  // Support both subcategory and subCategory parameter formats
  const subcategoryValue = queryParams.subcategory || queryParams.subCategory;
  if (subcategoryValue) {
    try {
      query.subcategory = new mongoose.Types.ObjectId(subcategoryValue);
    } catch (err) {
      // Error parsing subcategory ID
    }
  }

  return query;
};

// Helper function to determine stock status based on quantity
const getStockStatus = quantity => {
  if (quantity === 0) return 'Out of Stock';
  return 'In Stock';
};

// Total sold for a product (optionally restricted to one warehouse) - items identify their
// product directly, so this is one query per product with no Variant resolution step in between.
const getProductTotalSold = async (productId, warehouse) => {
  const match = { 'items.product': productId };
  if (warehouse) match.warehouse = new mongoose.Types.ObjectId(warehouse);

  const salesOrders = await SalesOrder.find(match).select('items warehouse');

  let totalSold = 0;
  for (const order of salesOrders) {
    for (const item of order.items) {
      if (item.product && item.product._id.toString() === productId.toString()) {
        totalSold += item.starterQuantity - (item.returnedQuantity || 0);
      }
    }
  }
  return totalSold;
};

// A product carries its own per-warehouse stock directly now (see docs/entities/products.md) - no
// separate Variant collection to join against. This stage computes each product's filtered stock
// entries (and total) straight from the embedded `stock` array.
const stockAggregationStages = warehouse => [
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
      stockEntries: {
        $filter: {
          input: { $ifNull: ['$stock', []] },
          as: 's',
          cond: warehouse ? { $eq: ['$$s.warehouse', new mongoose.Types.ObjectId(warehouse)] } : true,
        },
      },
      categoryName: { $arrayElemAt: ['$categoryData.name', 0] },
      subcategoryName: { $arrayElemAt: ['$subcategoryData.name', 0] },
    },
  },
  {
    $addFields: {
      totalStock: { $sum: '$stockEntries.quantity' },
    },
  },
];

const buildStockAnalysis = async (query, warehouse) => Product.aggregate([{ $match: query }, ...stockAggregationStages(warehouse)]);

// Resolves the stockAnalysis result set with the same fallback behavior as before: retry without
// an accidentally-future date filter, so an overly-narrow filter combo doesn't just return empty.
const resolveStockAnalysis = async (baseQuery, filters, warehouse) => {
  let stockAnalysis = await buildStockAnalysis(baseQuery, warehouse);
  if (stockAnalysis.length > 0) return stockAnalysis;

  if (filters.startDate) {
    const startDate = new Date(filters.startDate);
    const currentYear = new Date().getFullYear();

    if (startDate.getFullYear() > currentYear) {
      const baseQueryWithoutDate = { ...baseQuery };
      delete baseQueryWithoutDate.createdAt;
      stockAnalysis = await buildStockAnalysis(baseQueryWithoutDate, warehouse);
    }
  }

  return stockAnalysis;
};

// @desc    Get Inventory Summary Report
// @route   GET /api/v1/reports/inventory-summary
// @access  Private
exports.getInventorySummaryReport = asyncHandler(async (req, res) => {
  const { warehouse, stockStatus, sortBy = 'createdAt', sortOrder = 'desc', ...filters } = req.query;

  const baseQuery = buildBaseQuery(filters);
  const stockAnalysis = await resolveStockAnalysis(baseQuery, filters, warehouse);

  // Process products to include all required data
  const inventoryItems = await Promise.all(
    stockAnalysis.map(async product => {
      const totalSold = await getProductTotalSold(product._id, warehouse);

      const stockLevel = product.totalStock || 0;
      const cost = product.cost || 0;
      const value = stockLevel * cost;

      return {
        _id: product._id,
        title: product.title,
        description: product.description,
        sku: product.sku || '',
        barcode: product.barcode || '',
        category: product.categoryName,
        subcategory: product.subcategoryName,
        cost,
        price: product.price,
        stockLevel,
        stockStatus: getStockStatus(stockLevel),
        value,
        totalSold,
        stock: product.stockEntries,
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

  // Calculate summary statistics from filteredInventory to ensure consistency
  const totalStock = filteredInventory.reduce((sum, item) => sum + (item.stockLevel || 0), 0);
  const totalValue = filteredInventory.reduce((sum, item) => sum + (item.value || 0), 0);

  // Format totalValue with comma as thousands separator
  const formattedTotalValue = totalValue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const summary = {
    totalProducts: filteredInventory.length,
    totalValue: formattedTotalValue,
    totalStock,
    totalSold: filteredInventory.reduce((sum, item) => sum + (item.totalSold || 0), 0),
    byCategory: {},
    byStockStatus: {
      'In Stock': 0,
      'Out of Stock': 0,
    },
  };

  // Calculate category and status breakdowns
  filteredInventory.forEach(item => {
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
  const { warehouse, stockStatus, sortBy = 'createdAt', sortOrder = 'desc', ...filters } = req.query;

  const baseQuery = buildBaseQuery(filters);
  const stockAnalysis = await resolveStockAnalysis(baseQuery, filters, warehouse);

  // Process products into a flat array with one row per per-warehouse stock entry (replaces the
  // old one-row-per-variant layout - a product's stock is now tracked per warehouse directly,
  // without a separate color/size breakdown).
  let flatInventory = [];

  await Promise.all(
    stockAnalysis.map(async product => {
      const totalSold = await getProductTotalSold(product._id, warehouse);
      const stockEntries = product.stockEntries.length > 0 ? product.stockEntries : [{ quantity: 0, warehouse: null }];

      for (const stockEntry of stockEntries) {
        flatInventory.push({
          _id: product._id,
          barcode: product.barcode || '',
          title: product.title?.en || '',
          description: product.description?.en || '',
          sku: product.sku || '',
          category: product.categoryName?.en || '',
          subcategory: product.subcategoryName?.en || '',
          cost: product.cost,
          price: product.price,
          stockLevel: stockEntry.quantity || 0,
          stockStatus: getStockStatus(stockEntry.quantity || 0),
          value: (stockEntry.quantity || 0) * (product.cost || 0),
          totalSold,
          warehouse: stockEntry.warehouse || '',
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

  const columns = [
    { header: 'Barcode', key: 'barcode', width: 15 },
    { header: 'Title', key: 'title', width: 20 },
    { header: 'Description', key: 'description', width: 30 },
    { header: 'SKU', key: 'sku', width: 15 },
    { header: 'Category', key: 'category', width: 15 },
    { header: 'Subcategory', key: 'subcategory', width: 15 },
    { header: 'Cost', key: 'cost', width: 10 },
    { header: 'Price', key: 'price', width: 10 },
    { header: 'Stock Level', key: 'stockLevel', width: 10 },
    { header: 'Stock Status', key: 'stockStatus', width: 12 },
    { header: 'Value', key: 'value', width: 12 },
    { header: 'Total Sold', key: 'totalSold', width: 10 },
    { header: 'Created At', key: 'createdAt', width: 20 },
  ];

  if (filteredInventory.length === 0) {
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Inventory Summary');
    worksheet.columns = columns;

    const noteSheet = workbook.addWorksheet('Note');
    noteSheet.addRow(['No inventory data found matching these filter criteria:']);
    if (filters.startDate && filters.endDate) {
      noteSheet.addRow(['Date Range:', `${new Date(filters.startDate).toLocaleDateString()} - ${new Date(filters.endDate).toLocaleDateString()}`]);
    }
    if (filters.category) {
      noteSheet.addRow(['Category ID:', filters.category]);
    }
    if (filters.subCategory || filters.subcategory) {
      noteSheet.addRow(['Subcategory ID:', filters.subCategory || filters.subcategory]);
    }
    if (warehouse) {
      noteSheet.addRow(['Warehouse ID:', warehouse]);
    }
    if (stockStatus) {
      noteSheet.addRow(['Stock Status:', stockStatus]);
    }

    worksheet.getRow(1).font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=inventory-summary-empty.xlsx');

    await workbook.xlsx.write(res);
    return;
  }

  // Apply sorting
  if (sortBy) {
    const sortMultiplier = sortOrder === 'desc' ? -1 : 1;
    filteredInventory.sort((a, b) => {
      let aValue = a[sortBy];
      let bValue = b[sortBy];

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

  const totalStock = filteredInventory.reduce((sum, item) => sum + (item.stockLevel || 0), 0);
  const totalValue = filteredInventory.reduce((sum, item) => sum + (item.value || 0), 0);

  const formattedTotalValue = totalValue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const summary = {
    totalProducts: stockAnalysis.length,
    totalStockEntries: filteredInventory.length,
    totalValue: formattedTotalValue,
    totalStock,
    totalSold: filteredInventory.reduce((sum, item) => sum + (item.totalSold || 0), 0),
    byCategory: {},
    byStockStatus: {
      'In Stock': 0,
      'Out of Stock': 0,
    },
  };

  filteredInventory.forEach(item => {
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

    summary.byStockStatus[item.stockStatus]++;
  });

  const workbook = new excel.Workbook();
  const worksheet = workbook.addWorksheet('Inventory Summary');
  worksheet.columns = columns;

  filteredInventory.forEach(item => {
    worksheet.addRow({
      barcode: item.barcode,
      title: item.title,
      description: item.description,
      sku: item.sku,
      category: item.category,
      subcategory: item.subcategory,
      cost: item.cost,
      price: item.price,
      stockLevel: item.stockLevel,
      stockStatus: item.stockStatus,
      value: item.value,
      totalSold: item.totalSold,
      createdAt: item.createdAt.toLocaleDateString(),
    });
  });

  const summarySheet = workbook.addWorksheet('Summary');

  summarySheet.addRow(['Total Products', summary.totalProducts]);
  summarySheet.addRow(['Total Stock Entries', summary.totalStockEntries]);
  summarySheet.addRow(['Total Value', summary.totalValue]);
  summarySheet.addRow(['Total Stock', summary.totalStock]);
  summarySheet.addRow(['Total Sold', summary.totalSold]);

  summarySheet.addRow([]);
  summarySheet.addRow(['Stock Status Breakdown']);
  summarySheet.addRow(['In Stock', summary.byStockStatus['In Stock']]);
  summarySheet.addRow(['Out of Stock', summary.byStockStatus['Out of Stock']]);

  summarySheet.addRow([]);
  summarySheet.addRow(['Category Breakdown']);
  summarySheet.addRow(['Category', 'Count', 'Value', 'Stock', 'Sold']);

  Object.entries(summary.byCategory).forEach(([category, data]) => {
    summarySheet.addRow([category, data.count, data.value, data.stock, data.sold]);
  });

  worksheet.getRow(1).font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=inventory-summary.xlsx');

  await workbook.xlsx.write(res);
});
