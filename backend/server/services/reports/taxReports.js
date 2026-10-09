const JournalEntry = require('../../models/accounting/journalEntryModel');
const User = require('../../models/userModel');
const Vendor = require('../../models/vendor/vendor');
const Project = require('../../models/project/projectModel');
const SalesOrder = require('../../models/sales/salesOrderModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const Expense = require('../../models/expense/expenseModel');
const FixedAsset = require('../../models/fixedAssets');
const ApiError = require('../../utils/apiError');
const { AutomaticJournalAccountCodes, isPaymentAccountEligible } = require('../../utils/accountingConstants');
const C = require('./reportCommon');

const { round2, idOf, col, check, note, summaryItem, L } = C;

// Taxes reports - VAT and Commercial & Industrial Profit Tax (withholding, "خصم وإضافة") movements,
// read from the posted ledger. Read-only.
//
// TAX ACCOUNTS are discovered from the Chart of Accounts (discoverTaxAccounts), never from a list
// of codes in this file:
//   1. the accounts the automatic accounting engine posts VAT / withholding to
//      (AutomaticJournalAccountCodes - the system's existing configuration), and
//   2. every account whose own name, or its parent group's name, mentions a tax (English or
//      Arabic). The name decides VAT vs withholding; an account whose name says neither (or both),
//      or a profit-or-loss tax account, is listed for review in the Tax Accounts Overview instead
//      of being forced into a report.
//
// Each requested report is ONE tax and ONE movement direction across ALL accounts of that tax
// (e.g. VAT - Debit = every debit line on every VAT account). The account's role (input VAT vs
// output VAT, withholding receivable vs payable) comes from its normal balance side, and each
// line's nature (tax on a document, reversal, payment, settlement, manual entry) from the entry -
// a debit is never assumed to be recoverable tax, nor a credit payable tax.

const PATTERNS = {
  vat: /\bvat\b|value[\s-]*added|قيم[ةه]\s*(?:ال)?مضاف[ةه]/i,
  wht: /withholding|with-holding|commercial\s*(?:and|&)\s*industrial|خصم\s*و\s*(?:ال)?[إاأ]ضاف[ةه]|(?:ال)?[أا]رباح\s*(?:ال)?تجارية/i,
  tax: /\btax(?:es)?\b|ضريب|ضرائب/i,
};

// The accounts the automatic engine posts each tax to (utils/accountingConstants.js) - existing
// configuration, used as evidence of what the account holds.
const AUTOMATIC_TAX_ACCOUNTS = [
  { code: AutomaticJournalAccountCodes.inputVat, category: 'vat', use: L('Input VAT on Purchase Orders, Expenses and Fixed Assets', 'ضريبة المدخلات على أوامر الشراء والمصروفات والأصول الثابتة') },
  { code: AutomaticJournalAccountCodes.vatPayable, category: 'vat', use: L('Output VAT on Sales Orders (revenue recognition)', 'ضريبة المخرجات على أوامر البيع (إثبات الإيراد)') },
  { code: AutomaticJournalAccountCodes.withholdingTaxReceivable, category: 'wht', use: L('Withholding deducted by customers on Sales Orders', 'ضريبة الخصم التي يخصمها العملاء على أوامر البيع') },
  { code: AutomaticJournalAccountCodes.withholdingTaxPayable, category: 'wht', use: L('Withholding deducted from suppliers on Purchase Orders', 'ضريبة الخصم المخصومة من الموردين على أوامر الشراء') },
];

const CATEGORY_TITLES = {
  vat: L('Value Added Tax', 'ضريبة القيمة المضافة'),
  wht: L('Commercial and Industrial Profit Tax (withholding)', 'ضرائب الأرباح التجارية والصناعية (خصم وإضافة)'),
  other: L('Other tax account - to review', 'حساب ضرائب آخر - للمراجعة'),
};

const ROLES = {
  'vat|debit': L('Input VAT (recoverable)', 'ضريبة القيمة المضافة على المدخلات (قابلة للخصم)'),
  'vat|credit': L('Output VAT (payable)', 'ضريبة القيمة المضافة على المخرجات (مستحقة)'),
  'wht|debit': L('Withholding tax receivable (deducted by customers)', 'ضرائب خصم وإضافة لنا (خصمها العملاء)'),
  'wht|credit': L('Withholding tax payable (deducted from suppliers)', 'ضرائب خصم وإضافة علينا (مخصومة من الموردين)'),
};

const MOVEMENTS = {
  invoice: L('Tax on a document', 'ضريبة على مستند'),
  reversal: L('Reversal', 'قيد عكسي'),
  payment: L('Payment / refund', 'سداد / استرداد'),
  offset: L('Settlement between tax accounts', 'تسوية بين حسابات الضرائب'),
  adjustment: L('Manual entry / adjustment', 'قيد يدوي / تسوية'),
};

const SOURCES = {
  SO: L('Sales Order', 'أمر بيع'),
  PO: L('Purchase Order', 'أمر شراء'),
  EXPENSE: L('Expense', 'مصروف'),
  FIXED_ASSET: L('Fixed Asset', 'أصل ثابت'),
  MANUAL: L('Manual journal entry', 'قيد يدوي'),
  OTHER: L('Other automatic entry', 'قيد آلي آخر'),
};

// Automatic entries that carry the tax of a document, and the side of that entry the document's
// amount excluding tax sits on: revenue is credited on a sale; the asset / expense / WIP is
// debited on a purchase.
const SALE_ACTIONS = ['PROJECT_REVENUE_RECOGNITION'];
const PURCHASE_ACTIONS = ['PO_INVENTORY_RECEIPT', 'PO_SERVICE_TO_WIP', 'EXPENSE_RECORDED', 'FIXED_ASSET_ACQUISITION'];
const SOURCE_OF_ACTION = { PROJECT_REVENUE_RECOGNITION: 'SO', PO_INVENTORY_RECEIPT: 'PO', PO_SERVICE_TO_WIP: 'PO', EXPENSE_RECORDED: 'EXPENSE', FIXED_ASSET_ACQUISITION: 'FIXED_ASSET' };

// ---------------------------------------------------------------- discovery
const matches = text => ({ vat: PATTERNS.vat.test(text), wht: PATTERNS.wht.test(text), tax: PATTERNS.tax.test(text) });
const categoryOf = hit => (hit.vat && hit.wht ? 'both' : hit.vat ? 'vat' : hit.wht ? 'wht' : null);

/**
 * Every tax account in the Chart of Accounts: { account, category ('vat' | 'wht' | 'other'), side
 * (normal balance 'debit' | 'credit'), role, basis, review (why it needs review, or null) }.
 */
function discoverTaxAccounts(accounts) {
  const automatic = new Map(AUTOMATIC_TAX_ACCOUNTS.map(a => [a.code, a]));
  const found = [];
  for (const account of accounts.values()) {
    const own = matches(`${account.name || ''} ${account.nameAr || ''}`);
    const group = matches(`${account.parentGroupNameEn || ''} ${account.parentGroupNameAr || ''} ${account.parentAccount?.name || ''} ${account.parentAccount?.nameAr || ''}`);
    const auto = automatic.get(account.code);
    if (!auto && !own.vat && !own.wht && !own.tax && !group.vat && !group.wht && !group.tax) continue;

    const side = C.DEBIT_NATURE_TYPES.has(account.type) ? 'debit' : 'credit';
    const nameCategory = categoryOf(own);
    const groupCategory = categoryOf(group);
    let category = 'other';
    let basis;
    let review = null;
    if (auto) {
      category = auto.category;
      basis = L(`Automatic entries post here: ${auto.use.en}`, `تُرحّل إليه القيود الآلية: ${auto.use.ar}`);
      if (nameCategory && nameCategory !== category) review = L('The account name suggests a different tax than the one the automatic entries post to it.', 'اسم الحساب يشير إلى ضريبة غير التي تُرحّلها إليه القيود الآلية.');
    } else if (C.PROFIT_AND_LOSS_TYPES.has(account.type)) {
      basis = L('Tax mentioned in the account name', 'الحساب يذكر الضريبة في اسمه');
      review = L('A profit-or-loss account (tax expense or income), not a VAT or withholding balance - not included in the four tax reports.', 'حساب أرباح وخسائر (مصروف أو إيراد ضريبي) وليس رصيد ضريبة قيمة مضافة أو خصم وإضافة - غير مدرج في تقارير الضرائب الأربعة.');
    } else if (nameCategory === 'both') {
      basis = L('Tax mentioned in the account name', 'الحساب يذكر الضريبة في اسمه');
      review = L('The account name mentions both VAT and withholding tax.', 'اسم الحساب يذكر ضريبة القيمة المضافة وضريبة الخصم معاً.');
    } else if (nameCategory) {
      category = nameCategory;
      basis = L('Account name', 'اسم الحساب');
    } else if (groupCategory && groupCategory !== 'both') {
      category = groupCategory;
      basis = L('Parent group name', 'اسم المجموعة الأم');
    } else {
      basis = L(own.tax ? 'Tax mentioned in the account name' : 'Tax mentioned in the parent group name', own.tax ? 'الحساب يذكر الضريبة في اسمه' : 'المجموعة الأم تذكر الضريبة');
      review = L('The name does not say whether this is VAT or withholding tax - not included in the four tax reports until it is renamed or reclassified.', 'الاسم لا يحدد هل هي ضريبة قيمة مضافة أم ضريبة خصم وإضافة - غير مدرج في تقارير الضرائب الأربعة حتى يعاد تسميته أو تصنيفه.');
    }
    const role = ROLES[`${category}|${side}`] || CATEGORY_TITLES.other;
    found.push({ account, category, side, role, basis, review });
  }
  const missingAutomatic = AUTOMATIC_TAX_ACCOUNTS.filter(a => ![...accounts.values()].some(acc => acc.code === a.code));
  return { taxAccounts: C.sortAccountsByCode(found, d => d.account.code), missingAutomatic };
}

/** Tax accounts per report key, for the report's account filter. */
async function taxAccountOptions() {
  const { taxAccounts } = discoverTaxAccounts(await C.loadAccounts());
  return taxAccounts.map(d => ({
    _id: String(d.account._id),
    code: d.account.code,
    name: d.account.name,
    nameAr: d.account.nameAr || null,
    category: d.category,
    reports: d.category === 'other' ? [] : [`tax-${d.category}-debit`, `tax-${d.category}-credit`],
  }));
}

// ---------------------------------------------------------------- balances
/** Opening / period / closing as debit and credit balances (never netted into one signed figure). */
function balanceRow(t) {
  const opening = round2((t?.openingDebit || 0) - (t?.openingCredit || 0));
  const periodDebit = t?.periodDebit || 0;
  const periodCredit = t?.periodCredit || 0;
  const closing = round2(opening + periodDebit - periodCredit);
  return {
    openingDebit: opening > 0 ? opening : 0,
    openingCredit: opening < 0 ? -opening : 0,
    periodDebit,
    periodCredit,
    closingDebit: closing > 0 ? closing : 0,
    closingCredit: closing < 0 ? -closing : 0,
    netDirection: closing > 0 ? 'Debit' : closing < 0 ? 'Credit' : '-',
    netDirectionAr: closing > 0 ? 'مدين' : closing < 0 ? 'دائن' : '-',
  };
}

const BALANCE_COLUMNS = [
  col('openingDebit', 'Opening Debit', 'رصيد أول المدة مدين', 'money'),
  col('openingCredit', 'Opening Credit', 'رصيد أول المدة دائن', 'money'),
  col('periodDebit', 'Debit Movements', 'الحركة المدينة', 'money'),
  col('periodCredit', 'Credit Movements', 'الحركة الدائنة', 'money'),
  col('closingDebit', 'Closing Debit', 'رصيد آخر المدة مدين', 'money'),
  col('closingCredit', 'Closing Credit', 'رصيد آخر المدة دائن', 'money'),
  col('netDirection', 'Balance Side', 'طبيعة الرصيد', 'status'),
];
const sumBalances = rows => Object.fromEntries(['openingDebit', 'openingCredit', 'periodDebit', 'periodCredit', 'closingDebit', 'closingCredit'].map(k => [k, C.sumBy(rows, k)]));

// ---------------------------------------------------------------- source records (batched)
const ENTRY_PROJECTION = { entryNumber: 1, date: 1, description: 1, status: 1, source: 1, accountingAction: 1, sourceType: 1, sourceId: 1, reversalOfEntry: 1, reversedByEntry: 1, triggeredBySalesOrder: 1, project: 1, lines: 1 };
const uniqueIds = list => [...new Map(list.filter(Boolean).map(v => [String(v), v])).values()];

/** The document behind an entry that carries a document's tax: { type, id } (id may be null). */
function documentRefOf(entry) {
  const type = SOURCE_OF_ACTION[entry.accountingAction];
  if (type === 'SO') return { type, id: entry.triggeredBySalesOrder || null };
  if (type) return { type, id: entry.sourceId || null };
  return { type: entry.accountingAction ? 'OTHER' : 'MANUAL', id: null };
}

async function loadSources(entries) {
  // Reversal entries take their document, party and amounts from the entry they reverse.
  const relatedIds = uniqueIds(entries.flatMap(e => [e.reversalOfEntry, e.reversedByEntry]));
  const related = relatedIds.length ? await JournalEntry.collection.find({ _id: { $in: relatedIds } }, { projection: ENTRY_PROJECTION }).toArray() : [];
  const entryById = new Map(related.map(e => [String(e._id), e]));
  const effective = entries.map(e => (e.reversalOfEntry && entryById.get(String(e.reversalOfEntry))) || e);

  const refs = effective.map(documentRefOf);
  const idsOf = type => uniqueIds(refs.filter(r => r.type === type).map(r => r.id));
  const find = (Model, type, projection) => (idsOf(type).length ? Model.collection.find({ _id: { $in: idsOf(type) } }, { projection }).toArray() : []);
  const [salesOrders, purchaseOrders, expenses, assets] = await Promise.all([
    find(SalesOrder, 'SO', { code: 1, customer: 1, project: 1, totalAmount: 1, vatPercentage: 1, vatAmount: 1, withholdingTaxPercentage: 1, withholdingTaxAmount: 1 }),
    find(PurchaseOrder, 'PO', { code: 1, vendorId: 1, project: 1, totalAmount: 1, vatPercentage: 1, vatAmount: 1, withholdingTaxPercentage: 1, withholdingTaxAmount: 1 }),
    find(Expense, 'EXPENSE', { reference: 1, vendor: 1, amount: 1, vatPercentage: 1, vatAmount: 1 }),
    find(FixedAsset, 'FIXED_ASSET', { name: 1, vendor: 1, price: 1, vatPercentage: 1, vatAmount: 1 }),
  ]);
  const documents = new Map();
  salesOrders.forEach(d => documents.set(`SO|${d._id}`, { number: d.code || null, invoiceNumber: null, party: { kind: 'customer', id: d.customer }, rates: { vat: d.vatPercentage, wht: d.withholdingTaxPercentage }, link: 'salesOrder', id: d._id }));
  purchaseOrders.forEach(d => documents.set(`PO|${d._id}`, { number: d.code || null, invoiceNumber: null, party: { kind: 'vendor', id: d.vendorId }, rates: { vat: d.vatPercentage, wht: d.withholdingTaxPercentage }, link: 'purchaseOrder', id: d._id }));
  expenses.forEach(d => documents.set(`EXPENSE|${d._id}`, { number: d.reference || null, invoiceNumber: d.reference || null, party: { kind: 'vendor', id: d.vendor }, rates: { vat: d.vatPercentage, wht: undefined }, link: null, id: d._id }));
  assets.forEach(d => documents.set(`FIXED_ASSET|${d._id}`, { number: d.name || null, invoiceNumber: null, party: { kind: 'vendor', id: d.vendor }, rates: { vat: d.vatPercentage, wht: undefined }, link: 'fixedAsset', id: d._id }));

  // Parties: the document's own customer / supplier, else the Sub Account on the entry lines.
  const lines = effective.flatMap(e => e.lines || []);
  const numbersOf = type => [...new Set(lines.filter(l => l.partyType === type && l.partyNumber != null).map(l => l.partyNumber))];
  const docParties = kind => uniqueIds([...documents.values()].filter(d => d.party.kind === kind).map(d => d.party.id));
  const partyQuery = (ids, field, numbers) => ({ $or: [{ _id: { $in: ids } }, { [field]: { $in: numbers } }] });
  const [customers, vendors, projects] = await Promise.all([
    User.collection.find(partyQuery(docParties('customer'), 'customerNumber', numbersOf('customer')), { projection: { name: 1, customerNumber: 1, taxInfo: 1 } }).toArray(),
    Vendor.collection.find(partyQuery(docParties('vendor'), 'vendorNumber', numbersOf('vendor')), { projection: { name: 1, vendorNumber: 1, taxInfo: 1 } }).toArray(),
    Project.collection.find({ _id: { $in: uniqueIds([...lines.map(l => l.project), ...effective.map(e => e.project), ...entries.flatMap(e => (e.lines || []).map(l => l.project))]) } }, { projection: { projectNumber: 1 } }).toArray(),
  ]);
  const party = (kind, record) => record && { kind, id: String(record._id), number: kind === 'customer' ? record.customerNumber : record.vendorNumber, name: record.name, taxRegistrationNumber: record.taxInfo?.taxRegistrationNumber?.trim() || null };
  const parties = new Map();
  customers.forEach(c => {
    parties.set(`customer|id|${c._id}`, party('customer', c));
    if (c.customerNumber != null) parties.set(`customer|no|${c.customerNumber}`, party('customer', c));
  });
  vendors.forEach(v => {
    parties.set(`vendor|id|${v._id}`, party('vendor', v));
    if (v.vendorNumber != null) parties.set(`vendor|no|${v.vendorNumber}`, party('vendor', v));
  });
  return { entryById, effective, refs, documents, parties, projectById: new Map(projects.map(p => [String(p._id), p.projectNumber])) };
}

// ---------------------------------------------------------------- 1-4. tax movements by direction
const TAX_DETAIL_COLUMNS = [
  col('accountCode', 'Tax Account No.', 'رقم حساب الضريبة'),
  col('accountName', 'Tax Account', 'حساب الضريبة', 'account'),
  col('role', 'Account Role', 'دور الحساب', 'status'),
  col('entryNumber', 'Entry No.', 'رقم القيد'),
  col('documentNumber', 'Document No.', 'رقم المستند'),
  col('date', 'Date', 'التاريخ', 'date'),
  col('partyType', 'Party Type', 'نوع الطرف', 'status'),
  col('party', 'Customer / Supplier', 'العميل / المورد', 'name'),
  col('taxRegistrationNumber', 'Tax Registration No.', 'رقم التسجيل الضريبي'),
  col('invoiceNumber', 'Invoice No.', 'رقم الفاتورة'),
  col('invoiceBase', 'Amount excl. VAT', 'المبلغ قبل الضريبة', 'money'),
  col('taxRate', 'Tax Rate (document)', 'نسبة الضريبة (المستند)', 'percent'),
  col('effectiveRate', 'Effective Rate (computed)', 'النسبة الفعلية (محسوبة)', 'percent'),
  col('taxAmount', 'Tax Amount', 'مبلغ الضريبة', 'money'),
  col('currency', 'Currency', 'العملة'),
  col('exchangeRate', 'Exchange Rate', 'سعر الصرف', 'number'),
  col('projectNumber', 'Project No.', 'رقم المشروع'),
  col('documentType', 'Source Document', 'نوع المستند', 'status'),
  col('movementType', 'Movement Type', 'نوع الحركة', 'status'),
  col('status', 'Entry Status', 'حالة القيد', 'status'),
  col('description', 'Description', 'البيان', 'longtext'),
  col('missing', 'Missing Information', 'بيانات غير متاحة', 'longtext'),
];

async function taxMovements(query, category, direction) {
  const period = C.resolvePeriod(query);
  const accounts = await C.loadAccounts();
  const { taxAccounts } = discoverTaxAccounts(accounts);
  const inCategory = taxAccounts.filter(d => d.category === category);
  const accountId = C.objectIdParam(query.account, 'tax account');
  if (accountId && !inCategory.some(d => String(d.account._id) === String(accountId))) throw new ApiError(`The selected account is not a ${CATEGORY_TITLES[category].en} account.`, 400);
  const movement = C.enumParam(query.movement, 'movement type', Object.keys(MOVEMENTS));
  const source = C.enumParam(query.source, 'source document type', Object.keys(SOURCES));
  const customerId = C.objectIdParam(query.customer, 'customer');
  const vendorId = C.objectIdParam(query.vendor, 'supplier');
  const projectId = C.objectIdParam(query.project, 'project');
  const reference = String(query.reference || '').trim().toLowerCase().slice(0, 100);
  const rowFiltered = !!(movement || source || customerId || vendorId || projectId || reference);

  const selected = accountId ? inCategory.filter(d => String(d.account._id) === String(accountId)) : inCategory;
  const selectedIds = selected.map(d => d.account._id);
  const byAccountId = new Map(selected.map(d => [String(d.account._id), d]));
  const taxIds = new Set(taxAccounts.map(d => String(d.account._id)));
  const cashIds = new Set([...accounts.values()].filter(isPaymentAccountEligible).map(a => String(a._id)));
  const opposite = direction === 'debit' ? 'credit' : 'debit';

  const [totals, rawEntries] = await Promise.all([
    selectedIds.length ? C.ledgerTotals({ start: period.start, end: period.end, lineMatch: { 'lines.account': { $in: selectedIds } } }) : [],
    selectedIds.length
      ? JournalEntry.collection
          .find(C.ledgerMatch({ start: period.start, end: period.end, extra: { lines: { $elemMatch: { account: { $in: selectedIds }, [direction]: { $gt: 0 } } } } }), { projection: ENTRY_PROJECTION })
          .sort({ date: 1, entryNumber: 1 })
          .limit(C.MAX_DETAIL_ROWS + 1)
          .toArray()
      : [],
  ]);
  const truncated = rawEntries.length > C.MAX_DETAIL_ROWS;
  const entries = rawEntries.slice(0, C.MAX_DETAIL_ROWS);
  const { entryById, effective, refs, documents, parties, projectById } = await loadSources(entries);

  const rows = [];
  let rateMismatches = 0;
  entries.forEach((entry, index) => {
    const base = effective[index];
    const ref = refs[index];
    const isReversal = !!entry.reversalOfEntry;
    const document = ref.id ? documents.get(`${ref.type}|${ref.id}`) || null : null;
    const otherLines = entry.lines.filter(l => !taxIds.has(idOf(l.account)));
    const movementType = isReversal
      ? 'reversal'
      : SOURCE_OF_ACTION[entry.accountingAction]
        ? 'invoice'
        : entry.lines.some(l => cashIds.has(idOf(l.account)))
          ? 'payment'
          : otherLines.length === 0
            ? 'offset'
            : 'adjustment';
    const carriesDocument = movementType === 'invoice' || (movementType === 'reversal' && SOURCE_OF_ACTION[base.accountingAction]);

    // The document's amount excluding tax, from the entry that carries the tax (for a reversal,
    // the entry it reverses): revenue credited on a sale, the asset / expense debited on a purchase.
    const baseSide = SALE_ACTIONS.includes(base.accountingAction) ? 'credit' : PURCHASE_ACTIONS.includes(base.accountingAction) ? 'debit' : null;
    const entryBase = carriesDocument && baseSide ? round2(base.lines.filter(l => !taxIds.has(idOf(l.account))).reduce((s, l) => s + (l[baseSide] || 0), 0)) : null;
    // The tax side of the original posting (a reversal moves the other way).
    const taxSide = isReversal ? opposite : direction;

    const accountLines = new Map();
    entry.lines.forEach(line => {
      const id = idOf(line.account);
      if (byAccountId.has(id) && (line[direction] || 0) > 0) accountLines.set(id, [...(accountLines.get(id) || []), line]);
    });

    let baseCounted = false;
    for (const [id, lines] of accountLines) {
      const tax = byAccountId.get(id);
      const accountTax = round2(lines.reduce((s, l) => s + l[direction], 0));
      const postedTax = round2(base.lines.filter(l => idOf(l.account) === id).reduce((s, l) => s + (l[taxSide] || 0), 0)) || accountTax;
      const documentRate = document && typeof document.rates[category] === 'number' ? document.rates[category] : null;
      const effectiveRate = entryBase ? round2((postedTax / entryBase) * 100) : null;
      const rateAgrees = documentRate === null || entryBase === null || Math.abs((entryBase * documentRate) / 100 - postedTax) <= Math.max(0.05, postedTax * 0.0005);
      if (!rateAgrees) rateMismatches += lines.length;

      for (const line of lines) {
        // Party: the document's customer / supplier, else this line's Sub Account, else the one
        // Sub Account on the entry (never a guess when the entry names several).
        const partyLines = base.lines.filter(l => l.partyNumber != null && ['customer', 'vendor'].includes(l.partyType));
        const distinct = [...new Map(partyLines.map(l => [`${l.partyType}|${l.partyNumber}`, l])).values()];
        const partyLine = line.partyNumber != null && ['customer', 'vendor'].includes(line.partyType) ? line : distinct.length === 1 ? distinct[0] : null;
        const party = (document?.party.id && parties.get(`${document.party.kind}|id|${document.party.id}`)) || (partyLine && parties.get(`${partyLine.partyType}|no|${partyLine.partyNumber}`)) || null;
        const partyNumberOnly = !party && partyLine ? `${partyLine.partyNumber}` : null;
        const projectRef = idOf(line.project) || idOf(base.project);
        const share = accountTax ? line[direction] / accountTax : 0;
        const lineBase = entryBase === null ? null : round2(entryBase * share);
        const reversedBy = entry.status === 'reversed' && entry.reversedByEntry ? entryById.get(String(entry.reversedByEntry)) : null;
        const reverses = isReversal ? base : null;

        const missing = [];
        if (carriesDocument) {
          if (!document) missing.push(L(ref.type === 'SO' ? 'source Sales Order (recognition not tied to one order)' : 'source document', ref.type === 'SO' ? 'أمر البيع المصدر (الإثبات غير مرتبط بأمر واحد)' : 'المستند المصدر'));
          if (!document?.invoiceNumber) missing.push(L('invoice no.', 'رقم الفاتورة'));
          if (lineBase === null) missing.push(L('amount excl. VAT', 'المبلغ قبل الضريبة'));
          if (documentRate === null) missing.push(L('document tax rate', 'نسبة الضريبة في المستند'));
          if (!rateAgrees) missing.push(L(`posted tax differs from amount × document rate (${round2((entryBase * documentRate) / 100)})`, `الضريبة المرحلة تختلف عن المبلغ × نسبة المستند (${round2((entryBase * documentRate) / 100)})`));
        }
        // A payment to / settlement with the Tax Authority has no customer or supplier.
        if (carriesDocument || partyLine) {
          if (!party) missing.push(L(partyNumberOnly ? 'customer / supplier record' : 'customer / supplier', partyNumberOnly ? 'سجل العميل / المورد' : 'العميل / المورد'));
          else if (!party.taxRegistrationNumber) missing.push(L('tax registration no.', 'رقم التسجيل الضريبي'));
        }

        const row = {
          accountCode: tax.account.code,
          accountName: tax.account.name,
          accountNameAr: tax.account.nameAr || null,
          role: tax.role.en,
          roleAr: tax.role.ar,
          entryNumber: entry.entryNumber,
          documentNumber: document?.number || null,
          date: entry.date,
          partyType: party ? (party.kind === 'customer' ? 'Customer' : 'Supplier') : partyLine ? (partyLine.partyType === 'customer' ? 'Customer' : 'Supplier') : null,
          partyTypeAr: party ? (party.kind === 'customer' ? 'عميل' : 'مورد') : partyLine ? (partyLine.partyType === 'customer' ? 'عميل' : 'مورد') : null,
          party: party ? `${party.number ?? ''}${party.number != null ? ' - ' : ''}${party.name}` : partyNumberOnly,
          taxRegistrationNumber: party?.taxRegistrationNumber || null,
          invoiceNumber: document?.invoiceNumber || null,
          invoiceBase: lineBase,
          taxRate: documentRate,
          effectiveRate,
          taxAmount: line[direction],
          // Automatic entries are posted in the local currency; manual lines keep their own.
          currency: line.currency || (entry.source === 'manual' || !entry.accountingAction ? null : 'EGP'),
          exchangeRate: line.exchangeRate ?? (entry.source === 'manual' || !entry.accountingAction ? null : 1),
          projectNumber: projectRef ? projectById.get(projectRef) || line.projectNumber || null : line.projectNumber || null,
          documentType: SOURCES[ref.type].en,
          documentTypeAr: SOURCES[ref.type].ar,
          movementType: MOVEMENTS[movementType].en,
          movementTypeAr: MOVEMENTS[movementType].ar,
          status: reverses ? `Reverses entry ${reverses.entryNumber}` : reversedBy ? `Reversed by entry ${reversedBy.entryNumber}` : entry.status === 'reversed' ? 'Reversed' : 'Posted',
          statusAr: reverses ? `عكس القيد ${reverses.entryNumber}` : reversedBy ? `معكوس بالقيد ${reversedBy.entryNumber}` : entry.status === 'reversed' ? 'معكوس' : 'مرحل',
          description: line.description || entry.description || null,
          missing: missing.length ? missing.map(m => m.en).join('; ') : null,
          missingAr: missing.length ? missing.map(m => m.ar).join('، ') : null,
          _movement: movementType,
          _source: ref.type,
          _partyKey: party ? `${party.kind}|${party.id}` : null,
          _projectId: projectRef,
          // The amount excluding tax of one document is counted once in the totals, even when the
          // entry has several tax lines in this report.
          _baseInTotal: movementType === 'invoice' && entryBase !== null && !baseCounted ? entryBase : 0,
          _links: {
            entryNumber: { kind: 'journalEntry', id: String(entry._id) },
            ...(document?.link ? { documentNumber: { kind: document.link, id: String(document.id) } } : {}),
            ...(party ? { party: { kind: party.kind, id: party.id } } : {}),
            ...(projectRef ? { projectNumber: { kind: 'project', id: projectRef } } : {}),
          },
        };
        if (row._baseInTotal) baseCounted = true;
        rows.push(row);
      }
    }
  });

  const filtered = rows
    .filter(r => !movement || r._movement === movement)
    .filter(r => !source || r._source === source)
    .filter(r => !customerId || r._partyKey === `customer|${customerId}`)
    .filter(r => !vendorId || r._partyKey === `vendor|${vendorId}`)
    .filter(r => !projectId || r._projectId === String(projectId))
    .filter(r => !reference || [r.documentNumber, r.invoiceNumber, r.taxRegistrationNumber, r.party, String(r.entryNumber)].some(v => v && String(v).toLowerCase().includes(reference)));
  filtered.sort((a, b) => String(a.accountCode).localeCompare(String(b.accountCode), undefined, { numeric: true }) || new Date(a.date) - new Date(b.date) || a.entryNumber - b.entryNumber);
  const detailRows = filtered.map(({ _movement, _source, _partyKey, _projectId, _baseInTotal, ...r }) => r);

  // Account level: every selected account, opening / movements / closing.
  const totalsBy = new Map(totals.map(t => [t.accountId, t]));
  const accountRows = selected.map(d => ({
    code: d.account.code,
    name: d.account.name,
    nameAr: d.account.nameAr || null,
    role: d.role.en,
    roleAr: d.role.ar,
    ...balanceRow(totalsBy.get(String(d.account._id))),
    _links: { code: { kind: 'account', id: String(d.account._id) } },
  }));
  const accountSums = sumBalances(accountRows);
  const ledgerSide = direction === 'debit' ? accountSums.periodDebit : accountSums.periodCredit;

  // By rate: tax on documents grouped by account and the document's rate.
  const byRate = new Map();
  filtered
    .filter(r => r._movement === 'invoice')
    .forEach(r => {
      const key = `${r.accountCode}|${r.taxRate ?? 'n/a'}`;
      const g = byRate.get(key) || { accountCode: r.accountCode, accountName: r.accountName, accountNameAr: r.accountNameAr, role: r.role, roleAr: r.roleAr, taxRate: r.taxRate, documents: 0, invoiceBase: 0, taxAmount: 0, _baseKnown: true };
      g.documents += r._baseInTotal || r.invoiceBase === null ? 1 : 0;
      if (r.invoiceBase === null) g._baseKnown = false;
      g.invoiceBase = round2(g.invoiceBase + (r._baseInTotal || 0));
      g.taxAmount = round2(g.taxAmount + r.taxAmount);
      byRate.set(key, g);
    });
  const rateRows = [...byRate.values()].map(({ _baseKnown, ...g }) => ({ ...g, invoiceBase: _baseKnown ? g.invoiceBase : null, effectiveRate: _baseKnown && g.invoiceBase ? round2((g.taxAmount / g.invoiceBase) * 100) : null }));

  const amountOf = type => C.sumBy(filtered.filter(r => r._movement === type), 'taxAmount');
  const totalTax = C.sumBy(filtered, 'taxAmount');
  const baseTotal = round2(filtered.reduce((s, r) => s + (r._baseInTotal || 0), 0));
  const missingRegistration = filtered.filter(r => r.party && !r.taxRegistrationNumber).length;
  const dirLabel = direction === 'debit' ? L('debit', 'المدينة') : L('credit', 'الدائنة');

  return {
    period,
    summary: [
      summaryItem('total', `Total ${dirLabel.en} movements`, `إجمالي الحركات ${dirLabel.ar}`, totalTax),
      summaryItem('invoice', 'Tax on documents', 'الضريبة على المستندات', amountOf('invoice')),
      summaryItem('reversal', 'Reversals', 'القيود العكسية', amountOf('reversal')),
      summaryItem('settlement', 'Payments and settlements', 'السداد والتسويات', round2(amountOf('payment') + amountOf('offset'))),
      summaryItem('adjustment', 'Manual entries / adjustments', 'قيود يدوية / تسويات', amountOf('adjustment')),
      summaryItem('base', 'Documents amount excl. VAT', 'قيمة المستندات قبل الضريبة', baseTotal),
    ],
    checks: [
      ...(rowFiltered
        ? []
        : [check(`Detail lines equal the accounts' ${dirLabel.en} movements in the ledger`, `تفاصيل الحركات تساوي الحركة ${dirLabel.ar} للحسابات في دفتر الأستاذ`, !truncated && totalTax === ledgerSide, `${totalTax} / ${ledgerSide}`)]),
      check('Posted tax agrees with amount × document rate', 'الضريبة المرحلة تتفق مع المبلغ × نسبة المستند', rateMismatches === 0, rateMismatches ? `${rateMismatches} line(s)` : null),
      check('Every line has a tax registration number', 'كل السطور لها رقم تسجيل ضريبي', missingRegistration === 0, missingRegistration ? `${missingRegistration} line(s)` : null),
      ...(truncated ? [check('All movements included', 'تم تضمين كل الحركات', false, `limited to ${C.MAX_DETAIL_ROWS} entries`)] : []),
    ],
    sections: [
      {
        key: 'movements',
        title: L(`${CATEGORY_TITLES[category].en} - ${direction === 'debit' ? 'Debit' : 'Credit'} Movements`, `${CATEGORY_TITLES[category].ar} - الحركات ${dirLabel.ar}`),
        paginate: true,
        columns: TAX_DETAIL_COLUMNS,
        rows: detailRows,
        totals: { accountCode: 'Total', accountCodeAr: 'الإجمالي', invoiceBase: baseTotal, taxAmount: totalTax },
      },
      {
        key: 'rates',
        title: L('Tax on Documents by Rate', 'الضريبة على المستندات حسب النسبة'),
        columns: [
          col('accountCode', 'Tax Account No.', 'رقم حساب الضريبة'),
          col('accountName', 'Tax Account', 'حساب الضريبة', 'account'),
          col('role', 'Account Role', 'دور الحساب', 'status'),
          col('taxRate', 'Tax Rate (document)', 'نسبة الضريبة (المستند)', 'percent'),
          col('documents', 'Documents', 'عدد المستندات', 'number'),
          col('invoiceBase', 'Amount excl. VAT', 'المبلغ قبل الضريبة', 'money'),
          col('taxAmount', 'Tax Amount', 'مبلغ الضريبة', 'money'),
          col('effectiveRate', 'Effective Rate (computed)', 'النسبة الفعلية (محسوبة)', 'percent'),
        ],
        rows: rateRows,
        totals: rateRows.length ? { accountCode: 'Total', accountCodeAr: 'الإجمالي', documents: rateRows.reduce((s, r) => s + r.documents, 0), invoiceBase: rateRows.every(r => r.invoiceBase !== null) ? C.sumBy(rateRows, 'invoiceBase') : null, taxAmount: C.sumBy(rateRows, 'taxAmount') } : null,
      },
      {
        key: 'accounts',
        title: L('Tax Account Balances (all movements)', 'أرصدة حسابات الضريبة (كل الحركات)'),
        columns: [col('code', 'Account No.', 'رقم الحساب'), col('name', 'Account', 'الحساب', 'account'), col('role', 'Account Role', 'دور الحساب', 'status'), ...BALANCE_COLUMNS],
        rows: accountRows,
        totals: { code: 'Total', codeAr: 'الإجمالي', ...accountSums },
      },
    ],
    notes: [
      ...(selected.length === 0
        ? [note(`No ${CATEGORY_TITLES[category].en} account was found in the Chart of Accounts - see the Tax Accounts Overview report.`, `لم يتم العثور على حساب ${CATEGORY_TITLES[category].ar} في دليل الحسابات - راجع تقرير ملخص حسابات الضرائب.`)]
        : []),
      note(
        `Every ${dirLabel.en} line posted to the ${CATEGORY_TITLES[category].en} accounts in the period (posted entries, including entries later reversed and their reversals; drafts excluded). The account role comes from the account's normal balance side; the movement type from the entry: "Tax on a document" = the automatic entry of a Sales Order, Purchase Order, Expense or Fixed Asset; "Reversal" = an entry reversing another (it takes that entry's document and party); "Payment / refund" = an entry with a bank or cash account; "Settlement between tax accounts" = only tax accounts; anything else is a manual entry or adjustment.`,
        `كل سطر ${dirLabel.ar === 'المدينة' ? 'مدين' : 'دائن'} مرحل على حسابات ${CATEGORY_TITLES[category].ar} خلال الفترة (القيود المرحلة، بما فيها القيود التي عُكست لاحقاً وقيودها العكسية؛ المسودات مستبعدة). دور الحساب من طبيعة رصيده؛ ونوع الحركة من القيد: "ضريبة على مستند" = القيد الآلي لأمر بيع أو أمر شراء أو مصروف أو أصل ثابت؛ "قيد عكسي" = قيد يعكس قيداً آخر (ويأخذ مستنده وطرفه)؛ "سداد / استرداد" = قيد به حساب بنك أو نقدية؛ "تسوية بين حسابات الضرائب" = حسابات ضرائب فقط؛ وغير ذلك قيد يدوي أو تسوية.`,
      ),
      note(
        'Amount excl. VAT = the document amount the tax was posted on, from the same entry (the revenue credited for a Sales Order, the asset / expense / work-in-progress debited for a purchase). Tax rate (document) = the VAT or withholding percentage stored on the Sales Order, Purchase Order, Expense or Fixed Asset. Effective rate = tax amount ÷ amount excl. VAT, computed - a check, not a source. The amount of a document is counted once in the totals; the by-rate table covers tax on documents only.',
        'المبلغ قبل الضريبة = قيمة المستند التي حُسبت عليها الضريبة، من نفس القيد (الإيراد الدائن لأمر البيع، والأصل / المصروف / الأعمال تحت التنفيذ المدين للمشتريات). نسبة الضريبة (المستند) = نسبة القيمة المضافة أو الخصم المسجلة على أمر البيع أو الشراء أو المصروف أو الأصل. النسبة الفعلية = مبلغ الضريبة ÷ المبلغ قبل الضريبة، محسوبة للمراجعة وليست مصدراً. تُحسب قيمة المستند مرة واحدة في الإجماليات؛ وجدول النسب يشمل الضريبة على المستندات فقط.',
      ),
      note(
        'Customer / supplier = the party on the source document, else the Sub Account (customer / vendor number) on the entry. Tax registration no. = the Tax Registration Number on that customer or supplier record. Sales Orders, Purchase Orders and Fixed Assets have no invoice number field, so their invoice no. is n/a and the document no. identifies them; an Expense\'s invoice no. is its reference. Manual entries have no source document: amount, rate and party are n/a unless the line names a customer or supplier.',
        'العميل / المورد = الطرف في المستند المصدر، وإلا الحساب الفرعي (رقم العميل / المورد) في القيد. رقم التسجيل الضريبي = رقم التسجيل الضريبي في سجل ذلك العميل أو المورد. لا يوجد حقل رقم فاتورة في أوامر البيع والشراء والأصول الثابتة، لذا رقم الفاتورة غير متاح ورقم المستند هو المرجع؛ ورقم فاتورة المصروف هو مرجعه. القيود اليدوية بلا مستند مصدر: المبلغ والنسبة والطرف غير متاحة ما لم يذكر السطر عميلاً أو مورداً.',
      ),
      ...(rowFiltered
        ? [note('Filters other than the period and the account apply to the detail lines only; the account balances table always shows the whole ledger.', 'الفلاتر بخلاف الفترة والحساب تطبق على تفاصيل الحركات فقط؛ جدول أرصدة الحسابات يعرض دفتر الأستاذ كاملاً.')]
        : []),
    ],
  };
}

// ---------------------------------------------------------------- 5. tax accounts overview
async function taxAccountsOverview(query) {
  const period = C.resolvePeriod(query);
  const accounts = await C.loadAccounts();
  const { taxAccounts, missingAutomatic } = discoverTaxAccounts(accounts);
  const totals = taxAccounts.length ? await C.ledgerTotals({ start: period.start, end: period.end, lineMatch: { 'lines.account': { $in: taxAccounts.map(d => d.account._id) } } }) : [];
  const totalsBy = new Map(totals.map(t => [t.accountId, t]));
  const rows = taxAccounts.map(d => ({
    code: d.account.code,
    name: d.account.name,
    nameAr: d.account.nameAr || null,
    category: CATEGORY_TITLES[d.category].en,
    categoryAr: CATEGORY_TITLES[d.category].ar,
    role: d.role.en,
    roleAr: d.role.ar,
    normalSide: d.side === 'debit' ? 'Debit' : 'Credit',
    normalSideAr: d.side === 'debit' ? 'مدين' : 'دائن',
    basis: d.basis.en,
    basisAr: d.basis.ar,
    review: d.review?.en || null,
    reviewAr: d.review?.ar || null,
    ...balanceRow(totalsBy.get(String(d.account._id))),
    _rowType: d.review ? 'muted' : undefined,
    _links: { code: { kind: 'account', id: String(d.account._id) } },
  }));
  const toReview = taxAccounts.filter(d => d.category === 'other');
  const flagged = taxAccounts.filter(d => d.review);
  const sumOf = cat => C.sumBy(rows.filter((r, i) => taxAccounts[i].category === cat), 'periodDebit');
  const sumCreditOf = cat => C.sumBy(rows.filter((r, i) => taxAccounts[i].category === cat), 'periodCredit');

  return {
    period,
    summary: [
      summaryItem('accounts', 'Tax accounts found', 'حسابات الضرائب المكتشفة', taxAccounts.length, 'number'),
      summaryItem('vatDebit', 'VAT debit movements', 'الحركة المدينة للقيمة المضافة', sumOf('vat')),
      summaryItem('vatCredit', 'VAT credit movements', 'الحركة الدائنة للقيمة المضافة', sumCreditOf('vat')),
      summaryItem('whtDebit', 'Withholding debit movements', 'الحركة المدينة للخصم والإضافة', sumOf('wht')),
      summaryItem('whtCredit', 'Withholding credit movements', 'الحركة الدائنة للخصم والإضافة', sumCreditOf('wht')),
      summaryItem('review', 'Accounts to review', 'حسابات تحتاج مراجعة', flagged.length, 'number'),
    ],
    checks: [
      check('Every tax account is covered by a tax report', 'كل حسابات الضرائب مغطاة بتقرير ضرائب', toReview.length === 0, toReview.length ? toReview.map(d => d.account.code).join(', ') : null),
      check('The automatic entries\' tax accounts exist in the Chart of Accounts', 'حسابات الضرائب للقيود الآلية موجودة في دليل الحسابات', missingAutomatic.length === 0, missingAutomatic.length ? missingAutomatic.map(a => a.code).join(', ') : null),
    ],
    sections: [
      {
        key: 'accounts',
        title: L('Tax Accounts in the Chart of Accounts', 'حسابات الضرائب في دليل الحسابات'),
        columns: [
          col('code', 'Account No.', 'رقم الحساب'),
          col('name', 'Account', 'الحساب', 'account'),
          col('category', 'Tax', 'الضريبة', 'status'),
          col('role', 'Account Role', 'دور الحساب', 'status'),
          col('normalSide', 'Normal Balance', 'طبيعة الحساب', 'status'),
          col('basis', 'Classified by', 'أساس التصنيف'),
          ...BALANCE_COLUMNS,
          col('review', 'Needs Review', 'يحتاج مراجعة', 'longtext'),
        ],
        rows,
        totals: { code: 'Total', codeAr: 'الإجمالي', ...sumBalances(rows) },
      },
    ],
    notes: [
      note(
        'Tax accounts are found in the Chart of Accounts: the accounts the automatic entries post VAT and withholding tax to, and every account whose name or parent group mentions a tax (VAT / value added / withholding / commercial and industrial profits / ضريبة / ضرائب / قيمة مضافة / خصم وإضافة). The name decides VAT or withholding; the account type decides its normal balance side. Accounts marked "Needs review" are not in the four tax reports until they are renamed or reclassified.',
        'تُكتشف حسابات الضرائب من دليل الحسابات: الحسابات التي ترحّل إليها القيود الآلية ضريبة القيمة المضافة وضريبة الخصم، وكل حساب يذكر اسمه أو اسم مجموعته الأم ضريبة (ضريبة / ضرائب / قيمة مضافة / خصم وإضافة / أرباح تجارية وصناعية / VAT / withholding). الاسم يحدد قيمة مضافة أم خصم وإضافة؛ ونوع الحساب يحدد طبيعة رصيده. الحسابات المعلّمة "يحتاج مراجعة" لا تظهر في تقارير الضرائب الأربعة حتى يعاد تسميتها أو تصنيفها.',
      ),
      ...missingAutomatic.map(a => note(`The automatic entries post ${a.use.en.toLowerCase()} to account ${a.code}, which is not in the Chart of Accounts.`, `القيود الآلية ترحّل ${a.use.ar} إلى الحساب ${a.code} وهو غير موجود في دليل الحسابات.`)),
    ],
  };
}

module.exports = {
  discoverTaxAccounts,
  taxAccountOptions,
  taxAccountsOverview,
  whtDebit: query => taxMovements(query, 'wht', 'debit'),
  whtCredit: query => taxMovements(query, 'wht', 'credit'),
  vatDebit: query => taxMovements(query, 'vat', 'debit'),
  vatCredit: query => taxMovements(query, 'vat', 'credit'),
};
