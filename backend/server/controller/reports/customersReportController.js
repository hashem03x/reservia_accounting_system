const asyncHandler = require('express-async-handler');
const User = require('../../models/userModel');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');
<<<<<<< HEAD
const { orderTotalAmountExpr } = require('../../utils/orderTotals');

// Each order's final Total Amount (subtotal + VAT - withholding) - see utils/orderTotals.js.
const SALES_ORDERS_TOTAL_AMOUNT = { $sum: { $map: { input: '$salesOrders', as: 'o', in: orderTotalAmountExpr('$$o.') } } };
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628

// Helper function to get sort configuration
const getSortConfig = (sortBy, sortOrder) => {
  const validSortFields = ['balance', 'totalOrders', 'totalOrdersAmount', 'totalPaidAmount'];
  const order = sortOrder === 'asc' ? 1 : -1;

  if (sortBy && validSortFields.includes(sortBy)) {
    return { [sortBy]: order };
  }
  return { _id: -1 }; // default sort
};

// Aggregate customer data with sales order statistics
exports.getCustomerReport = asyncHandler(async (req, res) => {
  const { type, sortBy, sortOrder } = req.query;

  let matchStage = {};
  if (type) matchStage.type = type;

  const customers = await User.aggregate([
    {
      $match: { ...matchStage, role: 'user' },
    },
    {
      $lookup: {
        from: 'salesorders',
        localField: '_id',
        foreignField: 'customer',
        as: 'salesOrders',
      },
    },
    {
      $addFields: {
        totalOrders: { $size: '$salesOrders' },
<<<<<<< HEAD
        totalOrdersAmount: SALES_ORDERS_TOTAL_AMOUNT,
=======
        totalOrdersAmount: { $sum: '$salesOrders.totalAmount' },
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
        totalPaidAmount: { $sum: '$salesOrders.paidAmount' },
      },
    },
    {
      $project: {
        salesOrders: 0,
        password: 0,
      },
    },
    {
      $sort: getSortConfig(sortBy, sortOrder),
    },
  ]);

  res.status(200).json({
    status: 'success',
    results: customers.length,
    data: customers,
  });
});

// =============================================================

// Export customers report as Excel
exports.exportCustomerReportExcel = asyncHandler(async (req, res) => {
  const { type, sortBy, sortOrder } = req.query;

  let matchStage = {};
  if (type) matchStage.type = type;

  const customers = await User.aggregate([
    {
      $match: { ...matchStage, role: 'user' },
    },
    {
      $lookup: {
        from: 'salesorders',
        localField: '_id',
        foreignField: 'customer',
        as: 'salesOrders',
      },
    },
    {
      $addFields: {
        totalOrders: { $size: '$salesOrders' },
<<<<<<< HEAD
        totalOrdersAmount: SALES_ORDERS_TOTAL_AMOUNT,
=======
        totalOrdersAmount: { $sum: '$salesOrders.totalAmount' },
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
        totalPaidAmount: { $sum: '$salesOrders.paidAmount' },
      },
    },
    {
      $project: {
        salesOrders: 0,
        password: 0,
      },
    },
    {
      $sort: getSortConfig(sortBy, sortOrder),
    },
  ]);

  if (!customers.length) {
    throw new ApiError('No customer data found', 404);
  }

  // Prepare headers
  const headers = ['Name', 'Phone', 'Email', 'Type', 'Balance', 'Total Orders', 'Total Orders Amount', 'Total Paid Amount', 'Address'];

  // Transform data for excel format
  const data = customers.map(customer => [
    customer.name,
    customer.phone || '',
    customer.email || '',
    customer.type,
    customer.balance || 0,
    customer.totalOrders,
    customer.totalOrdersAmount || 0,
    customer.totalPaidAmount || 0,
    [customer.offlineAddress?.country, customer.offlineAddress?.city, customer.offlineAddress?.street, customer.offlineAddress?.postalCode].filter(Boolean).join(', ') || '',
  ]);

  // Calculate totals
  const totals = customers.reduce(
    (acc, customer) => ({
      balance: (acc.balance || 0) + (customer.balance || 0),
      totalOrders: (acc.totalOrders || 0) + (customer.totalOrders || 0),
      totalOrdersAmount: (acc.totalOrdersAmount || 0) + (customer.totalOrdersAmount || 0),
      totalPaidAmount: (acc.totalPaidAmount || 0) + (customer.totalPaidAmount || 0),
    }),
    {}
  );

  // Prepare total row
  const totalRow = ['Total', '', '', '', totals.balance, totals.totalOrders, totals.totalOrdersAmount, totals.totalPaidAmount, ''];

  // Export to Excel
  await exportToExcel(res, 'customer_report.xlsx', headers, data, { totalRow });
});
