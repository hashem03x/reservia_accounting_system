const asyncHandler = require('express-async-handler');
const Payment = require('../../models/vendor/paymentModel');
const { PaymentMethods } = require('../../utils/appConstant');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');

// @desc    Get Treasury Balance Report by Payment Method per Branch
// @route   GET /api/v1/reports/treasury-balance
// @access  Private
exports.getTreasuryBalanceReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, warehouse } = req.query;

  // Build query
  const query = {};

  // Add date range filter if provided
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  // Add warehouse filter if provided
  if (warehouse) {
    query.warehouseId = warehouse;
  }

  const payments = await Payment.find(query)
    .populate({
      path: 'warehouseId',
      select: 'name',
    })
    .lean();

  // Initialize results structure with all payment methods
  const initializePaymentMethods = () => {
    const methods = {};
    PaymentMethods.forEach(method => {
      methods[method] = {
        in: 0,
        out: 0,
        balance: 0,
      };
    });
    return methods;
  };

  // Group payments by warehouse and payment method
  const balanceByWarehouse = payments.reduce((acc, payment) => {
    const warehouseName = payment.warehouseId?.name || 'Unknown';
    const paymentMethod = payment.paymentMethod;

    if (!acc[warehouseName]) {
      acc[warehouseName] = initializePaymentMethods();
    }

    // Update amounts based on payment type
    if (payment.type === 'in') {
      acc[warehouseName][paymentMethod].in += payment.amountPaid;
    } else {
      acc[warehouseName][paymentMethod].out += payment.amountPaid;
    }

    // Calculate balance
    acc[warehouseName][paymentMethod].balance = acc[warehouseName][paymentMethod].in - acc[warehouseName][paymentMethod].out;

    return acc;
  }, {});

  // Format the results
  const formattedResults = Object.entries(balanceByWarehouse).map(([warehouse, methods]) => {
    const paymentMethods = Object.entries(methods).map(([method, amounts]) => ({
      method,
      inflow: Number(amounts.in.toFixed(2)),
      outflow: Number(amounts.out.toFixed(2)),
      balance: Number(amounts.balance.toFixed(2)),
    }));

    // Calculate warehouse totals
    const totals = paymentMethods.reduce(
      (acc, method) => ({
        totalInflow: acc.totalInflow + method.inflow,
        totalOutflow: acc.totalOutflow + method.outflow,
        totalBalance: acc.totalBalance + method.balance,
      }),
      { totalInflow: 0, totalOutflow: 0, totalBalance: 0 }
    );

    return {
      warehouse,
      paymentMethods,
      totals: {
        inflow: Number(totals.totalInflow.toFixed(2)),
        outflow: Number(totals.totalOutflow.toFixed(2)),
        balance: Number(totals.totalBalance.toFixed(2)),
      },
    };
  });

  res.status(200).json({
    status: 'success',
    results: formattedResults.length,
    data: formattedResults,
  });
});

// @desc    Generate Excel Report for Treasury Balance
// @route   POST /api/v1/reports/treasury-balance
// @access  Private
exports.generateTreasuryBalanceExcel = asyncHandler(async (req, res) => {
  const { startDate, endDate, warehouse } = req.body;

  // Build query
  const query = {};

  // Add date range filter if provided
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  // Add warehouse filter if provided
  if (warehouse) {
    query.warehouseId = warehouse;
  }

  const payments = await Payment.find(query)
    .populate({
      path: 'warehouseId',
      select: 'name',
    })
    .lean();

  if (!payments || payments.length === 0) {
    throw new ApiError('No data available for the specified criteria', 404);
  }

  // Initialize results structure with all payment methods
  const initializePaymentMethods = () => {
    const methods = {};
    PaymentMethods.forEach(method => {
      methods[method] = {
        in: 0,
        out: 0,
        balance: 0,
      };
    });
    return methods;
  };

  // Group payments by warehouse and payment method
  const balanceByWarehouse = payments.reduce((acc, payment) => {
    const warehouseName = payment.warehouseId?.name || 'Unknown';
    const paymentMethod = payment.paymentMethod;

    if (!acc[warehouseName]) {
      acc[warehouseName] = initializePaymentMethods();
    }

    // Update amounts based on payment type
    if (payment.type === 'in') {
      acc[warehouseName][paymentMethod].in += payment.amountPaid;
    } else {
      acc[warehouseName][paymentMethod].out += payment.amountPaid;
    }

    // Calculate balance
    acc[warehouseName][paymentMethod].balance = acc[warehouseName][paymentMethod].in - acc[warehouseName][paymentMethod].out;

    return acc;
  }, {});

  // Define Excel headers
  const headers = ['Warehouse', 'Payment Method', 'Total Inflow', 'Total Outflow', 'Balance'];

  // Prepare data for Excel
  const data = [];

  // Add data rows
  Object.entries(balanceByWarehouse).forEach(([warehouse, methods]) => {
    // Add rows for each payment method
    Object.entries(methods).forEach(([method, amounts]) => {
      if (amounts.in > 0 || amounts.out > 0) {
        // Only show methods with activity
        data.push([warehouse, method, Number(amounts.in.toFixed(2)), Number(amounts.out.toFixed(2)), Number(amounts.balance.toFixed(2))]);
      }
    });

    // Calculate warehouse totals
    const warehouseTotals = Object.values(methods).reduce(
      (acc, amounts) => ({
        in: acc.in + amounts.in,
        out: acc.out + amounts.out,
        balance: acc.balance + amounts.balance,
      }),
      { in: 0, out: 0, balance: 0 }
    );

    // Add total row for this warehouse
    data.push([`${warehouse} - Total`, '', Number(warehouseTotals.in.toFixed(2)), Number(warehouseTotals.out.toFixed(2)), Number(warehouseTotals.balance.toFixed(2))]);

    // Add empty row for spacing
    data.push(['', '', '', '', '']);
  });

  if (data.length === 0) {
    throw new ApiError('No transactions found for the specified criteria', 404);
  }

  return exportToExcel(res, 'Treasury Balance Report', headers, data);
});
