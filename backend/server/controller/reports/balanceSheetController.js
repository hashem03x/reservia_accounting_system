const asyncHandler = require('express-async-handler');
const FixedAsset = require('../../models/fixedAssets');
const Warehouse = require('../../models/inventory/warehouseModel');
const Payment = require('../../models/vendor/paymentModel');
const User = require('../../models/userModel');
const Product = require('../../models/inventory/productModel');
const Vendor = require('../../models/vendor/vendor');
const { getNetProfit } = require('./incomeStatementController');
const exportToExcel = require('../../utils/exportToExcel');

/**
 * Get Balance Sheet Report
 * @route GET /api/reports/balance-sheet
 * @description Generate balance sheet with assets, liabilities and equity
 */
exports.getBalanceSheetReport = asyncHandler(async (req, res) => {
  let { endDate } = req.query;

  if (!endDate) {
    endDate = new Date();
  }

  // Build query for date filtering
  const dateQuery = endDate
    ? {
        createdAt: {
          $lte: new Date(new Date(endDate).setHours(23, 59, 59)),
        },
      }
    : {};

  // 1. Calculate Non-current assets (Fixed Assets)
  const fixedAssets = await FixedAsset.find(dateQuery);
  const totalNonCurrentAssets = fixedAssets.reduce((sum, asset) => sum + (asset.bookValue || 0), 0);

  // 2. Calculate Current Assets
  // Get warehouse balances
  const warehouses = await Warehouse.find(dateQuery);
  const totalWarehouseBalance = warehouses.reduce((sum, warehouse) => sum + warehouse.balance, 0);

  // Get currency transfer payments
  const currencyTransfers = await Payment.find({
    ...dateQuery,
    paymentCategory: 'currency-transfer',
    type: 'out',
  });
  const currencyTransferAmountIn = await Payment.find({
    ...dateQuery,
    paymentCategory: 'currency-transfer',
    type: 'in',
  });

  const totalCurrencyTransfersIn = currencyTransferAmountIn.reduce((sum, payment) => sum + payment.amountPaid, 0);
  const totalCurrencyTransfers = currencyTransfers.reduce((sum, payment) => sum + payment.amountPaid, 0) - totalCurrencyTransfersIn;

  // 3. Calculate Inventory value
  // A product carries its own stock directly now (see docs/entities/products.md) - no separate
  // Variant to populate.
  const products = await Product.find({
    ...dateQuery,
    isDeleted: false,
  })
    .select('stock cost')
    .lean();

  let totalValue = 0;
  for (const product of products) {
    const stockLevel = (product.stock || []).reduce((sum, s) => sum + (s.quantity || 0), 0);
    totalValue += stockLevel * (product.cost || 0);
  }

  // 4. Calculate Accounts Receivable
  const users = await User.find(dateQuery);
  const totalAccountsReceivable = users.reduce((sum, user) => sum + (user.balance || 0), 0) * -1;

  // const totalCurrentAssets = totalWarehouseBalance + totalCurrencyTransfers + totalInventoryValue + totalAccountsReceivable;
  const totalCurrentAssets = totalWarehouseBalance + totalCurrencyTransfers + totalValue + totalAccountsReceivable;

  // Total Assets
  const totalAssets = totalNonCurrentAssets + totalCurrentAssets;

  // 5 & 6. Calculate Equity components
  const equityVendors = await Vendor.find({
    ...dateQuery,
    type: 'equity',
  });

  const capital = equityVendors.find(v => v.name === 'Capital')?.balance || 0;
  const retainedEarnings = equityVendors.find(v => v.name === 'Retained Earnings')?.balance || 0;

  // 7. Calculate Net Profit
  const incomeStatement = await getNetProfit(endDate);
  // console.log('incomeStatement__>>> 😶‍🌫️😶‍🌫️😶‍🌫️', incomeStatement);

  // 8. Non-current liabilities (empty for now)
  const totalNonCurrentLiabilities = 0;

  // 9. Current liabilities
  const currentLiabilities = await Vendor.find({
    ...dateQuery,
    type: 'current',
  });
  const totalCurrentLiabilities = currentLiabilities.reduce((sum, vendor) => sum + vendor.balance, 0);

  // Total Liabilities
  const totalLiabilities = totalNonCurrentLiabilities + totalCurrentLiabilities;

  // Total Equity
  const totalEquity = capital + retainedEarnings + incomeStatement.netProfit.current;

  // Prepare response
  const balanceSheet = {
    assets: {
      nonCurrentAssets: {
        fixedAssets: totalNonCurrentAssets,
        total: totalNonCurrentAssets,
      },
      currentAssets: {
        cashAndBank: totalWarehouseBalance + totalCurrencyTransfers,
        inventory: totalValue,
        accountsReceivable: totalAccountsReceivable,
        total: totalCurrentAssets,
      },
      total: totalAssets,
    },
    liabilitiesAndEquity: {
      equity: {
        capital,
        retainedEarnings,
        netProfit: incomeStatement.netProfit.current,
        total: totalEquity,
      },
      liabilities: {
        nonCurrentLiabilities: {
          total: totalNonCurrentLiabilities,
        },
        currentLiabilities: {
          total: totalCurrentLiabilities,
        },
        total: totalLiabilities,
      },
      total: totalEquity + totalLiabilities,
    },
  };

  res.json({
    status: 'success',
    data: balanceSheet,
  });
});

/**
 * Export Balance Sheet Report to Excel
 * @route POST /api/reports/balance-sheet
 * @description Export balance sheet report to Excel
 */
exports.exportBalanceSheetReport = asyncHandler(async (req, res) => {
  let { endDate } = req.query;

  if (!endDate) {
    endDate = new Date();
  }

  // Build query for date filtering
  const dateQuery = endDate
    ? {
        createdAt: {
          $lte: new Date(new Date(endDate).setHours(23, 59, 59)),
        },
      }
    : {};

  // 1. Calculate Non-current assets (Fixed Assets)
  const fixedAssets = await FixedAsset.find(dateQuery);
  const totalNonCurrentAssets = fixedAssets.reduce((sum, asset) => sum + (asset.bookValue || 0), 0);

  // 2. Calculate Current Assets
  // Get warehouse balances
  const warehouses = await Warehouse.find(dateQuery);
  const totalWarehouseBalance = warehouses.reduce((sum, warehouse) => sum + warehouse.balance, 0);

  // Get currency transfer payments
  const currencyTransfers = await Payment.find({
    ...dateQuery,
    paymentCategory: 'currency-transfer',
    type: 'out',
  });
  const currencyTransferAmountIn = await Payment.find({
    ...dateQuery,
    paymentCategory: 'currency-transfer',
    type: 'in',
  });

  const totalCurrencyTransfersIn = currencyTransferAmountIn.reduce((sum, payment) => sum + payment.amountPaid, 0);
  const totalCurrencyTransfers = currencyTransfers.reduce((sum, payment) => sum + payment.amountPaid, 0) - totalCurrencyTransfersIn;

  // 3. Calculate Inventory value
  // A product carries its own stock directly now (see docs/entities/products.md) - no separate
  // Variant to populate.
  const products = await Product.find({
    ...dateQuery,
    isDeleted: false,
  })
    .select('stock cost')
    .lean();

  let totalValue = 0;
  for (const product of products) {
    const stockLevel = (product.stock || []).reduce((sum, s) => sum + (s.quantity || 0), 0);
    totalValue += stockLevel * (product.cost || 0);
  }

  // 4. Calculate Accounts Receivable
  const users = await User.find(dateQuery);
  const totalAccountsReceivable = users.reduce((sum, user) => sum + (user.balance || 0), 0) * -1;

  const totalCurrentAssets = totalWarehouseBalance + totalCurrencyTransfers + totalValue + totalAccountsReceivable;

  // Total Assets
  const totalAssets = totalNonCurrentAssets + totalCurrentAssets;

  // 5 & 6. Calculate Equity components
  const equityVendors = await Vendor.find({
    ...dateQuery,
    type: 'equity',
  });

  const capital = equityVendors.find(v => v.name === 'Capital')?.balance || 0;
  const retainedEarnings = equityVendors.find(v => v.name === 'Retained Earnings')?.balance || 0;

  // 7. Calculate Net Profit
  const incomeStatement = await getNetProfit(endDate);

  // 8. Non-current liabilities (empty for now)
  const totalNonCurrentLiabilities = 0;

  // 9. Current liabilities
  const currentLiabilities = await Vendor.find({
    ...dateQuery,
    type: 'current',
  });
  const totalCurrentLiabilities = currentLiabilities.reduce((sum, vendor) => sum + vendor.balance, 0);

  // Total Liabilities
  const totalLiabilities = totalNonCurrentLiabilities + totalCurrentLiabilities;

  // Total Equity
  const totalEquity = capital + retainedEarnings + incomeStatement.netProfit.current;

  const headers = ['Category', 'Item', 'Amount'];

  const data = [
    ['Assets', 'Non-current Assets', ''],
    ['', 'Fixed Assets', totalNonCurrentAssets],
    ['', 'Total Non-current Assets', totalNonCurrentAssets],
    ['', '', ''],
    ['', 'Current Assets', ''],
    ['', 'Cash and Bank', totalWarehouseBalance + totalCurrencyTransfers],
    ['', 'Inventory', totalValue],
    ['', 'Accounts Receivable', totalAccountsReceivable],
    ['', 'Total Current Assets', totalCurrentAssets],
    ['', '', ''],
    ['', 'TOTAL ASSETS', totalAssets],
    ['', '', ''],
    ['Liabilities and Equity', 'Equity', ''],
    ['', 'Capital', capital],
    ['', 'Retained Earnings', retainedEarnings],
    ['', 'Net Profit', incomeStatement.netProfit.current],
    ['', 'Total Equity', totalEquity],
    ['', '', ''],
    ['', 'Liabilities', ''],
    ['', 'Non-current Liabilities', totalNonCurrentLiabilities],
    ['', 'Current Liabilities', totalCurrentLiabilities],
    ['', 'Total Liabilities', totalLiabilities],
    ['', '', ''],
    ['', 'TOTAL LIABILITIES AND EQUITY', totalEquity + totalLiabilities],
  ];

  const options = {
    totalRow: ['', 'Balance', totalAssets === totalEquity + totalLiabilities ? 'Balanced' : 'Not Balanced'],
  };

  await exportToExcel(res, 'balance-sheet-report', headers, data, options);
});
