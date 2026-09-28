const Payment = require('../../models/vendor/paymentModel');
const asyncHandler = require('express-async-handler');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');

// Helper function to get sort configuration
const getSortConfig = (sortBy, sortOrder) => {
  const validSortFields = ['amountPaid', 'createdAt', 'paymentMethod', 'paymentCategory', 'type'];
  const order = sortOrder === 'asc' ? 1 : -1;

  if (sortBy && validSortFields.includes(sortBy)) {
    return { [sortBy]: order };
  }
  return { createdAt: -1 }; // default sort by creation date, newest first
};

// =============================================================

/**
 * Get Payment Report
 * @route GET /api/reports/payments
 * @description Retrieve payments with optional filters and sorting
 *
 * @queryParam {String} startDate - Start date in ISO format (YYYY-MM-DD)
 * @queryParam {String} endDate - End date in ISO format (YYYY-MM-DD)
 * @queryParam {String} type - Filter by payment type ('in', 'out')
 * @queryParam {String} paymentMethod - Filter by payment method
 * @queryParam {String} paymentCategory - Filter by payment category ('purchase', 'sales', 'expense', etc.)
 * @queryParam {String} warehouseId - Filter by warehouse ID
 * @queryParam {String} vendorId - Filter by vendor ID
 * @queryParam {String} customerId - Filter by customer ID
 * @queryParam {String} sortBy - Sort field ('amountPaid', 'createdAt', 'paymentMethod', 'paymentCategory', 'type')
 * @queryParam {String} sortOrder - Sort order ('asc' or 'desc')
 *
 * @example
 * // Sort by amount paid descending
 * GET /reports/payments?sortBy=amountPaid&sortOrder=desc
 *
 * @returns {Object} JSON response
 */
exports.getPaymentReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, type, paymentMethod, paymentCategory, warehouseId, vendorId, customerId, sortBy, sortOrder } = req.query;

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

  if (type) query.type = type;
  if (paymentMethod) query.paymentMethod = paymentMethod;
  if (paymentCategory) query.paymentCategory = paymentCategory;
  if (warehouseId) query.warehouseId = warehouseId;
  if (vendorId) query.vendorId = vendorId;
  if (customerId) query.customerId = customerId;

  const sortConfig = getSortConfig(sortBy, sortOrder);

  const payments = await Payment.find(query).populate('createdBy', 'name').sort(sortConfig);

  res.status(200).json({
    status: 'success',
    results: payments.length,
    data: payments,
  });
});

// =============================================================

/**
 * Export Payment Report to Excel
 * @route GET /api/reports/payments/export-excel
 * @description Export payments report as Excel file with optional filters and sorting
 */
exports.exportPaymentReportExcel = asyncHandler(async (req, res, next) => {
  const { startDate, endDate, type, paymentMethod, paymentCategory, warehouseId, vendorId, customerId, sortBy, sortOrder } = req.query;

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

  if (type) query.type = type;
  if (paymentMethod) query.paymentMethod = paymentMethod;
  if (paymentCategory) query.paymentCategory = paymentCategory;
  if (warehouseId) query.warehouseId = warehouseId;
  if (vendorId) query.vendorId = vendorId;
  if (customerId) query.customerId = customerId;

  const sortConfig = getSortConfig(sortBy, sortOrder);

  const payments = await Payment.find(query).populate('warehouseId', 'name').populate('createdBy', 'name').sort(sortConfig);

  if (payments.length === 0) {
    return next(new ApiError('No payments found', 404));
  }

  // Prepare headers
  const headers = ['Date', 'Warehouse', 'Amount Paid', 'Payment Type', 'Payment Method', 'Payment Category', 'Order ID', 'Notes'];

  // Transform data
  const data = payments.map(payment => {
    // Determine the related order (purchase order or sales order)
    const relatedOrder = payment.purchaseOrderId || payment.salesOrderId || '';

    // Apply negative sign to outgoing payments
    const displayAmount = payment.type === 'out' ? payment.amountPaid * -1 : payment.amountPaid;

    return [
      payment.createdAt,
      payment.warehouseId ? payment.warehouseId.name : '',
      displayAmount,
      payment.type === 'in' ? 'In' : 'Out',
      payment.paymentMethod,
      payment.paymentCategory,
      relatedOrder.toString(),
      payment.notes || '',
    ];
  });

  // Calculate totals
  const incomingTotal = payments.filter(payment => payment.type === 'in').reduce((sum, payment) => sum + (payment.amountPaid || 0), 0);

  const outgoingTotal = payments.filter(payment => payment.type === 'out').reduce((sum, payment) => sum + (payment.amountPaid || 0), 0);

  const netTotal = incomingTotal - outgoingTotal;

  // Get all unique warehouses from payments
  const warehouseMap = new Map();
  payments.forEach(payment => {
    if (payment.warehouseId && !warehouseMap.has(payment.warehouseId._id.toString())) {
      warehouseMap.set(payment.warehouseId._id.toString(), payment.warehouseId);
    }
  });
  const warehouses = Array.from(warehouseMap.values());

  // Prepare warehouse payment summary
  const warehouseSummaryTitle = ['Warehouse Payment Summary', '', '', '', '', '', '', ''];

  const warehouseSummaryHeaders = ['Warehouse', 'In', 'Out', 'Balance', '', '', '', ''];

  const warehouseSummaryRows = warehouses.map(warehouse => {
    const warehousePayments = payments.filter(payment => payment.warehouseId && payment.warehouseId._id.toString() === warehouse._id.toString());

    const inflow = warehousePayments.filter(payment => payment.type === 'in').reduce((sum, payment) => sum + payment.amountPaid, 0);

    const outflow = warehousePayments.filter(payment => payment.type === 'out').reduce((sum, payment) => sum + payment.amountPaid, 0);

    const balance = inflow - outflow;

    const row = ['', '', '', '', '', '', '', ''];
    row[0] = warehouse.name;
    row[1] = inflow;
    row[2] = outflow * -1;
    row[3] = balance;

    return row;
  });

  // Export to Excel with summary information
  exportToExcel(res, 'Payments Report', headers, [
    ...data,
    ['', '', '', '', '', '', '', ''], // Empty row as separator
    warehouseSummaryTitle,
    warehouseSummaryHeaders,
    ...warehouseSummaryRows,
    ['', '', '', '', '', '', '', ''], // Empty row as separator
    ['Total', incomingTotal, outgoingTotal * -1, netTotal], // Total row
  ]);
});
