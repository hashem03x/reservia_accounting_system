const express = require('express');
const { getVendorReport, exportVendorReportExcel } = require('../controller/reports/vendorsReportController');
const { getCustomerReport, exportCustomerReportExcel } = require('../controller/reports/customersReportController');
const { getPurchaseOrderReport, exportPurchaseOrderReportExcel } = require('../controller/reports/purchaseOrderReportController');
const { getSalesOrderReport, exportSalesOrderReportExcel } = require('../controller/reports/salesOrderReportController');
const { getProductsReport, exportProductsReportExcel } = require('../controller/reports/productsReportController');
const { getVariantHistoryReport, exportVariantHistoryReportExcel } = require('../controller/reports/variantHistoryReportController');
const { getSalesOrderProfitReport, generateSalesOrderProfitReport } = require('../controller/reports/salesOrderProfitReportController');
const { getExpensesReport, generateExpensesReportExcel } = require('../controller/reports/expensesReportController');
const { getProductPriceList, generateProductPriceListExcel } = require('../controller/reports/productPriceListReportController');
const { getVariantStockReport, generateVariantStockReportExcel } = require('../controller/reports/variantStockReportController');
const { getInventorySummaryReport, generateInventorySummaryExcel } = require('../controller/reports/inventorySummaryReportController');
const { getInventoryMovementReport, generateInventoryMovementExcel } = require('../controller/reports/inventoryMovementReportController');
const { getInventoryTransferReport, generateInventoryTransferExcel } = require('../controller/reports/inventoryTransferReportController');
const { getTreasuryBalanceReport, generateTreasuryBalanceExcel } = require('../controller/reports/treasuryBalanceReportController');
const { getProfitBySalesReport, exportProfitBySalesReport } = require('../controller/reports/profitBySalesReportController');
const { getProfitByCustomerReport, exportProfitByCustomerReport } = require('../controller/reports/profitByCustomerReportController');
const { getProfitByProductReport, exportProfitByProductReport } = require('../controller/reports/profitByProductReportController');
const { getReturnsReport, exportReturnsReport } = require('../controller/reports/returnsReportController');
const { getIncomeStatementReport, exportIncomeStatementReport } = require('../controller/reports/incomeStatementController');
const { getFinancialStatementReport, exportFinancialStatementReport } = require('../controller/reports/financialStatementController');
const { getFixedAssetsReport, exportFixedAssetsReport } = require('../controller/reports/fixedAssetsReportController');
const { getBalanceSheetReport, exportBalanceSheetReport } = require('../controller/reports/balanceSheetController');
const { getPaymentReport, exportPaymentReportExcel } = require('../controller/reports/paymentReportController');
const { Resources, Actions } = require('../utils/appConstant');
const authController = require('../controller/user/authController');
const { checkUserPermissions } = require('../middleware/hasPermission');

const router = express.Router();

router.use(authController.protect);
router.use(checkUserPermissions({ resource: Resources.reports, action: Actions.read }));

router.route('/vendors').get(getVendorReport).post(exportVendorReportExcel);

router.route('/customers').get(getCustomerReport).post(exportCustomerReportExcel);

router.route('/purchase-orders').get(getPurchaseOrderReport).post(exportPurchaseOrderReportExcel);

router.route('/sales-orders').get(getSalesOrderReport).post(exportSalesOrderReportExcel);

router.route('/products').get(getProductsReport).post(exportProductsReportExcel);

router.route('/payments').get(getPaymentReport).post(exportPaymentReportExcel);

router.route('/variant-history').get(getVariantHistoryReport).post(exportVariantHistoryReportExcel);

router.route('/variant-stock').get(getVariantStockReport).post(generateVariantStockReportExcel);

router.route('/sales-profit').get(getSalesOrderProfitReport).post(generateSalesOrderProfitReport);

router.route('/expenses').get(getExpensesReport).post(generateExpensesReportExcel);

router.route('/price-list').get(getProductPriceList).post(generateProductPriceListExcel);

router.route('/inventory-summary').get(getInventorySummaryReport).post(generateInventorySummaryExcel);

router.route('/inventory-transfer').get(getInventoryTransferReport).post(generateInventoryTransferExcel);

router.route('/treasury-balance').get(getTreasuryBalanceReport).post(generateTreasuryBalanceExcel);

router.route('/profit-by-sales').get(getProfitBySalesReport).post(exportProfitBySalesReport);

router.route('/profit-by-customer').get(getProfitByCustomerReport).post(exportProfitByCustomerReport);

router.route('/profit-by-product').get(getProfitByProductReport).post(exportProfitByProductReport);

router.route('/returns').get(getReturnsReport).post(exportReturnsReport);

router.route('/income-statement').get(getIncomeStatementReport).post(exportIncomeStatementReport);

// router.route('/financial-statement').get(getFinancialStatementReport).post(exportFinancialStatementReport);

router.route('/balance-sheet').get(getBalanceSheetReport).post(exportBalanceSheetReport);

router.route('/fixed-assets').get(getFixedAssetsReport).post(exportFixedAssetsReport);

module.exports = router;
