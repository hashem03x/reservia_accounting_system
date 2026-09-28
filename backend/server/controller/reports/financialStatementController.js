const asyncHandler = require('express-async-handler');
const SalesOrder = require('../../models/sales/salesOrderModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const Expense = require('../../models/expense/expenseModel');
const exportToExcel = require('../../utils/exportToExcel');

/**
 * Get Financial Statement Report
 * @route GET /api/reports/financial-statement
 * @description Generate financial statement with assets, liabilities and equity
 */
exports.getFinancialStatementReport = asyncHandler(async (req, res) => {
    const { date } = req.query;
    const queryDate = date ? new Date(date) : new Date();

    // Calculate Assets
    // 1. Cash (from transactions)
    const salesOrders = await SalesOrder.find({
        createdAt: { $lte: queryDate },
        paymentStatus: 'paid'
    });
    const totalCash = salesOrders.reduce((sum, order) => sum + order.paidAmount, 0);

    // 2. Inventory (current stock value)
    const purchaseOrders = await PurchaseOrder.find({
        createdAt: { $lte: queryDate }
    }).populate('items.variantId');
    const totalInventory = purchaseOrders.reduce((sum, order) => {
        return sum + order.items.reduce((itemSum, item) => {
            const remainingQuantity = item.starterQuantity - (item.returnedQuantity || 0);
            return itemSum + (remainingQuantity * item.unitPrice);
        }, 0);
    }, 0);

    // 3. Accounts Receivable (unpaid sales orders)
    const unpaidSalesOrders = await SalesOrder.find({
        createdAt: { $lte: queryDate },
        paymentStatus: { $in: ['unpaid', 'partial'] }
    });
    const accountsReceivable = unpaidSalesOrders.reduce((sum, order) => sum + order.remainingAmount, 0);

    // Calculate Liabilities
    // 1. Accounts Payable (unpaid purchase orders)
    const unpaidPurchaseOrders = await PurchaseOrder.find({
        createdAt: { $lte: queryDate },
        paymentStatus: { $in: ['unpaid', 'partial'] }
    });
    const accountsPayable = unpaidPurchaseOrders.reduce((sum, order) => sum + order.remainingAmount, 0);

    // Calculate Equity
    // 1. Capital (fixed value for now, should be stored in settings)
    const capital = 2000000; // 2 million as shown in the image

    // 2. Calculate Retained Earnings
    // Get all historical sales
    const historicalSales = await SalesOrder.find({
        createdAt: { $lte: queryDate }
    });
    const totalRevenue = historicalSales.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    // Get all historical costs
    const historicalCosts = await PurchaseOrder.find({
        createdAt: { $lte: queryDate }
    });
    const totalCosts = historicalCosts.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    // Get all historical expenses
    const historicalExpenses = await Expense.find({
        createdAt: { $lte: queryDate }
    }).populate('paymentId');
    const totalExpenses = historicalExpenses.reduce((sum, expense) => {
        const amount = expense.paymentId ? expense.paymentId.amount || 0 : 0;
        return sum + amount;
    }, 0);

    // Retained Earnings = Revenue - Costs - Expenses
    const retainedEarnings = totalRevenue - totalCosts - totalExpenses;

    // Calculate totals
    const totalAssets = totalCash + totalInventory + accountsReceivable;
    const totalLiabilities = accountsPayable;
    const totalEquity = capital + retainedEarnings;

    // Prepare response
    const response = {
        date: queryDate,
        assets: {
            cash: Number(totalCash.toFixed(2)),
            inventory: Number(totalInventory.toFixed(2)),
            accountsReceivable: Number(accountsReceivable.toFixed(2)),
            totalAssets: Number(totalAssets.toFixed(2))
        },
        liabilities: {
            accountsPayable: Number(accountsPayable.toFixed(2)),
            totalLiabilities: Number(totalLiabilities.toFixed(2))
        },
        equity: {
            capital: Number(capital.toFixed(2)),
            retainedEarnings: Number(retainedEarnings.toFixed(2)),
            totalEquity: Number(totalEquity.toFixed(2))
        },
        // For validation
        totalLiabilitiesPlusEquity: Number((totalLiabilities + totalEquity).toFixed(2))
    };

    res.status(200).json({
        status: 'success',
        data: response
    });
});

/**
 * Export Financial Statement Report to Excel
 * @route POST /api/reports/financial-statement/export
 */
exports.exportFinancialStatementReport = asyncHandler(async (req, res) => {
    const { date } = req.query;
    const queryDate = date ? new Date(date) : new Date();

    // Get the financial statement data
    const report = await getFinancialStatementData(queryDate);

    // Prepare data for Excel
    const data = [
        ['Financial Statement', '', '', ''],
        ['As of ' + queryDate.toLocaleDateString(), '', '', ''],
        ['', '', '', ''],
        ['Assets:', '', '', ''],
        ['Current Assets:', '', '', ''],
        ['Cash', report.assets.cash, '', ''],
        ['Inventory', report.assets.inventory, '', ''],
        ['Accounts Receivable', report.assets.accountsReceivable, '', ''],
        ['Total Assets', report.assets.totalAssets, '', ''],
        ['', '', '', ''],
        ['Liabilities:', '', '', ''],
        ['Current Liabilities:', '', '', ''],
        ['Accounts Payable', report.liabilities.accountsPayable, '', ''],
        ['Total Liabilities', report.liabilities.totalLiabilities, '', ''],
        ['', '', '', ''],
        ['Equity:', '', '', ''],
        ['Capital', report.equity.capital, '', ''],
        ['Retained Earnings', report.equity.retainedEarnings, '', ''],
        ['Total Equity', report.equity.totalEquity, '', ''],
        ['', '', '', ''],
        ['Total Liabilities + Equity', report.totalLiabilitiesPlusEquity, '', '']
    ];

    // Export to Excel
    const workbook = await exportToExcel(data, 'Financial Statement');

    res.status(200).json({
        status: 'success',
        data: workbook
    });
});
