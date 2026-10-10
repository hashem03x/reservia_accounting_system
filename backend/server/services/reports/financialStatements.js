const { isPaymentAccountEligible } = require('../../utils/accountingConstants');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const Vendor = require('../../models/vendor/vendor');
const { assetClassOf, isAccumulatedAccountFor } = require('../fixedAssets/fixedAssetAccounts');
const C = require('./reportCommon');

const { round2, col, check, note, summaryItem, L } = C;

const TYPE_LABELS = {
  asset: L('Assets', 'الأصول'),
  liability: L('Liabilities', 'الالتزامات'),
  equity: L('Equity', 'حقوق الملكية'),
  revenue: L('Revenue', 'الإيرادات'),
  cogs: L('Cost of Sales', 'تكلفة المبيعات'),
  expense: L('Expenses', 'المصروفات'),
};

const UNGROUPED = L('Other', 'أخرى');

/**
 * Rows of accounts of one type, grouped by their Chart of Accounts group (parent group / parent
 * account) with a subtotal row per group. `amountOf(account, balance)` returns the amount shown.
 */
function groupedRows(accounts, balances, type, amountOf) {
  const items = [];
  for (const account of accounts.values()) {
    if (account.type !== type) continue;
    const balance = balances.get(String(account._id));
    if (!balance) continue;
    const amount = amountOf(account, balance);
    if (amount === 0) continue;
    items.push({ account, amount, group: C.groupOf(account), groupAr: C.groupArOf(account) });
  }
  const groups = new Map();
  for (const item of C.sortAccountsByCode(items, i => i.account.code)) {
    const key = item.group || '';
    if (!groups.has(key)) groups.set(key, { group: item.group, groupAr: item.groupAr, items: [] });
    groups.get(key).items.push(item);
  }
  const rows = [];
  let total = 0;
  for (const { group, groupAr, items: groupItems } of groups.values()) {
    const subtotal = round2(groupItems.reduce((s, i) => s + i.amount, 0));
    rows.push({ _rowType: 'header', name: group || UNGROUPED.en, nameAr: groupAr || group || UNGROUPED.ar });
    groupItems.forEach(i =>
      rows.push({ code: i.account.code, name: i.account.name, nameAr: i.account.nameAr || null, amount: i.amount, _links: { code: { kind: 'account', id: String(i.account._id) } } })
    );
    rows.push({ _rowType: 'subtotal', name: `Total ${group || UNGROUPED.en}`, nameAr: `إجمالي ${groupAr || group || UNGROUPED.ar}`, amount: subtotal });
    total += subtotal;
  }
  return { rows, total: round2(total) };
}

const amountCols = () => [col('code', 'Account No.', 'رقم الحساب'), col('name', 'Account', 'الحساب', 'account'), col('amount', 'Amount', 'المبلغ', 'money')];

// ---------------------------------------------------------------- 1. Trial Balance
async function trialBalance(query) {
  const period = C.resolvePeriod(query);
  const includeZero = query.includeZero === 'true' || query.includeZero === true;
  const accounts = await C.loadAccounts();
  const totals = await C.ledgerTotals({ start: period.start, end: period.end });
  const byAccount = new Map(totals.map(t => [t.accountId, t]));

  const ids = new Set([...byAccount.keys(), ...(includeZero ? [...accounts.values()].filter(a => a.isActive !== false).map(a => String(a._id)) : [])]);
  let rows = [];
  for (const id of ids) {
    const t = byAccount.get(id) || { openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0 };
    const account = accounts.get(id);
    const openingNet = round2(t.openingDebit - t.openingCredit);
    const closingNet = round2(openingNet + t.periodDebit - t.periodCredit);
    rows.push({
      code: account?.code || '?',
      name: account?.name || 'Unknown account (missing from the Chart of Accounts)',
      nameAr: account?.nameAr || null,
      type: account?.type || null,
      group: C.groupOf(account),
      openingDebit: openingNet > 0 ? openingNet : 0,
      openingCredit: openingNet < 0 ? -openingNet : 0,
      periodDebit: t.periodDebit,
      periodCredit: t.periodCredit,
      closingDebit: closingNet > 0 ? closingNet : 0,
      closingCredit: closingNet < 0 ? -closingNet : 0,
      netBalance: Math.abs(closingNet),
      side: closingNet > 0 ? 'Dr' : closingNet < 0 ? 'Cr' : '-',
      _links: account ? { code: { kind: 'account', id } } : undefined,
      _missing: !account,
    });
  }
  rows = C.sortAccountsByCode(rows, r => r.code);

  const sums = {};
  ['openingDebit', 'openingCredit', 'periodDebit', 'periodCredit', 'closingDebit', 'closingCredit'].forEach(k => (sums[k] = C.sumBy(rows, k)));
  const missing = rows.filter(r => r._missing).length;

  return {
    period,
    summary: [
      summaryItem('periodDebit', 'Period debits', 'حركة مدينة للفترة', sums.periodDebit),
      summaryItem('periodCredit', 'Period credits', 'حركة دائنة للفترة', sums.periodCredit),
      summaryItem('accounts', 'Accounts', 'عدد الحسابات', rows.length, 'number'),
    ],
    checks: [
      check('Opening debits = opening credits', 'رصيد أول المدة المدين = الدائن', sums.openingDebit === sums.openingCredit, `${sums.openingDebit} / ${sums.openingCredit}`),
      check('Period debits = period credits', 'حركة الفترة المدينة = الدائنة', sums.periodDebit === sums.periodCredit, `${sums.periodDebit} / ${sums.periodCredit}`),
      check('Closing debits = closing credits', 'رصيد آخر المدة المدين = الدائن', sums.closingDebit === sums.closingCredit, `${sums.closingDebit} / ${sums.closingCredit}`),
      ...(missing ? [check('Every account exists in the Chart of Accounts', 'كل الحسابات موجودة في دليل الحسابات', false, `${missing}`)] : []),
    ],
    sections: [
      {
        key: 'accounts',
        title: L('Trial Balance', 'ميزان المراجعة'),
        columns: [
          col('code', 'Account No.', 'رقم الحساب'),
          col('name', 'Account', 'الحساب', 'account'),
          col('openingDebit', 'Opening Debit', 'أول المدة مدين', 'money'),
          col('openingCredit', 'Opening Credit', 'أول المدة دائن', 'money'),
          col('periodDebit', 'Period Debit', 'حركة مدينة', 'money'),
          col('periodCredit', 'Period Credit', 'حركة دائنة', 'money'),
          col('closingDebit', 'Closing Debit', 'آخر المدة مدين', 'money'),
          col('closingCredit', 'Closing Credit', 'آخر المدة دائن', 'money'),
          col('netBalance', 'Net Balance', 'صافي الرصيد', 'money'),
          col('side', 'Dr/Cr', 'مدين/دائن'),
        ],
        rows,
        totals: { name: 'Total', nameAr: 'الإجمالي', ...sums },
      },
    ],
    notes: [
      note(
        'Opening balances include every posted entry dated before the start date; reversed entries and their reversals are both included, so a reversal nets to zero. Draft entries are excluded.',
        'يشمل رصيد أول المدة كل القيود المرحلة قبل تاريخ البداية؛ وتُحتسب القيود المعكوسة وقيود عكسها معاً فيصبح أثرها صفراً. القيود المسودة مستبعدة.'
      ),
    ],
  };
}

// ---------------------------------------------------------------- 2. Statement of Financial Position
async function financialPosition(query) {
  const { asOf, end } = C.resolveAsOf(query);
  const accounts = await C.loadAccounts();
  const balances = await C.balancesByAccount({ end });
  const natural = (account, b) => C.naturalBalance(account, b.debit, b.credit);

  const assets = groupedRows(accounts, balances, 'asset', natural);
  const liabilities = groupedRows(accounts, balances, 'liability', natural);
  const equity = groupedRows(accounts, balances, 'equity', natural);
  // Revenue/expense accounts are never closed by the system, so the cumulative profit to date is
  // still sitting in them - shown once, inside equity, and nowhere else.
  const unclosedProfit = C.profitFrom(balances, accounts);
  equity.rows.push({ _rowType: 'item', code: '', name: 'Accumulated profit / (loss) not yet closed to equity', nameAr: 'الأرباح / (الخسائر) المتراكمة غير المرحلة لحقوق الملكية', amount: unclosedProfit });
  const totalEquity = round2(equity.total + unclosedProfit);
  const difference = round2(assets.total - (liabilities.total + totalEquity));

  return {
    asOf,
    summary: [
      summaryItem('totalAssets', 'Total assets', 'إجمالي الأصول', assets.total),
      summaryItem('totalLiabilities', 'Total liabilities', 'إجمالي الالتزامات', liabilities.total),
      summaryItem('totalEquity', 'Total equity', 'إجمالي حقوق الملكية', totalEquity),
    ],
    totalEquity,
    checks: [check('Assets = Liabilities + Equity', 'الأصول = الالتزامات + حقوق الملكية', difference === 0, difference === 0 ? null : `difference ${difference}`)],
    sections: [
      { key: 'assets', title: TYPE_LABELS.asset, columns: amountCols(), rows: assets.rows, totals: { name: 'Total Assets', nameAr: 'إجمالي الأصول', amount: assets.total } },
      { key: 'liabilities', title: TYPE_LABELS.liability, columns: amountCols(), rows: liabilities.rows, totals: { name: 'Total Liabilities', nameAr: 'إجمالي الالتزامات', amount: liabilities.total } },
      { key: 'equity', title: TYPE_LABELS.equity, columns: amountCols(), rows: equity.rows, totals: { name: 'Total Equity', nameAr: 'إجمالي حقوق الملكية', amount: totalEquity } },
    ],
    notes: [
      note(
        'Balances are cumulative to the as-of date and grouped by the Chart of Accounts groups. Contra accounts (e.g. accumulated depreciation) reduce their group. There are no closing entries in the system, so the cumulative profit/(loss) of all revenue and expense accounts is shown as one equity line.',
        'الأرصدة تراكمية حتى التاريخ المحدد ومجمعة حسب مجموعات دليل الحسابات. الحسابات المقابلة (مثل مجمع الإهلاك) تخفض مجموعتها. لا توجد قيود إقفال في النظام، لذا يظهر صافي ربح/(خسارة) حسابات الإيرادات والمصروفات المتراكم كبند واحد ضمن حقوق الملكية.'
      ),
    ],
  };
}

// ---------------------------------------------------------------- 3. Statement of Profit or Loss
async function profitLoss(query) {
  const period = C.resolvePeriod(query);
  const accounts = await C.loadAccounts();
  const balances = await C.balancesByAccount({ start: period.start, end: period.end });
  const natural = (account, b) => C.naturalBalance(account, b.debit, b.credit);

  const revenue = groupedRows(accounts, balances, 'revenue', natural);
  const cogs = groupedRows(accounts, balances, 'cogs', natural);
  const expenses = groupedRows(accounts, balances, 'expense', natural);
  const grossProfit = round2(revenue.total - cogs.total);
  const netProfit = round2(grossProfit - expenses.total);

  return {
    period,
    summary: [
      summaryItem('revenue', 'Revenue', 'الإيرادات', revenue.total),
      summaryItem('cogs', 'Cost of sales', 'تكلفة المبيعات', cogs.total),
      summaryItem('grossProfit', 'Gross profit', 'مجمل الربح', grossProfit),
      summaryItem('grossMargin', 'Gross profit margin', 'نسبة مجمل الربح', C.pct(grossProfit, revenue.total), 'percent'),
      summaryItem('expenses', 'Operating & other expenses', 'المصروفات التشغيلية والأخرى', expenses.total),
      summaryItem('netProfit', 'Net profit / (loss)', 'صافي الربح / (الخسارة)', netProfit),
    ],
    netProfit,
    checks: [],
    sections: [
      { key: 'revenue', title: TYPE_LABELS.revenue, columns: amountCols(), rows: revenue.rows, totals: { name: 'Total Revenue', nameAr: 'إجمالي الإيرادات', amount: revenue.total } },
      { key: 'cogs', title: TYPE_LABELS.cogs, columns: amountCols(), rows: cogs.rows, totals: { name: 'Total Cost of Sales', nameAr: 'إجمالي تكلفة المبيعات', amount: cogs.total } },
      {
        key: 'grossProfit',
        title: L('Gross Profit', 'مجمل الربح'),
        columns: amountCols(),
        rows: [{ _rowType: 'total', name: 'Gross profit', nameAr: 'مجمل الربح', amount: grossProfit }],
        totals: null,
      },
      { key: 'expenses', title: TYPE_LABELS.expense, columns: amountCols(), rows: expenses.rows, totals: { name: 'Total Expenses', nameAr: 'إجمالي المصروفات', amount: expenses.total } },
      {
        key: 'netProfit',
        title: L('Net Profit / (Loss)', 'صافي الربح / (الخسارة)'),
        columns: amountCols(),
        rows: [{ _rowType: 'total', name: 'Net profit / (loss)', nameAr: 'صافي الربح / (الخسارة)', amount: netProfit }],
        totals: null,
      },
    ],
    notes: [
      note(
        'Revenue, cost of sales and expenses follow the Chart of Accounts types (revenue / cogs / expense) and are shown under their own Chart of Accounts groups. The Chart of Accounts does not flag "other income/expenses" separately, so they appear inside their groups rather than as a separate section.',
        'تتبع الإيرادات وتكلفة المبيعات والمصروفات أنواع الحسابات في دليل الحسابات (إيراد / تكلفة مبيعات / مصروف) وتظهر تحت مجموعاتها. لا يميز دليل الحسابات "الإيرادات/المصروفات الأخرى" بشكل مستقل، لذا تظهر ضمن مجموعاتها وليس كقسم منفصل.'
      ),
    ],
  };
}

// ---------------------------------------------------------------- 4. Cash Flow Statement
const FLOW_CATEGORIES = {
  operating: L('Operating Activities', 'الأنشطة التشغيلية'),
  investing: L('Investing Activities', 'الأنشطة الاستثمارية'),
  financing: L('Financing Activities', 'الأنشطة التمويلية'),
};

function flowCategoryOf(account) {
  if (!account) return 'operating';
  if (account.type === 'equity') return 'financing';
  if (assetClassOf(account) || isAccumulatedAccountFor(account, 'tangible') || isAccumulatedAccountFor(account, 'intangible')) return 'investing';
  return 'operating';
}

// Cash Flow classification - the one rule set every cash flow figure uses (the Cash Flow Statement,
// project cash flows and the analytics dashboard), applied to each counterpart line of a cash entry,
// in this order:
//   1. the entry's own type: the payment of a fixed asset acquisition is an investing outflow
//      (FLOW_BY_ACTION). A reversal entry follows the entry it reverses, so a reversed payment
//      cancels in the same activity;
//   2. the vendor's classification: a line carrying a vendor whose Cash Flow Activity is set
//      (Vendor.cashFlowActivity - e.g. "Supplier - Finance Activities" = financing) is classified as
//      that vendor's activity;
//   3. otherwise the counterpart account (flowCategoryOf): equity = financing, fixed asset and
//      accumulated depreciation accounts = investing, everything else = operating.
// Only real cash lines move cash, so an unpaid acquisition or cost (no cash line) and depreciation
// (non-cash) never appear; nothing is counted twice because each counterpart line carries exactly
// its own share of the entry's cash movement.
const FLOW_BY_ACTION = {
  FIXED_ASSET_PAYMENT_RECORDED: 'investing',
  FIXED_ASSET_ACQUISITION: 'investing',
};
const RULE_LABELS = {
  action: L('Transaction type', 'نوع العملية'),
  vendor: L('Vendor cash flow classification', 'تصنيف المورد في التدفقات النقدية'),
};

/**
 * The cash movements of ledger entries touching a Cash / Cash Equivalent account in the window.
 * For each entry, its net cash movement equals the sum of its non-cash lines (credit - debit) -
 * a balanced entry guarantees it - so each counterpart line carries its exact share of the cash
 * movement and nothing is counted twice. Entries made only of cash lines are internal transfers.
 * `classify(entry, line)` returns { category, rule } for a counterpart line (see the rules above).
 */
async function cashMovements({ start, end }, accounts) {
  const cashIds = [...accounts.values()].filter(isPaymentAccountEligible).map(a => a._id);
  const { entries, truncated } = await C.ledgerEntries({ start, end, entryMatch: { 'lines.account': { $in: cashIds } } });
  const isCash = id => {
    const a = accounts.get(C.idOf(id));
    return !!a && isPaymentAccountEligible(a);
  };

  const reversedIds = [...new Map(entries.filter(e => e.reversalOfEntry).map(e => [C.idOf(e.reversalOfEntry), e.reversalOfEntry])).values()];
  const [originals, vendors] = await Promise.all([
    reversedIds.length ? JournalEntry.collection.find({ _id: { $in: reversedIds } }, { projection: { accountingAction: 1 } }).toArray() : [],
    Vendor.collection.find({ cashFlowActivity: { $in: ['operating', 'investing', 'financing'] } }, { projection: { vendorNumber: 1, cashFlowActivity: 1 } }).toArray(),
  ]);
  const actionOfOriginal = new Map(originals.map(o => [String(o._id), o.accountingAction]));
  const vendorActivity = new Map(vendors.filter(v => v.vendorNumber != null).map(v => [v.vendorNumber, v.cashFlowActivity]));

  const classify = (entry, line) => {
    const action = entry.reversalOfEntry ? actionOfOriginal.get(C.idOf(entry.reversalOfEntry)) : entry.accountingAction;
    if (action && FLOW_BY_ACTION[action]) return { category: FLOW_BY_ACTION[action], rule: 'action' };
    if (line.partyType === 'vendor' && vendorActivity.has(line.partyNumber)) return { category: vendorActivity.get(line.partyNumber), rule: 'vendor' };
    return { category: flowCategoryOf(accounts.get(C.idOf(line.account))), rule: null };
  };
  return { cashIds, entries, truncated, isCash, classify };
}

async function cashFlow(query) {
  const period = C.resolvePeriod(query);
  const accounts = await C.loadAccounts();
  const { cashIds, entries, truncated, isCash, classify } = await cashMovements(period, accounts);

  const byAccount = new Map(); // category|accountId -> { inflow, outflow }
  const reclassified = []; // counterpart lines classified by transaction type or vendor, for drill-down
  let transfers = 0;
  let transferAmount = 0;
  for (const entry of entries) {
    const nonCash = entry.lines.filter(l => !isCash(l.account));
    if (nonCash.length === 0) {
      transfers += 1;
      transferAmount += entry.lines.reduce((s, l) => s + (l.debit || 0), 0);
    } else {
      for (const line of nonCash) {
        const amount = (line.credit || 0) - (line.debit || 0); // + inflow, - outflow
        if (amount !== 0) {
          const account = accounts.get(C.idOf(line.account));
          const { category, rule } = classify(entry, line);
          const key = `${category}|${C.idOf(line.account)}`;
          if (rule) {
            reclassified.push({
              date: entry.date,
              entryNumber: entry.entryNumber,
              description: line.description || entry.description || null,
              account: account ? `${account.code} - ${account.name}` : null,
              party: line.partyType === 'vendor' && line.partyNumber != null ? String(line.partyNumber) : null,
              activity: FLOW_CATEGORIES[category].en,
              activityAr: FLOW_CATEGORIES[category].ar,
              rule: RULE_LABELS[rule].en,
              ruleAr: RULE_LABELS[rule].ar,
              inflow: amount > 0 ? round2(amount) : 0,
              outflow: amount < 0 ? round2(-amount) : 0,
              _links: { entryNumber: { kind: 'journalEntry', id: String(entry._id) } },
            });
          }
          if (!byAccount.has(key)) byAccount.set(key, { inflow: 0, outflow: 0, account });
          const bucket = byAccount.get(key);
          if (amount > 0) bucket.inflow += amount;
          else bucket.outflow += -amount;
        }
      }
    }
  }

  const sections = [];
  const netByCategory = {};
  for (const [category, title] of Object.entries(FLOW_CATEGORIES)) {
    let rows = [...byAccount.entries()]
      .filter(([key]) => key.startsWith(`${category}|`))
      .map(([, b]) => ({
        code: b.account?.code || '?',
        name: b.account?.name || 'Unknown account',
        nameAr: b.account?.nameAr || null,
        inflow: round2(b.inflow),
        outflow: round2(b.outflow),
        net: round2(b.inflow - b.outflow),
      }));
    rows = C.sortAccountsByCode(rows, r => r.code);
    netByCategory[category] = C.sumBy(rows, 'net');
    sections.push({
      key: category,
      title,
      columns: [col('code', 'Counterpart Account No.', 'رقم الحساب المقابل'), col('name', 'Counterpart Account', 'الحساب المقابل', 'account'), col('inflow', 'Cash In', 'متحصلات', 'money'), col('outflow', 'Cash Out', 'مدفوعات', 'money'), col('net', 'Net', 'الصافي', 'money')],
      rows,
      totals: { name: `Net cash from ${title.en.toLowerCase()}`, nameAr: `صافي النقدية من ${title.ar}`, inflow: C.sumBy(rows, 'inflow'), outflow: C.sumBy(rows, 'outflow'), net: netByCategory[category] },
    });
  }

  reclassified.sort((a, b) => new Date(a.date) - new Date(b.date) || a.entryNumber - b.entryNumber);
  sections.push({
    key: 'classified',
    title: L('Cash Flows Classified by Transaction Type or Vendor', 'تدفقات نقدية مصنفة حسب نوع العملية أو المورد'),
    paginate: true,
    columns: [
      col('date', 'Date', 'التاريخ', 'date'),
      col('entryNumber', 'Entry No.', 'رقم القيد'),
      col('description', 'Description', 'البيان'),
      col('account', 'Counterpart Account', 'الحساب المقابل'),
      col('party', 'Vendor No.', 'رقم المورد'),
      col('activity', 'Activity', 'النشاط', 'status'),
      col('rule', 'Classified by', 'أساس التصنيف', 'status'),
      col('inflow', 'Cash In', 'متحصلات', 'money'),
      col('outflow', 'Cash Out', 'مدفوعات', 'money'),
    ],
    rows: reclassified,
    totals: reclassified.length ? { description: 'Total', descriptionAr: 'الإجمالي', inflow: C.sumBy(reclassified, 'inflow'), outflow: C.sumBy(reclassified, 'outflow') } : null,
  });

  const cashSet = new Set(cashIds.map(String));
  const sumCash = balances => round2([...balances].filter(([id]) => cashSet.has(id)).reduce((s, [, b]) => s + b.debit - b.credit, 0));
  const [openingBalances, closingBalances] = await Promise.all([
    C.balancesByAccount({ end: new Date(period.start.getTime() - 1) }),
    C.balancesByAccount({ end: period.end }),
  ]);
  const opening = sumCash(openingBalances);
  const closing = sumCash(closingBalances);
  const netChange = round2(netByCategory.operating + netByCategory.investing + netByCategory.financing);

  return {
    period,
    summary: [
      summaryItem('opening', 'Opening cash', 'النقدية أول المدة', opening),
      summaryItem('operating', 'Net operating cash flow', 'صافي التدفق التشغيلي', netByCategory.operating),
      summaryItem('investing', 'Net investing cash flow', 'صافي التدفق الاستثماري', netByCategory.investing),
      summaryItem('financing', 'Net financing cash flow', 'صافي التدفق التمويلي', netByCategory.financing),
      summaryItem('netChange', 'Net change in cash', 'صافي التغير في النقدية', netChange),
      summaryItem('closing', 'Closing cash', 'النقدية آخر المدة', closing),
    ],
    checks: [
      check('Opening cash + net change = closing cash', 'النقدية أول المدة + صافي التغير = النقدية آخر المدة', round2(opening + netChange) === closing, `${opening} + ${netChange} = ${round2(opening + netChange)} / ${closing}`),
      ...(truncated ? [check('All cash entries included', 'تم تضمين كل قيود النقدية', false, `limited to ${C.MAX_DETAIL_ROWS}`)] : []),
    ],
    sections,
    notes: [
      note(
        'Direct method from the ledger: only entries that touch a Cash / Cash Equivalent account move cash. Each entry\'s cash movement is attributed to its counterpart accounts (equity = financing; fixed asset and accumulated depreciation accounts = investing; everything else = operating). Payments for fixed asset acquisitions are investing, and payments to a vendor with a Cash Flow Activity (e.g. "Supplier - Finance Activities") follow that activity; a reversal follows the entry it reverses. Unpaid amounts and depreciation (non-cash) never appear. The last table lists every cash flow classified by transaction type or vendor.',
        'الطريقة المباشرة من دفتر الأستاذ: القيود التي تمس حساب نقدية أو ما في حكمها فقط هي التي تحرك النقدية. يُنسب أثر كل قيد على النقدية إلى حساباته المقابلة (حقوق الملكية = تمويلية؛ حسابات الأصول الثابتة ومجمع الإهلاك = استثمارية؛ وغير ذلك = تشغيلية). سداد اقتناء الأصول الثابتة استثماري، والمدفوعات لمورد له تصنيف تدفقات نقدية (مثل "Supplier - Finance Activities") تتبع ذلك التصنيف؛ والقيد العكسي يتبع القيد الذي يعكسه. لا تظهر المبالغ غير المدفوعة ولا الإهلاك (غير نقدي). الجدول الأخير يعرض كل التدفقات المصنفة حسب نوع العملية أو المورد.'
      ),
      note(
        `Transfers between cash/bank accounts are excluded (${transfers} entr${transfers === 1 ? 'y' : 'ies'}, ${round2(transferAmount)}). The Chart of Accounts does not identify loan/borrowing accounts, so their cash movements fall under operating activities.`,
        `التحويلات بين حسابات النقدية والبنوك مستبعدة (${transfers} قيد، ${round2(transferAmount)}). لا يحدد دليل الحسابات حسابات القروض، لذا تظهر حركتها النقدية ضمن الأنشطة التشغيلية.`
      ),
    ],
  };
}

// ---------------------------------------------------------------- 5. Statement of Changes in Equity
async function changesInEquity(query) {
  const period = C.resolvePeriod(query);
  const accounts = await C.loadAccounts();
  const equityIds = [...accounts.values()].filter(a => a.type === 'equity').map(a => a._id);
  const [totals, contributions, openingBalances, periodBalances] = await Promise.all([
    C.ledgerTotals({ start: period.start, end: period.end, lineMatch: { 'lines.account': { $in: equityIds } } }),
    C.ledgerTotals({ start: period.start, end: period.end, lineMatch: { 'lines.account': { $in: equityIds } }, entryMatch: { accountingAction: 'SHAREHOLDER_CONTRIBUTION' } }),
    C.balancesByAccount({ end: new Date(period.start.getTime() - 1) }),
    C.balancesByAccount({ start: period.start, end: period.end }),
  ]);
  const contributionsBy = new Map(contributions.map(t => [t.accountId, t]));

  // contributions + other increases - decreases = the period's net credit to the account.
  let rows = totals.map(t => {
    const account = accounts.get(t.accountId);
    const contribution = contributionsBy.get(t.accountId) || { periodCredit: 0, periodDebit: 0 };
    const opening = round2(t.openingCredit - t.openingDebit);
    return {
      code: account?.code || '?',
      name: account?.name || 'Unknown account',
      nameAr: account?.nameAr || null,
      opening,
      profit: null,
      contributions: round2(contribution.periodCredit - contribution.periodDebit),
      otherIncreases: round2(t.periodCredit - contribution.periodCredit),
      decreases: round2(t.periodDebit - contribution.periodDebit),
      closing: round2(opening + t.periodCredit - t.periodDebit),
    };
  });
  rows = C.sortAccountsByCode(rows, r => r.code);

  const openingProfit = C.profitFrom(openingBalances, accounts);
  const periodProfit = C.profitFrom(periodBalances, accounts);
  rows.push({
    code: '',
    name: 'Accumulated profit / (loss) not yet closed to equity',
    nameAr: 'الأرباح / (الخسائر) المتراكمة غير المرحلة لحقوق الملكية',
    opening: openingProfit,
    profit: periodProfit,
    contributions: 0,
    otherIncreases: 0,
    decreases: 0,
    closing: round2(openingProfit + periodProfit),
  });

  const closingTotal = C.sumBy(rows, 'closing');
  const position = await financialPosition({ asOf: period.to });

  return {
    period,
    summary: [
      summaryItem('opening', 'Opening equity', 'حقوق الملكية أول المدة', C.sumBy(rows, 'opening')),
      summaryItem('profit', 'Profit / (loss) for the period', 'ربح / (خسارة) الفترة', periodProfit),
      summaryItem('contributions', 'Capital contributions', 'مساهمات رأس المال', C.sumBy(rows, 'contributions')),
      summaryItem('closing', 'Closing equity', 'حقوق الملكية آخر المدة', closingTotal),
    ],
    checks: [check('Closing equity = equity in the Statement of Financial Position', 'حقوق الملكية آخر المدة = حقوق الملكية في قائمة المركز المالي', closingTotal === position.totalEquity, `${closingTotal} / ${position.totalEquity}`)],
    sections: [
      {
        key: 'equity',
        title: L('Changes in Equity', 'التغير في حقوق الملكية'),
        columns: [
          col('code', 'Account No.', 'رقم الحساب'),
          col('name', 'Equity Component', 'بند حقوق الملكية', 'account'),
          col('opening', 'Opening', 'أول المدة', 'money'),
          col('profit', 'Profit / (Loss)', 'الربح / (الخسارة)', 'money'),
          col('contributions', 'Contributions', 'المساهمات', 'money'),
          col('otherIncreases', 'Other Increases', 'زيادات أخرى', 'money'),
          col('decreases', 'Decreases / Withdrawals', 'تخفيضات / مسحوبات', 'money'),
          col('closing', 'Closing', 'آخر المدة', 'money'),
        ],
        rows,
        totals: {
          name: 'Total Equity',
          nameAr: 'إجمالي حقوق الملكية',
          opening: C.sumBy(rows, 'opening'),
          profit: periodProfit,
          contributions: C.sumBy(rows, 'contributions'),
          otherIncreases: C.sumBy(rows, 'otherIncreases'),
          decreases: C.sumBy(rows, 'decreases'),
          closing: closingTotal,
        },
      },
    ],
    notes: [
      note(
        'Contributions are the credits posted by shareholder contributions (Equity module). Other credits to equity accounts are "Other increases"; debits are "Decreases / withdrawals" - the system has no separate withdrawal or dividend transaction. No closing entries are created.',
        'المساهمات هي الأرصدة الدائنة المرحلة من مساهمات المساهمين (وحدة حقوق الملكية). أي أرصدة دائنة أخرى لحسابات حقوق الملكية تظهر "زيادات أخرى"، والمدينة "تخفيضات / مسحوبات" - لا يوجد في النظام عملية مستقلة للمسحوبات أو التوزيعات. لا يتم إنشاء قيود إقفال.'
      ),
    ],
  };
}

module.exports = { trialBalance, financialPosition, profitLoss, cashFlow, changesInEquity, cashMovements, groupedRows, TYPE_LABELS, flowCategoryOf };
