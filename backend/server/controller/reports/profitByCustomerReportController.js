const SalesOrder = require('../../models/sales/salesOrderModel');
const User = require('../../models/userModel');
const asyncHandler = require('express-async-handler');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');

// Helper function to get sort configuration
const getSortConfig = (sortBy, sortOrder) => {
  const validSortFields = ['totalSales', 'costOfSales', 'grossProfit', 'customerName'];
  const order = sortOrder === 'asc' ? 1 : -1;

  if (sortBy && validSortFields.includes(sortBy)) {
    return { [sortBy]: order };
  }
  return { totalSales: -1 }; // default sort by total sales, highest first
};

/**
 * Get Profit by Customer Report
 * @route GET /api/reports/profit-by-customer
 * @description Retrieve profit analysis grouped by customer
 */
exports.getProfitByCustomerReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, customerType, warehouse, online, sortBy, sortOrder } = req.query;

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

  if (warehouse && warehouse !== 'all') {
    query.warehouse = warehouse;
  }

  if (online) {
    query.isOnlineOrder = online === 'true';
  }

  // Get all sales orders with customer details
  const salesOrders = await SalesOrder.find(query)
    .populate({
      path: 'customer',
      select: 'name email phone type',
      match: customerType ? { type: customerType } : {},
    })
    .populate('items.product', 'title')
    .sort('customer');

  // Filter out orders where customer was not found (due to type filter)
  const validOrders = salesOrders.filter(order => order.customer);

  // Group and calculate metrics by customer
  const customerProfitMap = new Map();

  validOrders.forEach(order => {
    const customerId = order.customer._id.toString();
    const customerData = customerProfitMap.get(customerId) || {
      _id: customerId,
      customerName: order.customer.name,
      customerEmail: order.customer.email,
      customerPhone: order.customer.phone,
      customerType: order.customer.type,
      totalSales: 0,
      costOfSales: 0,
      grossProfit: 0,
      orderCount: 0,
    };

    const orderTotal = order.totalAmount;
    const orderCost = order.items.reduce((total, item) => total + (item.costWhenSold || 0) * (item.starterQuantity - item.returnedQuantity), 0);

    customerData.totalSales += orderTotal;
    customerData.costOfSales += orderCost;
    customerData.grossProfit = customerData.totalSales - customerData.costOfSales;
    customerData.orderCount += 1;

    customerProfitMap.set(customerId, customerData);
  });

  // Convert map to array and sort
  let profitData = Array.from(customerProfitMap.values());

  // Apply sorting based on getSortConfig
  const sortConfig = getSortConfig(sortBy, sortOrder);
  const sortField = Object.keys(sortConfig)[0];
  const sortMultiplier = Object.values(sortConfig)[0];

  if (sortField === 'customerName') {
    profitData.sort((a, b) => sortMultiplier * a.customerName.localeCompare(b.customerName));
  } else {
    profitData.sort((a, b) => sortMultiplier * (a[sortField] - b[sortField]));
  }

  res.status(200).json({
    status: 'success',
    results: profitData.length,
    data: profitData,
  });
});

/**
 * Export Profit by Customer Report to Excel
 * @route POST /api/reports/profit-by-customer
 * @description Export profit by customer analysis to Excel
 */
exports.exportProfitByCustomerReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, customerType, warehouse, online, sortBy, sortOrder } = req.query;

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

  if (warehouse && warehouse !== 'all') {
    query.warehouse = warehouse;
  }

  if (online) {
    query.isOnlineOrder = online === 'true';
  }

  // Get all sales orders with customer details
  const salesOrders = await SalesOrder.find(query)
    .populate({
      path: 'customer',
      select: 'name email phone type',
      match: customerType ? { type: customerType } : {},
    })
    .populate('items.product', 'title')
    .sort('customer');

  // Filter out orders where customer was not found (due to type filter)
  const validOrders = salesOrders.filter(order => order.customer);

  // Group and calculate metrics by customer
  const customerProfitMap = new Map();

  validOrders.forEach(order => {
    const customerId = order.customer._id.toString();
    const customerData = customerProfitMap.get(customerId) || {
      customerName: order.customer.name,
      totalSales: 0,
      costOfSales: 0,
      grossProfit: 0,
    };

    const orderTotal = order.totalAmount;
    const orderCost = order.items.reduce((total, item) => total + (item.costWhenSold || 0) * (item.starterQuantity - item.returnedQuantity), 0);

    customerData.totalSales += orderTotal;
    customerData.costOfSales += orderCost;
    customerData.grossProfit = customerData.totalSales - customerData.costOfSales;

    customerProfitMap.set(customerId, customerData);
  });

  // Convert map to array and format for Excel
  const profitData = Array.from(customerProfitMap.values()).map(customer => [
    customer.customerName,
    Number(customer.totalSales).toFixed(2),
    Number(customer.costOfSales).toFixed(2),
    Number(customer.grossProfit).toFixed(2),
  ]);

  // Calculate totals
  const totals = profitData.reduce(
    (acc, row) => ['Total', (Number(acc[1]) + Number(row[1])).toFixed(2), (Number(acc[2]) + Number(row[2])).toFixed(2), (Number(acc[3]) + Number(row[3])).toFixed(2)],
    ['Total', 0, 0, 0]
  );

  const headers = ['Customer Name', 'Total Sales', 'Cost of Sales', 'Gross Profit'];

  await exportToExcel(res, 'Profit_By_Customer_Report', headers, profitData, {
    totalRow: totals,
  });
});
