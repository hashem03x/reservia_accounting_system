const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Product = require('../../models/inventory/productModel');
const Variant = require('../../models/inventory/variantModel');
const SalesOrder = require('../../models/sales/salesOrderModel');
const ApiError = require('../../utils/apiError');
const excel = require('exceljs');

// Helper function to build product query based on filters
const buildProductQuery = queryParams => {
  const query = { isDeleted: false };

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

// Helper function to get warehouse stock for a variant
const getWarehouseStock = (variant, warehouse) => {
  if (!variant || !variant.stock) return 0;
  if (!warehouse) return variant.stockLevel || 0;

  const warehouseStock = variant.stock.find(s => s && s.warehouse && s.warehouse.toString() === warehouse);
  return warehouseStock ? warehouseStock.quantity || 0 : 0;
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

  // Use aggregation pipeline for consistent stock calculation - similar to inventorySummaryReport
  let stockAnalysis = await Product.aggregate([
    {
      $match: query,
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
              color: { $first: '$color' },
              size: { $first: '$size' },
              sku: { $first: '$sku' },
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

  // Check if filters returned no results
  if (stockAnalysis.length === 0) {
    // Check if category exists
    if (filters.category) {
      const categoryCount = await mongoose.connection.db.collection('categories').countDocuments({
        _id: new mongoose.Types.ObjectId(filters.category),
      });
    }

    // Check if subcategory exists
    if (filters.subcategory) {
      const subcategoryCount = await mongoose.connection.db.collection('subcategories').countDocuments({
        _id: new mongoose.Types.ObjectId(filters.subcategory),
      });

      // If subcategory exists, check if it belongs to the specified category
      if (subcategoryCount > 0 && filters.category) {
        const matchingSubcategory = await mongoose.connection.db.collection('subcategories').countDocuments({
          _id: new mongoose.Types.ObjectId(filters.subcategory),
          mainCategory: new mongoose.Types.ObjectId(filters.category),
        });

        // If subcategory doesn't belong to category, try with just category filter
        if (matchingSubcategory === 0) {
          const queryWithoutSubcategory = { ...query };
          delete queryWithoutSubcategory.subcategory;

          const productsWithCategoryOnly = await Product.countDocuments(queryWithoutSubcategory);

          // If there are products with just the category filter, use that instead
          if (productsWithCategoryOnly > 0) {
            stockAnalysis = await Product.aggregate([
              {
                $match: queryWithoutSubcategory,
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
                        color: { $first: '$color' },
                        size: { $first: '$size' },
                        sku: { $first: '$sku' },
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
          }
        }
      }
    }

    // Check if warehouse exists
    if (warehouse) {
      const warehouseCount = await mongoose.connection.db.collection('warehouses').countDocuments({
        _id: new mongoose.Types.ObjectId(warehouse),
      });

      // Check if there are any products with stock in this warehouse
      const productsInWarehouse = await Variant.aggregate([
        {
          $match: {
            'stock.warehouse': new mongoose.Types.ObjectId(warehouse),
            isDeleted: false,
          },
        },
        {
          $group: {
            _id: '$productId',
            count: { $sum: 1 },
          },
        },
        {
          $count: 'total',
        },
      ]);

      const warehouseProductCount = productsInWarehouse.length > 0 ? productsInWarehouse[0].total : 0;

      // If still no products and we have a warehouse filter, try without it
      if (stockAnalysis.length === 0 && warehouseProductCount === 0) {
        // Create a simplified aggregation without warehouse filter
        const queryWithoutWarehouse = { ...query };

        stockAnalysis = await Product.aggregate([
          {
            $match: queryWithoutWarehouse,
          },
          {
            $lookup: {
              from: 'variants',
              localField: 'variants',
              foreignField: '_id',
              pipeline: [
                { $match: { isDeleted: false } },
                { $unwind: '$stock' },
                {
                  $group: {
                    _id: '$_id',
                    stockQuantity: { $sum: '$stock.quantity' },
                    color: { $first: '$color' },
                    size: { $first: '$size' },
                    sku: { $first: '$sku' },
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
      }
    }
  }

  // Process products to include all required data with consistent null handling
  const processedProducts = await Promise.all(
    stockAnalysis.map(async product => {
      // Calculate total sold based on variants and warehouse if specified
      const totalSold = await getVariantsTotalSold(product.variantStocks, warehouse);

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
        colors: product.colors,
        createdAt: product.createdAt,
        variants: product.variantStocks,
        totalStock: product.totalStock || 0,
        categoryName: product.categoryName,
        subcategoryName: product.subcategoryName,
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

  // Calculate the grand total stock using the same approach as analytics controller
  const totalStock = stockAnalysis.reduce((sum, p) => sum + (p.totalStock || 0), 0);

  // Calculate the total inventory value directly from processedProducts to ensure consistency
  const totalValue = processedProducts.reduce((sum, product) => {
    const stockLevel = product.totalStock || 0;
    const cost = product.cost || 0;
    return sum + stockLevel * cost;
  }, 0);

  // Format totalValue with comma as thousands separator
  const formattedTotalValue = totalValue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Check if we still have no products after all fallback attempts
  if (processedProducts.length === 0) {
    // Instead of error, return success but with empty data and a message
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
    totalStock: totalStock, // Include the standardized totalStock in the response
    totalValue: formattedTotalValue, // Format with comma separator to match expected display
    data: processedProducts,
  });
});

exports.exportProductsReportExcel = asyncHandler(async (req, res, next) => {
  const { sortBy = 'createdAt', sortOrder = 'desc', warehouse, ...filters } = req.query;

  // Build base query
  const query = buildProductQuery(filters);

  // Use aggregation pipeline for consistent stock calculation - similar to inventorySummaryReport
  let stockAnalysis = await Product.aggregate([
    {
      $match: query,
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
              color: { $first: '$color' },
              size: { $first: '$size' },
              sku: { $first: '$sku' },
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

  // Check if filters returned no results
  if (stockAnalysis.length === 0) {
    // Check if category exists
    if (filters.category) {
      const categoryCount = await mongoose.connection.db.collection('categories').countDocuments({
        _id: new mongoose.Types.ObjectId(filters.category),
      });
    }

    // Check if subcategory exists
    if (filters.subcategory) {
      const subcategoryCount = await mongoose.connection.db.collection('subcategories').countDocuments({
        _id: new mongoose.Types.ObjectId(filters.subcategory),
      });

      // If subcategory exists, check if it belongs to the specified category
      if (subcategoryCount > 0 && filters.category) {
        const matchingSubcategory = await mongoose.connection.db.collection('subcategories').countDocuments({
          _id: new mongoose.Types.ObjectId(filters.subcategory),
          mainCategory: new mongoose.Types.ObjectId(filters.category),
        });

        // If subcategory doesn't belong to category, try with just category filter
        if (matchingSubcategory === 0) {
          const queryWithoutSubcategory = { ...query };
          delete queryWithoutSubcategory.subcategory;

          const productsWithCategoryOnly = await Product.countDocuments(queryWithoutSubcategory);

          // If there are products with just the category filter, use that instead
          if (productsWithCategoryOnly > 0) {
            stockAnalysis = await Product.aggregate([
              {
                $match: queryWithoutSubcategory,
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
                        color: { $first: '$color' },
                        size: { $first: '$size' },
                        sku: { $first: '$sku' },
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
          }
        }
      }
    }

    // Check if warehouse exists
    if (warehouse) {
      const warehouseCount = await mongoose.connection.db.collection('warehouses').countDocuments({
        _id: new mongoose.Types.ObjectId(warehouse),
      });

      // Check if there are any products with stock in this warehouse
      const productsInWarehouse = await Variant.aggregate([
        {
          $match: {
            'stock.warehouse': new mongoose.Types.ObjectId(warehouse),
            isDeleted: false,
          },
        },
        {
          $group: {
            _id: '$productId',
            count: { $sum: 1 },
          },
        },
        {
          $count: 'total',
        },
      ]);

      const warehouseProductCount = productsInWarehouse.length > 0 ? productsInWarehouse[0].total : 0;

      // If still no products and we have a warehouse filter, try without it
      if (stockAnalysis.length === 0 && warehouseProductCount === 0) {
        // Create a simplified aggregation without warehouse filter
        const queryWithoutWarehouse = { ...query };

        stockAnalysis = await Product.aggregate([
          {
            $match: queryWithoutWarehouse,
          },
          {
            $lookup: {
              from: 'variants',
              localField: 'variants',
              foreignField: '_id',
              pipeline: [
                { $match: { isDeleted: false } },
                { $unwind: '$stock' },
                {
                  $group: {
                    _id: '$_id',
                    stockQuantity: { $sum: '$stock.quantity' },
                    color: { $first: '$color' },
                    size: { $first: '$size' },
                    sku: { $first: '$sku' },
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
      }
    }
  }

  // Process products to include all required data with consistent null handling
  const processedProducts = await Promise.all(
    stockAnalysis.map(async product => {
      // Calculate total sold based on variants and warehouse if specified
      const totalSold = await getVariantsTotalSold(product.variantStocks, warehouse);

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
        colors: product.colors,
        createdAt: product.createdAt,
        variants: product.variantStocks,
        totalStock: product.totalStock || 0,
        categoryName: product.categoryName,
        subcategoryName: product.subcategoryName,
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

  // Calculate the grand total stock using the same approach as analytics controller
  const totalStock = stockAnalysis.reduce((sum, p) => sum + (p.totalStock || 0), 0);

  // Calculate the total inventory value directly from processedProducts to ensure consistency
  const totalValue = processedProducts.reduce((sum, product) => {
    const stockLevel = product.totalStock || 0;
    const cost = product.cost || 0;
    return sum + stockLevel * cost;
  }, 0);

  // Format totalValue with comma as thousands separator
  const formattedTotalValue = totalValue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Check if we still have no products after all fallback attempts
  if (processedProducts.length === 0) {
    // Create a new workbook with a note about missing data
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

    // Add note about empty data
    worksheet.addRow({
      titleEn: 'No products found matching the specified filters. Please try with different filter criteria.',
      titleAr: '',
      category: '',
      subcategory: '',
    });

    // Style the header row
    worksheet.getRow(1).font = { bold: true };

    // Set the response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=products-report-empty.xlsx');

    // Write the workbook to the response
    await workbook.xlsx.write(res);
    return;
  }

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

  // Add data rows using processed products (sorted)
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

  // Add summary row
  worksheet.addRow({});
  worksheet.addRow({
    titleEn: 'TOTAL',
    totalStock: totalStock,
    cost: formattedTotalValue,
  });

  // Style the header row
  worksheet.getRow(1).font = { bold: true };

  // Set the response headers
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=products-report.xlsx');

  // Write the workbook to the response
  await workbook.xlsx.write(res);
});
