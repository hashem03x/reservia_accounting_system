const asyncHandler = require('express-async-handler');
const Product = require('../../models/inventory/productModel');
const Variant = require('../../models/inventory/variantModel');
const SalesOrder = require('../../models/sales/salesOrderModel');
const ApiError = require('../../utils/apiError');
const excel = require('exceljs');

// Helper function to build product query based on filters
const buildProductQuery = queryParams => {
  const query = { isDeleted: false };

  if (queryParams.category) query.category = queryParams.category;
  if (queryParams.subcategory) query.subcategory = queryParams.subcategory;
  if (queryParams.season) query.season = queryParams.season;

  // Date range filter for createdAt
  if (queryParams.startDate && queryParams.endDate) {
    query.createdAt = {
      $gte: new Date(queryParams.startDate),
      $lte: new Date(queryParams.endDate),
    };
  }

  return query;
};

// Helper function to get warehouse stock for a variant
const getWarehouseStock = (variant, warehouse) => {
  if (!warehouse) return variant.stockLevel;

  const warehouseStock = variant.stock.find(s => s.warehouse.toString() === warehouse);
  return warehouseStock ? warehouseStock.quantity : 0;
};

// Helper function to get total sold for variants in a specific warehouse
const getVariantsTotalSold = async (variants, warehouse) => {
  const variantIds = variants.map(v => v._id.toString());
  const query = {
    'items.variant': { $in: variantIds },
    // orderStatus: 'delivered',
  };

  if (warehouse) {
    query.warehouse = warehouse;
  }

  const salesOrders = await SalesOrder.find(query).populate('items.variant'); // Make sure variant is populated

  let totalSold = 0;
  for (const order of salesOrders) {
    for (const item of order.items) {
      // Compare using the _id from the populated variant object
      const variantId = item.variant._id.toString();
      if (variantIds.includes(variantId)) {
        totalSold += item.starterQuantity - (item.returnedQuantity || 0);
      }
    }
  }
  return totalSold;
};

exports.getProductsReport = asyncHandler(async (req, res, next) => {
  const { sortBy = 'createdAt', sortOrder = 'desc', warehouse, ...filters } = req.query;

  // Build base query
  const query = buildProductQuery(filters);

  // Get products with populated variants
  let products = await Product.find(query)
    .populate({
      path: 'variants',
      select: 'color size stockLevel stock sku',
    })
    .populate('category', 'name')
    .populate('subcategory', 'name')
    .lean();

  // Process products to include warehouse-specific data if needed
  const processedProducts = await Promise.all(
    products.map(async product => {
      // Calculate total stock based on warehouse if specified
      const totalStock = product.variants.reduce((sum, variant) => sum + getWarehouseStock(variant, warehouse), 0);

      // Calculate total sold based on variants and warehouse if specified
      const totalSold = await getVariantsTotalSold(product.variants, warehouse);

      // Map variants with warehouse-specific stock
      const variants = product.variants.map(variant => ({
        _id: variant._id,
        color: variant.color,
        size: variant.size,
        sku: variant.sku,
        stockLevel: getWarehouseStock(variant, warehouse),
        stockStatus: variant.stockStatus,
      }));

      return {
        _id: product._id,
        title: product.title,
        description: product.description,
        cost: product.cost,
        price: product.price,
        priceAfterDiscount: product.priceAfterDiscount,
        totalSold,
        isAvailable: product.isAvailable,
        season: product.season,
        category: product.category._id,
        subcategory: product.subcategory._id,
        colors: product.colors,
        createdAt: product.createdAt,
        variants,
        totalStock,
        categoryName: product.category.name,
        subcategoryName: product.subcategory.name,
      };
    })
  );

  // Sort products
  if (sortBy) {
    const sortMultiplier = sortOrder === 'desc' ? -1 : 1;
    processedProducts.sort((a, b) => {
      if (a[sortBy] < b[sortBy]) return -1 * sortMultiplier;
      if (a[sortBy] > b[sortBy]) return 1 * sortMultiplier;
      return 0;
    });
  }

  res.status(200).json({
    status: 'success',
    results: processedProducts.length,
    data: processedProducts,
  });
});

exports.exportProductsReportExcel = asyncHandler(async (req, res, next) => {
  const { warehouse, ...filters } = req.query;

  // Get products data using the same logic as getProductsReport
  const query = buildProductQuery(filters);
  const products = await Product.find(query)
    .populate({
      path: 'variants',
      select: 'color size stockLevel stock sku',
    })
    .populate('category', 'name')
    .populate('subcategory', 'name')
    .lean();

  // Create a new workbook
  const workbook = new excel.Workbook();
  const worksheet = workbook.addWorksheet('Products Report');

  // Define columns
  worksheet.columns = [
    { header: 'Title (EN)', key: 'titleEn', width: 20 },
    { header: 'Title (AR)', key: 'titleAr', width: 20 },
    { header: 'Category', key: 'category', width: 15 },
    { header: 'Subcategory', key: 'subcategory', width: 15 },
    { header: 'Cost', key: 'cost', width: 10 },
    { header: 'Price', key: 'price', width: 10 },
    { header: 'Total Sold', key: 'totalSold', width: 10 },
    { header: 'Total Stock', key: 'totalStock', width: 10 },
    { header: 'Season', key: 'season', width: 10 },
    { header: 'Created At', key: 'createdAt', width: 20 },
  ];

  // Add data rows
  products.forEach(product => {
    const totalStock = product.variants.reduce((sum, variant) => sum + getWarehouseStock(variant, warehouse), 0);

    worksheet.addRow({
      titleEn: product.title.en,
      titleAr: product.title.ar,
      category: product.category.name,
      subcategory: product.subcategory.name,
      cost: product.cost,
      price: product.price,
      totalSold: product.totalSold,
      totalStock,
      season: product.season,
      createdAt: product.createdAt.toLocaleDateString(),
    });
  });

  // Style the header row
  worksheet.getRow(1).font = { bold: true };

  // Set the response headers
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=products-report.xlsx');

  // Write the workbook to the response
  await workbook.xlsx.write(res);
});
