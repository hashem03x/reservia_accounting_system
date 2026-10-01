const SalesOrder = require('../../models/sales/salesOrderModel');
const asyncHandler = require('express-async-handler');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');

// Helper function to get sort configuration
const getSortConfig = (sortBy, sortOrder) => {
  const validSortFields = ['totalSales', 'costOfSales', 'grossProfit', 'createdAt'];
  const order = sortOrder === 'asc' ? 1 : -1;

  if (sortBy && validSortFields.includes(sortBy)) {
    return { [sortBy]: order };
  }
  return { createdAt: -1 }; // default sort by creation date, newest first
};

/**
 * Get Profit by Sales Report
 * @route GET /api/reports/profit-by-sales
 * @description Retrieve profit analysis for each sales order
 */
exports.getProfitBySalesReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, orderSource, warehouse, online, sortBy, sortOrder } = req.query;

  const query = {};

  if (startDate) {
    query.createdAt = {
      ...query.createdAt,
      $gte: new Date(startDate),
    };
  }

  if (endDate) {
    query.createdAt = {
      ...query.createdAt,
      $lte: new Date(endDate),
    };
  }

  if (orderSource) query.orderSource = orderSource;
  if (warehouse) query.warehouse = warehouse;
  if (online) query.isOnlineOrder = online === 'true';

  const sortConfig = getSortConfig(sortBy, sortOrder);

  const salesOrders = await SalesOrder.find(query).populate('items.product', 'title').populate('customer', 'name').sort(sortConfig);

  // Calculate profit metrics for each order
  const profitData = salesOrders.map(order => {
    const totalSales = order.totalAmount;
    const costOfSales = order.items.reduce((total, item) => total + (item.costWhenSold || 0) * (item.starterQuantity - item.returnedQuantity), 0);
    const grossProfit = totalSales - costOfSales;

    return {
      _id: order._id,
      orderId: order._id,
      customerName: order.customer ? order.customer.name : 'N/A',
      createdAt: order.createdAt,
      totalSales,
      costOfSales,
      grossProfit,
    };
  });

  res.status(200).json({
    status: 'success',
    results: profitData.length,
    data: profitData,
  });
});

/**
 * Export Profit by Sales Report to Excel
 * @route POST /api/reports/profit-by-sales
 * @description Export profit analysis data to Excel
 */
exports.exportProfitBySalesReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, orderSource, warehouse, online, sortBy, sortOrder } = req.query;

  const query = {};

  if (startDate) {
    query.createdAt = {
      ...query.createdAt,
      $gte: new Date(startDate),
    };
  }

  if (endDate) {
    query.createdAt = {
      ...query.createdAt,
      $lte: new Date(endDate),
    };
  }

  if (orderSource) query.orderSource = orderSource;
  if (warehouse) query.warehouse = warehouse;
  if (online) query.isOnlineOrder = online === 'true';

  const sortConfig = getSortConfig(sortBy, sortOrder);

  const salesOrders = await SalesOrder.find(query).populate('items.product', 'title').populate('customer', 'name').sort(sortConfig);

  // Calculate profit metrics for each order
  const profitData = salesOrders.map(order => {
    const totalSales = order.totalAmount;
    const costOfSales = order.items.reduce((total, item) => total + (item.costWhenSold || 0) * (item.starterQuantity - item.returnedQuantity), 0);
    const grossProfit = totalSales - costOfSales;

    return [
      order._id.toString(),
      order.customer ? order.customer.name : 'N/A',
      new Date(order.createdAt).toLocaleDateString(),
      totalSales.toFixed(2),
      costOfSales.toFixed(2),
      grossProfit.toFixed(2),
    ];
  });

  // Calculate totals
  const totals = profitData.reduce(
    (acc, row) => ['Total', '', '', (Number(acc[3]) + Number(row[3])).toFixed(2), (Number(acc[4]) + Number(row[4])).toFixed(2), (Number(acc[5]) + Number(row[5])).toFixed(2)],
    ['Total', '', '', 0, 0, 0]
  );

  const headers = ['Order ID', 'Customer Name', 'Date', 'Total Sales', 'Cost of Sales', 'Gross Profit'];

  await exportToExcel(res, 'Profit_By_Sales_Report', headers, profitData, {
    totalRow: totals,
  });
});
