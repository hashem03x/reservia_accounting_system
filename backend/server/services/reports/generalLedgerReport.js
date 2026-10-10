const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');
const C = require('./reportCommon');

const { round2, col, check, note, summaryItem, L } = C;

// General Ledger - line items: every ledger line (posted entries, including entries later reversed
// and their reversals; drafts excluded - the same ledger as the Trial Balance) with its account
// number and name from the Chart of Accounts, sub-account, project, party, source document and a
// running balance per account in the account's normal-balance direction. Read-only.

const SORTS = {
  date: (a, b) => a._seq - b._seq,
  '-date': (a, b) => b._seq - a._seq,
  entryNumber: (a, b) => a.entryNumber - b.entryNumber || a._seq - b._seq,
  '-entryNumber': (a, b) => b.entryNumber - a.entryNumber || a._seq - b._seq,
  account: (a, b) => String(a.accountCode).localeCompare(String(b.accountCode), undefined, { numeric: true }) || a._seq - b._seq,
  amount: (a, b) => a.debit + a.credit - (b.debit + b.credit) || a._seq - b._seq,
  '-amount': (a, b) => b.debit + b.credit - (a.debit + a.credit) || a._seq - b._seq,
};

const SOURCE_LABELS = {
  'Sales Order': L('Sales Order', 'أمر بيع'),
  'Purchase Order': L('Purchase Order', 'أمر شراء'),
  Payment: L('Payment', 'دفعة'),
  'Advanced Payment': L('Advanced Payment', 'دفعة مقدمة'),
  Expense: L('Expense', 'مصروف'),
  'Fixed Asset': L('Fixed Asset', 'أصل ثابت'),
  Project: L('Project', 'مشروع'),
  Equity: L('Equity', 'حقوق ملكية'),
  Inventory: L('PUC Transfer', 'تحويل مشروعات تحت التنفيذ'),
  Manual: L('Manual entry', 'قيد يدوي'),
  Reversal: L('Reversal', 'قيد عكسي'),
};

const oid = id => new mongoose.Types.ObjectId(String(id));
const coll = name => mongoose.connection.collection(name);

/** Source document number of each entry, batched by kind (no per-entry queries). */
async function sourceDocuments(entries) {
  const ids = kind => [...new Set(entries.filter(e => e.sourceId && kind(e)).map(e => String(e.sourceId)))].map(oid);
  const isAction = (...actions) => e => actions.includes(e.accountingAction);
  const soIds = [...new Set(entries.map(e => (e.sourceType === 'SO' ? e.sourceId : e.triggeredBySalesOrder)).filter(Boolean).map(String))].map(oid);
  const [salesOrders, purchaseOrders, payments, expenses, advances, assets, depreciated, transfers] = await Promise.all([
    soIds.length ? coll('salesorders').find({ _id: { $in: soIds } }, { projection: { code: 1 } }).toArray() : [],
    coll('purchaseorders').find({ _id: { $in: ids(e => e.sourceType === 'PO') } }, { projection: { code: 1 } }).toArray(),
    coll('payments').find({ _id: { $in: ids(e => e.sourceType === 'PAYMENT') } }, { projection: { purchaseOrderId: 1, salesOrderId: 1 } }).toArray(),
    coll('expenses').find({ _id: { $in: ids(e => e.sourceType === 'EXPENSE') } }, { projection: { reference: 1 } }).toArray(),
    coll('advancedpayments').find({ _id: { $in: ids(e => e.sourceType === 'ADVANCED_PAYMENT') } }, { projection: { _id: 1 } }).toArray(),
    coll('fixedassets').find({ _id: { $in: ids(isAction('FIXED_ASSET_ACQUISITION')) } }, { projection: { name: 1, assetNumber: 1 } }).toArray(),
    coll('fixedassets').find({ 'depreciations.journalEntry': { $in: entries.filter(isAction('FIXED_ASSET_DEPRECIATION')).map(e => e._id) } }, { projection: { name: 1, assetNumber: 1, 'depreciations.journalEntry': 1 } }).toArray(),
    coll('puctransfers').find({ journalEntry: { $in: entries.filter(isAction('PUC_TRANSFER')).map(e => e._id) } }, { projection: { journalEntry: 1, quantity: 1 } }).toArray(),
  ]);
  const orderIds = [...new Set(payments.flatMap(p => [p.purchaseOrderId, p.salesOrderId]).filter(Boolean).map(String))].map(oid);
  const [paidPOs, paidSOs] = await Promise.all([
    orderIds.length ? coll('purchaseorders').find({ _id: { $in: orderIds } }, { projection: { code: 1 } }).toArray() : [],
    orderIds.length ? coll('salesorders').find({ _id: { $in: orderIds } }, { projection: { code: 1 } }).toArray() : [],
  ]);
  const code = new Map([...salesOrders, ...purchaseOrders, ...paidPOs, ...paidSOs].map(d => [String(d._id), d.code]));
  const assetLabel = a => `${a.assetNumber ? `FA-${String(a.assetNumber).padStart(4, '0')} ` : ''}${a.name}`;
  const byEntry = new Map();
  depreciated.forEach(a => a.depreciations.forEach(d => byEntry.set(String(d.journalEntry), assetLabel(a))));
  transfers.forEach(t => byEntry.set(String(t.journalEntry), `PUC transfer ${t._id}`));
  const paymentOf = new Map(payments.map(p => [String(p._id), p]));
  const expenseOf = new Map(expenses.map(x => [String(x._id), x.reference || String(x._id)]));
  const assetOf = new Map(assets.map(a => [String(a._id), assetLabel(a)]));
  const advanceOf = new Set(advances.map(a => String(a._id)));

  return entry => {
    const id = String(entry.sourceId);
    if (byEntry.has(String(entry._id))) return byEntry.get(String(entry._id));
    if (entry.sourceType === 'SO' || entry.triggeredBySalesOrder) return code.get(String(entry.sourceType === 'SO' ? entry.sourceId : entry.triggeredBySalesOrder)) || null;
    if (entry.sourceType === 'PO') return code.get(id) || null;
    if (entry.sourceType === 'PAYMENT') {
      const p = paymentOf.get(id);
      const order = p && code.get(String(p.purchaseOrderId || p.salesOrderId));
      return order ? `Payment - ${order}` : `Payment ${id.slice(-6)}`;
    }
    if (entry.sourceType === 'EXPENSE') return expenseOf.get(id) || null;
    if (entry.sourceType === 'ADVANCED_PAYMENT') return advanceOf.has(id) ? `Advance ${id.slice(-6)}` : null;
    if (entry.accountingAction === 'FIXED_ASSET_ACQUISITION') return assetOf.get(id) || null;
    return entry.reference || null;
  };
}

/** Customer / vendor / shareholder names by number. */
async function partyNames(lines) {
  const numbers = type => [...new Set(lines.filter(l => l.partyType === type && l.partyNumber != null).map(l => l.partyNumber))];
  const [customers, vendors, shareholders] = await Promise.all([
    numbers('customer').length ? coll('users').find({ customerNumber: { $in: numbers('customer') } }, { projection: { name: 1, customerNumber: 1 } }).toArray() : [],
    numbers('vendor').length ? coll('vendors').find({ vendorNumber: { $in: numbers('vendor') } }, { projection: { name: 1, vendorNumber: 1 } }).toArray() : [],
    numbers('shareholder').length ? coll('shareholders').find({ shareholderNumber: { $in: numbers('shareholder') } }, { projection: { name: 1, shareholderNumber: 1 } }).toArray() : [],
  ]);
  const map = new Map();
  customers.forEach(c => map.set(`customer|${c.customerNumber}`, { name: c.name, id: String(c._id), kind: 'customer' }));
  vendors.forEach(v => map.set(`vendor|${v.vendorNumber}`, { name: v.name, id: String(v._id), kind: 'vendor' }));
  shareholders.forEach(s => map.set(`shareholder|${s.shareholderNumber}`, { name: s.name, id: String(s._id), kind: 'shareholder' }));
  return map;
}

async function generalLedgerLines(query) {
  const period = C.resolvePeriod(query);
  const accounts = await C.loadAccounts();
  const accountId = C.objectIdParam(query.account, 'account');
  if (accountId && !accounts.has(String(accountId))) throw new ApiError('The selected account does not exist.', 400);
  const projectId = C.objectIdParam(query.project, 'project');
  const customerId = C.objectIdParam(query.customer, 'customer');
  const vendorId = C.objectIdParam(query.vendor, 'supplier');
  const entryNumber = C.numberParam(query.entryNumber, 'entry number', { min: 1, integer: true });
  const sort = C.enumParam(query.sort, 'sort', Object.keys(SORTS)) || 'date';
  const search = String(query.search || '').trim().toLowerCase().slice(0, 100);

  // The party filters are line Sub Accounts (customer / vendor numbers).
  const [customer, vendor] = await Promise.all([
    customerId ? coll('users').findOne({ _id: customerId }, { projection: { customerNumber: 1, name: 1 } }) : null,
    vendorId ? coll('vendors').findOne({ _id: vendorId }, { projection: { vendorNumber: 1, name: 1 } }) : null,
  ]);
  if (customerId && customer?.customerNumber == null) throw new ApiError('The selected customer has no Customer Number, so no ledger line can carry it.', 400);
  if (vendorId && vendor?.vendorNumber == null) throw new ApiError('The selected supplier has no Vendor Number, so no ledger line can carry it.', 400);

  const lineMatch = {
    ...(accountId ? { 'lines.account': accountId } : {}),
    ...(projectId ? { 'lines.project': projectId } : {}),
    ...(customer ? { 'lines.partyType': 'customer', 'lines.partyNumber': customer.customerNumber } : {}),
    ...(vendor ? { 'lines.partyType': 'vendor', 'lines.partyNumber': vendor.vendorNumber } : {}),
  };
  const entryMatch = entryNumber ? { entryNumber } : {};
  const lineFits = line =>
    (!accountId || String(line.account) === String(accountId)) &&
    (!projectId || String(line.project) === String(projectId)) &&
    (!customer || (line.partyType === 'customer' && line.partyNumber === customer.customerNumber)) &&
    (!vendor || (line.partyType === 'vendor' && line.partyNumber === vendor.vendorNumber));

  // Opening / period totals per account for the same scope - the running balances start from these.
  const [totals, { entries, truncated }, scopeTotals] = await Promise.all([
    C.ledgerTotals({ start: period.start, end: period.end, lineMatch, entryMatch }),
    C.ledgerEntries({ start: period.start, end: period.end, entryMatch: { ...entryMatch, ...(Object.keys(lineMatch).length ? { lines: { $elemMatch: Object.fromEntries(Object.entries(lineMatch).map(([k, v]) => [k.replace('lines.', ''), v])) } } : {}) } }),
    // The Trial Balance's movements for the same accounts and period (no line filters).
    accountId ? C.ledgerTotals({ start: period.start, end: period.end, lineMatch: { 'lines.account': accountId } }) : C.ledgerTotals({ start: period.start, end: period.end }),
  ]);
  const natural = (account, debit, credit) => round2(C.DEBIT_NATURE_TYPES.has(account?.type) ? debit - credit : credit - debit);
  const totalsBy = new Map(totals.map(t => [t.accountId, t]));

  const flat = [];
  entries.forEach(entry => entry.lines.forEach((line, lineIndex) => lineFits(line) && flat.push({ entry, line, lineIndex })));
  const [sourceOf, parties] = await Promise.all([sourceDocuments(entries), partyNames(flat.map(f => f.line))]);
  const projectIds = [...new Set(flat.map(f => C.idOf(f.line.project)).filter(Boolean))].map(oid);
  const projects = projectIds.length ? await coll('projects').find({ _id: { $in: projectIds } }, { projection: { projectNumber: 1 } }).toArray() : [];
  const projectNumberOf = new Map(projects.map(p => [String(p._id), p.projectNumber]));

  // Running balance per account, in date order, from its opening balance (normal-balance sign).
  const running = new Map();
  let seq = 0;
  const rows = flat.map(({ entry, line }) => {
    const id = C.idOf(line.account);
    const account = accounts.get(id);
    if (!running.has(id)) {
      const t = totalsBy.get(id);
      running.set(id, t ? natural(account, t.openingDebit, t.openingCredit) : 0);
    }
    const balance = round2(running.get(id) + natural(account, line.debit || 0, line.credit || 0));
    running.set(id, balance);
    const sub = line.subAccount ? accounts.get(C.idOf(line.subAccount)) : null;
    const party = line.partyNumber != null ? parties.get(`${line.partyType}|${line.partyNumber}`) : null;
    const module = entry.reversalOfEntry ? 'Reversal' : entry.module || (entry.accountingAction ? null : 'Manual');
    const sourceType = SOURCE_LABELS[module] || (module ? L(module, module) : null);
    const projectRef = C.idOf(line.project);
    seq += 1;
    return {
      _seq: seq,
      date: entry.date,
      entryNumber: entry.entryNumber,
      accountCode: account?.code || '?',
      accountName: account?.name || 'Unknown account',
      accountNameAr: account?.nameAr || null,
      subAccountNumber: sub ? sub.code : line.partyNumber != null ? String(line.partyNumber) : null,
      subAccountName: sub ? sub.name : party?.name || null,
      projectNumber: projectRef ? projectNumberOf.get(projectRef) || line.projectNumber || null : line.projectNumber || null,
      party: line.partyNumber != null ? `${line.partyType === 'customer' ? 'Customer' : line.partyType === 'vendor' ? 'Vendor' : 'Shareholder'} ${line.partyNumber}${party ? ` - ${party.name}` : ''}` : null,
      sourceType: sourceType?.en || null,
      sourceTypeAr: sourceType?.ar || null,
      sourceNumber: sourceOf(entry),
      description: line.description || entry.description || null,
      currency: line.currency || 'EGP',
      exchangeRate: line.exchangeRate ?? (line.currency ? null : 1),
      debit: line.debit || 0,
      credit: line.credit || 0,
      balance,
      status: entry.reversalOfEntry ? 'Reversal' : entry.status === 'reversed' ? 'Reversed' : 'Posted',
      statusAr: entry.reversalOfEntry ? 'قيد عكسي' : entry.status === 'reversed' ? 'معكوس' : 'مرحل',
      _links: {
        entryNumber: { kind: 'journalEntry', id: String(entry._id) },
        ...(projectRef ? { projectNumber: { kind: 'project', id: projectRef } } : {}),
        ...(party ? { party: { kind: party.kind, id: party.id } } : {}),
      },
    };
  });

  const searched = search
    ? rows.filter(r => [r.accountCode, r.accountName, r.accountNameAr, r.description, r.party, r.subAccountNumber, r.subAccountName, r.sourceNumber, r.projectNumber, String(r.entryNumber)].some(v => v && String(v).toLowerCase().includes(search)))
    : rows;
  searched.sort(SORTS[sort]);
  const detail = searched.map(({ _seq, ...r }) => r);

  const accountRows = C.sortAccountsByCode(
    totals.map(t => {
      const account = accounts.get(t.accountId);
      const opening = natural(account, t.openingDebit, t.openingCredit);
      return {
        code: account?.code || '?',
        name: account?.name || 'Unknown account',
        nameAr: account?.nameAr || null,
        normalSide: C.DEBIT_NATURE_TYPES.has(account?.type) ? 'Debit' : 'Credit',
        normalSideAr: C.DEBIT_NATURE_TYPES.has(account?.type) ? 'مدين' : 'دائن',
        opening,
        debit: t.periodDebit,
        credit: t.periodCredit,
        closing: round2(opening + natural(account, t.periodDebit, t.periodCredit)),
      };
    }),
    r => r.code
  );

  const rowFiltered = !!(projectId || customer || vendor || entryNumber || search);
  const sums = { debit: C.sumBy(detail, 'debit'), credit: C.sumBy(detail, 'credit') };
  const tbDebit = round2(scopeTotals.reduce((s, t) => s + t.periodDebit, 0));
  const tbCredit = round2(scopeTotals.reduce((s, t) => s + t.periodCredit, 0));
  const scopeLabel = accountId ? `${accounts.get(String(accountId)).code} - ${accounts.get(String(accountId)).name}` : null;

  return {
    period,
    summary: [
      summaryItem('lines', 'Ledger lines', 'سطور الأستاذ', detail.length, 'number'),
      summaryItem('debit', 'Total debit', 'إجمالي المدين', sums.debit),
      summaryItem('credit', 'Total credit', 'إجمالي الدائن', sums.credit),
      ...(accountId
        ? [
            summaryItem('opening', 'Opening balance', 'الرصيد الافتتاحي', accountRows[0]?.opening ?? 0),
            summaryItem('closing', 'Closing balance', 'الرصيد الختامي', accountRows[0]?.closing ?? 0),
          ]
        : []),
    ],
    checks: [
      ...(rowFiltered
        ? []
        : [check(`Debits and credits equal the Trial Balance movements${scopeLabel ? ` of ${scopeLabel}` : ''}`, 'المدين والدائن يساويان حركة ميزان المراجعة', !truncated && sums.debit === tbDebit && sums.credit === tbCredit, `${sums.debit} / ${tbDebit} · ${sums.credit} / ${tbCredit}`)]),
      ...(accountId || rowFiltered ? [] : [check('Total debits equal total credits', 'إجمالي المدين يساوي إجمالي الدائن', sums.debit === sums.credit, `${sums.debit} / ${sums.credit}`)]),
      ...(truncated ? [check('All ledger lines included', 'تم تضمين كل سطور الأستاذ', false, `limited to ${C.MAX_DETAIL_ROWS} entries`)] : []),
    ],
    sections: [
      {
        key: 'lines',
        title: L('General Ledger Lines', 'سطور دفتر الأستاذ العام'),
        paginate: true,
        columns: [
          col('date', 'Date', 'التاريخ', 'date'),
          col('entryNumber', 'Entry No.', 'رقم القيد'),
          col('accountCode', 'Account No.', 'رقم الحساب'),
          col('accountName', 'Account Name', 'اسم الحساب', 'account'),
          col('subAccountNumber', 'Sub-Account No.', 'رقم الحساب الفرعي'),
          col('subAccountName', 'Sub-Account Name', 'اسم الحساب الفرعي'),
          col('projectNumber', 'Project No.', 'رقم المشروع'),
          col('party', 'Customer / Vendor', 'العميل / المورد'),
          col('sourceType', 'Source Document', 'نوع المستند', 'status'),
          col('sourceNumber', 'Document No.', 'رقم المستند'),
          col('description', 'Description', 'البيان'),
          col('currency', 'Currency', 'العملة'),
          col('exchangeRate', 'Rate', 'سعر الصرف', 'number'),
          col('debit', 'Debit', 'مدين', 'money'),
          col('credit', 'Credit', 'دائن', 'money'),
          col('balance', 'Running Balance', 'الرصيد الجاري', 'money'),
          col('status', 'Entry Status', 'حالة القيد', 'status'),
        ],
        rows: detail,
        totals: { date: null, accountCode: 'Total', accountCodeAr: 'الإجمالي', ...sums },
      },
      {
        key: 'accounts',
        title: L('Account Balances', 'أرصدة الحسابات'),
        columns: [
          col('code', 'Account No.', 'رقم الحساب'),
          col('name', 'Account Name', 'اسم الحساب', 'account'),
          col('normalSide', 'Normal Balance', 'طبيعة الحساب', 'status'),
          col('opening', 'Opening Balance', 'الرصيد الافتتاحي', 'money'),
          col('debit', 'Debit Movements', 'الحركة المدينة', 'money'),
          col('credit', 'Credit Movements', 'الحركة الدائنة', 'money'),
          col('closing', 'Closing Balance', 'الرصيد الختامي', 'money'),
        ],
        rows: accountRows,
        totals: { code: 'Total', codeAr: 'الإجمالي', debit: C.sumBy(accountRows, 'debit'), credit: C.sumBy(accountRows, 'credit') },
      },
    ],
    notes: [
      note(
        'Every ledger line in the period: posted entries, including entries later reversed and their reversals (together they net to zero); drafts are not in the ledger. Account numbers and names are the Chart of Accounts codes. Balances are shown in each account\'s normal direction (debit for assets and expenses, credit for liabilities, equity and revenue): the running balance starts from the opening balance of the same filters and follows the lines in date order, whatever the sort. Sub-account = the line\'s Chart of Accounts sub-account, else its customer / vendor / shareholder number. Amounts are in the local currency; the currency and rate are those recorded on the line.',
        'كل سطر في دفتر الأستاذ خلال الفترة: القيود المرحلة بما فيها القيود التي عُكست لاحقاً وقيودها العكسية (يلغي أحدهما الآخر)؛ المسودات ليست في الأستاذ. أرقام وأسماء الحسابات هي أكواد دليل الحسابات. الأرصدة بطبيعة كل حساب (مدين للأصول والمصروفات، دائن للالتزامات وحقوق الملكية والإيرادات): الرصيد الجاري يبدأ من الرصيد الافتتاحي لنفس الفلاتر ويتبع السطور بترتيب التاريخ أياً كان الفرز. الحساب الفرعي = الحساب الفرعي من دليل الحسابات، وإلا رقم العميل / المورد / المساهم. المبالغ بالعملة المحلية؛ والعملة والسعر كما سُجلا على السطر.'
      ),
    ],
  };
}

module.exports = { generalLedgerLines, sourceDocuments, partyNames, SOURCE_LABELS };
