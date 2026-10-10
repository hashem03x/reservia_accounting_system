const JournalEntry = require('../../models/accounting/journalEntryModel');
const ApiError = require('../../utils/apiError');
const { AutomaticJournalAccountCodes, isPaymentAccountEligible } = require('../../utils/accountingConstants');
const { isDepreciationExpenseAccount } = require('../fixedAssets/fixedAssetAccounts');
const C = require('../reports/reportCommon');
const { cashMovements } = require('../reports/financialStatements');

// Financial Analytics dashboard (GET /analytics/financial-dashboard). Built on the same ledger
// foundation as the accounting reports (services/reports/*): posted + reversed entries count (a
// reversal nets to zero), drafts never do, and the totals equal the Statement of Profit or Loss,
// the Statement of Financial Position and the Statement of Cash Flows for the same dates.
// Read-only.
//
// Every metric carries its formula and, when the data cannot support it, `value: null` with the
// reason - never an estimate. Classifications come from the Chart of Accounts `state` field
// (current / non-current / operating / non-operating / cash / cash-equivalent).

const { round2, L } = C;
const DAY = 86400000;

const div = (a, b) => (b ? a / b : null);
const ratio = (a, b) => (b ? round2(a / b) : null);
const percent = (a, b) => (b ? round2((a / b) * 100) : null);
const dayString = date => date.toISOString().slice(0, 10);

/** The preceding period of the same kind: same calendar shape for whole months/quarters/years, else same length. */
function previousPeriod({ from, to }) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const start = new Date(Date.UTC(fy, fm - 1, fd));
  const end = new Date(`${to}T00:00:00.000Z`);
  const lastOfMonth = d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() === d.getUTCDate();
  if (fd === 1 && lastOfMonth(end)) {
    const months = (end.getUTCFullYear() - fy) * 12 + end.getUTCMonth() - (fm - 1) + 1;
    const prevStart = new Date(Date.UTC(fy, fm - 1 - months, 1));
    const prevEnd = new Date(Date.UTC(fy, fm - 1, 0));
    return { from: dayString(prevStart), to: dayString(prevEnd) };
  }
  const days = Math.round((end - start) / DAY) + 1;
  return { from: dayString(new Date(start.getTime() - days * DAY)), to: dayString(new Date(start.getTime() - DAY)) };
}

// ---------------------------------------------------------------- balance-sheet snapshot
function positionOf(balances, accounts) {
  const p = { assets: 0, liabilities: 0, equity: 0, cash: 0, receivables: 0, payables: 0, currentAssets: 0, nonCurrentAssets: 0, currentLiabilities: 0, nonCurrentLiabilities: 0, unclassifiedAssets: [], unclassifiedLiabilities: [] };
  let profit = 0;
  for (const [id, { debit, credit }] of balances) {
    const a = accounts.get(id);
    if (a) {
      const natural = C.naturalBalance(a, debit, credit);
      if (a.type === 'asset' && natural !== 0) {
        p.assets += natural;
        if (isPaymentAccountEligible(a)) p.cash += natural;
        if (a.code === AutomaticJournalAccountCodes.accountsReceivableProjects) p.receivables += natural;
        if (isPaymentAccountEligible(a) || a.state === 'current' || a.state === 'cash' || a.state === 'cash-equivalent') p.currentAssets += natural;
        else if (a.state === 'non-current') p.nonCurrentAssets += natural;
        else p.unclassifiedAssets.push({ code: a.code, name: a.name, amount: natural });
      } else if (a.type === 'liability' && natural !== 0) {
        p.liabilities += natural;
        if (a.code === AutomaticJournalAccountCodes.suppliers) p.payables += natural;
        if (a.state === 'current') p.currentLiabilities += natural;
        else if (a.state === 'non-current') p.nonCurrentLiabilities += natural;
        else p.unclassifiedLiabilities.push({ code: a.code, name: a.name, amount: natural });
      } else if (a.type === 'equity') p.equity += natural;
      else if (C.PROFIT_AND_LOSS_TYPES.has(a.type)) profit += credit - debit;
    }
  }
  // No closing entries exist: the cumulative profit sits in the P&L accounts and is part of equity.
  p.equity += profit;
  ['assets', 'liabilities', 'equity', 'cash', 'receivables', 'payables', 'currentAssets', 'nonCurrentAssets', 'currentLiabilities', 'nonCurrentLiabilities'].forEach(k => (p[k] = round2(p[k])));
  return p;
}

// ---------------------------------------------------------------- P&L for a window
function profitAndLossOf(balances, accounts) {
  const pl = { revenue: 0, operatingRevenue: 0, cogs: 0, expenses: 0, operatingExpenses: 0, depreciation: 0, unclassifiedExpenses: [] };
  for (const [id, { debit, credit }] of balances) {
    const a = accounts.get(id);
    if (a) {
      if (a.type === 'revenue') {
        pl.revenue += credit - debit;
        if (a.state !== 'non-operating') pl.operatingRevenue += credit - debit;
      } else if (a.type === 'cogs') pl.cogs += debit - credit;
      else if (a.type === 'expense' && debit - credit !== 0) {
        pl.expenses += debit - credit;
        if (isDepreciationExpenseAccount(a)) pl.depreciation += debit - credit;
        if (a.state === 'operating') pl.operatingExpenses += debit - credit;
        else if (a.state !== 'non-operating') pl.unclassifiedExpenses.push({ code: a.code, name: a.name, amount: round2(debit - credit) });
      }
    }
  }
  Object.keys(pl).forEach(k => typeof pl[k] === 'number' && (pl[k] = round2(pl[k])));
  pl.grossProfit = round2(pl.revenue - pl.cogs);
  pl.netProfit = round2(pl.grossProfit - pl.expenses);
  return pl;
}

/**
 * Movement of a control account in the window caused by entries of the given accounting actions,
 * net of reversals of those entries (a reversal entry carries no action of its own - it is resolved
 * through `reversalOfEntry`). `side` is the side the actions post to ('debit' | 'credit').
 */
async function controlMovement(accountId, actions, side, { start, end }) {
  if (!accountId) return 0;
  const signed = side === 'debit' ? { $subtract: ['$lines.debit', '$lines.credit'] } : { $subtract: ['$lines.credit', '$lines.debit'] };
  const [direct] = await JournalEntry.aggregate([
    { $match: C.ledgerMatch({ start, end, extra: { accountingAction: { $in: actions } } }) },
    { $unwind: '$lines' },
    { $match: { 'lines.account': accountId } },
    { $group: { _id: null, total: { $sum: signed } } },
  ]);
  const [reversed] = await JournalEntry.aggregate([
    { $match: C.ledgerMatch({ start, end, extra: { reversalOfEntry: { $ne: null } } }) },
    { $lookup: { from: 'journalentries', localField: 'reversalOfEntry', foreignField: '_id', as: 'original', pipeline: [{ $project: { accountingAction: 1 } }] } },
    { $match: { 'original.accountingAction': { $in: actions } } },
    { $unwind: '$lines' },
    { $match: { 'lines.account': accountId } },
    { $group: { _id: null, total: { $sum: signed } } },
  ]);
  return round2((direct?.total || 0) + (reversed?.total || 0));
}

const SALES_ACTIONS = ['PROJECT_REVENUE_RECOGNITION'];
const PURCHASE_ACTIONS = ['PO_INVENTORY_RECEIPT', 'PO_SERVICE_TO_WIP', 'EXPENSE_RECORDED', 'FIXED_ASSET_ACQUISITION'];

// ---------------------------------------------------------------- cash flows of a window
function cashFlowOf({ entries, isCash, classify }, bucketOf) {
  const totals = { operating: 0, investing: 0, financing: 0 };
  const buckets = new Map();
  for (const entry of entries) {
    const nonCash = entry.lines.filter(l => !isCash(l.account));
    // Entries made only of cash lines are transfers between cash accounts - not cash flows.
    for (const line of nonCash) {
      const amount = (line.credit || 0) - (line.debit || 0);
      if (amount !== 0) {
        const { category } = classify(entry, line);
        totals[category] += amount;
        if (bucketOf) {
          const key = bucketOf(entry.date);
          if (!buckets.has(key)) buckets.set(key, { operating: 0, investing: 0, financing: 0 });
          buckets.get(key)[category] += amount;
        }
      }
    }
  }
  Object.keys(totals).forEach(k => (totals[k] = round2(totals[k])));
  return { totals, buckets };
}

// ---------------------------------------------------------------- one period's figures
async function snapshot(period, accounts) {
  const dayBefore = new Date(period.start.getTime() - 1);
  const [periodBalances, openingBalances, closingBalances, cash] = await Promise.all([
    C.balancesByAccount({ start: period.start, end: period.end }),
    C.balancesByAccount({ end: dayBefore }),
    C.balancesByAccount({ end: period.end }),
    cashMovements(period, accounts),
  ]);
  const ar = [...accounts.values()].find(a => a.code === AutomaticJournalAccountCodes.accountsReceivableProjects);
  const ap = [...accounts.values()].find(a => a.code === AutomaticJournalAccountCodes.suppliers);
  const [creditSales, creditPurchases] = await Promise.all([controlMovement(ar?._id, SALES_ACTIONS, 'debit', period), controlMovement(ap?._id, PURCHASE_ACTIONS, 'credit', period)]);
  return {
    days: Math.round((period.end - period.start) / DAY),
    pl: profitAndLossOf(periodBalances, accounts),
    opening: positionOf(openingBalances, accounts),
    closing: positionOf(closingBalances, accounts),
    cash: cashFlowOf(cash).totals,
    cashTruncated: cash.truncated,
    creditSales,
    creditPurchases,
  };
}

// ---------------------------------------------------------------- metrics
const unavailable = (en, ar) => ({ value: null, reason: L(en, ar) });
const listAccounts = list =>
  list
    .slice(0, 5)
    .map(a => `${a.code} ${a.name}`)
    .join(', ') + (list.length > 5 ? ` (+${list.length - 5})` : '');

function classificationGap(list, what) {
  return unavailable(
    `${list.length} ${what} account(s) with a balance have no Current / Non-current classification in the Chart of Accounts: ${listAccounts(list)}.`,
    `${list.length} حساب ${what === 'asset' ? 'أصول' : 'التزامات'} برصيد بدون تصنيف متداول / غير متداول في دليل الحسابات: ${listAccounts(list)}.`
  );
}

/** Metric definitions: compute(s) returns { value } or { value: null, reason }. */
const METRICS = {
  profitability: [
    { key: 'grossProfit', label: L('Gross Profit', 'مجمل الربح'), unit: 'money', better: 'higher', formula: L('Revenue − cost of sales', 'الإيرادات − تكلفة المبيعات'), compute: s => ({ value: s.pl.grossProfit }) },
    { key: 'grossMargin', label: L('Gross Profit Margin', 'نسبة مجمل الربح'), unit: 'percent', better: 'higher', formula: L('Gross profit ÷ revenue × 100', 'مجمل الربح ÷ الإيرادات × 100'), compute: s => (s.pl.revenue ? { value: percent(s.pl.grossProfit, s.pl.revenue) } : unavailable('No revenue in the period.', 'لا توجد إيرادات في الفترة.')) },
    { key: 'netProfit', label: L('Net Profit', 'صافي الربح'), unit: 'money', better: 'higher', formula: L('Revenue − cost of sales − expenses', 'الإيرادات − تكلفة المبيعات − المصروفات'), compute: s => ({ value: s.pl.netProfit }) },
    { key: 'netMargin', label: L('Net Profit Margin', 'نسبة صافي الربح'), unit: 'percent', better: 'higher', formula: L('Net profit ÷ revenue × 100', 'صافي الربح ÷ الإيرادات × 100'), compute: s => (s.pl.revenue ? { value: percent(s.pl.netProfit, s.pl.revenue) } : unavailable('No revenue in the period.', 'لا توجد إيرادات في الفترة.')) },
    {
      key: 'roa',
      label: L('Return on Assets (ROA)', 'العائد على الأصول'),
      unit: 'percent',
      better: 'higher',
      formula: L('Net profit ÷ average total assets (opening and closing) × 100 - for the period, not annualized', 'صافي الربح ÷ متوسط إجمالي الأصول (أول وآخر المدة) × 100 - عن الفترة، غير مسنوي'),
      compute: s => {
        const avg = (s.opening.assets + s.closing.assets) / 2;
        return avg > 0 ? { value: percent(s.pl.netProfit, avg) } : unavailable('Average total assets are zero or negative.', 'متوسط إجمالي الأصول صفر أو سالب.');
      },
    },
    {
      key: 'roe',
      label: L('Return on Equity (ROE)', 'العائد على حقوق الملكية'),
      unit: 'percent',
      better: 'higher',
      formula: L('Net profit ÷ average equity (opening and closing) × 100 - for the period, not annualized', 'صافي الربح ÷ متوسط حقوق الملكية (أول وآخر المدة) × 100 - عن الفترة، غير مسنوي'),
      compute: s => {
        const avg = (s.opening.equity + s.closing.equity) / 2;
        return avg > 0 ? { value: percent(s.pl.netProfit, avg) } : unavailable('Average equity is zero or negative.', 'متوسط حقوق الملكية صفر أو سالب.');
      },
    },
  ],
  liquidity: [
    {
      key: 'currentRatio',
      label: L('Current Ratio', 'نسبة التداول'),
      unit: 'ratio',
      better: 'higher',
      formula: L('Current assets ÷ current liabilities (Chart of Accounts classification)', 'الأصول المتداولة ÷ الالتزامات المتداولة (تصنيف دليل الحسابات)'),
      compute: s =>
        s.closing.unclassifiedAssets.length
          ? classificationGap(s.closing.unclassifiedAssets, 'asset')
          : s.closing.unclassifiedLiabilities.length
            ? classificationGap(s.closing.unclassifiedLiabilities, 'liability')
            : s.closing.currentLiabilities > 0
              ? { value: ratio(s.closing.currentAssets, s.closing.currentLiabilities) }
              : unavailable('There are no current liabilities.', 'لا توجد التزامات متداولة.'),
    },
    {
      key: 'quickRatio',
      label: L('Quick Ratio', 'نسبة السيولة السريعة'),
      unit: 'ratio',
      better: 'higher',
      formula: L('(Cash and cash equivalents + customer receivables) ÷ current liabilities', '(النقدية وما في حكمها + مديونية العملاء) ÷ الالتزامات المتداولة'),
      compute: s =>
        s.closing.unclassifiedLiabilities.length
          ? classificationGap(s.closing.unclassifiedLiabilities, 'liability')
          : s.closing.currentLiabilities > 0
            ? { value: ratio(s.closing.cash + s.closing.receivables, s.closing.currentLiabilities) }
            : unavailable('There are no current liabilities.', 'لا توجد التزامات متداولة.'),
    },
    { key: 'cash', label: L('Cash and Cash Equivalents', 'النقدية وما في حكمها'), unit: 'money', better: 'higher', formula: L('Balance of the Cash & Cash Equivalents accounts at the end date', 'رصيد حسابات النقدية وما في حكمها في نهاية الفترة'), compute: s => ({ value: s.closing.cash }) },
    {
      key: 'workingCapital',
      label: L('Working Capital', 'رأس المال العامل'),
      unit: 'money',
      better: 'higher',
      formula: L('Current assets − current liabilities', 'الأصول المتداولة − الالتزامات المتداولة'),
      compute: s =>
        s.closing.unclassifiedAssets.length
          ? classificationGap(s.closing.unclassifiedAssets, 'asset')
          : s.closing.unclassifiedLiabilities.length
            ? classificationGap(s.closing.unclassifiedLiabilities, 'liability')
            : { value: round2(s.closing.currentAssets - s.closing.currentLiabilities) },
    },
  ],
  solvency: [
    { key: 'debtToAssets', label: L('Debt to Assets', 'الديون إلى الأصول'), unit: 'ratio', better: 'lower', formula: L('Total liabilities ÷ total assets', 'إجمالي الالتزامات ÷ إجمالي الأصول'), compute: s => (s.closing.assets > 0 ? { value: ratio(s.closing.liabilities, s.closing.assets) } : unavailable('Total assets are zero.', 'إجمالي الأصول صفر.')) },
    { key: 'equityRatio', label: L('Equity Ratio', 'نسبة الملكية'), unit: 'ratio', better: 'higher', formula: L('Total equity ÷ total assets', 'إجمالي حقوق الملكية ÷ إجمالي الأصول'), compute: s => (s.closing.assets > 0 ? { value: ratio(s.closing.equity, s.closing.assets) } : unavailable('Total assets are zero.', 'إجمالي الأصول صفر.')) },
    {
      key: 'ltDebtToCapital',
      label: L('Non-current Liabilities to Capital', 'الالتزامات طويلة الأجل إلى رأس المال'),
      unit: 'ratio',
      better: 'lower',
      formula: L('Non-current liabilities ÷ (non-current liabilities + equity). Interest-bearing debt is not identified separately.', 'الالتزامات غير المتداولة ÷ (الالتزامات غير المتداولة + حقوق الملكية). لا يتم تمييز الديون بفوائد بشكل مستقل.'),
      compute: s => {
        if (s.closing.unclassifiedLiabilities.length) return classificationGap(s.closing.unclassifiedLiabilities, 'liability');
        const capital = s.closing.nonCurrentLiabilities + s.closing.equity;
        return capital > 0 ? { value: ratio(s.closing.nonCurrentLiabilities, capital) } : unavailable('Capital (non-current liabilities + equity) is zero or negative.', 'رأس المال صفر أو سالب.');
      },
    },
    { key: 'totalLiabilities', label: L('Total Liabilities', 'إجمالي الالتزامات'), unit: 'money', better: 'lower', formula: L('Balance of all liability accounts at the end date', 'رصيد كل حسابات الالتزامات في نهاية الفترة'), compute: s => ({ value: s.closing.liabilities }) },
    { key: 'totalEquity', label: L('Total Equity', 'إجمالي حقوق الملكية'), unit: 'money', better: 'higher', formula: L('Equity accounts + accumulated profit not yet closed', 'حسابات حقوق الملكية + الأرباح المتراكمة غير المرحلة'), compute: s => ({ value: s.closing.equity }) },
  ],
  debt: [
    { key: 'debtToEquity', label: L('Debt to Equity', 'الديون إلى حقوق الملكية'), unit: 'ratio', better: 'lower', formula: L('Total liabilities ÷ total equity', 'إجمالي الالتزامات ÷ إجمالي حقوق الملكية'), compute: s => (s.closing.equity > 0 ? { value: ratio(s.closing.liabilities, s.closing.equity) } : unavailable('Equity is zero or negative.', 'حقوق الملكية صفر أو سالبة.')) },
    {
      key: 'interestCoverage',
      label: L('Interest Coverage', 'تغطية الفوائد'),
      unit: 'times',
      better: 'higher',
      formula: L('EBIT ÷ interest expense', 'الأرباح قبل الفوائد والضرائب ÷ مصروف الفوائد'),
      compute: () => unavailable('Interest expense cannot be identified: the Chart of Accounts has no interest classification.', 'لا يمكن تحديد مصروف الفوائد: لا يوجد تصنيف للفوائد في دليل الحسابات.'),
    },
    {
      key: 'dscr',
      label: L('Debt Service Coverage', 'تغطية خدمة الدين'),
      unit: 'times',
      better: 'higher',
      formula: L('Cash available for debt service ÷ principal and interest due', 'النقدية المتاحة لخدمة الدين ÷ الأقساط والفوائد المستحقة'),
      compute: () => unavailable('The system has no loans or repayment schedules to measure debt service against.', 'لا توجد في النظام قروض أو جداول سداد لقياس خدمة الدين.'),
    },
  ],
  efficiency: [
    {
      key: 'inventoryTurnover',
      label: L('Inventory Turnover', 'معدل دوران المخزون'),
      unit: 'times',
      better: 'higher',
      formula: L('Cost of sales ÷ average inventory', 'تكلفة المبيعات ÷ متوسط المخزون'),
      compute: () => unavailable('Cost of sales is loaded from project average cost × executed %, not from inventory consumption, so it cannot be compared with inventory.', 'تكلفة المبيعات تُحمل من متوسط تكلفة المشروع × نسبة التنفيذ وليس من استهلاك المخزون، فلا تصلح للمقارنة بالمخزون.'),
    },
    {
      key: 'receivablesTurnover',
      label: L('Receivables Turnover', 'معدل دوران المدينين'),
      unit: 'times',
      better: 'higher',
      formula: L('Credit sales (receivables posted by revenue recognition, net of reversals) ÷ average customer receivables', 'المبيعات الآجلة (المديونية المرحلة بإثبات الإيراد بعد العكس) ÷ متوسط مديونية العملاء'),
      compute: s => {
        const avg = (s.opening.receivables + s.closing.receivables) / 2;
        return s.creditSales > 0 && avg > 0 ? { value: ratio(s.creditSales, avg) } : unavailable('No credit sales or no receivables in the period.', 'لا توجد مبيعات آجلة أو مديونية في الفترة.');
      },
    },
    {
      key: 'dso',
      label: L('Days Sales Outstanding', 'متوسط فترة التحصيل'),
      unit: 'days',
      better: 'lower',
      formula: L('Average customer receivables ÷ credit sales × days in the period', 'متوسط مديونية العملاء ÷ المبيعات الآجلة × عدد أيام الفترة'),
      compute: s => {
        const avg = (s.opening.receivables + s.closing.receivables) / 2;
        return s.creditSales > 0 ? { value: round2(div(avg, s.creditSales) * s.days) } : unavailable('No credit sales in the period.', 'لا توجد مبيعات آجلة في الفترة.');
      },
    },
    {
      key: 'dpo',
      label: L('Days Payable Outstanding', 'متوسط فترة السداد'),
      unit: 'days',
      better: null,
      formula: L('Average supplier payables ÷ credit purchases (Purchase Orders, expenses and fixed assets posted to Suppliers, net of reversals) × days in the period', 'متوسط أرصدة الموردين ÷ المشتريات الآجلة (أوامر الشراء والمصروفات والأصول المرحلة على الموردين بعد العكس) × عدد أيام الفترة'),
      compute: s => {
        const avg = (s.opening.payables + s.closing.payables) / 2;
        return s.creditPurchases > 0 ? { value: round2(div(avg, s.creditPurchases) * s.days) } : unavailable('No credit purchases in the period.', 'لا توجد مشتريات آجلة في الفترة.');
      },
    },
    {
      key: 'cashConversionCycle',
      label: L('Cash Conversion Cycle', 'دورة تحويل النقدية'),
      unit: 'days',
      better: 'lower',
      formula: L('Days inventory outstanding + DSO − DPO', 'أيام المخزون + فترة التحصيل − فترة السداد'),
      compute: () => unavailable('Needs days inventory outstanding, which is not available (see Inventory Turnover).', 'يحتاج أيام المخزون، وهي غير متاحة (انظر معدل دوران المخزون).'),
    },
  ],
  advanced: [
    {
      key: 'ebitda',
      label: L('EBITDA', 'الأرباح قبل الفوائد والضرائب والإهلاك'),
      unit: 'money',
      better: 'higher',
      formula: L('Operating revenue − cost of sales − operating expenses + depreciation & amortization (expense accounts classified Operating / Non-operating)', 'الإيرادات التشغيلية − تكلفة المبيعات − المصروفات التشغيلية + الإهلاك والاستهلاك (حسابات المصروفات المصنفة تشغيلية / غير تشغيلية)'),
      compute: s =>
        s.pl.unclassifiedExpenses.length
          ? unavailable(
              `${s.pl.unclassifiedExpenses.length} expense account(s) with activity have no Operating / Non-operating classification in the Chart of Accounts: ${listAccounts(s.pl.unclassifiedExpenses)}.`,
              `${s.pl.unclassifiedExpenses.length} حساب مصروفات بحركة بدون تصنيف تشغيلي / غير تشغيلي في دليل الحسابات: ${listAccounts(s.pl.unclassifiedExpenses)}.`
            )
          : { value: round2(s.pl.operatingRevenue - s.pl.cogs - s.pl.operatingExpenses + s.pl.depreciation) },
    },
    {
      key: 'freeCashFlow',
      label: L('Free Cash Flow', 'التدفق النقدي الحر'),
      unit: 'money',
      better: 'higher',
      formula: L('Net cash from operating activities + net cash from investing activities (Statement of Cash Flows)', 'صافي النقدية من الأنشطة التشغيلية + صافي النقدية من الأنشطة الاستثمارية (قائمة التدفقات النقدية)'),
      compute: s => ({ value: round2(s.cash.operating + s.cash.investing) }),
    },
    {
      key: 'roi',
      label: L('Return on Investment (ROI)', 'العائد على الاستثمار'),
      unit: 'percent',
      better: 'higher',
      formula: L('Return ÷ amount invested', 'العائد ÷ قيمة الاستثمار'),
      compute: () => unavailable('There is no defined investment basis in the data (investments are not recorded separately); ROA and ROE measure the return on assets and equity.', 'لا يوجد أساس استثمار محدد في البيانات؛ يقيس العائد على الأصول والعائد على حقوق الملكية العائد على الأصول وحقوق الملكية.'),
    },
  ],
};

const GROUP_TITLES = {
  profitability: L('Profitability', 'الربحية'),
  liquidity: L('Liquidity', 'السيولة'),
  solvency: L('Solvency', 'الملاءة المالية'),
  debt: L('Debt Management', 'إدارة الديون'),
  efficiency: L('Operational Efficiency', 'الكفاءة التشغيلية'),
  advanced: L('Advanced Financial Metrics', 'مؤشرات مالية متقدمة'),
};

// ---------------------------------------------------------------- trend series
async function series(period, accounts) {
  const days = Math.round((period.end - period.start) / DAY) + 1;
  const granularity = days <= 62 ? 'day' : 'month';
  const keyOf = date => (granularity === 'day' ? dayString(new Date(date)) : dayString(new Date(date)).slice(0, 7));
  const points = new Map();
  for (let d = new Date(period.start); d <= period.end; d = granularity === 'day' ? new Date(d.getTime() + DAY) : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    points.set(keyOf(d), { key: keyOf(d), revenue: 0, cogs: 0, expenses: 0, operating: 0, investing: 0, financing: 0 });
  }

  const format = granularity === 'day' ? '%Y-%m-%d' : '%Y-%m';
  const plIds = [...accounts.values()].filter(a => C.PROFIT_AND_LOSS_TYPES.has(a.type)).map(a => a._id);
  const rows = await JournalEntry.aggregate([
    { $match: C.ledgerMatch({ start: period.start, end: period.end, extra: { 'lines.account': { $in: plIds } } }) },
    { $unwind: '$lines' },
    { $match: { 'lines.account': { $in: plIds } } },
    { $group: { _id: { bucket: { $dateToString: { format, date: '$date', timezone: 'UTC' } }, account: '$lines.account' }, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);
  for (const r of rows) {
    const point = points.get(r._id.bucket);
    const type = accounts.get(C.idOf(r._id.account))?.type;
    if (point) {
      if (type === 'revenue') point.revenue += r.credit - r.debit;
      if (type === 'cogs') point.cogs += r.debit - r.credit;
      if (type === 'expense') point.expenses += r.debit - r.credit;
    }
  }
  const cash = await cashMovements(period, accounts);
  const { buckets } = cashFlowOf(cash, keyOf);
  for (const [key, flows] of buckets) {
    const point = points.get(key);
    if (point) Object.assign(point, { operating: flows.operating, investing: flows.investing, financing: flows.financing });
  }
  return {
    granularity,
    points: [...points.values()].map(p => {
      const out = { key: p.key };
      ['revenue', 'cogs', 'expenses', 'operating', 'investing', 'financing'].forEach(k => (out[k] = round2(p[k])));
      out.grossProfit = round2(out.revenue - out.cogs);
      out.netProfit = round2(out.grossProfit - out.expenses);
      return out;
    }),
  };
}

// ---------------------------------------------------------------- entry point
async function financialDashboard(query = {}) {
  const period = C.resolvePeriod(query);
  const comparison = query.compareFrom || query.compareTo ? C.resolvePeriod({ from: query.compareFrom, to: query.compareTo }) : C.resolvePeriod(previousPeriod(period));
  if (comparison.end >= period.start) throw new ApiError('The comparison period must end before the reporting period starts.', 400);
  const days = Math.round((period.end - period.start) / DAY) + 1;
  if (days > 3700) throw new ApiError('The reporting period cannot exceed 10 years.', 400);

  const accounts = await C.loadAccounts();
  const [current, previous, trend] = await Promise.all([snapshot(period, accounts), snapshot(comparison, accounts), series(period, accounts)]);

  const groups = Object.entries(METRICS).map(([key, metrics]) => ({
    key,
    title: GROUP_TITLES[key],
    metrics: metrics.map(m => {
      const now = m.compute(current);
      const before = m.compute(previous);
      return { key: m.key, label: m.label, unit: m.unit, better: m.better, formula: m.formula, value: now.value, reason: now.reason || null, previous: before.value ?? null };
    }),
  }));

  return {
    period: { from: period.from, to: period.to },
    comparison: { from: comparison.from, to: comparison.to },
    generatedAt: new Date().toISOString(),
    currency: 'EGP',
    hasActivity: current.pl.revenue !== 0 || current.pl.cogs !== 0 || current.pl.expenses !== 0 || current.closing.assets !== 0,
    groups,
    totals: { revenue: current.pl.revenue, cogs: current.pl.cogs, expenses: current.pl.expenses, netProfit: current.pl.netProfit, totalAssets: current.closing.assets, totalLiabilities: current.closing.liabilities, totalEquity: current.closing.equity, cash: current.closing.cash, ...current.cash },
    series: trend,
    notes: [
      L(
        'Figures come from posted journal entries (a reversal and its original net to zero; drafts are excluded) with the same rules as the Financial Reports. Ratios use the Chart of Accounts classification (Current / Non-current, Operating / Non-operating). Trends compare with the preceding period of the same length; no industry averages are used.',
        'الأرقام من القيود المرحلة (القيد العكسي وأصله صافيهما صفر؛ المسودات مستبعدة) بنفس قواعد التقارير المالية. تستخدم النسب تصنيف دليل الحسابات (متداول / غير متداول، تشغيلي / غير تشغيلي). تتم المقارنة بالفترة السابقة المماثلة؛ لا تُستخدم متوسطات الصناعة.'
      ),
      ...(current.cashTruncated ? [L('Cash flows are limited to the first 20,000 cash entries of the period.', 'التدفقات النقدية مقتصرة على أول 20,000 قيد نقدي في الفترة.')] : []),
    ],
  };
}

module.exports = { financialDashboard, previousPeriod };
