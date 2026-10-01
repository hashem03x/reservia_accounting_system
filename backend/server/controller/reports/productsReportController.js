const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Product = require('../../models/inventory/productModel');
const SalesOrder = require('../../models/sales/salesOrderModel');
const ApiError = require('../../utils/apiError');
const excel = require('exceljs');

// Helper function to build product query based on filters
const buildProductQuery = queryParams => {
  // This report is specifically about stock levels/inventory movement - a service (type:
  // 'service') has no stock by design and must not be lumped in with real out-of-stock/low-stock
  // products (see docs/entities/products.md). `$ne: 'service'` (not `type: 'product'`) also
  // matches legacy documents that predate this field, since Mongo doesn't retroactively apply
  // schema defaults to already-stored documents.
  const query = { isDeleted: false, type: { $ne: 'service' } };

  // Handle category filter
  if (queryParams.category) {
    try {
      query.category = new mongoose.Types.ObjectId(queryParams.category);
    } catch (err) {
      // Error converting category ID
    }
  }

  // Handle subcategory filter
  if (queryParams.subcategory) {
    try {
      query.subcategory = new mongoose.Types.ObjectId(queryParams.subcategory);
    } catch (err) {
      // Error converting subcategory ID
    }
  }

  // Handle season filter
  if (queryParams.season) {
    query.season = queryParams.season;
  }

  // Date range filter for createdAt
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

  return query;
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

// Total sold for a product (optionally restricted to one warehouse), summed directly from
// SalesOrder.items - items identify their product directly, so this is one query per product with
// no Variant resolution step in between.
const getProductTotalSold = async (productId, warehouse) => {
  const match = { 'items.product': productId };
  if (warehouse) match.warehouse = warehouse;

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

const buildStockAnalysis = async (query, warehouse) => Product.aggregate([{ $match: query }, ...stockAggregationStages(warehouse)]);

// Resolves the stockAnalysis result set with the same category/subcategory/warehouse fallback
// behavior as before: if the initial filters produce nothing, progressively relax them (drop a
// subcategory that doesn't belong to the given category, then drop the warehouse filter) so the
// report still shows something useful instead of an empty page for an overly-narrow filter combo.
const resolveStockAnalysis = async (query, filters, warehouse) => {
  let stockAnalysis = await buildStockAnalysis(query, warehouse);
  if (stockAnalysis.length > 0) return stockAnalysis;

  if (filters.subcategory && filters.category) {
    const matchingSubcategory = await mongoose.connection.db.collection('subcategories').countDocuments({
      _id: new mongoose.Types.ObjectId(filters.subcategory),
      mainCategory: new mongoose.Types.ObjectId(filters.category),
    });

    if (matchingSubcategory === 0) {
      const queryWithoutSubcategory = { ...query };
      delete queryWithoutSubcategory.subcategory;

      const productsWithCategoryOnly = await Product.countDocuments(queryWithoutSubcategory);
      if (productsWithCategoryOnly > 0) {
        stockAnalysis = await buildStockAnalysis(queryWithoutSubcategory, warehouse);
      }
    }
  }

  if (stockAnalysis.length === 0 && warehouse) {
    stockAnalysis = await buildStockAnalysis(query, undefined);
  }

  return stockAnalysis;
};

const buildProcessedProducts = async (stockAnalysis, warehouse) =>
  Promise.all(
    stockAnalysis.map(async product => {
      const totalSold = await getProductTotalSold(product._id, warehouse);

      return {
        _id: product._id,
        title: product.title,
        description: product.description,
        cost: product.cost || 0,
        price: product.price || 0,
        priceAfterDiscount: product.priceAfterDiscount,
        totalSold: totalSold || 0,
        isAvailable: product.isAvailable,
        season: product.season,
        category: product.category,
        subcategory: product.subcategory,
        createdAt: product.createdAt,
        sku: product.sku,
        barcode: product.barcode,
        stock: product.stockEntries,
        totalStock: product.totalStock || 0,
        categoryName: product.categoryName,
        subcategoryName: product.subcategoryName,
      };
    })
  );

const sortProducts = (products, sortBy, sortOrder) => {
  if (!sortBy) return products;
  const sortMultiplier = sortOrder === 'desc' ? -1 : 1;
  return [...products].sort((a, b) => {
    if (a[sortBy] < b[sortBy]) return -1 * sortMultiplier;
    if (a[sortBy] > b[sortBy]) return 1 * sortMultiplier;
    return 0;
  });
};

exports.getProductsReport = asyncHandler(async (req, res, next) => {
  const { sortBy = 'createdAt', sortOrder = 'desc', warehouse, ...filters } = req.query;

  const query = buildProductQuery(filters);
  const stockAnalysis = await resolveStockAnalysis(query, filters, warehouse);
  const processedProducts = sortProducts(await buildProcessedProducts(stockAnalysis, warehouse), sortBy, sortOrder);

  const totalStock = stockAnalysis.reduce((sum, p) => sum + (p.totalStock || 0), 0);
  const totalValue = processedProducts.reduce((sum, product) => sum + (product.totalStock || 0) * (product.cost || 0), 0);
  const formattedTotalValue = totalValue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (processedProducts.length === 0) {
    return res.status(200).json({
      status: 'success',
      results: 0,
      totalStock: 0,
      totalValue: '0.00',
      message: 'No products found matching the specified filters. Please try with different filter criteria.',
      data: [],
    });
  }

  res.status(200).json({
    status: 'success',
    results: processedProducts.length,
    totalStock,
    totalValue: formattedTotalValue,
    data: processedProducts,
  });
});

exports.exportProductsReportExcel = asyncHandler(async (req, res, next) => {
  const { sortBy = 'createdAt', sortOrder = 'desc', warehouse, ...filters } = req.query;

  const query = buildProductQuery(filters);
  const stockAnalysis = await resolveStockAnalysis(query, filters, warehouse);
  const processedProducts = sortProducts(await buildProcessedProducts(stockAnalysis, warehouse), sortBy, sortOrder);

  const totalStock = stockAnalysis.reduce((sum, p) => sum + (p.totalStock || 0), 0);
  const totalValue = processedProducts.reduce((sum, product) => sum + (product.totalStock || 0) * (product.cost || 0), 0);
  const formattedTotalValue = totalValue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const workbook = new excel.Workbook();
  const worksheet = workbook.addWorksheet('Products Report');

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

  if (processedProducts.length === 0) {
    worksheet.addRow({
      titleEn: 'No products found matching the specified filters. Please try with different filter criteria.',
      titleAr: '',
      category: '',
      subcategory: '',
    });

    worksheet.getRow(1).font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=products-report-empty.xlsx');

    await workbook.xlsx.write(res);
    return;
  }

  for (const product of processedProducts) {
    worksheet.addRow({
      titleEn: product.title?.en || '',
      titleAr: product.title?.ar || '',
      category: product.categoryName?.en || '',
      subcategory: product.subcategoryName?.en || '',
      cost: product.cost || 0,
      price: product.price || 0,
      totalSold: product.totalSold,
      totalStock: product.totalStock || 0,
      season: product.season || '',
      createdAt: product.createdAt ? new Date(product.createdAt).toLocaleDateString() : '',
    });
  }

  worksheet.addRow({});
  worksheet.addRow({
    titleEn: 'TOTAL',
    totalStock,
    cost: formattedTotalValue,
  });

  worksheet.getRow(1).font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=products-report.xlsx');

  await workbook.xlsx.write(res);
});
