const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const asyncHandler = require('express-async-handler');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');

// Helper function to get sort configuration
const getSortConfig = (sortBy, sortOrder) => {
  const validSortFields = ['totalAmount', 'paidAmount', 'remainingAmount', 'createdAt'];
  const order = sortOrder === 'asc' ? 1 : -1;

  if (sortBy && validSortFields.includes(sortBy)) {
    return { [sortBy]: order };
  }
  return { createdAt: -1 }; // default sort by creation date, newest first
};

// =============================================================

/**
 * Get Purchase Order Report
 * @route GET /api/reports/purchase-orders
 * @description Retrieve purchase orders with optional filters and sorting
 * 
 * @queryParam {String} startDate - Start date in ISO format (YYYY-MM-DD)
 * @queryParam {String} endDate - End date in ISO format (YYYY-MM-DD)
 * @queryParam {String} warehouseId - Filter by warehouse ID
 * @queryParam {String} paymentStatus - Filter by payment status ('unpaid', 'partial', 'paid', 'unknown')
 * @queryParam {String} sortBy - Sort field ('totalAmount', 'paidAmount', 'remainingAmount', 'createdAt')
 * @queryParam {String} sortOrder - Sort order ('asc' or 'desc')
 * 
 * @example
 * // Sort by total amount descending
 * GET /reports/purchase-orders?sortBy=totalAmount&sortOrder=desc
 * 
 * @returns {Object} JSON response
 */
exports.getPurchaseOrderReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, warehouseId, paymentStatus, sortBy, sortOrder } = req.query;

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

  if (warehouseId) query.warehouseId = warehouseId;
  if (paymentStatus) query.paymentStatus = paymentStatus;

  const sortConfig = getSortConfig(sortBy, sortOrder);

  const purchaseOrders = await PurchaseOrder.find(query)
    .populate('vendorId', 'name email phone')
    .populate('items.variantId', 'name')
    .sort(sortConfig);

  res.status(200).json({
    status: 'success',
    results: purchaseOrders.length,
    data: purchaseOrders
  });
});

// =============================================================

exports.exportPurchaseOrderReportExcel = asyncHandler(async (req, res) => {
  const { startDate, endDate, warehouseId, paymentStatus, sortBy, sortOrder } = req.query;

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

  if (warehouseId) query.warehouseId = warehouseId;
  if (paymentStatus) query.paymentStatus = paymentStatus;

  const sortConfig = getSortConfig(sortBy, sortOrder);

  const purchaseOrders = await PurchaseOrder.find(query)
    .populate('vendorId', 'name email phone')
    .populate('warehouseId', 'name')
    .populate('items.variantId', 'name')
    .sort(sortConfig);

  if (purchaseOrders.length === 0) {
    return next(new ApiError('No purchase orders found', 404));
  }

  // Perpare headers
  const headers = [
    "Order ID",
    "Warehouse",
    "Vendor",
    "Payment Status",
    "Total Amount",
    "Paid Amount",
    "Remaining Amount",
    "Date & Time",
  ];

  // Transform data
  const data = purchaseOrders.map(order => [
    order._id.toString(),
    order.warehouseId.name,
    order.vendorId.name,
    order.paymentStatus,
    order.totalAmount,
    order.paidAmount,
    order.remainingAmount,
    order.createdAt
  ]);

  // Calculate totals
  const totals = purchaseOrders.reduce((acc, order) => ({
    totalAmount: (acc.totalAmount || 0) + (order.totalAmount || 0),
    paidAmount: (acc.paidAmount || 0) + (order.paidAmount || 0),
    remainingAmount: (acc.remainingAmount || 0) + (order.remainingAmount || 0)
  }), {});

  // Prepare total row
  const totalRow = [
    'Total',
    '',
    '',
    '',
    totals.totalAmount,
    totals.paidAmount,
    totals.remainingAmount,
    '',
  ];

  // Export to Excel
  exportToExcel(res, 'Purchase Order Report', headers, data, { totalRow });
});
