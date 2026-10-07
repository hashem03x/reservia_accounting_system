const SalesOrder = require('../../models/sales/salesOrderModel');
const asyncHandler = require('express-async-handler');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');
const { getOrderTotalAmount } = require('../../utils/orderTotals');

// Helper function to get sort configuration
const getSortConfig = (sortBy, sortOrder) => {
  const validSortFields = ['totalAmount', 'paidAmount', 'remainingAmount', 'createdAt'];
  const order = sortOrder === 'asc' ? 1 : -1;

  if (sortBy && validSortFields.includes(sortBy)) {
    // 'totalAmount' (the report's "Total Amount" column) sorts by the order's final Total Amount -
    // grandTotal (subtotal + VAT - withholding), not the pre-tax subtotal field of the same name.
    return { [sortBy === 'totalAmount' ? 'grandTotal' : sortBy]: order };
  }
  return { createdAt: -1 }; // default sort by creation date, newest first
};

// =============================================================

/**
 * Get Sales Order Report
 * @route GET /api/reports/sales-orders
 * @description Retrieve sales orders with optional filters and sorting
 * 
 * @queryParam {String} startDate - Start date in ISO format (YYYY-MM-DD)
 * @queryParam {String} endDate - End date in ISO format (YYYY-MM-DD)
 * @queryParam {String} orderSource - Filter by order source ('website', 'cashier')
 * @queryParam {String} warehouse - Filter by warehouse ID
 * @queryParam {String} paymentStatus - Filter by payment status ('unpaid', 'partial', 'paid', 'unknown')
 * @queryParam {String} sortBy - Sort field ('totalAmount', 'paidAmount', 'remainingAmount', 'createdAt')
 * @queryParam {String} sortOrder - Sort order ('asc' or 'desc')
 * 
 * @example
 * // Sort by total amount descending
 * GET /reports/sales-orders?sortBy=totalAmount&sortOrder=desc
 * 
 * @returns {Object} JSON response
 */
exports.getSalesOrderReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, orderSource, warehouse, paymentStatus, sortBy, sortOrder } = req.query;

  const query = {};

  if (startDate) {
    query.createdAt = {
      ...query.createdAt,
      $gte: new Date(startDate)
    };
  }

  if (endDate) {
    query.createdAt = {
      ...query.createdAt,
      $lte: new Date(endDate)
    };
  }

  if (orderSource) query.orderSource = orderSource;
  if (warehouse) query.warehouse = warehouse;
  if (paymentStatus) query.paymentStatus = paymentStatus;

  const sortConfig = getSortConfig(sortBy, sortOrder);

  const salesOrders = await SalesOrder.find(query)
    .populate('customer', 'name email phone')
    .populate('items.product', 'title')
    .sort(sortConfig);

  res.status(200).json({
    status: 'success',
    results: salesOrders.length,
    data: salesOrders
  });
});

// =============================================================

exports.exportSalesOrderReportExcel = asyncHandler(async (req, res, next) => {
  const { startDate, endDate, orderSource, warehouse, paymentStatus, sortBy, sortOrder } = req.query;

  const query = {};

  if (startDate) {
    query.createdAt = {
      ...query.createdAt,
      $gte: new Date(startDate)
    };
  }

  if (endDate) {
    query.createdAt = {
      ...query.createdAt,
      $lte: new Date(endDate)
    };
  }

  if (orderSource) query.orderSource = orderSource;
  if (warehouse) query.warehouse = warehouse;
  if (paymentStatus) query.paymentStatus = paymentStatus;

  const sortConfig = getSortConfig(sortBy, sortOrder);

  const salesOrders = await SalesOrder.find(query)
    .populate('customer', 'name email phone')
    .populate('items.product', 'title')
    .populate('warehouse', 'name')
    .sort(sortConfig);

  if (salesOrders.length === 0) {
    return next(new ApiError('No sales orders found', 404));
  }

  // Perpare headers
  const headers = [
    "Order ID",
    "Order Source",
    "Warehouse",
    "Customer",
    "Payment Status",
    "Total Amount",
    "Paid Amount",
    "Remaining Amount",
    "Date & Time",
  ];

  // Transform data
  const data = salesOrders.map(order => [
    order._id.toString(),
    order.orderSource,
    order.warehouse?.name || '',
    order.customer?.name || '',
    order.paymentStatus,
    getOrderTotalAmount(order),
    order.paidAmount,
    order.remainingAmount,
    order.createdAt
  ]);

  // Calculate totals
  const totals = salesOrders.reduce((acc, order) => ({
    totalAmount: (acc.totalAmount || 0) + getOrderTotalAmount(order),
    paidAmount: (acc.paidAmount || 0) + (order.paidAmount || 0),
    remainingAmount: (acc.remainingAmount || 0) + (order.remainingAmount || 0)
  }), {});

  // Prepare total row
  const totalRow = [
    'Total',
    '',
    '',
    '',
    '',
    totals.totalAmount,
    totals.paidAmount,
    totals.remainingAmount,
    '',
  ];

  // Export to Excel
  exportToExcel(res, 'Sales Order Report', headers, data, { totalRow });
});
