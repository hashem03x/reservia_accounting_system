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

  if (queryParams.subcategory) {
    query.subcategory = new mongoose.Types.ObjectId(queryParams.subcategory);
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
    query.warehouse = warehouse;
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

  // Build base query
  const query = buildBaseQuery(filters);

  // Get products with populated data
  const products = await Product.find(query)
    .populate({
      path: 'variants',
      select: 'color size stockLevel stock sku',
    })
    .populate('category', 'name')
    .populate('subcategory', 'name')
    .lean();

  // Process products to include all required data
  const inventory = await Promise.all(
    products.map(async product => {
      // Calculate stock level
      const stockLevel = product.variants.reduce((sum, variant) => {
        if (warehouse) {
          const warehouseStock = variant.stock.find(s => s.warehouse.toString() === warehouse);
          return sum + (warehouseStock ? warehouseStock.quantity : 0);
        }
        return sum + variant.stockLevel;
      }, 0);

      // Calculate total sold
      const totalSold = await getVariantsTotalSold(product.variants, warehouse);

      // Calculate value
      const value = stockLevel * product.cost;

      return {
        _id: product._id,
        title: product.title,
        description: product.description,
        sku: product.variants.map(v => v.sku).join(', '),
        category: product.category.name,
        subcategory: product.subcategory.name,
        cost: product.cost,
        price: product.price,
        stockLevel,
        stockStatus: getStockStatus(stockLevel),
        value,
        totalSold,
        variants: product.variants,
        createdAt: product.createdAt,
      };
    })
  );

  // Filter by stock status if specified
  const filteredInventory = stockStatus ? inventory.filter(item => item.stockStatus === stockStatus) : inventory;

  // Calculate summary statistics
  const summary = {
    totalProducts: filteredInventory.length,
    totalValue: filteredInventory.reduce((sum, item) => sum + item.value, 0),
    totalStock: filteredInventory.reduce((sum, item) => sum + item.stockLevel, 0),
    totalSold: filteredInventory.reduce((sum, item) => sum + item.totalSold, 0),
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
    const categoryName = item.category.en;
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

  // Sort inventory
  if (sortBy) {
    const sortMultiplier = sortOrder === 'desc' ? -1 : 1;
    filteredInventory.sort((a, b) => {
      if (a[sortBy] < b[sortBy]) return -1 * sortMultiplier;
      if (a[sortBy] > b[sortBy]) return 1 * sortMultiplier;
      return 0;
    });
  }

  res.status(200).json({
    status: 'success',
    results: filteredInventory.length,
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
  const query = buildBaseQuery(filters);
  const products = await Product.find(query)
    .populate({
      path: 'variants',
      select: 'color size stockLevel stock sku variantCode',
    })
    .populate('category', 'name')
    .populate('subcategory', 'name')
    .lean();

  // Process products and create a flat array with one entry per variant
  let flatInventory = [];

  await Promise.all(
    products.map(async product => {
      // Calculate total sold for all variants
      const totalSold = await getVariantsTotalSold(product.variants, warehouse);

      // Create an entry for each variant
      for (const variant of product.variants) {
        // Calculate stock level for this specific variant
        let variantStockLevel = 0;
        if (warehouse) {
          const warehouseStock = variant.stock.find(s => s.warehouse.toString() === warehouse);
          variantStockLevel = warehouseStock ? warehouseStock.quantity : 0;
        } else {
          variantStockLevel = variant.stockLevel;
        }

        // Calculate value for this variant
        const variantValue = variantStockLevel * product.cost;

        // Calculate variant-specific sold amount (if possible)
        // Note: If you can't get variant-specific sold amount, you might need to distribute the total
        // sold proportionally or just show the total for each variant

        flatInventory.push({
          _id: product._id,
          variantCode: variant.variantCode, // Use the variant's variantCode instead of sku
          title: product.title.en,
          description: product.description.en,
          sku: variant.sku || '', // Use variant SKU
          category: product.category.name.en,
          subcategory: product.subcategory.name.en,
          cost: product.cost,
          price: product.price,
          stockLevel: variantStockLevel,
          stockStatus: getStockStatus(variantStockLevel),
          value: variantValue,
          totalSold: totalSold, // Using total sold for all variants (could be refined if you have variant-specific data)
          variantDetails: `${variant.color?.name || ''} - ${variant.size || ''}`,
          createdAt: product.createdAt,
        });
      }
    })
  );

  // Filter by stock status if specified
  const filteredInventory = stockStatus ? flatInventory.filter(item => item.stockStatus === stockStatus) : flatInventory;

  if (filteredInventory.length === 0) {
    throw new ApiError('No inventory data available for export', 404);
  }

  // Calculate summary statistics
  const summary = {
    totalProducts: products.length,
    totalVariants: filteredInventory.length,
    totalValue: filteredInventory.reduce((sum, item) => sum + item.value, 0),
    totalStock: filteredInventory.reduce((sum, item) => sum + item.stockLevel, 0),
    totalSold: filteredInventory.reduce((sum, item) => sum + item.totalSold, 0),
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
