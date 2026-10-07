const Project = require('../../models/project/projectModel');
const SalesOrder = require('../../models/sales/salesOrderModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const { getTrialBalance } = require('../accounting/generalLedgerService');
const { CashEquivalentParentGroupName, AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');
const { ORDER_TOTAL_AMOUNT_EXPR } = require('../../utils/orderTotals');
const { ACCOUNT_CODE_COLLATION, ACCOUNT_CODE_SORT } = require('../../utils/accountCodeSort');

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// How many trailing months the Sales Trend chart covers - a fixed, small window (not "all time")
// keeps the aggregation cheap regardless of how long the company has been using the system.
const SALES_TREND_MONTHS = 6;

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Builds the Admin Home dashboard's single read-only summary (docs section "Admin Home /
 * Dashboard"). Deliberately NOT "load every Project/SalesOrder/PurchaseOrder/JournalEntry into the
 * browser and reduce in React" - every figure here is computed server-side via a small, fixed
 * number of cheap queries/aggregations, regardless of how much historical data exists. Nothing
 * here writes to or alters any accounting data - purely derived read-only figures, reusing the
 * exact same eligibility/balance logic already used elsewhere (the same two-signal query
 * isPaymentAccountEligible()/getCashEquivalentAccounts use, getTrialBalance, the orders' canonical
 * Total Amount from utils/orderTotals.js) rather than inventing a second definition of any of them.
 */
async function getDashboardSummaryData() {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - (SALES_TREND_MONTHS - 1));
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const [activeProjects, salesTotalsRaw, purchaseTotalsRaw, salesTrendRaw, cashAccounts, trialBalance] = await Promise.all([
    // Small collection (one row per real project, not per transaction) - a plain find is fine, no
    // aggregation needed just to sum a handful of documents' contractValue.
    Project.find({ isDeleted: { $ne: true }, status: 'active' }).select('_id contractValue').lean(),

    // Order KPIs use each order's final Total Amount (grandTotal = subtotal + VAT - withholding),
    // read through the one shared expression in utils/orderTotals.js - never the pre-tax subtotal.
    SalesOrder.aggregate([
      { $match: { orderStatus: { $ne: 'canceled' } } },
      { $group: { _id: null, total: { $sum: ORDER_TOTAL_AMOUNT_EXPR }, count: { $sum: 1 } } },
    ]),

    // PurchaseOrder has no cancellation concept today (no orderStatus field) - every order counts.
    PurchaseOrder.aggregate([{ $group: { _id: null, total: { $sum: ORDER_TOTAL_AMOUNT_EXPR }, count: { $sum: 1 } } }]),

    SalesOrder.aggregate([
      { $match: { orderStatus: { $ne: 'canceled' }, createdAt: { $gte: sixMonthsAgo } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, total: { $sum: ORDER_TOTAL_AMOUNT_EXPR } } },
    ]),

    // Same two-signal eligibility query as isPaymentAccountEligible()/getCashEquivalentAccounts -
    // never a second definition of "Cash & Cash Equivalents" (docs section "Cash & Cash
    // Equivalents").
    ChartOfAccount.find({
      type: 'asset',
      isActive: true,
      $or: [{ parentGroupNameEn: CashEquivalentParentGroupName }, { state: { $in: ['cash', 'cash-equivalent'] } }],
    })
      .select('code name nameAr')
      .sort(ACCOUNT_CODE_SORT)
      .collation(ACCOUNT_CODE_COLLATION)
      .lean(),

    // Single aggregation across every posted Journal Entry line, grouped by account - the exact
    // same function the Chart of Accounts/Journal Entries module already uses, not a second
    // balance-computation mechanism.
    getTrialBalance(),
  ]);

  const activeProjectIds = activeProjects.map(p => p._id);
  const totalContractValue = round2(activeProjects.reduce((sum, p) => sum + (p.contractValue || 0), 0));

  // Executed % deliberately stays on the PRE-TAX subtotal (`totalAmount`), matching
  // projectAccountingService.js#recalculateExecutedPercentage exactly: executed % drives
  // PROJECT_REVENUE_RECOGNITION, and revenue must never include VAT (VAT is a liability, not
  // revenue). Using the VAT-inclusive total here would overstate execution and recognized revenue.
  const [activeProjectsSalesRaw] = await SalesOrder.aggregate([
    { $match: { project: { $in: activeProjectIds }, orderStatus: { $ne: 'canceled' } } },
    { $group: { _id: null, total: { $sum: '$totalAmount' } } },
  ]);
  const activeProjectsSales = round2(activeProjectsSalesRaw?.total || 0);
  const executedPercentage = totalContractValue > 0 ? Math.min(100, round2((activeProjectsSales / totalContractValue) * 100)) : 0;

  const balanceByAccountId = new Map(trialBalance.map(row => [row.account._id.toString(), row.balance]));
  const cashAccountsWithBalance = cashAccounts.map(account => ({
    _id: account._id,
    code: account.code,
    name: account.name,
    nameAr: account.nameAr,
    balance: round2(balanceByAccountId.get(account._id.toString()) || 0),
  }));
  const totalCash = round2(cashAccountsWithBalance.reduce((sum, a) => sum + a.balance, 0));

  const arRow = trialBalance.find(row => row.account.code === AutomaticJournalAccountCodes.accountsReceivableProjects);
  const apRow = trialBalance.find(row => row.account.code === AutomaticJournalAccountCodes.suppliers);
  // Asset account - a debit balance (balance > 0) is a real amount owed TO the company.
  const totalReceivables = Math.max(0, round2(arRow?.balance || 0));
  // Liability account - a credit balance (balance < 0, since balance = debit - credit) is a real
  // amount owed BY the company; shown as a positive "outstanding" figure.
  const totalPayables = Math.max(0, round2(-(apRow?.balance || 0)));

  // Fill in any month with zero sales activity so the trend chart never silently skips a month -
  // the frontend must never see gaps it would otherwise have to guess about.
  const salesTrendByMonth = new Map(salesTrendRaw.map(row => [row._id, round2(row.total)]));
  const salesTrend = [];
  for (let i = SALES_TREND_MONTHS - 1; i >= 0; i -= 1) {
    const d = new Date(sixMonthsAgo);
    d.setMonth(d.getMonth() + (SALES_TREND_MONTHS - 1 - i));
    const key = monthKey(d);
    salesTrend.push({ month: key, total: salesTrendByMonth.get(key) || 0 });
  }

  const salesTotals = salesTotalsRaw[0] || { total: 0, count: 0 };
  const purchaseTotals = purchaseTotalsRaw[0] || { total: 0, count: 0 };

  return {
    projects: {
      activeCount: activeProjects.length,
      totalContractValue,
      executedPercentage,
    },
    sales: { total: round2(salesTotals.total || 0), count: salesTotals.count || 0 },
    purchases: { total: round2(purchaseTotals.total || 0), count: purchaseTotals.count || 0 },
    cash: { total: totalCash, accounts: cashAccountsWithBalance },
    receivables: { total: totalReceivables },
    payables: { total: totalPayables },
    salesTrend,
  };
}

module.exports = { getDashboardSummaryData };
