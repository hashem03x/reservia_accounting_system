const asyncHandler = require('express-async-handler');
const SalesOrder = require('../../models/sales/salesOrderModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const Expense = require('../../models/expense/expenseModel');
const exportToExcel = require('../../utils/exportToExcel');
const FixedAsset = require('../../models/fixedAssets');

exports.getNetProfit = async function (endDate, warehouseId = '', startDate) {
  // Parse input dates or use defaults
  let parsedEndDate = endDate ? new Date(endDate) : new Date();
  const parsedStartDate = startDate ? new Date(startDate) : new Date('1900-01-01T00:00:00.000Z');

  if (!parsedEndDate || isNaN(parsedEndDate.getTime())) {
    parsedEndDate = new Date();
  }

  // Create date objects for start of day and end of day without modifying original dates
  const currentStartDateTime = new Date(parsedStartDate);
  currentStartDateTime.setHours(0, 0, 0, 0);

  const currentEndDateTime = new Date(parsedEndDate);
  currentEndDateTime.setHours(23, 59, 59, 999);

  const currentQuery = {
    createdAt: {
      $gte: currentStartDateTime,
      $lte: currentEndDateTime,
    },
  };

  // Calculate previous period dates (same date range, one year before)
  const previousStartDate = new Date(currentStartDateTime);
  previousStartDate.setFullYear(previousStartDate.getFullYear() - 1);

  const previousEndDate = new Date(currentEndDateTime);
  previousEndDate.setFullYear(previousEndDate.getFullYear() - 1);

  const previousQuery = {
    createdAt: {
      $gte: previousStartDate,
      $lte: previousEndDate,
    },
  };

  // Get purchase orders for both periods
  const [currentPurchaseOrders, previousPurchaseOrders] = await Promise.all([
    PurchaseOrder.find({
      ...currentQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouseId: warehouseId } : {}),
    }).lean(),
    PurchaseOrder.find({
      ...previousQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouseId: warehouseId } : {}),
    }).lean(),
  ]);

  // Get sales orders for both periods
  const [currentSalesOrders, previousSalesOrders] = await Promise.all([
    SalesOrder.find({
      ...currentQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouse: warehouseId } : {}),
    })
      .populate('items.variant')
      .lean(),
    SalesOrder.find({
      ...previousQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouse: warehouseId } : {}),
    })
      .populate('items.variant')
      .lean(),
  ]);

  // Calculate sales and COGS for current period
  let currentTotalSales = 0;
  let currentCOGS = 0;
  currentSalesOrders.forEach(order => {
    // Only count sales if items weren't fully returned
    const actualSales = order.items.reduce((total, item) => {
      const soldQuantity = item.starterQuantity - (item.returnedQuantity || 0);
      if (soldQuantity > 0) {
        return total + item.unitPriceAfterDiscount * soldQuantity;
      }
      return total;
    }, 0);
    currentTotalSales += actualSales;

    // Calculate COGS only for actually sold items
    const orderCOGS = order.items.reduce((total, item) => {
      const soldQuantity = item.starterQuantity - (item.returnedQuantity || 0);
      if (soldQuantity > 0) {
        return total + (item.costWhenSold || 0) * soldQuantity;
      }
      return total;
    }, 0);
    currentCOGS += orderCOGS;
  });

  // Calculate sales and COGS for previous period
  let previousTotalSales = 0;
  let previousCOGS = 0;
  previousSalesOrders.forEach(order => {
    // Only count sales if items weren't fully returned
    const actualSales = order.items.reduce((total, item) => {
      const soldQuantity = item.starterQuantity - (item.returnedQuantity || 0);
      if (soldQuantity > 0) {
        return total + item.unitPriceAfterDiscount * soldQuantity;
      }
      return total;
    }, 0);
    previousTotalSales += actualSales;

    // Calculate COGS only for actually sold items
    const orderCOGS = order.items.reduce((total, item) => {
      const soldQuantity = item.starterQuantity - (item.returnedQuantity || 0);
      if (soldQuantity > 0) {
        return total + (item.costWhenSold || 0) * soldQuantity;
      }
      return total;
    }, 0);
    previousCOGS += orderCOGS;
  });

  const currentGrossProfit = currentTotalSales - currentCOGS;
  const previousGrossProfit = previousTotalSales - previousCOGS;

  // Get expenses for both periods
  const [currentExpenses, previousExpenses] = await Promise.all([
    Expense.find(currentQuery)
      .populate({
        path: 'paymentId',
        select: 'amountPaid warehouseId',
      })
      .lean(),
    Expense.find(previousQuery)
      .populate({
        path: 'paymentId',
        select: 'amountPaid warehouseId',
      })
      .lean(),
  ]);

  // Filter expenses by warehouse
  const filteredCurrentExpenses =
    warehouseId && warehouseId !== 'all' ? currentExpenses.filter(expense => expense.paymentId?.warehouseId?.toString() === warehouseId) : currentExpenses;

  const filteredPreviousExpenses =
    warehouseId && warehouseId !== 'all' ? previousExpenses.filter(expense => expense.paymentId?.warehouseId?.toString() === warehouseId) : previousExpenses;

  // Group current expenses by category
  const currentExpensesByCategory = filteredCurrentExpenses.reduce((acc, expense) => {
    const categoryName = expense.expenseCategory || 'Uncategorized';
    if (!acc[categoryName]) {
      acc[categoryName] = 0;
    }
    acc[categoryName] += expense.paymentId?.amountPaid || 0;
    return acc;
  }, {});

  // Group previous expenses by category
  const previousExpensesByCategory = filteredPreviousExpenses.reduce((acc, expense) => {
    const categoryName = expense.expenseCategory || 'Uncategorized';
    if (!acc[categoryName]) {
      acc[categoryName] = 0;
    }
    acc[categoryName] += expense.paymentId?.amountPaid || 0;
    return acc;
  }, {});

  // Calculate total expenses
  const currentTotalExpenses = Object.values(currentExpensesByCategory).reduce((a, b) => (a || 0) + (b || 0), 0);
  const previousTotalExpenses = Object.values(previousExpensesByCategory).reduce((a, b) => (a || 0) + (b || 0), 0);

  // Calculate net profit
  const currentNetProfit = currentGrossProfit - currentTotalExpenses;
  const previousNetProfit = previousGrossProfit - previousTotalExpenses;

  // Clean up any null values in expense categories
  Object.keys(currentExpensesByCategory).forEach(key => {
    currentExpensesByCategory[key] = currentExpensesByCategory[key] || 0;
  });

  Object.keys(previousExpensesByCategory).forEach(key => {
    previousExpensesByCategory[key] = previousExpensesByCategory[key] || 0;
  });

  // Prepare report data
  const reportData = {
    period: {
      current: {
        start: startDate,
        end: endDate,
      },
      previous: {
        start: previousStartDate,
        end: previousEndDate,
      },
    },
    sales: {
      current: currentTotalSales || 0,
      previous: previousTotalSales || 0,
    },
    cogs: {
      current: currentCOGS || 0,
      previous: previousCOGS || 0,
    },
    grossProfit: {
      current: currentGrossProfit || 0,
      previous: previousGrossProfit || 0,
    },
    expenses: {
      current: {
        byCategory: currentExpensesByCategory,
        total: currentTotalExpenses || 0,
      },
      previous: {
        byCategory: previousExpensesByCategory,
        total: previousTotalExpenses || 0,
      },
    },
    netProfit: {
      current: currentNetProfit || 0,
      previous: previousNetProfit || 0,
    },
  };

  // Get fixed assets for both periods
  const [currentFixedAssets, previousFixedAssets] = await Promise.all([
    FixedAsset.find({
      ...currentQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouseId: warehouseId } : {}),
    }).lean(),
    FixedAsset.find({
      ...previousQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouseId: warehouseId } : {}),
    }).lean(),
  ]);

  // Calculate loss value for current period
  const currentLossValue = currentFixedAssets.reduce((total, asset) => {
    const loss = asset.fairValue < asset.bookValue ? asset.bookValue - asset.fairValue : 0;
    return total + loss;
  }, 0);

  // Calculate loss value for previous period
  const previousLossValue = previousFixedAssets.reduce((total, asset) => {
    const loss = asset.fairValue < asset.bookValue ? asset.bookValue - asset.fairValue : 0;
    return total + loss;
  }, 0);

  reportData.netProfit.current -= currentLossValue;
  reportData.netProfit.previous -= previousLossValue;

  return reportData;
};

/**
 * Get Income Statement Report
 * @route GET /api/reports/income-statement
 * @description Generate income statement with sales, costs, expenses and profits
 */
exports.getIncomeStatementReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, warehouseId } = req.query;

  // Calculate date ranges for current and previous periods
  let currentStartDate, currentEndDate, previousStartDate, previousEndDate;

  if (startDate && endDate) {
    // Use provided date range
    currentStartDate = new Date(startDate);
    currentEndDate = new Date(endDate);

    // Calculate previous period as same date range but one year before
    previousStartDate = new Date(currentStartDate);
    previousStartDate.setFullYear(previousStartDate.getFullYear() - 1);
    previousEndDate = new Date(currentEndDate);
    previousEndDate.setFullYear(previousEndDate.getFullYear() - 1);
  } else {
    // Default to current year vs previous year
    const now = new Date();

    // Current period: Last year from now
    currentEndDate = now;
    currentStartDate = new Date(now);
    currentStartDate.setFullYear(currentStartDate.getFullYear() - 1);

    // Previous period: Year before the current period
    previousEndDate = new Date(currentStartDate);
    previousStartDate = new Date(currentStartDate);
    previousStartDate.setFullYear(previousStartDate.getFullYear() - 1);
  }

  // Create date objects for start of day and end of day without modifying original dates
  const currentStartDateTime = new Date(currentStartDate);
  currentStartDateTime.setHours(0, 0, 0, 0);

  const currentEndDateTime = new Date(currentEndDate);
  currentEndDateTime.setHours(23, 59, 59, 999);

  // Build base queries for current and previous periods
  const currentQuery = {
    createdAt: {
      $gte: currentStartDateTime,
      $lte: currentEndDateTime,
    },
  };

  // Recalculate previous period dates based on the time-adjusted current dates
  const previousStartDateTime = new Date(currentStartDateTime);
  previousStartDateTime.setFullYear(previousStartDateTime.getFullYear() - 1);

  const previousEndDateTime = new Date(currentEndDateTime);
  previousEndDateTime.setFullYear(previousEndDateTime.getFullYear() - 1);

  const previousQuery = {
    createdAt: {
      $gte: previousStartDateTime,
      $lte: previousEndDateTime,
    },
  };

  // Get purchase orders for both periods
  const [currentPurchaseOrders, previousPurchaseOrders] = await Promise.all([
    PurchaseOrder.find({
      ...currentQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouseId: warehouseId } : {}),
    }).lean(),
    PurchaseOrder.find({
      ...previousQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouseId: warehouseId } : {}),
    }).lean(),
  ]);

  // Get sales orders for both periods
  const [currentSalesOrders, previousSalesOrders] = await Promise.all([
    SalesOrder.find({
      ...currentQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouse: warehouseId } : {}),
    })
      .populate('items.variant')
      .lean(),
    SalesOrder.find({
      ...previousQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouse: warehouseId } : {}),
    })
      .populate('items.variant')
      .lean(),
  ]);

  // Calculate sales and COGS for current period
  let currentTotalSales = 0;
  let currentCOGS = 0;
  currentSalesOrders.forEach(order => {
    // Only count sales if items weren't fully returned
    const actualSales = order.items.reduce((total, item) => {
      const soldQuantity = item.starterQuantity - (item.returnedQuantity || 0);
      if (soldQuantity > 0) {
        return total + item.unitPriceAfterDiscount * soldQuantity;
      }
      return total;
    }, 0);
    currentTotalSales += actualSales;

    // Calculate COGS only for actually sold items
    const orderCOGS = order.items.reduce((total, item) => {
      const soldQuantity = item.starterQuantity - (item.returnedQuantity || 0);
      if (soldQuantity > 0) {
        return total + (item.costWhenSold || 0) * soldQuantity;
      }
      return total;
    }, 0);
    currentCOGS += orderCOGS;
  });

  // Calculate sales and COGS for previous period
  let previousTotalSales = 0;
  let previousCOGS = 0;
  previousSalesOrders.forEach(order => {
    // Only count sales if items weren't fully returned
    const actualSales = order.items.reduce((total, item) => {
      const soldQuantity = item.starterQuantity - (item.returnedQuantity || 0);
      if (soldQuantity > 0) {
        return total + item.unitPriceAfterDiscount * soldQuantity;
      }
      return total;
    }, 0);
    previousTotalSales += actualSales;

    // Calculate COGS only for actually sold items
    const orderCOGS = order.items.reduce((total, item) => {
      const soldQuantity = item.starterQuantity - (item.returnedQuantity || 0);
      if (soldQuantity > 0) {
        return total + (item.costWhenSold || 0) * soldQuantity;
      }
      return total;
    }, 0);
    previousCOGS += orderCOGS;
  });

  const currentGrossProfit = currentTotalSales - currentCOGS;
  const previousGrossProfit = previousTotalSales - previousCOGS;

  // Get expenses for both periods
  const [currentExpenses, previousExpenses] = await Promise.all([
    Expense.find(currentQuery)
      .populate({
        path: 'paymentId',
        select: 'amountPaid warehouseId',
      })
      .lean(),
    Expense.find(previousQuery)
      .populate({
        path: 'paymentId',
        select: 'amountPaid warehouseId',
      })
      .lean(),
  ]);

  // Filter expenses by warehouse
  const filteredCurrentExpenses =
    warehouseId && warehouseId !== 'all' ? currentExpenses.filter(expense => expense.paymentId?.warehouseId?.toString() === warehouseId) : currentExpenses;

  const filteredPreviousExpenses =
    warehouseId && warehouseId !== 'all' ? previousExpenses.filter(expense => expense.paymentId?.warehouseId?.toString() === warehouseId) : previousExpenses;

  // Group current expenses by category
  const currentExpensesByCategory = filteredCurrentExpenses.reduce((acc, expense) => {
    const categoryName = expense.expenseCategory || 'Uncategorized';
    if (!acc[categoryName]) {
      acc[categoryName] = 0;
    }
    acc[categoryName] += expense.paymentId?.amountPaid || 0;
    return acc;
  }, {});

  // Group previous expenses by category
  const previousExpensesByCategory = filteredPreviousExpenses.reduce((acc, expense) => {
    const categoryName = expense.expenseCategory || 'Uncategorized';
    if (!acc[categoryName]) {
      acc[categoryName] = 0;
    }
    acc[categoryName] += expense.paymentId?.amountPaid || 0;
    return acc;
  }, {});

  // Calculate total expenses
  const currentTotalExpenses = Object.values(currentExpensesByCategory).reduce((a, b) => (a || 0) + (b || 0), 0);
  const previousTotalExpenses = Object.values(previousExpensesByCategory).reduce((a, b) => (a || 0) + (b || 0), 0);

  // Calculate net profit
  const currentNetProfit = currentGrossProfit - currentTotalExpenses;
  const previousNetProfit = previousGrossProfit - previousTotalExpenses;

  // Clean up any null values in expense categories
  Object.keys(currentExpensesByCategory).forEach(key => {
    currentExpensesByCategory[key] = currentExpensesByCategory[key] || 0;
  });

  Object.keys(previousExpensesByCategory).forEach(key => {
    previousExpensesByCategory[key] = previousExpensesByCategory[key] || 0;
  });

  // Prepare report data
  const reportData = {
    period: {
      current: {
        start: currentStartDate,
        end: currentEndDate,
      },
      previous: {
        start: previousStartDate,
        end: previousEndDate,
      },
    },
    sales: {
      current: currentTotalSales || 0,
      previous: previousTotalSales || 0,
    },
    cogs: {
      current: currentCOGS || 0,
      previous: previousCOGS || 0,
    },
    grossProfit: {
      current: currentGrossProfit || 0,
      previous: previousGrossProfit || 0,
    },
    expenses: {
      current: {
        byCategory: currentExpensesByCategory,
        total: currentTotalExpenses || 0,
      },
      previous: {
        byCategory: previousExpensesByCategory,
        total: previousTotalExpenses || 0,
      },
    },
    netProfit: {
      current: currentNetProfit || 0,
      previous: previousNetProfit || 0,
    },
  };

  // Get fixed assets for both periods
  const [currentFixedAssets, previousFixedAssets] = await Promise.all([
    FixedAsset.find({
      ...currentQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouseId: warehouseId } : {}),
    }).lean(),
    FixedAsset.find({
      ...previousQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouseId: warehouseId } : {}),
    }).lean(),
  ]);

  // Calculate loss value for current period
  const currentLossValue = currentFixedAssets.reduce((total, asset) => {
    const loss = asset.fairValue < asset.bookValue ? asset.bookValue - asset.fairValue : 0;
    return total + loss;
  }, 0);

  // Calculate loss value for previous period
  const previousLossValue = previousFixedAssets.reduce((total, asset) => {
    const loss = asset.fairValue < asset.bookValue ? asset.bookValue - asset.fairValue : 0;
    return total + loss;
  }, 0);

  reportData.netProfit.current -= currentLossValue;
  reportData.netProfit.previous -= previousLossValue;

  res.status(200).json({
    status: 'success',
    data: {
      ...reportData,
      fixedAssets: {
        current: currentLossValue,
        previous: previousLossValue,
      },
    },
  });
});

/**
 * Export Income Statement Report to Excel
 * @route POST /api/reports/income-statement
 * @description Export income statement report to Excel
 */
exports.exportIncomeStatementReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, warehouseId } = req.query;

  // Calculate date ranges for current and previous periods
  let currentStartDate, currentEndDate, previousStartDate, previousEndDate;

  if (startDate && endDate) {
    // Use provided date range
    currentStartDate = new Date(startDate);
    currentEndDate = new Date(endDate);

    // Calculate previous period as same date range but one year before
    previousStartDate = new Date(currentStartDate);
    previousStartDate.setFullYear(previousStartDate.getFullYear() - 1);
    previousEndDate = new Date(currentEndDate);
    previousEndDate.setFullYear(previousEndDate.getFullYear() - 1);
  } else {
    // Default to current year vs previous year
    const now = new Date();

    // Current period: Last year from now
    currentEndDate = now;
    currentStartDate = new Date(now);
    currentStartDate.setFullYear(currentStartDate.getFullYear() - 1);

    // Previous period: Year before the current period
    previousEndDate = new Date(currentStartDate);
    previousStartDate = new Date(currentStartDate);
    previousStartDate.setFullYear(previousStartDate.getFullYear() - 1);
  }

  // Create date objects for start of day and end of day without modifying original dates
  const currentStartDateTime = new Date(currentStartDate);
  currentStartDateTime.setHours(0, 0, 0, 0);

  const currentEndDateTime = new Date(currentEndDate);
  currentEndDateTime.setHours(23, 59, 59, 999);

  // Build base queries for current and previous periods
  const currentQuery = {
    createdAt: {
      $gte: currentStartDateTime,
      $lte: currentEndDateTime,
    },
  };

  // Recalculate previous period dates based on the time-adjusted current dates
  const previousStartDateTime = new Date(currentStartDateTime);
  previousStartDateTime.setFullYear(previousStartDateTime.getFullYear() - 1);

  const previousEndDateTime = new Date(currentEndDateTime);
  previousEndDateTime.setFullYear(previousEndDateTime.getFullYear() - 1);

  const previousQuery = {
    createdAt: {
      $gte: previousStartDateTime,
      $lte: previousEndDateTime,
    },
  };

  // Get purchase orders for both periods
  const [currentPurchaseOrders, previousPurchaseOrders] = await Promise.all([
    PurchaseOrder.find({
      ...currentQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouseId: warehouseId } : {}),
    }).lean(),
    PurchaseOrder.find({
      ...previousQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouseId: warehouseId } : {}),
    }).lean(),
  ]);

  // Get sales orders for both periods
  const [currentSalesOrders, previousSalesOrders] = await Promise.all([
    SalesOrder.find({
      ...currentQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouse: warehouseId } : {}),
    })
      .populate('items.variant')
      .lean(),
    SalesOrder.find({
      ...previousQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouse: warehouseId } : {}),
    })
      .populate('items.variant')
      .lean(),
  ]);

  // Calculate sales and COGS for current period
  let currentTotalSales = 0;
  let currentCOGS = 0;
  currentSalesOrders.forEach(order => {
    // Only count sales if items weren't fully returned
    const actualSales = order.items.reduce((total, item) => {
      const soldQuantity = item.starterQuantity - (item.returnedQuantity || 0);
      if (soldQuantity > 0) {
        return total + item.unitPriceAfterDiscount * soldQuantity;
      }
      return total;
    }, 0);
    currentTotalSales += actualSales;

    // Calculate COGS only for actually sold items
    const orderCOGS = order.items.reduce((total, item) => {
      const soldQuantity = item.starterQuantity - (item.returnedQuantity || 0);
      if (soldQuantity > 0) {
        return total + (item.costWhenSold || 0) * soldQuantity;
      }
      return total;
    }, 0);
    currentCOGS += orderCOGS;
  });

  // Calculate sales and COGS for previous period
  let previousTotalSales = 0;
  let previousCOGS = 0;
  previousSalesOrders.forEach(order => {
    // Only count sales if items weren't fully returned
    const actualSales = order.items.reduce((total, item) => {
      const soldQuantity = item.starterQuantity - (item.returnedQuantity || 0);
      if (soldQuantity > 0) {
        return total + item.unitPriceAfterDiscount * soldQuantity;
      }
      return total;
    }, 0);
    previousTotalSales += actualSales;

    // Calculate COGS only for actually sold items
    const orderCOGS = order.items.reduce((total, item) => {
      const soldQuantity = item.starterQuantity - (item.returnedQuantity || 0);
      if (soldQuantity > 0) {
        return total + (item.costWhenSold || 0) * soldQuantity;
      }
      return total;
    }, 0);
    previousCOGS += orderCOGS;
  });

  const currentGrossProfit = currentTotalSales - currentCOGS;
  const previousGrossProfit = previousTotalSales - previousCOGS;

  // Get expenses for both periods
  const [currentExpenses, previousExpenses] = await Promise.all([
    Expense.find(currentQuery)
      .populate({
        path: 'paymentId',
        select: 'amountPaid warehouseId',
      })
      .lean(),
    Expense.find(previousQuery)
      .populate({
        path: 'paymentId',
        select: 'amountPaid warehouseId',
      })
      .lean(),
  ]);

  // Filter expenses by warehouse
  const filteredCurrentExpenses =
    warehouseId && warehouseId !== 'all' ? currentExpenses.filter(expense => expense.paymentId?.warehouseId?.toString() === warehouseId) : currentExpenses;

  const filteredPreviousExpenses =
    warehouseId && warehouseId !== 'all' ? previousExpenses.filter(expense => expense.paymentId?.warehouseId?.toString() === warehouseId) : previousExpenses;

  // Group current expenses by category
  const currentExpensesByCategory = filteredCurrentExpenses.reduce((acc, expense) => {
    const categoryName = expense.expenseCategory || 'Uncategorized';
    if (!acc[categoryName]) {
      acc[categoryName] = 0;
    }
    acc[categoryName] += expense.paymentId?.amountPaid || 0;
    return acc;
  }, {});

  // Group previous expenses by category
  const previousExpensesByCategory = filteredPreviousExpenses.reduce((acc, expense) => {
    const categoryName = expense.expenseCategory || 'Uncategorized';
    if (!acc[categoryName]) {
      acc[categoryName] = 0;
    }
    acc[categoryName] += expense.paymentId?.amountPaid || 0;
    return acc;
  }, {});

  // Calculate total expenses
  const currentTotalExpenses = Object.values(currentExpensesByCategory).reduce((a, b) => (a || 0) + (b || 0), 0);
  const previousTotalExpenses = Object.values(previousExpensesByCategory).reduce((a, b) => (a || 0) + (b || 0), 0);

  // Get fixed assets for both periods
  const [currentFixedAssets, previousFixedAssets] = await Promise.all([
    FixedAsset.find({
      ...currentQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouseId: warehouseId } : {}),
    }).lean(),
    FixedAsset.find({
      ...previousQuery,
      ...(warehouseId && warehouseId !== 'all' ? { warehouseId: warehouseId } : {}),
    }).lean(),
  ]);

  // Calculate loss value for current period
  const currentLossValue = currentFixedAssets.reduce((total, asset) => {
    const loss = asset.fairValue < asset.bookValue ? asset.bookValue - asset.fairValue : 0;
    return total + loss;
  }, 0);

  // Calculate loss value for previous period
  const previousLossValue = previousFixedAssets.reduce((total, asset) => {
    const loss = asset.fairValue < asset.bookValue ? asset.bookValue - asset.fairValue : 0;
    return total + loss;
  }, 0);

  // Calculate net profit
  const currentNetProfit = currentGrossProfit - currentTotalExpenses - currentLossValue;
  const previousNetProfit = previousGrossProfit - previousTotalExpenses - previousLossValue;

  // Format dates for Excel
  const formatDate = date => {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Prepare Excel data
  const headers = ['Description', 'Current Period', 'Previous Period', 'Change %'];
  const excelData = [
    ['Period:', `${formatDate(currentStartDate)} - ${formatDate(currentEndDate)}`, `${formatDate(previousStartDate)} - ${formatDate(previousEndDate)}`, ''],
    ['', '', '', ''],
    [
      'Sales',
      Number(currentTotalSales.toFixed(2)),
      Number(previousTotalSales.toFixed(2)),
      previousTotalSales ? (((currentTotalSales - previousTotalSales) / previousTotalSales) * 100).toFixed(2) + '%' : 'N/A',
    ],
    ['COGS', Number(currentCOGS.toFixed(2)), Number(previousCOGS.toFixed(2)), previousCOGS ? (((currentCOGS - previousCOGS) / previousCOGS) * 100).toFixed(2) + '%' : 'N/A'],
    [
      'Gross Profit',
      Number(currentGrossProfit.toFixed(2)),
      Number(previousGrossProfit.toFixed(2)),
      previousGrossProfit ? (((currentGrossProfit - previousGrossProfit) / previousGrossProfit) * 100).toFixed(2) + '%' : 'N/A',
    ],
    ['', '', '', ''],
    ['Expenses:', '', '', ''],
  ];

  // Add expense categories
  const allCategories = new Set([...Object.keys(currentExpensesByCategory), ...Object.keys(previousExpensesByCategory)]);

  allCategories.forEach(category => {
    const currentAmount = currentExpensesByCategory[category] || 0;
    const previousAmount = previousExpensesByCategory[category] || 0;
    const change = previousAmount ? (((currentAmount - previousAmount) / previousAmount) * 100).toFixed(2) + '%' : 'N/A';

    excelData.push([
      category.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), // Format category name
      Number(currentAmount.toFixed(2)),
      Number(previousAmount.toFixed(2)),
      change,
    ]);
  });

  // Add totals
  excelData.push(
    ['', '', '', ''],
    [
      'Total Expenses',
      Number(currentTotalExpenses.toFixed(2)),
      Number(previousTotalExpenses.toFixed(2)),
      previousTotalExpenses ? (((currentTotalExpenses - previousTotalExpenses) / previousTotalExpenses) * 100).toFixed(2) + '%' : 'N/A',
    ],
    ['', '', '', ''],
    [
      'Fixed Assets Loss',
      Number(currentLossValue.toFixed(2)),
      Number(previousLossValue.toFixed(2)),
      previousLossValue ? (((currentLossValue - previousLossValue) / previousLossValue) * 100).toFixed(2) + '%' : 'N/A',
    ],
    ['', '', '', ''],
    [
      'Net Profit',
      Number(currentNetProfit.toFixed(2)),
      Number(previousNetProfit.toFixed(2)),
      previousNetProfit ? (((currentNetProfit - previousNetProfit) / previousNetProfit) * 100).toFixed(2) + '%' : 'N/A',
    ]
  );

  // Export to Excel using the utility function
  await exportToExcel(res, 'Income_Statement_Report', headers, excelData);
});
