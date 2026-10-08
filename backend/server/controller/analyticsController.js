const asyncHandler = require('express-async-handler');
const Order = require('../models/sales/salesOrderModel');
const OrderReturn = require('../models/sales/salesOrderReturnModel');
const Product = require('../models/inventory/productModel');
const User = require('../models/userModel');
const Warehouse = require('../models/inventory/warehouseModel');
const Expense = require('../models/expense/expenseModel');
const FixedAsset = require('../models/fixedAssets');
const { getNetProfit } = require('./reports/incomeStatementController');
const mongoose = require('mongoose');
const { ORDER_TOTAL_AMOUNT_EXPR } = require('../utils/orderTotals');

// Order-value statistics use each order's final Total Amount (subtotal + VAT - withholding, see
// utils/orderTotals.js); "incl. shipping" figures add the separately-tracked shipping cost on top.
// Line-item based revenue/COGS/profit metrics below are untouched (they are net-of-tax by nature).
const ORDER_TOTAL = ORDER_TOTAL_AMOUNT_EXPR;
const ORDER_TOTAL_PLUS_SHIPPING = { $add: [ORDER_TOTAL_AMOUNT_EXPR, { $ifNull: ['$shippingCost', 0] }] };

// Get Sales Overview
exports.getSalesOverview = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const start = startDate ? new Date(startDate) : new Date(new Date().setFullYear(new Date().getFullYear() - 1));
  const end = endDate ? new Date(endDate) : new Date();

  const totalSales = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        orderStatus: { $ne: 'cancelled' }, // Exclude cancelled orders
      },
    },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: ORDER_TOTAL_PLUS_SHIPPING }, // Include shipping in total
        count: { $sum: 1 },
        totalShipping: { $sum: '$shippingCost' },
        totalWithoutShipping: { $sum: ORDER_TOTAL },
      },
    },
  ]);

  const dailySales = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        orderStatus: { $ne: 'cancelled' }, // Exclude cancelled orders
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        totalAmount: { $sum: ORDER_TOTAL_PLUS_SHIPPING }, // Include shipping in total
        totalWithoutShipping: { $sum: ORDER_TOTAL },
        totalShipping: { $sum: '$shippingCost' },
        count: { $sum: 1 },
        orders: {
          $push: {
            orderId: '$_id',
            items: '$items',
            customer: '$customer',
            orderSource: '$orderSource',
            orderStatus: '$orderStatus',
          },
        },
      },
    },
    {
      $sort: { _id: -1 },
    },
    {
      $limit: 30,
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      totalSales: totalSales[0] || {
        _id: null,
        totalAmount: 0,
        totalWithoutShipping: 0,
        totalShipping: 0,
        count: 0,
      },
      dailySales: dailySales || [],
    },
  });
});

// Get Top Selling Products
exports.getTopSellingProducts = asyncHandler(async (req, res) => {
  const { warehouseId } = req.query;

  // A product carries its own stock directly now (see docs/entities/products.md) - filtering by
  // warehouse is a plain match on the embedded `stock` array, no separate Variant lookup needed.
  const matchStage = { isDeleted: false, ...(warehouseId ? { 'stock.warehouse': new mongoose.Types.ObjectId(warehouseId) } : {}) };

  const topProducts = await Product.aggregate([
    {
      $match: matchStage,
    },
    {
      $lookup: {
        from: 'salesorders',
        let: { productId: '$_id' },
        pipeline: [
          {
            $match: {
              ...(warehouseId ? { warehouse: new mongoose.Types.ObjectId(warehouseId) } : {}),
              orderStatus: { $ne: 'cancelled' },
            },
          },
          { $unwind: '$items' },
          {
            $match: {
              $expr: { $eq: ['$items.product', '$$productId'] },
            },
          },
          {
            $group: {
              _id: null,
              totalSold: { $sum: { $subtract: ['$items.starterQuantity', '$items.returnedQuantity'] } },
              revenue: {
                $sum: {
                  $multiply: [{ $subtract: ['$items.starterQuantity', '$items.returnedQuantity'] }, '$items.unitPriceAfterDiscount'],
                },
              },
            },
          },
        ],
        as: 'salesData',
      },
    },
    {
      $addFields: {
        salesInfo: { $arrayElemAt: ['$salesData', 0] },
      },
    },
    {
      $project: {
        _id: 1,
        title: 1,
        price: 1,
        totalSold: { $ifNull: ['$salesInfo.totalSold', 0] },
        revenue: { $ifNull: ['$salesInfo.revenue', 0] },
        stockEntriesCount: { $size: { $ifNull: ['$stock', []] } },
      },
    },
    {
      $sort: { totalSold: -1 },
    },
    {
      $limit: 10,
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: topProducts,
  });
});

// Get Revenue by Category
exports.getRevenueByCategory = asyncHandler(async (req, res) => {
  const { startDate, endDate, warehouseId } = req.query;
  const start = startDate ? new Date(startDate) : new Date(new Date().setFullYear(new Date().getFullYear() - 1));
  const end = endDate ? new Date(endDate) : new Date();

  const matchStage = {
    createdAt: { $gte: start, $lte: end },
    orderStatus: { $ne: 'cancelled' },
  };

  if (warehouseId) {
    matchStage.warehouse = new mongoose.Types.ObjectId(warehouseId);
  }

  const revenueByCategory = await Order.aggregate([
    {
      $match: matchStage,
    },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'productInfo',
      },
    },
    { $unwind: '$productInfo' },
    {
      $lookup: {
        from: 'categories',
        localField: 'productInfo.category',
        foreignField: '_id',
        as: 'categoryInfo',
      },
    },
    { $unwind: '$categoryInfo' },
    {
      $group: {
        _id: '$categoryInfo._id',
        categoryName: { $first: '$categoryInfo.name' },
        totalRevenue: {
          $sum: {
            $multiply: ['$items.unitPriceAfterDiscount', { $subtract: ['$items.starterQuantity', { $ifNull: ['$items.returnedQuantity', 0] }] }],
          },
        },
        totalQuantitySold: {
          $sum: { $subtract: ['$items.starterQuantity', { $ifNull: ['$items.returnedQuantity', 0] }] },
        },
        totalOrders: { $addToSet: '$_id' },
        products: {
          $addToSet: {
            productId: '$productInfo._id',
            productName: '$productInfo.title',
            price: '$productInfo.price',
            priceAfterDiscount: '$productInfo.priceAfterDiscount',
            isAvailable: '$productInfo.isAvailable',
            quantitySold: {
              $sum: { $subtract: ['$items.starterQuantity', '$items.returnedQuantity'] },
            },
          },
        },
      },
    },
    {
      $project: {
        _id: 1,
        categoryName: 1,
        totalRevenue: 1,
        totalQuantitySold: 1,
        numberOfOrders: { $size: '$totalOrders' },
        numberOfProducts: { $size: '$products' },
        products: 1,
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);

  res.status(200).json({
    status: 'success',
    data: revenueByCategory || [],
    summary:
      revenueByCategory.length > 0
        ? {
            totalCategories: revenueByCategory.length,
            totalRevenue: revenueByCategory.reduce((sum, cat) => sum + cat.totalRevenue, 0),
            totalQuantitySold: revenueByCategory.reduce((sum, cat) => sum + cat.totalQuantitySold, 0),
          }
        : {
            totalCategories: 0,
            totalRevenue: 0,
            totalQuantitySold: 0,
          },
  });
});

// Get Customer Insights
exports.getCustomerInsights = asyncHandler(async (req, res) => {
  const { startDate, endDate, warehouseId } = req.query;

  // Default to last week if no date range is provided
  const defaultStartDate = new Date();
  defaultStartDate.setDate(defaultStartDate.getDate() - 7); // Last 7 days

  const start = startDate ? new Date(startDate) : defaultStartDate;
  const end = endDate ? new Date(endDate) : new Date();

  // Get customer counts by type
  const [totalCustomers, onlineCustomers, offlineCustomers, newCustomers] = await Promise.all([
    User.countDocuments({ role: 'user', isDeleted: false }),
    User.countDocuments({ role: 'user', type: 'online', isDeleted: false }),
    User.countDocuments({ role: 'user', type: 'offline', isDeleted: false }),
    User.countDocuments({
      role: 'user',
      createdAt: { $gte: start, $lte: end },
      isDeleted: false,
    }),
  ]);

  // Create match stage for orders
  const matchStage = {
    createdAt: { $gte: start, $lte: end },
    orderStatus: { $ne: 'cancelled' }, // Exclude cancelled orders
  };

  // Add warehouse filter if warehouseId is provided
  if (warehouseId) {
    matchStage.warehouse = new mongoose.Types.ObjectId(warehouseId);
  }

  // Get all active customers with their spending data
  const allActiveCustomers = await Order.aggregate([
    {
      $match: matchStage,
    },
    {
      $group: {
        _id: '$customer',
        orderCount: { $sum: 1 },
        totalSpent: { $sum: ORDER_TOTAL },
        averageOrderValue: { $avg: ORDER_TOTAL },
        lastOrderDate: { $max: '$createdAt' },
        orderSources: { $addToSet: '$orderSource' },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'customerInfo',
      },
    },
    { $unwind: '$customerInfo' },
    {
      $match: {
        'customerInfo.isDeleted': false,
        'customerInfo.role': 'user',
      },
    },
    {
      $project: {
        _id: 1,
        name: '$customerInfo.name',
        phone: '$customerInfo.phone',
        type: '$customerInfo.type',
        totalOrders: '$orderCount',
        totalSpent: 1,
        averageOrderValue: 1,
        lastOrderDate: 1,
        orderSources: 1,
        customerStatus: {
          $switch: {
            branches: [
              { case: { $gte: ['$totalSpent', 50000] }, then: 'VIP' },
              { case: { $gte: ['$totalSpent', 25000] }, then: 'Premium' },
              { case: { $gte: ['$totalSpent', 10000] }, then: 'Regular' },
            ],
            default: 'New',
          },
        },
      },
    },
  ]);

  const activeCustomers = allActiveCustomers.length;

  // Get top 10 customers for the top customers list
  const topCustomers = [...allActiveCustomers].sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 10);

  // Create match stage for order source counts
  const orderSourceMatchStage = {
    createdAt: { $gte: start, $lte: end },
    paymentStatus: { $in: ['paid', 'partial'] },
  };

  // Add warehouse filter if warehouseId is provided
  if (warehouseId) {
    orderSourceMatchStage.warehouse = new mongoose.Types.ObjectId(warehouseId);
  }

  // Calculate total orders by source
  const orderSourceCounts = await Order.aggregate([
    {
      $match: orderSourceMatchStage,
    },
    {
      $group: {
        _id: '$orderSource',
        count: { $sum: 1 },
      },
    },
  ]);

  // Calculate customer metrics based on all active customers
  const customerMetrics =
    allActiveCustomers.length > 0
      ? {
          averageOrderValue: allActiveCustomers.reduce((acc, cur) => acc + cur.averageOrderValue, 0) / allActiveCustomers.length,
          averageOrdersPerCustomer: allActiveCustomers.reduce((acc, cur) => acc + cur.totalOrders, 0) / allActiveCustomers.length,
          totalRevenue: allActiveCustomers.reduce((acc, cur) => acc + cur.totalSpent, 0),
          customerCategories: {
            vip: allActiveCustomers.filter(c => c.customerStatus === 'VIP').length,
            premium: allActiveCustomers.filter(c => c.customerStatus === 'Premium').length,
            regular: allActiveCustomers.filter(c => c.customerStatus === 'Regular').length,
            new: allActiveCustomers.filter(c => c.customerStatus === 'New').length,
          },
          orderSources: orderSourceCounts.reduce(
            (acc, source) => {
              acc[source._id] = source.count;
              return acc;
            },
            { website: 0, cashier: 0 }
          ),
        }
      : {
          averageOrderValue: 0,
          averageOrdersPerCustomer: 0,
          totalRevenue: 0,
          customerCategories: {
            vip: 0,
            premium: 0,
            regular: 0,
            new: 0,
          },
          orderSources: {
            website: 0,
            cashier: 0,
          },
        };

  res.status(200).json({
    status: 'success',
    data: {
      activeCustomers,
      totalCustomers,
      onlineCustomers,
      offlineCustomers,
      newCustomers,
      topCustomers,
      customerMetrics,
    },
  });
});

// Get New Customers with detailed information
exports.getNewCustomers = asyncHandler(async (req, res) => {
  const { startDate, endDate, page = 1, limit = 10, type, search } = req.query;

  // Default to last week if no date range is provided
  const defaultStartDate = new Date();
  defaultStartDate.setDate(defaultStartDate.getDate() - 7); // Last 7 days

  const start = startDate ? new Date(startDate) : defaultStartDate;
  const end = endDate ? new Date(endDate) : new Date();

  // Build query for new customers
  const query = {
    role: 'user',
    createdAt: { $gte: start, $lte: end },
    isDeleted: false,
  };

  // Add type filter if provided
  if (type && ['online', 'offline'].includes(type)) {
    query.type = type;
  }

  // Add search filter if provided
  if (search) {
    query.$or = [{ name: { $regex: search, $options: 'i' } }, { phone: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }];
  }

  // Calculate skip value for pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Get new customers with pagination
  const [newCustomers, totalCount] = await Promise.all([
    User.find(query).select('name phone email type createdAt addresses').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
    User.countDocuments(query),
  ]);

  // Get additional statistics
  const [totalNewCustomers, onlineNewCustomers, offlineNewCustomers] = await Promise.all([
    User.countDocuments({
      role: 'user',
      createdAt: { $gte: start, $lte: end },
      isDeleted: false,
    }),
    User.countDocuments({
      role: 'user',
      type: 'online',
      createdAt: { $gte: start, $lte: end },
      isDeleted: false,
    }),
    User.countDocuments({
      role: 'user',
      type: 'offline',
      createdAt: { $gte: start, $lte: end },
      isDeleted: false,
    }),
  ]);

  // Calculate pagination info
  const totalPages = Math.ceil(totalCount / parseInt(limit));
  const hasNextPage = parseInt(page) < totalPages;
  const hasPrevPage = parseInt(page) > 1;

  res.status(200).json({
    status: 'success',
    data: {
      newCustomers,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        hasNextPage,
        hasPrevPage,
        limit: parseInt(limit),
      },
      statistics: {
        totalNewCustomers,
        onlineNewCustomers,
        offlineNewCustomers,
        dateRange: {
          start,
          end,
        },
      },
    },
  });
});

// Get Inventory Status
exports.getInventoryStatus = asyncHandler(async (req, res) => {
  // A product carries its own per-warehouse stock directly now - no separate Variant collection
  // to join against.
  const inventoryStatus = await Product.aggregate([
    {
      $match: { isDeleted: false },
    },
    {
      $unwind: '$stock',
    },
    {
      $group: {
        _id: '$_id',
        productTitle: { $first: '$title' },
        totalStock: { $sum: '$stock.quantity' },
        stockByWarehouse: {
          $push: {
            sku: '$sku',
            barcode: '$barcode',
            stockQuantity: '$stock.quantity',
            warehouse: '$stock.warehouse',
          },
        },
      },
    },
    {
      $lookup: {
        from: 'warehouses',
        localField: 'stockByWarehouse.warehouse',
        foreignField: '_id',
        as: 'warehouseDetails',
      },
    },
    {
      $project: {
        _id: 1,
        productTitle: 1,
        totalStock: 1,
        stockByWarehouse: 1,
        warehouseCount: { $size: '$warehouseDetails' },
      },
    },
  ]);

  res.status(200).json({
    status: 'success',
    data: inventoryStatus,
  });
});

exports.getWarehousesBalance = async (req, res) => {
  try {
    const { startDate, endDate, warehouseId } = req.query;

    // Build query object
    let query = {};
    if (warehouseId) {
      query._id = warehouseId;
    }

    // Add date filters if provided
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Get warehouses data
    const warehouses = await Warehouse.find(query);
    // console.log('warehouses____>>> ', warehouses);
    // Initialize balance summary with all currencies set to 0
    const balanceSummary = {
      totalBalance: 0,
      totalBalanceForAllCurrencies: 0,
      USD: 0,
      EUR: 0,
      TRY: 0,
      CNY: 0,
    };

    // Calculate totals
    warehouses.forEach(warehouse => {
      // Add main balance
      balanceSummary.totalBalance += warehouse.balance || 0;
      balanceSummary.totalBalanceForAllCurrencies += warehouse.totalBalanceEGP || 0;

      // Add currency balances
      ['usd', 'eur', 'try', 'cny'].forEach(currency => {
        balanceSummary[currency.toUpperCase()] += warehouse[currency]?.balance || 0;
      });
    });

    res.status(200).json({
      status: 'success',
      data: balanceSummary,
    });
  } catch (error) {
    res.status(400).json({
      status: 'fail',
      message: error.message,
    });
  }
};

// Helper function to get inventory total value
const getInventoryTotalValue = async (startDate, endDate, warehouseId) => {
  const query = { isDeleted: false };

  if (startDate && endDate) {
    query.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }

  const products = await Product.find(query).select('stock cost').lean();

  let totalValue = 0;

  for (const product of products) {
    const stockLevel = (product.stock || []).reduce((sum, stockItem) => {
      if (warehouseId) {
        return stockItem.warehouse.toString() === warehouseId ? sum + stockItem.quantity : sum;
      }
      return sum + stockItem.quantity;
    }, 0);

    totalValue += stockLevel * (product.cost || 0);
  }

  return totalValue;
};

// Get Sales by Time Period
exports.getSalesByTimePeriod = asyncHandler(async (req, res) => {
  const { startDate, endDate, groupBy = 'day', warehouseId } = req.query;
  const start = startDate ? new Date(startDate) : new Date(new Date().setFullYear(new Date().getFullYear() - 1));
  const end = endDate ? new Date(endDate) : new Date();

  // Validate and set date format based on groupBy parameter
  let dateFormat;
  let quarterGrouping = false;
  switch (groupBy.toLowerCase()) {
    case 'month':
      dateFormat = '%Y-%m';
      break;
    case 'year':
      dateFormat = '%Y';
      break;
    case 'week':
      dateFormat = '%Y-%m-%d';
      break;
    case 'quarter':
      quarterGrouping = true;
      dateFormat = '%Y-%m-%d';
      break;
    default: // day
      dateFormat = '%Y-%m-%d';
  }

  const matchStage = {
    createdAt: { $gte: start, $lte: end },
    orderStatus: { $ne: 'cancelled' }, // Exclude cancelled orders
  };

  // Add warehouse filter if specified
  if (warehouseId && warehouseId !== 'all') {
    matchStage.warehouse = new mongoose.Types.ObjectId(warehouseId);
  }

  // For week grouping, we need to find the date of the Monday of each week
  const groupIdStage = quarterGrouping
    ? {
        year: { $year: '$createdAt' },
        quarter: {
          $ceil: {
            $divide: [{ $month: '$createdAt' }, 3],
          },
        },
      }
    : groupBy.toLowerCase() === 'week'
    ? {
        // For week grouping, calculate the date of the Monday of the week
        $dateFromParts: {
          isoWeekYear: { $isoWeekYear: '$createdAt' },
          isoWeek: { $isoWeek: '$createdAt' },
          isoDayOfWeek: 1, // Monday is 1 in ISO
        },
      }
    : { $dateToString: { format: dateFormat, date: '$createdAt' } };

  const salesByPeriod = await Order.aggregate([
    {
      $match: matchStage,
    },
    {
      $facet: {
        // First, count the total number of unique orders per period
        orderCounts: [
          {
            $group: {
              _id: groupIdStage,
              totalOrders: { $sum: 1 },
            },
          },
        ],
        // Then calculate sales metrics with unwound items
        salesMetrics: [
          { $unwind: '$items' },
          {
            $group: {
              _id: groupIdStage,
              totalAmount: {
                $sum: {
                  $multiply: [{ $subtract: ['$items.starterQuantity', { $ifNull: ['$items.returnedQuantity', 0] }] }, '$items.unitPriceAfterDiscount'],
                },
              },
              totalShipping: { $sum: '$shippingCost' },
              paidAmount: { $sum: '$paidAmount' },
              totalCOGS: {
                $sum: {
                  $multiply: [{ $subtract: ['$items.starterQuantity', { $ifNull: ['$items.returnedQuantity', 0] }] }, { $ifNull: ['$items.costWhenSold', 0] }],
                },
              },
            },
          },
        ],
      },
    },
    // Merge the results
    {
      $project: {
        mergedResults: {
          $map: {
            input: '$salesMetrics',
            as: 'salesMetric',
            in: {
              $mergeObjects: [
                '$$salesMetric',
                {
                  totalOrders: {
                    $let: {
                      vars: {
                        matchingOrderCount: {
                          $arrayElemAt: [
                            {
                              $filter: {
                                input: '$orderCounts',
                                as: 'orderCount',
                                cond: { $eq: ['$$orderCount._id', '$$salesMetric._id'] },
                              },
                            },
                            0,
                          ],
                        },
                      },
                      in: { $ifNull: ['$$matchingOrderCount.totalOrders', 0] },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
    { $unwind: '$mergedResults' },
    { $replaceRoot: { newRoot: '$mergedResults' } },
    ...(quarterGrouping
      ? [
          {
            $project: {
              _id: 0,
              date: {
                $concat: [{ $toString: '$_id.year' }, '-Q', { $toString: '$_id.quarter' }],
              },
              totalAmount: 1,
              totalOrders: 1,
              totalShipping: 1,
              paidAmount: 1,
              totalCOGS: 1,
              pendingPayments: {
                $subtract: ['$totalAmount', '$paidAmount'],
              },
            },
          },
        ]
      : []),
    {
      $project: {
        _id: 0,
        date: '$_id',
        totalAmount: 1,
        totalOrders: 1,
        totalShipping: 1,
        paidAmount: 1,
        totalCOGS: 1,
        pendingPayments: {
          $subtract: ['$totalAmount', '$paidAmount'],
        },
      },
    },
    { $sort: { date: 1 } },
  ]);

  // Get expenses for the period
  const expenses = await Expense.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        ...(warehouseId && warehouseId !== 'all' ? { 'paymentId.warehouseId': warehouseId } : {}),
      },
    },
    {
      $lookup: {
        from: 'payments',
        localField: 'paymentId',
        foreignField: '_id',
        as: 'payment',
      },
    },
    {
      $unwind: '$payment',
    },
    {
      $group: {
        _id: quarterGrouping
          ? {
              year: { $year: '$createdAt' },
              quarter: {
                $ceil: {
                  $divide: [{ $month: '$createdAt' }, 3],
                },
              },
            }
          : groupBy.toLowerCase() === 'week'
          ? {
              $dateFromParts: {
                isoWeekYear: { $isoWeekYear: '$createdAt' },
                isoWeek: { $isoWeek: '$createdAt' },
                isoDayOfWeek: 1, // Monday is 1 in ISO
              },
            }
          : { $dateToString: { format: dateFormat, date: '$createdAt' } },
        totalExpenses: { $sum: '$payment.amountPaid' },
      },
    },
    ...(quarterGrouping
      ? [
          {
            $project: {
              _id: 0,
              date: {
                $concat: [{ $toString: '$_id.year' }, '-Q', { $toString: '$_id.quarter' }],
              },
              totalExpenses: 1,
            },
          },
        ]
      : []),
    { $sort: { date: 1 } },
  ]);

  // Create a map of expenses by date
  const expensesByDate = new Map(expenses.map(e => [e.date, e.totalExpenses]));
  const incomeStatement = await getNetProfit(endDate, warehouseId, startDate);
  // console.log('incomeStatement__>>> 😶‍🌫️😶‍🌫️😶‍🌫️', incomeStatement);
  // Calculate summary statistics
  const summary = await salesByPeriod.reduce(
    async (acc, period) => {
      const resolvedAcc = await acc;
      const periodExpenses = expensesByDate.get(period.date) || 0;

      resolvedAcc.totalSales = incomeStatement.sales.current;
      resolvedAcc.totalCOGS = incomeStatement.cogs.current;
      resolvedAcc.totalExpenses = incomeStatement.expenses.current.total;
      resolvedAcc.grossProfit = incomeStatement.grossProfit.current;
      resolvedAcc.netProfit = incomeStatement.netProfit.current;
      resolvedAcc.totalOrders += period.totalOrders;
      // resolvedAcc.totalPaid += period.paidAmount;
      // resolvedAcc.totalPending += period.pendingPayments;
      return resolvedAcc;
    },
    Promise.resolve({
      totalSales: 0,
      totalCOGS: 0,
      grossProfit: 0,
      totalExpenses: 0,
      netProfit: 0,
      totalOrders: 0,
      // totalPaid: 0,
      // totalPending: 0,
    })
  );

  // console.log('summary__>>> 😶‍🌫️😶‍🌫️😶‍🌫️', summary);
  // Get total book value from fixed assets
  const fixedAssetsQuery = {};
  if (warehouseId) {
    fixedAssetsQuery.warehouseId = new mongoose.Types.ObjectId(warehouseId);
  }
  if (startDate && endDate) {
    fixedAssetsQuery.createdAt = { $gte: start, $lte: end };
  }

  const fixedAssets = await FixedAsset.find(fixedAssetsQuery).lean();
  const totalBookValue = fixedAssets.reduce((sum, asset) => sum + (asset.bookValue || 0), 0);

  // Get total inventory value
  const totalValue = await getInventoryTotalValue(startDate, endDate, warehouseId);

  res.status(200).json({
    status: 'success',
    data: {
      timePeriod: {
        start,
        end,
        groupBy,
        warehouseId,
      },
      salesByPeriod: salesByPeriod.map(period => ({
        ...period,
        expenses: expensesByDate.get(period.date) || 0,
        grossProfit: period.totalAmount - period.totalCOGS,
        netProfit: period.totalAmount - period.totalShipping - period.totalCOGS - (expensesByDate.get(period.date) || 0),
      })),
      totalBookValue,
      totalValue,
      summary: {
        ...summary,
        totalBookValue,
        totalValue,
      },
    },
  });
});

// Get Product Performance
exports.getProductPerformance = asyncHandler(async (req, res) => {
  const { warehouseId, startDate, endDate } = req.query;

  // Set default date range if not provided (last year to now)
  const start = startDate ? new Date(startDate) : new Date(new Date().setFullYear(new Date().getFullYear() - 1));
  const end = endDate ? new Date(endDate) : new Date();

  // Ensure end date includes the entire day
  end.setHours(23, 59, 59, 999);

  const productPerformance = await Product.aggregate([
    {
      $match: {
        isDeleted: false,
        // A product carries its own stock directly now - filtering by warehouse is a plain match
        // on the embedded `stock` array, no separate Variant lookup needed.
        ...(warehouseId ? { 'stock.warehouse': new mongoose.Types.ObjectId(warehouseId) } : {}),
      },
    },
    {
      $lookup: {
        from: 'salesorders',
        let: { productId: '$_id' },
        pipeline: [
          {
            $match: {
              ...(warehouseId ? { warehouse: new mongoose.Types.ObjectId(warehouseId) } : {}),
              orderStatus: { $ne: 'cancelled' },
              createdAt: { $gte: start, $lte: end },
            },
          },
          { $unwind: '$items' },
          {
            $match: {
              $expr: { $eq: ['$items.product', '$$productId'] },
            },
          },
          {
            $group: {
              _id: null,
              totalSold: { $sum: { $subtract: ['$items.starterQuantity', '$items.returnedQuantity'] } },
              revenue: {
                $sum: {
                  $multiply: [{ $subtract: ['$items.starterQuantity', '$items.returnedQuantity'] }, '$items.unitPriceAfterDiscount'],
                },
              },
            },
          },
        ],
        as: 'salesData',
      },
    },
    {
      $project: {
        _id: 1,
        title: 1,
        totalSold: { $ifNull: [{ $arrayElemAt: ['$salesData.totalSold', 0] }, 0] },
        revenue: { $ifNull: [{ $arrayElemAt: ['$salesData.revenue', 0] }, 0] },
        averageRating: '$ratingsAverage',
        reviewCount: '$ratingsQuantity',
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: 20 },
  ]);

  res.status(200).json({
    status: 'success',
    data: productPerformance,
  });
});

// Get User Acquisition and Retention
exports.getUserAcquisitionAndRetention = asyncHandler(async (req, res) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const newUsers = await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });
  const activeUsers = await Order.distinct('user', { createdAt: { $gte: thirtyDaysAgo } }).length;
  const totalUsers = await User.countDocuments();
  const retentionRate = (activeUsers / totalUsers) * 100;

  const userGrowth = await User.aggregate([
    {
      $match: { createdAt: { $gte: ninetyDaysAgo } },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        newUsers: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      newUsers,
      activeUsers,
      totalUsers,
      retentionRate,
      userGrowth,
    },
  });
});

// Get Order Statistics
exports.getOrderStatistics = asyncHandler(async (req, res) => {
  const { startDate, endDate, warehouseId } = req.query;
  const start = startDate ? new Date(startDate) : new Date(new Date().setFullYear(new Date().getFullYear() - 1));
  const end = endDate ? new Date(endDate) : new Date();

  const matchStage = {
    createdAt: { $gte: start, $lte: end },
  };

  if (warehouseId) {
    matchStage.warehouse = new mongoose.Types.ObjectId(warehouseId);
  }

  // Get basic order stats including financial metrics
  const orderStats = await Order.aggregate([
    {
      $match: matchStage,
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        maxOrderValue: { $max: ORDER_TOTAL },
        minOrderValue: { $min: ORDER_TOTAL },
        averageOrderValue: { $avg: ORDER_TOTAL },
        totalRevenue: { $sum: ORDER_TOTAL },
        totalShippingCost: { $sum: '$shippingCost' },
        totalPaidAmount: { $sum: '$paidAmount' },
        pendingPayments: {
          $sum: {
            $subtract: [ORDER_TOTAL, { $ifNull: ['$paidAmount', 0] }],
          },
        },
      },
    },
  ]);

  // Get orders by delivery status
  const ordersByDeliveryStatus = await Order.aggregate([
    {
      $match: matchStage,
    },
    {
      $group: {
        _id: '$orderStatus',
        count: { $sum: 1 },
        totalAmount: { $sum: ORDER_TOTAL },
      },
    },
    {
      $project: {
        status: {
          $switch: {
            branches: [
              { case: { $eq: ['$_id', 'pending'] }, then: 'Pending' },
              { case: { $eq: ['$_id', 'delivered'] }, then: 'Delivered' },
              { case: { $eq: ['$_id', 'cancelled'] }, then: 'Cancelled' },
            ],
            default: 'Pending',
          },
        },
        count: 1,
        totalAmount: 1,
        _id: 0,
      },
    },
    { $sort: { count: -1 } },
  ]);

  // Get orders by payment status
  const ordersByPaymentStatus = await Order.aggregate([
    {
      $match: matchStage,
    },
    {
      $group: {
        _id: '$paymentStatus',
        count: { $sum: 1 },
        totalAmount: { $sum: ORDER_TOTAL },
      },
    },
    {
      $project: {
        status: {
          $switch: {
            branches: [
              { case: { $eq: ['$_id', 'unpaid'] }, then: 'Unpaid' },
              { case: { $eq: ['$_id', 'partial'] }, then: 'Partially Paid' },
              { case: { $eq: ['$_id', 'paid'] }, then: 'Fully Paid' },
            ],
            default: 'Unpaid',
          },
        },
        count: 1,
        totalAmount: 1,
        _id: 0,
      },
    },
    { $sort: { count: -1 } },
  ]);

  // Get orders by source
  const ordersBySource = await Order.aggregate([
    {
      $match: matchStage,
    },
    {
      $group: {
        _id: '$orderSource',
        count: { $sum: 1 },
        totalAmount: { $sum: ORDER_TOTAL },
      },
    },
    {
      $project: {
        source: {
          $switch: {
            branches: [
              { case: { $eq: ['$_id', 'website'] }, then: 'Website' },
              { case: { $eq: ['$_id', 'cashier'] }, then: 'Cashier' },
            ],
            default: 'Unknown',
          },
        },
        count: 1,
        totalAmount: 1,
        _id: 0,
      },
    },
    { $sort: { count: -1 } },
  ]);

  // Get return statistics
  const returnStats = await OrderReturn.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        ...(warehouseId && { warehouseId: new mongoose.Types.ObjectId(warehouseId) }),
      },
    },
    {
      $group: {
        _id: null,
        totalReturns: { $sum: 1 },
        totalReturnAmount: { $sum: '$returnedAmount' },
      },
    },
  ]);

  const stats = orderStats[0] || {
    _id: null,
    totalOrders: 0,
    maxOrderValue: 0,
    minOrderValue: 0,
    averageOrderValue: 0,
    totalRevenue: 0,
    totalShippingCost: 0,
    totalPaidAmount: 0,
    pendingPayments: 0,
  };

  const returnStatsData = returnStats[0] || {
    _id: null,
    totalReturns: 0,
    totalReturnAmount: 0,
  };

  res.status(200).json({
    status: 'success',
    data: {
      orderStats: {
        ...stats,
        netRevenue: stats.totalRevenue - returnStatsData.totalReturnAmount,
      },
      ordersByDeliveryStatus,
      ordersByPaymentStatus,
      ordersBySource,
      returnStats: returnStatsData,
      dateRange: {
        start,
        end,
      },
    },
  });
});

// Get Sales by Category
exports.getSalesByCategory = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const start = startDate ? new Date(startDate) : new Date(new Date().setFullYear(new Date().getFullYear() - 1));
  const end = endDate ? new Date(endDate) : new Date();

  const salesByCategory = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        orderStatus: { $ne: 'cancelled' },
      },
    },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: '$product' },
    {
      $lookup: {
        from: 'categories',
        localField: 'product.category',
        foreignField: '_id',
        as: 'category',
      },
    },
    { $unwind: '$category' },
    {
      $group: {
        _id: '$category._id',
        categoryName: { $first: '$category.name' },
        categorySlug: { $first: '$category.slug' },
        totalRevenue: {
          $sum: {
            $multiply: ['$items.unitPriceAfterDiscount', { $subtract: ['$items.starterQuantity', { $ifNull: ['$items.returnedQuantity', 0] }] }],
          },
        },
        totalQuantitySold: {
          $sum: { $subtract: ['$items.starterQuantity', { $ifNull: ['$items.returnedQuantity', 0] }] },
        },
        uniqueOrders: { $addToSet: '$_id' },
        uniqueProducts: { $addToSet: '$product._id' },
      },
    },
    {
      $project: {
        _id: 1,
        categoryName: 1,
        categorySlug: 1,
        totalRevenue: 1,
        totalQuantitySold: 1,
        numberOfOrders: { $size: '$uniqueOrders' },
        numberOfProducts: { $size: '$uniqueProducts' },
        averageOrderValue: { $divide: ['$totalRevenue', { $size: '$uniqueOrders' }] },
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);

  const summary = {
    totalCategories: salesByCategory.length,
    totalRevenue: salesByCategory.reduce((sum, cat) => sum + cat.totalRevenue, 0),
    totalQuantitySold: salesByCategory.reduce((sum, cat) => sum + cat.totalQuantitySold, 0),
    totalOrders: salesByCategory.reduce((sum, cat) => sum + cat.numberOfOrders, 0),
    averageOrderValue: salesByCategory.length
      ? salesByCategory.reduce((sum, cat) => sum + cat.totalRevenue, 0) / salesByCategory.reduce((sum, cat) => sum + cat.numberOfOrders, 0)
      : 0,
  };

  res.status(200).json({
    status: 'success',
    data: salesByCategory,
    summary,
  });
});

// Get Sales by SubCategory
exports.getSalesBySubCategory = asyncHandler(async (req, res) => {
  const { startDate, endDate, warehouseId } = req.query;
  const start = startDate ? new Date(startDate) : new Date(new Date().setFullYear(new Date().getFullYear() - 1));
  const end = endDate ? new Date(endDate) : new Date();

  const matchStage = {
    createdAt: { $gte: start, $lte: end },
    orderStatus: { $ne: 'cancelled' },
  };

  if (warehouseId) {
    matchStage.warehouse = new mongoose.Types.ObjectId(warehouseId);
  }

  const salesBySubCategory = await Order.aggregate([
    {
      $match: matchStage,
    },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'products',
        localField: 'items.product',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: '$product' },
    {
      $lookup: {
        from: 'subcategories',
        localField: 'product.subcategory',
        foreignField: '_id',
        as: 'subcategoryInfo',
      },
    },
    { $unwind: '$subcategoryInfo' },
    {
      $lookup: {
        from: 'categories',
        localField: 'subcategoryInfo.mainCategory',
        foreignField: '_id',
        as: 'categoryInfo',
      },
    },
    { $unwind: '$categoryInfo' },
    {
      $group: {
        _id: '$subcategoryInfo._id',
        subcategoryName: { $first: '$subcategoryInfo.name' },
        subcategorySlug: { $first: '$subcategoryInfo.slug' },
        categoryId: { $first: '$categoryInfo._id' },
        categoryName: { $first: '$categoryInfo.name' },
        categorySlug: { $first: '$categoryInfo.slug' },
        totalRevenue: {
          $sum: {
            $multiply: ['$items.unitPriceAfterDiscount', { $subtract: ['$items.starterQuantity', { $ifNull: ['$items.returnedQuantity', 0] }] }],
          },
        },
        totalQuantitySold: {
          $sum: { $subtract: ['$items.starterQuantity', { $ifNull: ['$items.returnedQuantity', 0] }] },
        },
        uniqueOrders: { $addToSet: '$_id' },
        uniqueProducts: { $addToSet: '$product._id' },
      },
    },
    {
      $group: {
        _id: '$categoryId',
        categoryName: { $first: '$categoryName' },
        categorySlug: { $first: '$categorySlug' },
        subcategories: {
          $push: {
            _id: '$_id',
            name: '$subcategoryName',
            slug: '$subcategorySlug',
            totalRevenue: '$totalRevenue',
            totalQuantitySold: '$totalQuantitySold',
            numberOfOrders: { $size: '$uniqueOrders' },
            numberOfProducts: { $size: '$uniqueProducts' },
            averageOrderValue: {
              $cond: [{ $eq: [{ $size: '$uniqueOrders' }, 0] }, 0, { $divide: ['$totalRevenue', { $size: '$uniqueOrders' }] }],
            },
          },
        },
        totalRevenue: { $sum: '$totalRevenue' },
        totalQuantitySold: { $sum: '$totalQuantitySold' },
        uniqueOrders: { $addToSet: '$uniqueOrders' },
      },
    },
    {
      $project: {
        _id: 1,
        categoryName: 1,
        categorySlug: 1,
        subcategories: 1,
        totalRevenue: 1,
        totalQuantitySold: 1,
        numberOfOrders: {
          $size: {
            $reduce: {
              input: '$uniqueOrders',
              initialValue: [],
              in: { $setUnion: ['$$value', '$$this'] },
            },
          },
        },
        averageOrderValue: {
          $cond: [
            {
              $eq: [
                {
                  $size: {
                    $reduce: {
                      input: '$uniqueOrders',
                      initialValue: [],
                      in: { $setUnion: ['$$value', '$$this'] },
                    },
                  },
                },
                0,
              ],
            },
            0,
            {
              $divide: [
                '$totalRevenue',
                {
                  $size: {
                    $reduce: {
                      input: '$uniqueOrders',
                      initialValue: [],
                      in: { $setUnion: ['$$value', '$$this'] },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);

  const summary =
    salesBySubCategory.length > 0
      ? {
          totalCategories: salesBySubCategory.length,
          totalSubcategories: salesBySubCategory.reduce((sum, cat) => sum + cat.subcategories.length, 0),
          totalRevenue: salesBySubCategory.reduce((sum, cat) => sum + cat.totalRevenue, 0),
          totalQuantitySold: salesBySubCategory.reduce((sum, cat) => sum + cat.totalQuantitySold, 0),
          totalOrders: salesBySubCategory.reduce((sum, cat) => sum + cat.numberOfOrders, 0),
          averageOrderValue: salesBySubCategory.reduce((sum, cat) => sum + cat.totalRevenue, 0) / salesBySubCategory.reduce((sum, cat) => sum + cat.numberOfOrders, 0),
        }
      : {
          totalCategories: 0,
          totalSubcategories: 0,
          totalRevenue: 0,
          totalQuantitySold: 0,
          totalOrders: 0,
          averageOrderValue: 0,
        };

  res.status(200).json({
    status: 'success',
    data: salesBySubCategory,
    summary,
  });
});

// Get Best Selling Governorates
exports.getBestSellingGovernorates = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const start = startDate ? new Date(startDate) : new Date(new Date().setFullYear(new Date().getFullYear() - 1));
  const end = endDate ? new Date(endDate) : new Date();

  const governorateSales = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lte: end },
        orderStatus: { $ne: 'cancelled' },
        'shippingAddress.governorate': { $exists: true },
      },
    },
    {
      $lookup: {
        from: 'governorates',
        localField: 'shippingAddress.governorate',
        foreignField: '_id',
        as: 'governorate',
      },
    },
    {
      $unwind: '$governorate',
    },
    {
      $group: {
        _id: '$governorate._id',
        governorateName: { $first: '$governorate.name' },
        totalAmount: { $sum: ORDER_TOTAL_PLUS_SHIPPING },
        totalOrders: { $sum: 1 },
        totalShipping: { $sum: '$shippingCost' },
        paidAmount: { $sum: '$paidAmount' },
      },
    },
    {
      $project: {
        _id: 1,
        governorateName: 1,
        totalAmount: 1,
        totalOrders: 1,
        totalShipping: 1,
        paidAmount: 1,
        pendingPayments: {
          $subtract: ['$totalAmount', '$paidAmount'],
        },
        averageOrderValue: {
          $divide: ['$totalAmount', '$totalOrders'],
        },
      },
    },
    {
      $sort: {
        totalAmount: -1,
      },
    },
  ]);

  // Calculate summary
  const summary = governorateSales.reduce(
    (acc, gov) => {
      acc.totalRevenue += gov.totalAmount;
      acc.totalOrders += gov.totalOrders;
      acc.totalShipping += gov.totalShipping;
      acc.totalPaid += gov.paidAmount;
      acc.totalPending += gov.pendingPayments;
      return acc;
    },
    {
      totalRevenue: 0,
      totalOrders: 0,
      totalShipping: 0,
      totalPaid: 0,
      totalPending: 0,
    }
  );

  res.status(200).json({
    status: 'success',
    data: {
      timePeriod: {
        start,
        end,
      },
      summary,
      governorates: governorateSales,
    },
  });
});

// Get Product Availability Analysis
exports.getProductAvailabilityAnalysis = asyncHandler(async (req, res) => {
  const { warehouseId } = req.query;

  // A service (type: 'service') has no inventory by design - it must be excluded from every
  // count/aggregation here, otherwise it inflates `totalProducts` while contributing zero stock,
  // silently depressing the reported "availability %" for a reason that has nothing to do with
  // actual inventory health. `$ne: 'service'` (not `type: 'product'`) also matches any legacy
  // document that predates this field entirely, since Mongo doesn't retroactively apply schema
  // defaults to already-stored documents.
  const excludeServicesFilter = { type: { $ne: 'service' } };

  // 1. Get total number of active products
  const totalProducts = await Product.countDocuments({ isDeleted: false, ...excludeServicesFilter });

  // 2. Get available products and total stock with warehouse filter - a product carries its own
  // stock directly now, so this is a single in-document computation with no Variant lookup needed.
  const stockAnalysis = await Product.aggregate([
    {
      $match: { isDeleted: false, ...excludeServicesFilter },
    },
    {
      $addFields: {
        totalStock: {
          $sum: {
            $map: {
              input: { $ifNull: ['$stock', []] },
              as: 's',
              in: warehouseId ? { $cond: [{ $eq: ['$$s.warehouse', new mongoose.Types.ObjectId(warehouseId)] }, '$$s.quantity', 0] } : '$$s.quantity',
            },
          },
        },
      },
    },
  ]);

  const availableProducts = stockAnalysis.filter(p => p.totalStock > 0).length;
  const totalStock = stockAnalysis.reduce((sum, p) => sum + (p.totalStock || 0), 0);

  // 3. Get sold products analysis with warehouse filter
  const deliveredOrders = await Order.aggregate([
    {
      $match: {
        orderStatus: 'delivered',
        ...(warehouseId && { warehouse: new mongoose.Types.ObjectId(warehouseId) }),
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        soldQuantity: { $sum: '$items.starterQuantity' },
      },
    },
  ]);

  // Get returns with warehouse filter
  const returnedOrders = await OrderReturn.aggregate([
    {
      $match: {
        ...(warehouseId && { warehouseId: new mongoose.Types.ObjectId(warehouseId) }),
      },
    },
    {
      $group: {
        _id: '$productId',
        returnedQuantity: { $sum: '$returnedQuantity' },
      },
    },
  ]);

  // Create a map for quick lookup of returned quantities
  const returnMap = new Map(returnedOrders.map(item => [item._id.toString(), item.returnedQuantity]));

  // Calculate net sales
  const salesAnalysis = deliveredOrders.map(order => {
    const productId = order._id.toString();
    const returnedQty = returnMap.get(productId) || 0;
    return {
      productId,
      netQuantity: order.soldQuantity - returnedQty,
    };
  });

  // Count unique sold products - items already identify their product directly (no separate
  // Variant to resolve a productId from), so this is a plain in-memory count, no extra DB query.
  const soldProductsCount = new Set(salesAnalysis.filter(item => item.netQuantity > 0).map(item => item.productId)).size;

  const totalSold = salesAnalysis.reduce((sum, item) => sum + Math.max(0, item.netQuantity), 0);

  // Calculate unsold products ensuring we never get a negative number
  const unsoldProducts = Math.max(0, totalProducts - soldProductsCount);

  // Prepare summary
  const summary = {
    totalProducts,
    availableProducts,
    soldProducts: soldProductsCount,
    unsoldProducts,
    totalStock,
    totalSold,
  };

  res.status(200).json({
    status: 'success',
    data: summary,
  });
});
