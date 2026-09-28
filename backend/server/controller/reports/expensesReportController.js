const asyncHandler = require('express-async-handler');
const Expense = require('../../models/expense/expenseModel');
const exportToExcel = require('../../utils/exportToExcel');
const ApiError = require('../../utils/apiError');
const { Schema } = require('mongoose');
const Warehouse = require('../../models/inventory/warehouseModel');

// @desc    Get Expenses Report
// @route   GET /api/v1/reports/expenses
// @access  Private
exports.getExpensesReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, category, warehouse } = req.query;

  // Build query
  const query = {};

  // Add date range filter if provided
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  // Add category filter if provided
  if (category) {
    query.expenseCategory = category;
  }

  const expenses = await Expense.find(query)
    .populate({
      path: 'paymentId',
      select: 'amountPaid paymentMethod status warehouseId',
      populate: {
        path: 'warehouseId',
        select: 'name',
      },
    })
    .populate({
      path: 'createdBy',
      select: 'name',
    })
    .lean();

  // Filter expenses by warehouse if provided
  const filteredExpenses = warehouse ? expenses.filter(expense => expense.paymentId?.warehouseId?._id.toString() === warehouse) : expenses.filter(expense => expense.paymentId);

  // Calculate totals
  const totals = filteredExpenses.reduce(
    (acc, expense) => ({
      totalAmount: (acc.totalAmount || 0) + (expense.paymentId?.amountPaid || 0),
      categoryCounts: {
        ...acc.categoryCounts,
        [expense.expenseCategory]: (acc.categoryCounts[expense.expenseCategory] || 0) + 1,
      },
      categoryAmounts: {
        ...acc.categoryAmounts,
        [expense.expenseCategory]: (acc.categoryAmounts[expense.expenseCategory] || 0) + (expense.paymentId?.amountPaid || 0),
      },
    }),
    { categoryCounts: {}, categoryAmounts: {} }
  );

  // Format the summary data
  const summary = {
    totalExpenses: filteredExpenses.length,
    totalAmount: totals.totalAmount || 0,
    byCategory: Object.keys(totals.categoryCounts).map(category => ({
      category,
      count: totals.categoryCounts[category],
      amount: totals.categoryAmounts[category] || 0,
      percentage: totals.totalAmount ? (((totals.categoryAmounts[category] || 0) / totals.totalAmount) * 100).toFixed(2) : '0.00',
    })),
  };

  res.status(200).json({
    status: 'success',
    results: filteredExpenses.length,
    data: {
      expenses: filteredExpenses.map(expense => ({
        _id: expense._id,
        description: expense.description,
        expenseCategory: expense.expenseCategory,
        createdAt: expense.createdAt,
        updatedAt: expense.updatedAt,
        payment: expense.paymentId
          ? {
              amount: expense.paymentId.amountPaid,
              method: expense.paymentId.paymentMethod,
              status: 'paid',
            }
          : null,
        warehouse: expense.paymentId?.warehouseId
          ? {
              _id: expense.paymentId.warehouseId._id,
              name: expense.paymentId.warehouseId.name,
            }
          : null,
        creator: {
          name: expense.createdBy?.name,
        },
      })),
      summary,
    },
  });
});

// @desc    Generate Expenses Report Excel
// @route   POST /api/v1/reports/expenses/excel
// @access  Private
exports.generateExpensesReportExcel = asyncHandler(async (req, res) => {
  const { startDate, endDate, category, warehouse } = req.body;

  // Build query
  const query = {};

  // Add date range filter if provided
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  // Add category filter if provided
  if (category) {
    query.expenseCategory = category;
  }

  // Get expenses with payment data
  const expenses = await Expense.find(query)
    .populate({
      path: 'paymentId',
      select: 'amountPaid paymentMethod status warehouseId',
    })
    .populate({
      path: 'createdBy',
      select: 'name',
    })
    .lean();

  // Filter expenses by warehouse if provided
  const filteredExpenses = warehouse ? expenses.filter(expense => expense.paymentId?.warehouseId?.toString() === warehouse) : expenses.filter(expense => expense.paymentId);

  if (!filteredExpenses.length) {
    throw new ApiError('No expense data found', 404);
  }

  // Get all warehouse IDs from the filtered expenses
  const warehouseIds = filteredExpenses.filter(expense => expense.paymentId && expense.paymentId.warehouseId).map(expense => expense.paymentId.warehouseId);

  // Fetch warehouse data for all IDs
  const warehouses = warehouseIds.length > 0 ? await Warehouse.find({ _id: { $in: warehouseIds } }).lean() : [];

  // Create a map of warehouse IDs to names for quick lookup
  const warehouseMap = {};
  warehouses.forEach(warehouse => {
    warehouseMap[warehouse._id.toString()] = warehouse.name;
  });

  // Calculate totals using the same logic as getExpensesReport
  const totals = filteredExpenses.reduce(
    (acc, expense) => ({
      totalAmount: (acc.totalAmount || 0) + (expense.paymentId?.amountPaid || 0),
      categoryCounts: {
        ...acc.categoryCounts,
        [expense.expenseCategory]: (acc.categoryCounts[expense.expenseCategory] || 0) + 1,
      },
      categoryAmounts: {
        ...acc.categoryAmounts,
        [expense.expenseCategory]: (acc.categoryAmounts[expense.expenseCategory] || 0) + (expense.paymentId?.amountPaid || 0),
      },
    }),
    { categoryCounts: {}, categoryAmounts: {} }
  );

  // Prepare headers
  const headers = ['Date', 'Description', 'Category', 'Amount', 'Payment Method', 'Payment Status', 'Created By', 'Warehouse'];

  // Format helpers
  const formatNumber = num => (num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatDate = date =>
    new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  // Transform data for excel format with improved warehouse handling
  const data = filteredExpenses.map(expense => {
    // Get warehouse name from the map
    let warehouseName = 'N/A';
    if (expense.paymentId && expense.paymentId.warehouseId) {
      const warehouseId = expense.paymentId.warehouseId.toString();
      warehouseName = warehouseMap[warehouseId] || 'N/A';
    }

    return [
      formatDate(expense.createdAt),
      expense.description,
      expense.expenseCategory,
      formatNumber(expense.paymentId?.amountPaid || 0),
      expense.paymentId?.paymentMethod || 'N/A',
      'paid',
      expense.createdBy?.name || 'N/A',
      warehouseName,
    ];
  });

  // Prepare category breakdown using the same totals calculation
  const categoryBreakdown = Object.keys(totals.categoryCounts).map(category => [
    '',
    '',
    category,
    formatNumber(totals.categoryAmounts[category] || 0),
    '',
    '',
    '',
    `${totals.categoryCounts[category]} ${totals.categoryCounts[category] > 1 ? 'expenses' : 'expense'}`,
  ]);

  // Add total row
  const totalRow = [
    'TOTAL',
    '',
    'All Categories',
    formatNumber(totals.totalAmount || 0),
    '',
    '',
    '',
    `${filteredExpenses.length} ${filteredExpenses.length > 1 ? 'Expenses' : 'Expense'}`,
  ];

  // Generate Excel file
  const filename = `Expenses_Report_${formatDate(startDate || new Date())}_to_${formatDate(endDate || new Date())}`;

  await exportToExcel(res, filename, headers, [...data, ['', '', '', '', '', '', '', ''], ...categoryBreakdown], {
    totalRow: totalRow,
  });
});
