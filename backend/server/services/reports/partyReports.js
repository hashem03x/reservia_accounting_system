const mongoose = require('mongoose');
const User = require('../../models/userModel');
const Vendor = require('../../models/vendor/vendor');
const SalesOrder = require('../../models/sales/salesOrderModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const Project = require('../../models/project/projectModel');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const Product = require('../../models/inventory/productModel');
const ApiError = require('../../utils/apiError');
const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');
const { getOrderTotalAmount } = require('../../utils/orderTotals');
const C = require('./reportCommon');
const { projectLedgerFigures, loadProjects, profitCells, profitColumns, profitTotals, profitNotes, NOT_LINKED } = require('./projectReports');

const { round2, col, check, note, summaryItem, L } = C;

// The ledger control accounts the automatic accounting engine posts each party to (the same codes
// the General Ledger uses to resolve Sub Accounts): the receivable / payable account and the
// advances account. A party's balance is read from these accounts' lines carrying its number.
const PARTY = {
  customer: {
    controlCode: AutomaticJournalAccountCodes.accountsReceivableProjects,
    advanceCode: AutomaticJournalAccountCodes.customerAdvancesPayable,
    // Receivable: debit-natured. Advances received: credit-natured liability.
    sign: 1,
    title: L('Customer', 'العميل'),
    numberField: 'customerNumber',
    linkKind: 'customer',
  },
  vendor: {
    controlCode: AutomaticJournalAccountCodes.suppliers,
    advanceCode: AutomaticJournalAccountCodes.advanceToSuppliers,
    // Payable: credit-natured. Advances paid: debit-natured asset.
    sign: -1,
    title: L('Supplier', 'المورد'),
    numberField: 'vendorNumber',
    linkKind: 'vendor',
  },
};

async function controlAccounts(partyType) {
  const cfg = PARTY[partyType];
  const accounts = await ChartOfAccount.find({ code: { $in: [cfg.controlCode, cfg.advanceCode] } }).lean();
  return { control: accounts.find(a => a.code === cfg.controlCode) || null, advance: accounts.find(a => a.code === cfg.advanceCode) || null };
}

async function partyNames(partyType, numbers) {
  const list = numbers.filter(n => n != null);
  if (!list.length) return new Map();
  const docs =
    partyType === 'customer'
      ? await User.collection.find({ customerNumber: { $in: list } }, { projection: { name: 1, customerNumber: 1 } }).toArray()
      : await Vendor.collection.find({ vendorNumber: { $in: list } }, { projection: { name: 1, vendorNumber: 1 } }).toArray();
  return new Map(docs.map(d => [d[PARTY[partyType].numberField], d]));
}

async function partyNumberFilter(partyType, query) {
  const id = C.objectIdParam(query[partyType], partyType);
  if (!id) return null;
  const doc = partyType === 'customer' ? await User.collection.findOne({ _id: id }) : await Vendor.collection.findOne({ _id: id });
  if (!doc) throw new ApiError(`${partyType === 'customer' ? 'Customer' : 'Vendor'} not found.`, 404);
  return doc[PARTY[partyType].numberField] ?? -1;
}

// ---------------------------------------------------------------- 14 / 19. Customer / supplier balances
async function partyBalances(partyType, query) {
  const cfg = PARTY[partyType];
  const period = C.resolvePeriod(query);
  const byProject = query.byProject === 'true';
  const { control, advance } = await controlAccounts(partyType);
  if (!control) {
    return {
      period,
      summary: [],
      checks: [check('Control account exists', 'الحساب الرقابي موجود', false, cfg.controlCode)],
      sections: [],
      notes: [note(`The control account ${cfg.controlCode} does not exist in the Chart of Accounts.`, `الحساب الرقابي ${cfg.controlCode} غير موجود في دليل الحسابات.`)],
    };
  }
  const partyNumber = await partyNumberFilter(partyType, query);
  const lineMatch = { 'lines.account': { $in: [control._id, ...(advance ? [advance._id] : [])] } };
  if (partyNumber != null) Object.assign(lineMatch, { 'lines.partyNumber': partyNumber, 'lines.partyType': partyType });
  const totals = await C.ledgerTotals({
    start: period.start,
    end: period.end,
    lineMatch,
    groupBy: { partyNumber: '$lines.partyNumber', partyType: '$lines.partyType', ...(byProject ? { project: '$lines.project' } : {}), currency: '$lines.currency' },
  });

  // natural = debit - credit for a customer receivable, credit - debit for a supplier payable.
  const nat = (d, c) => round2(cfg.sign * (d - c));
  const rowsByKey = new Map();
  for (const t of totals) {
    const isControl = t.accountId === String(control._id);
    const owner = t.key.partyType === partyType ? t.key.partyNumber : null;
    const key = `${owner ?? ''}|${byProject ? C.idOf(t.key.project) || '' : ''}`;
    if (!rowsByKey.has(key)) rowsByKey.set(key, { partyNumber: owner, project: byProject ? C.idOf(t.key.project) : null, opening: 0, debit: 0, credit: 0, advances: 0, currencies: new Set() });
    const r = rowsByKey.get(key);
    if (t.key.currency) r.currencies.add(t.key.currency);
    if (isControl) {
      r.opening = round2(r.opening + nat(t.openingDebit, t.openingCredit));
      r.debit = round2(r.debit + t.periodDebit);
      r.credit = round2(r.credit + t.periodCredit);
    } else {
      // Advances: received from a customer (credit-natured) / paid to a supplier (debit-natured).
      r.advances = round2(r.advances - nat(t.openingDebit + t.periodDebit, t.openingCredit + t.periodCredit));
    }
  }

  const names = await partyNames(partyType, [...rowsByKey.values()].map(r => r.partyNumber));
  const projectIds = [...new Set([...rowsByKey.values()].map(r => r.project).filter(Boolean))];
  const projects = projectIds.length ? new Map((await Project.collection.find({ _id: { $in: projectIds.map(id => new mongoose.Types.ObjectId(id)) } }, { projection: { projectNumber: 1 } }).toArray()).map(p => [String(p._id), p])) : new Map();

  let rows = [...rowsByKey.values()].map(r => {
    const party = r.partyNumber != null ? names.get(r.partyNumber) : null;
    const closing = round2(r.opening + nat(r.debit, r.credit));
    return {
      partyNumber: r.partyNumber,
      partyName: r.partyNumber == null ? 'Unassigned (lines without a Sub Account)' : party?.name || 'Unknown',
      partyNameAr: r.partyNumber == null ? 'غير محدد (سطور بدون حساب فرعي)' : party?.name || 'غير معروف',
      projectNumber: byProject ? (r.project ? projects.get(r.project)?.projectNumber || '?' : '-') : undefined,
      currency: r.currencies.size ? [...r.currencies].join(', ') : 'EGP',
      opening: r.opening,
      debit: r.debit,
      credit: r.credit,
      closing,
      advances: r.advances,
      net: round2(closing - r.advances),
      _rowType: r.partyNumber == null ? 'muted' : undefined,
      _links: { ...(party ? { partyName: { kind: cfg.linkKind, id: String(party._id) } } : {}), ...(r.project ? { projectNumber: { kind: 'project', id: r.project } } : {}) },
    };
  });
  rows = rows.filter(r => r.opening || r.debit || r.credit || r.closing || r.advances).sort((a, b) => (a.partyNumber ?? Infinity) - (b.partyNumber ?? Infinity) || String(a.projectNumber || '').localeCompare(String(b.projectNumber || '')));

  const sums = { opening: C.sumBy(rows, 'opening'), debit: C.sumBy(rows, 'debit'), credit: C.sumBy(rows, 'credit'), closing: C.sumBy(rows, 'closing'), advances: C.sumBy(rows, 'advances'), net: C.sumBy(rows, 'net') };
  // Reconciliation: without a party filter, the rows add up to the control account itself.
  const controlBalances = await C.balancesByAccount({ end: period.end });
  const ledgerClosing = nat(controlBalances.get(String(control._id))?.debit || 0, controlBalances.get(String(control._id))?.credit || 0);
  const isCustomer = partyType === 'customer';

  return {
    period,
    summary: [
      summaryItem('closing', isCustomer ? 'Closing receivables' : 'Closing payables', isCustomer ? 'أرصدة العملاء آخر المدة' : 'أرصدة الموردين آخر المدة', sums.closing),
      summaryItem('advances', isCustomer ? 'Advances received' : 'Advances paid', isCustomer ? 'دفعات مقدمة مستلمة' : 'دفعات مقدمة مدفوعة', sums.advances),
      summaryItem('net', 'Net position', 'صافي المركز', sums.net),
    ],
    checks: partyNumber == null ? [check(`Balances = ${control.code} ${control.name} ledger balance`, `الأرصدة = رصيد حساب ${control.code} في دفتر الأستاذ`, sums.closing === ledgerClosing, `${sums.closing} / ${ledgerClosing}`)] : [],
    sections: [
      {
        key: 'balances',
        title: isCustomer ? L('Customer Balances', 'أرصدة العملاء') : L('Supplier Balances', 'أرصدة الموردين'),
        paginate: true,
        columns: [
          col('partyNumber', isCustomer ? 'Customer No.' : 'Supplier No.', isCustomer ? 'رقم العميل' : 'رقم المورد'),
          col('partyName', cfg.title.en, cfg.title.ar, 'name'),
          ...(byProject ? [col('projectNumber', 'Project No.', 'رقم المشروع')] : []),
          col('currency', 'Currency', 'العملة'),
          col('opening', 'Opening Balance', 'رصيد أول المدة', 'money'),
          col('debit', 'Debit', 'مدين', 'money'),
          col('credit', 'Credit', 'دائن', 'money'),
          col('closing', 'Closing Balance', 'رصيد آخر المدة', 'money'),
          col('advances', isCustomer ? 'Advances Received' : 'Advances Paid', isCustomer ? 'دفعات مقدمة مستلمة' : 'دفعات مقدمة مدفوعة', 'money'),
          col('net', 'Net Position', 'صافي المركز', 'money'),
        ],
        rows,
        totals: { partyName: 'Total', partyNameAr: 'الإجمالي', ...sums },
      },
    ],
    notes: [
      note(
        `From the ledger: the ${control.code} ${control.name} control account lines carrying each ${isCustomer ? 'Customer' : 'Vendor'} Number (Sub Account) - every posted receivable/payable, payment, advance application and reversal. ${isCustomer ? 'Debit increases, credit decreases the receivable.' : 'Credit increases, debit decreases the payable.'} Advances are the ${advance ? `${advance.code} ${advance.name}` : 'advances'} account balance, shown separately; Net Position = balance − advances. Amounts are in the local currency.`,
        `من دفتر الأستاذ: سطور الحساب الرقابي ${control.code} التي تحمل رقم ${isCustomer ? 'العميل' : 'المورد'} (الحساب الفرعي) - كل المستحقات والمدفوعات وتطبيقات الدفعات المقدمة والقيود العكسية. الدفعات المقدمة هي رصيد حساب ${advance ? advance.code : 'الدفعات المقدمة'} وتظهر منفصلة؛ صافي المركز = الرصيد − الدفعات المقدمة. المبالغ بالعملة المحلية.`
      ),
    ],
  };
}

// ---------------------------------------------------------------- 15 / 20. Aging
const BUCKETS = [
  { key: 'notDue', en: 'Not yet due', ar: 'غير مستحق بعد', test: d => d <= 0 },
  { key: 'd1_30', en: '1–30 days', ar: '1–30 يوم', test: d => d >= 1 && d <= 30 },
  { key: 'd31_60', en: '31–60 days', ar: '31–60 يوم', test: d => d >= 31 && d <= 60 },
  { key: 'd61_90', en: '61–90 days', ar: '61–90 يوم', test: d => d >= 61 && d <= 90 },
  { key: 'd90plus', en: 'Over 90 days', ar: 'أكثر من 90 يوم', test: d => d > 90 },
];

/**
 * Open-item aging by FIFO: per party, the control-account postings that increase the balance
 * (customer: debits; supplier: credits) are the open items, dated by their entry date; every
 * posting that decreases it (payments, advance applications, reversals, credit notes) is applied
 * to the oldest open items first. What remains is aged by days past (entry date + credit terms).
 */
async function partyAging(partyType, query) {
  const cfg = PARTY[partyType];
  const { asOf, end } = C.resolveAsOf(query);
  const termDays = C.numberParam(query.termDays, 'credit terms (days)', { min: 0, max: 3650, integer: true }) ?? 0;
  const { control } = await controlAccounts(partyType);
  if (!control) return { asOf, summary: [], checks: [check('Control account exists', 'الحساب الرقابي موجود', false, cfg.controlCode)], sections: [], notes: [] };
  const partyNumber = await partyNumberFilter(partyType, query);

  const lineMatch = { 'lines.account': control._id };
  if (partyNumber != null) Object.assign(lineMatch, { 'lines.partyNumber': partyNumber, 'lines.partyType': partyType });
  const lines = await JournalEntry.aggregate([
    { $match: C.ledgerMatch({ end }) },
    { $unwind: '$lines' },
    { $match: lineMatch },
    { $project: { _id: 0, date: 1, entryNumber: 1, partyNumber: { $cond: [{ $eq: ['$lines.partyType', partyType] }, '$lines.partyNumber', null] }, debit: '$lines.debit', credit: '$lines.credit' } },
    { $sort: { date: 1, entryNumber: 1 } },
  ]);

  const parties = new Map();
  for (const l of lines) {
    const increase = round2(cfg.sign > 0 ? l.debit - l.credit : l.credit - l.debit);
    if (!parties.has(l.partyNumber)) parties.set(l.partyNumber, { items: [], settlements: 0 });
    const p = parties.get(l.partyNumber);
    if (increase > 0) p.items.push({ date: l.date, amount: increase });
    else if (increase < 0) p.settlements = round2(p.settlements - increase);
  }

  const names = await partyNames(partyType, [...parties.keys()]);
  const DAY = 86400000;
  let rows = [];
  for (const [number, p] of parties) {
    let toApply = p.settlements;
    const buckets = Object.fromEntries(BUCKETS.map(b => [b.key, 0]));
    for (const item of p.items) {
      const applied = Math.min(item.amount, toApply);
      toApply = round2(toApply - applied);
      const open = round2(item.amount - applied);
      if (open > 0) {
        const daysPastDue = Math.floor((end.getTime() - (new Date(item.date).getTime() + termDays * DAY)) / DAY);
        const bucket = BUCKETS.find(b => b.test(daysPastDue));
        buckets[bucket.key] = round2(buckets[bucket.key] + open);
      }
    }
    const outstanding = round2(BUCKETS.reduce((s, b) => s + buckets[b.key], 0));
    const party = number != null ? names.get(number) : null;
    rows.push({
      partyNumber: number,
      partyName: number == null ? 'Unassigned (lines without a Sub Account)' : party?.name || 'Unknown',
      partyNameAr: number == null ? 'غير محدد (سطور بدون حساب فرعي)' : party?.name || 'غير معروف',
      ...buckets,
      outstanding,
      unappliedCredits: toApply,
      balance: round2(outstanding - toApply),
      _rowType: number == null ? 'muted' : undefined,
      _links: party ? { partyName: { kind: cfg.linkKind, id: String(party._id) } } : undefined,
    });
  }
  rows = rows.filter(r => r.outstanding || r.unappliedCredits).sort((a, b) => (a.partyNumber ?? Infinity) - (b.partyNumber ?? Infinity));
  const totals = { partyName: 'Total', partyNameAr: 'الإجمالي', outstanding: C.sumBy(rows, 'outstanding'), unappliedCredits: C.sumBy(rows, 'unappliedCredits'), balance: C.sumBy(rows, 'balance') };
  BUCKETS.forEach(b => (totals[b.key] = C.sumBy(rows, b.key)));
  const ledger = await C.balancesByAccount({ end });
  const ledgerBalance = round2(cfg.sign * ((ledger.get(String(control._id))?.debit || 0) - (ledger.get(String(control._id))?.credit || 0)));
  const isCustomer = partyType === 'customer';

  return {
    asOf,
    summary: [summaryItem('outstanding', 'Outstanding', 'المستحق', totals.outstanding), summaryItem('overdue', 'Overdue (1+ days)', 'متأخر (يوم فأكثر)', round2(totals.outstanding - totals.notDue)), summaryItem('termDays', 'Credit terms (days)', 'مدة الائتمان (أيام)', termDays, 'number')],
    checks: partyNumber == null ? [check(`Balance = ${control.code} ledger balance at the as-of date`, `الرصيد = رصيد حساب ${control.code} في التاريخ المحدد`, totals.balance === ledgerBalance, `${totals.balance} / ${ledgerBalance}`)] : [],
    sections: [
      {
        key: 'aging',
        title: isCustomer ? L('Receivables Aging', 'أعمار المديونية') : L('Payables Aging', 'أعمار الدائنية'),
        paginate: true,
        columns: [
          col('partyNumber', isCustomer ? 'Customer No.' : 'Supplier No.', isCustomer ? 'رقم العميل' : 'رقم المورد'),
          col('partyName', cfg.title.en, cfg.title.ar, 'name'),
          ...BUCKETS.map(b => col(b.key, b.en, b.ar, 'money')),
          col('outstanding', 'Outstanding', 'إجمالي المستحق', 'money'),
          col('unappliedCredits', isCustomer ? 'Unapplied Credits' : 'Unapplied Debits', isCustomer ? 'دائن غير مطبق' : 'مدين غير مطبق', 'money'),
          col('balance', 'Balance', 'الرصيد', 'money'),
        ],
        rows,
        totals,
      },
    ],
    notes: [
      note(
        `Limitation: Sales/Purchase Orders and journal entries store no due dates or invoice-level allocations. Each ${isCustomer ? 'receivable posting (debit)' : 'payable posting (credit)'} on the ${control.code} control account is treated as an open item dated by its entry; payments, advance applications, reversals and credits are applied to the oldest items first (FIFO). Due date = entry date + the credit terms entered above (default 0 days, i.e. due on posting).`,
        `قيد: لا تحتوي أوامر البيع والشراء ولا القيود على تواريخ استحقاق أو تخصيص على مستوى الفاتورة. كل ${isCustomer ? 'قيد مدين' : 'قيد دائن'} على الحساب الرقابي ${control.code} يُعامل كبند مفتوح بتاريخ قيده؛ وتُطبق المدفوعات وتطبيقات الدفعات المقدمة والقيود العكسية على أقدم البنود أولاً (الوارد أولاً يصرف أولاً). تاريخ الاستحقاق = تاريخ القيد + مدة الائتمان المحددة (افتراضياً 0 يوم أي مستحق عند الترحيل).`
      ),
    ],
  };
}

// ---------------------------------------------------------------- order lists
function orderDateFilter(period) {
  return { createdAt: { $gte: period.start, $lte: period.end } };
}

// ---------------------------------------------------------------- 16. Sales orders
async function salesOrders(query) {
  const period = C.resolvePeriod(query);
  const filter = orderDateFilter(period);
  const customer = C.objectIdParam(query.customer, 'customer');
  if (customer) filter.customer = customer;
  const project = C.objectIdParam(query.project, 'project');
  if (project) filter.project = project;
  const status = C.enumParam(query.orderStatus, 'order status', ['pending', 'delivered', 'canceled']);
  if (status) filter.orderStatus = status;
  const paymentStatus = C.enumParam(query.paymentStatus, 'payment status', ['unpaid', 'partial', 'paid', 'unknown']);
  if (paymentStatus) filter.paymentStatus = paymentStatus;

  const orders = await SalesOrder.collection.find(filter).sort({ createdAt: 1 }).limit(C.MAX_DETAIL_ROWS + 1).toArray();
  const truncated = orders.length > C.MAX_DETAIL_ROWS;
  const list = orders.slice(0, C.MAX_DETAIL_ROWS);
  const [customers, projects] = await Promise.all([
    User.collection.find({ _id: { $in: [...new Set(list.map(o => C.idOf(o.customer)).filter(Boolean))].map(id => new mongoose.Types.ObjectId(id)) } }, { projection: { name: 1, customerNumber: 1 } }).toArray(),
    Project.collection.find({ _id: { $in: [...new Set(list.map(o => C.idOf(o.project)).filter(Boolean))].map(id => new mongoose.Types.ObjectId(id)) } }, { projection: { projectNumber: 1 } }).toArray(),
  ]);
  const customerById = new Map(customers.map(c => [String(c._id), c]));
  const projectById = new Map(projects.map(p => [String(p._id), p]));

  const rows = list.map(o => {
    const c = customerById.get(C.idOf(o.customer));
    const total = round2(getOrderTotalAmount(o));
    const paid = round2(o.paidAmount || 0);
    return {
      code: o.code || String(o._id),
      date: o.createdAt,
      customer: c ? `${c.customerNumber != null ? `${c.customerNumber} - ` : ''}${c.name}` : null,
      projectNumber: projectById.get(C.idOf(o.project))?.projectNumber || null,
      orderStatus: o.orderStatus || null,
      paymentStatus: o.paymentStatus || null,
      currency: 'EGP',
      exchangeRate: 1,
      subtotal: round2(o.totalAmount || 0),
      vat: round2(o.vatAmount || 0),
      withholding: round2(o.withholdingTaxAmount || 0),
      total,
      paid,
      outstanding: o.orderStatus === 'canceled' ? null : round2(total - paid),
      _links: { code: { kind: 'salesOrder', id: String(o._id) }, ...(c ? { customer: { kind: 'customer', id: String(c._id) } } : {}), ...(o.project ? { projectNumber: { kind: 'project', id: C.idOf(o.project) } } : {}) },
    };
  });
  const totals = { code: 'Total', codeAr: 'الإجمالي' };
  ['subtotal', 'vat', 'withholding', 'total', 'paid', 'outstanding'].forEach(k => (totals[k] = C.sumBy(rows, k)));
  return {
    period,
    summary: [summaryItem('orders', 'Orders', 'عدد الأوامر', rows.length, 'number'), summaryItem('subtotal', 'Subtotal (before taxes)', 'الإجمالي قبل الضرائب', totals.subtotal), summaryItem('total', 'Total', 'الإجمالي', totals.total), summaryItem('outstanding', 'Outstanding', 'المتبقي', totals.outstanding)],
    checks: truncated ? [check('All orders included', 'تم تضمين كل الأوامر', false, `limited to ${C.MAX_DETAIL_ROWS}`)] : [],
    sections: [
      {
        key: 'orders',
        title: L('Sales Orders', 'أوامر البيع'),
        paginate: true,
        columns: [
          col('code', 'Order No.', 'رقم الأمر'),
          col('date', 'Date', 'التاريخ', 'date'),
          col('customer', 'Customer', 'العميل'),
          col('projectNumber', 'Project No.', 'رقم المشروع'),
          col('orderStatus', 'Order Status', 'حالة الأمر', 'status'),
          col('paymentStatus', 'Payment Status', 'حالة الدفع', 'status'),
          col('currency', 'Currency', 'العملة'),
          col('exchangeRate', 'Rate', 'سعر الصرف', 'number'),
          col('subtotal', 'Subtotal', 'الإجمالي قبل الضرائب', 'money'),
          col('vat', 'VAT', 'ضريبة القيمة المضافة', 'money'),
          col('withholding', 'Withholding Tax', 'ضريبة الخصم', 'money'),
          col('total', 'Total', 'الإجمالي', 'money'),
          col('paid', 'Paid', 'المدفوع', 'money'),
          col('outstanding', 'Outstanding', 'المتبقي', 'money'),
        ],
        rows,
        totals,
      },
    ],
    notes: [
      note(
        'Order figures exactly as the Sales Order stores them: Subtotal = total after discounts and returns before taxes; Total = Subtotal + VAT − Withholding Tax; Outstanding = Total − Paid (n/a for canceled orders). Sales Orders have no currency field - all amounts are in the local currency (rate 1). Dated by the order creation date.',
        'أرقام الأوامر كما هي مسجلة في أمر البيع: الإجمالي قبل الضرائب بعد الخصومات والمرتجعات؛ الإجمالي = الإجمالي قبل الضرائب + ضريبة القيمة المضافة − ضريبة الخصم؛ المتبقي = الإجمالي − المدفوع (غير متاح للأوامر الملغاة). لا يوجد حقل عملة في أوامر البيع - كل المبالغ بالعملة المحلية (سعر 1). مؤرخة بتاريخ إنشاء الأمر.'
      ),
    ],
  };
}

// ---------------------------------------------------------------- 17. Sales order profitability
async function salesOrderProfitability(query) {
  const base = await salesOrders(query);
  const period = base.period;
  const orderRows = base.sections[0].rows;
  const ids = orderRows.map(r => new mongoose.Types.ObjectId(r._links.code.id));
  const accounts = await C.loadAccounts();
  // Ledger revenue / cost of sales posted by each order's own automatic entries (revenue
  // recognition + project cost entry carry triggeredBySalesOrder), up to the period end.
  const totals = ids.length ? await C.ledgerTotals({ end: period.end, entryMatch: { triggeredBySalesOrder: { $in: ids } }, groupBy: { order: '$triggeredBySalesOrder' } }) : [];
  const ledger = new Map();
  for (const t of totals) {
    const type = accounts.get(t.accountId)?.type;
    const key = C.idOf(t.key.order);
    if (!ledger.has(key)) ledger.set(key, { revenue: 0, costOfSales: 0 });
    const f = ledger.get(key);
    if (type === 'revenue') f.revenue = round2(f.revenue + t.periodCredit - t.periodDebit);
    if (type === 'cogs') f.costOfSales = round2(f.costOfSales + t.periodDebit - t.periodCredit);
  }
  const orders = ids.length ? await SalesOrder.collection.find({ _id: { $in: ids } }, { projection: { items: 1, totalAmount: 1 } }).toArray() : [];
  const itemsCost = new Map(
    orders.map(o => [
      String(o._id),
      (o.items || []).some(i => typeof i.costWhenSold !== 'number')
        ? null
        : round2((o.items || []).reduce((s, i) => s + i.costWhenSold * Math.max(0, (i.starterQuantity || 0) - (i.returnedQuantity || 0)), 0)),
    ])
  );

  const rows = orderRows.map(r => {
    const f = ledger.get(r._links.code.id) || { revenue: 0, costOfSales: 0 };
    const grossProfit = round2(f.revenue - f.costOfSales);
    const cost = itemsCost.get(r._links.code.id);
    return {
      code: r.code,
      date: r.date,
      customer: r.customer,
      projectNumber: r.projectNumber,
      orderStatus: r.orderStatus,
      subtotal: r.subtotal,
      revenue: f.revenue,
      costOfSales: f.costOfSales,
      grossProfit,
      grossMargin: C.pct(grossProfit, f.revenue),
      itemsCost: cost,
      itemsMargin: cost == null || r.orderStatus === 'canceled' ? null : C.pct(round2(r.subtotal - cost), r.subtotal),
      _links: r._links,
    };
  });
  const totalsRow = { code: 'Total', codeAr: 'الإجمالي' };
  ['subtotal', 'revenue', 'costOfSales', 'grossProfit', 'itemsCost'].forEach(k => (totalsRow[k] = C.sumBy(rows, k)));
  totalsRow.grossMargin = C.pct(totalsRow.grossProfit, totalsRow.revenue);
  return {
    period,
    summary: [summaryItem('revenue', 'Recognized revenue', 'الإيراد المثبت', totalsRow.revenue), summaryItem('grossProfit', 'Gross profit', 'مجمل الربح', totalsRow.grossProfit), summaryItem('grossMargin', 'Gross margin', 'نسبة مجمل الربح', totalsRow.grossMargin, 'percent')],
    checks: base.checks,
    sections: [
      {
        key: 'orders',
        title: L('Sales Order Profitability', 'ربحية أوامر البيع'),
        paginate: true,
        columns: [
          col('code', 'Order No.', 'رقم الأمر'),
          col('date', 'Date', 'التاريخ', 'date'),
          col('customer', 'Customer', 'العميل'),
          col('projectNumber', 'Project No.', 'رقم المشروع'),
          col('orderStatus', 'Status', 'الحالة', 'status'),
          col('subtotal', 'Order Amount (excl. taxes)', 'قيمة الأمر (بدون ضرائب)', 'money'),
          col('revenue', 'Recognized Revenue', 'الإيراد المثبت', 'money'),
          col('costOfSales', 'Recognized Cost of Sales', 'تكلفة المبيعات المثبتة', 'money'),
          col('grossProfit', 'Gross Profit', 'مجمل الربح', 'money'),
          col('grossMargin', 'Gross Margin', 'نسبة مجمل الربح', 'percent'),
          col('itemsCost', 'Items Cost (order lines)', 'تكلفة الأصناف (سطور الأمر)', 'money'),
          col('itemsMargin', 'Items Margin', 'هامش الأصناف', 'percent'),
        ],
        rows,
        totals: totalsRow,
      },
    ],
    notes: [
      note(
        'Recognized revenue and cost of sales are the ledger postings of each order\'s own automatic entries (revenue recognition - excluding VAT, withholding tax is not deducted from revenue - and the project cost entry), up to the period end. They follow the project\'s executed percentage, so they can differ from the order amount. Items Cost = Σ cost at sale × (sold − returned) from the order lines, shown for reference; "n/a" when a line has no recorded cost.',
        'الإيراد وتكلفة المبيعات المثبتان هما ترحيلات القيود الآلية الخاصة بكل أمر (إثبات الإيراد - بدون ضريبة القيمة المضافة، ولا تُخصم ضريبة الخصم من الإيراد - وقيد تحميل تكاليف المشروع) حتى نهاية الفترة. وهي تتبع نسبة تنفيذ المشروع فقد تختلف عن قيمة الأمر. تكلفة الأصناف = مجموع تكلفة البيع × (المباع − المرتجع) من سطور الأمر للمرجعية؛ "غير متاح" إذا لم تُسجل تكلفة لسطر.'
      ),
    ],
  };
}

// ---------------------------------------------------------------- 18. Customer profitability
async function customerProfitability(query) {
  const period = C.resolvePeriod(query);
  const [projects, figures] = await Promise.all([loadProjects({ customer: query.customer, sector: query.sector }), projectLedgerFigures(period)]);
  const byCustomer = new Map();
  for (const p of projects) {
    const key = p.customer?._id ? String(p.customer._id) : '';
    if (!byCustomer.has(key)) byCustomer.set(key, { customer: p.customer || null, projects: 0, revenue: 0, costOfSales: 0, otherExpenses: 0 });
    const g = byCustomer.get(key);
    const f = figures.get(String(p._id)) || { revenue: 0, costOfSales: 0, otherExpenses: 0 };
    g.projects += 1;
    g.revenue = round2(g.revenue + f.revenue);
    g.costOfSales = round2(g.costOfSales + f.costOfSales);
    g.otherExpenses = round2(g.otherExpenses + f.otherExpenses);
  }
  const rows = [...byCustomer.values()]
    .map(g => ({
      customerNumber: g.customer?.customerNumber ?? null,
      customer: g.customer ? g.customer.name : 'Projects without a customer',
      customerAr: g.customer ? g.customer.name : 'مشروعات بدون عميل',
      projects: g.projects,
      ...profitCells(g),
      _links: g.customer ? { customer: { kind: 'customer', id: String(g.customer._id) } } : undefined,
    }))
    .filter(r => r.revenue || r.costOfSales || r.otherExpenses || query.includeZero === 'true')
    .sort((a, b) => b.revenue - a.revenue);
  const filtered = !!(query.customer || query.sector);
  if (!filtered && figures.has(null)) rows.push({ customer: NOT_LINKED.en, customerAr: NOT_LINKED.ar, _rowType: 'muted', ...profitCells(figures.get(null)) });
  const totals = profitTotals(rows);
  return {
    period,
    summary: [summaryItem('revenue', 'Revenue', 'الإيرادات', totals.revenue), summaryItem('grossProfit', 'Gross profit', 'مجمل الربح', totals.grossProfit), summaryItem('grossMargin', 'Gross margin', 'نسبة مجمل الربح', totals.grossMargin, 'percent')],
    checks: [],
    sections: [{ key: 'customers', title: L('Customer Profitability', 'ربحية العملاء'), paginate: true, columns: [col('customerNumber', 'Customer No.', 'رقم العميل'), col('customer', 'Customer', 'العميل', 'name'), col('projects', 'Projects', 'المشروعات', 'number'), ...profitColumns()], rows, totals: { customer: 'Total', customerAr: 'الإجمالي', projects: C.sumBy(rows, 'projects'), ...totals } }],
    notes: [...profitNotes(), note('Each customer is the sum of its projects in the Project Profitability report (same rules), so the reports reconcile and nothing is counted twice.', 'كل عميل هو مجموع مشروعاته في تقرير ربحية المشروعات (نفس القواعد)، فتتطابق التقارير ولا يُحتسب شيء مرتين.')],
  };
}

// ---------------------------------------------------------------- 21. Purchase orders
async function purchaseOrders(query) {
  const period = C.resolvePeriod(query);
  const filter = orderDateFilter(period);
  const vendor = C.objectIdParam(query.vendor, 'vendor');
  if (vendor) filter.vendorId = vendor;
  const project = C.objectIdParam(query.project, 'project');
  if (project) filter.project = project;
  const paymentStatus = C.enumParam(query.paymentStatus, 'payment status', ['unpaid', 'partial', 'paid', 'unknown']);
  if (paymentStatus) filter.paymentStatus = paymentStatus;

  const orders = await PurchaseOrder.collection.find(filter).sort({ createdAt: 1 }).limit(C.MAX_DETAIL_ROWS + 1).toArray();
  const truncated = orders.length > C.MAX_DETAIL_ROWS;
  const list = orders.slice(0, C.MAX_DETAIL_ROWS);
  const ids = arr => [...new Set(arr.filter(Boolean))].map(id => new mongoose.Types.ObjectId(id));
  const [vendors, projects, products] = await Promise.all([
    Vendor.collection.find({ _id: { $in: ids(list.map(o => C.idOf(o.vendorId))) } }, { projection: { name: 1, vendorNumber: 1 } }).toArray(),
    Project.collection.find({ _id: { $in: ids(list.map(o => C.idOf(o.project))) } }, { projection: { projectNumber: 1 } }).toArray(),
    Product.collection.find({ _id: { $in: ids(list.flatMap(o => (o.items || []).map(i => C.idOf(i.productId)))) } }, { projection: { type: 1 } }).toArray(),
  ]);
  const vendorById = new Map(vendors.map(v => [String(v._id), v]));
  const projectById = new Map(projects.map(p => [String(p._id), p]));
  const typeById = new Map(products.map(p => [String(p._id), p.type || 'product']));

  const rows = list.map(o => {
    const v = vendorById.get(C.idOf(o.vendorId));
    const total = round2(getOrderTotalAmount(o));
    const paid = round2(o.paidAmount || 0);
    const types = new Set((o.items || []).map(i => typeById.get(C.idOf(i.productId)) || 'product'));
    return {
      code: o.code || String(o._id),
      date: o.createdAt,
      vendor: v ? `${v.vendorNumber != null ? `${v.vendorNumber} - ` : ''}${v.name}` : null,
      projectNumber: projectById.get(C.idOf(o.project))?.projectNumber || null,
      itemTypes: [...types].map(t => (t === 'service' ? 'Services' : 'Products')).join(' + '),
      paymentStatus: o.paymentStatus || null,
      currency: 'EGP',
      exchangeRate: 1,
      subtotal: round2(o.totalAmount || 0),
      vat: round2(o.vatAmount || 0),
      withholding: round2(o.withholdingTaxAmount || 0),
      total,
      paid,
      outstanding: round2(total - paid),
      _links: { code: { kind: 'purchaseOrder', id: String(o._id) }, ...(v ? { vendor: { kind: 'vendor', id: String(v._id) } } : {}), ...(o.project ? { projectNumber: { kind: 'project', id: C.idOf(o.project) } } : {}) },
    };
  });
  const totals = { code: 'Total', codeAr: 'الإجمالي' };
  ['subtotal', 'vat', 'withholding', 'total', 'paid', 'outstanding'].forEach(k => (totals[k] = C.sumBy(rows, k)));
  return {
    period,
    summary: [summaryItem('orders', 'Orders', 'عدد الأوامر', rows.length, 'number'), summaryItem('total', 'Total', 'الإجمالي', totals.total), summaryItem('outstanding', 'Outstanding', 'المتبقي', totals.outstanding)],
    checks: truncated ? [check('All orders included', 'تم تضمين كل الأوامر', false, `limited to ${C.MAX_DETAIL_ROWS}`)] : [],
    sections: [
      {
        key: 'orders',
        title: L('Purchase Orders', 'أوامر الشراء'),
        paginate: true,
        columns: [
          col('code', 'Order No.', 'رقم الأمر'),
          col('date', 'Date', 'التاريخ', 'date'),
          col('vendor', 'Supplier', 'المورد'),
          col('projectNumber', 'Project No.', 'رقم المشروع'),
          col('itemTypes', 'Items', 'نوع البنود'),
          col('paymentStatus', 'Payment Status', 'حالة الدفع', 'status'),
          col('currency', 'Currency', 'العملة'),
          col('exchangeRate', 'Rate', 'سعر الصرف', 'number'),
          col('subtotal', 'Subtotal', 'الإجمالي قبل الضرائب', 'money'),
          col('vat', 'VAT', 'ضريبة القيمة المضافة', 'money'),
          col('withholding', 'Withholding Tax', 'ضريبة الخصم', 'money'),
          col('total', 'Total', 'الإجمالي', 'money'),
          col('paid', 'Paid', 'المدفوع', 'money'),
          col('outstanding', 'Outstanding', 'المتبقي', 'money'),
        ],
        rows,
        totals,
      },
    ],
    notes: [
      note(
        'Order figures exactly as the Purchase Order stores them (products and services). In this system a Purchase Order is posted to the ledger when it is created (receipt / service cost Dr, Suppliers Cr), so its total is a recorded liability, not only a commitment - the Supplier Balances report is the ledger view. Purchase Orders have no lifecycle status field; the payment status is shown. All amounts are in the local currency (rate 1).',
        'أرقام الأوامر كما هي مسجلة في أمر الشراء (منتجات وخدمات). في هذا النظام يُرحل أمر الشراء لدفتر الأستاذ عند إنشائه (مدين المخزون/تكلفة الخدمة، دائن الموردين)، فإجماليه التزام مسجل وليس مجرد ارتباط - وتقرير أرصدة الموردين هو عرض دفتر الأستاذ. لا يوجد حقل حالة لأمر الشراء؛ تظهر حالة الدفع. كل المبالغ بالعملة المحلية (سعر 1).'
      ),
    ],
  };
}

module.exports = {
  customerBalances: q => partyBalances('customer', q),
  supplierBalances: q => partyBalances('vendor', q),
  customerAging: q => partyAging('customer', q),
  supplierAging: q => partyAging('vendor', q),
  salesOrders,
  salesOrderProfitability,
  customerProfitability,
  purchaseOrders,
  PARTY,
  BUCKETS,
};
