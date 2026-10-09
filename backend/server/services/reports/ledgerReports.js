const mongoose = require('mongoose');
const User = require('../../models/userModel');
const Vendor = require('../../models/vendor/vendor');
const Project = require('../../models/project/projectModel');
const FixedAsset = require('../../models/fixedAssets');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const DisclosureNote = require('../../models/reports/disclosureNoteModel');
const ApiError = require('../../utils/apiError');
const { isPaymentAccountEligible } = require('../../utils/accountingConstants');
const C = require('./reportCommon');
const { financialPosition } = require('./financialStatements');
const { customerBalances, supplierBalances } = require('./partyReports');

const { round2, col, check, note, summaryItem, L } = C;
const toIds = list => [...new Set(list.filter(Boolean).map(String))].map(id => new mongoose.Types.ObjectId(id));

/** Names behind Sub Accounts: Customer / Vendor / Shareholder Numbers. */
async function partyLookup(pairs) {
  const numbersOf = type => [...new Set(pairs.filter(p => p.type === type && p.number != null).map(p => p.number))];
  const Shareholder = mongoose.models.Shareholder;
  const [customers, vendors, shareholders] = await Promise.all([
    numbersOf('customer').length ? User.collection.find({ customerNumber: { $in: numbersOf('customer') } }, { projection: { name: 1, customerNumber: 1 } }).toArray() : [],
    numbersOf('vendor').length ? Vendor.collection.find({ vendorNumber: { $in: numbersOf('vendor') } }, { projection: { name: 1, vendorNumber: 1 } }).toArray() : [],
    numbersOf('shareholder').length && Shareholder ? Shareholder.collection.find({ shareholderNumber: { $in: numbersOf('shareholder') } }, { projection: { name: 1, shareholderNumber: 1 } }).toArray() : [],
  ]);
  const map = new Map();
  customers.forEach(c => map.set(`customer|${c.customerNumber}`, { name: c.name, kind: 'customer', id: String(c._id) }));
  vendors.forEach(v => map.set(`vendor|${v.vendorNumber}`, { name: v.name, kind: 'vendor', id: String(v._id) }));
  shareholders.forEach(s => map.set(`shareholder|${s.shareholderNumber}`, { name: s.name, kind: 'shareholder', id: String(s._id) }));
  return map;
}

// ---------------------------------------------------------------- 22. Banks and cash equivalents
async function bankCash(query) {
  const period = C.resolvePeriod(query);
  const accounts = await C.loadAccounts();
  const cashAccounts = C.sortAccountsByCode([...accounts.values()].filter(isPaymentAccountEligible), a => a.code);
  const accountId = C.objectIdParam(query.account, 'account');
  if (accountId && !cashAccounts.some(a => String(a._id) === String(accountId))) throw new ApiError('The selected account is not a Cash / Cash Equivalent account.', 400);
  const selected = accountId ? cashAccounts.filter(a => String(a._id) === String(accountId)) : cashAccounts;
  const selectedIds = selected.map(a => a._id);
  const cashIds = new Set(cashAccounts.map(a => String(a._id)));

  const [totals, { entries, truncated }] = await Promise.all([
    C.ledgerTotals({ start: period.start, end: period.end, lineMatch: { 'lines.account': { $in: selectedIds } } }),
    C.ledgerEntries({ start: period.start, end: period.end, entryMatch: { 'lines.account': { $in: selectedIds } } }),
  ]);
  const totalsBy = new Map(totals.map(t => [t.accountId, t]));

  const summaryRows = selected.map(a => {
    const t = totalsBy.get(String(a._id)) || { openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0 };
    const opening = round2(t.openingDebit - t.openingCredit);
    return { code: a.code, name: a.name, nameAr: a.nameAr || null, opening, debit: t.periodDebit, credit: t.periodCredit, closing: round2(opening + t.periodDebit - t.periodCredit), _links: { code: { kind: 'account', id: String(a._id) } } };
  });

  // Movement lines, per account in date order, with a running balance from the opening balance.
  const running = new Map(summaryRows.map((r, i) => [String(selected[i]._id), r.opening]));
  const pairs = [];
  const raw = [];
  for (const entry of entries) {
    const transfer = entry.lines.every(l => cashIds.has(C.idOf(l.account)));
    entry.lines.forEach(line => {
      const id = C.idOf(line.account);
      if (selectedIds.some(s => String(s) === id)) {
        // The counterparty: this line's own Sub Account, else the entry's.
        const partyLine = line.partyNumber != null ? line : entry.lines.find(l => l.partyNumber != null);
        if (partyLine) pairs.push({ type: partyLine.partyType, number: partyLine.partyNumber });
        raw.push({ entry, line, id, transfer, partyLine });
      }
    });
  }
  const [parties, projects] = await Promise.all([
    partyLookup(pairs),
    Project.collection.find({ _id: { $in: toIds(raw.map(r => C.idOf(r.line.project))) } }, { projection: { projectNumber: 1 } }).toArray(),
  ]);
  const projectById = new Map(projects.map(p => [String(p._id), p]));
  raw.sort((a, b) => String(accounts.get(a.id)?.code).localeCompare(String(accounts.get(b.id)?.code), undefined, { numeric: true }));

  const movementRows = raw.map(({ entry, line, id, transfer, partyLine }) => {
    const balance = round2(running.get(id) + (line.debit || 0) - (line.credit || 0));
    running.set(id, balance);
    const party = partyLine ? parties.get(`${partyLine.partyType}|${partyLine.partyNumber}`) : null;
    const projectId = C.idOf(line.project);
    return {
      account: `${accounts.get(id)?.code} - ${accounts.get(id)?.name}`,
      date: entry.date,
      entryNumber: entry.entryNumber,
      description: line.description || entry.description || null,
      counterparty: party ? `${partyLine.partyNumber} - ${party.name}` : partyLine ? String(partyLine.partyNumber) : null,
      projectNumber: projectId ? projectById.get(projectId)?.projectNumber || line.projectNumber || null : null,
      type: transfer ? 'Internal transfer' : null,
      typeAr: transfer ? 'تحويل داخلي' : null,
      debit: line.debit || 0,
      credit: line.credit || 0,
      balance,
      _links: { entryNumber: { kind: 'journalEntry', id: String(entry._id) }, ...(party ? { counterparty: { kind: party.kind, id: party.id } } : {}), ...(projectId ? { projectNumber: { kind: 'project', id: projectId } } : {}) },
    };
  });

  const sums = { opening: C.sumBy(summaryRows, 'opening'), debit: C.sumBy(summaryRows, 'debit'), credit: C.sumBy(summaryRows, 'credit'), closing: C.sumBy(summaryRows, 'closing') };
  const lastBalances = summaryRows.every((r, i) => round2(running.get(String(selected[i]._id))) === r.closing);
  return {
    period,
    summary: [summaryItem('opening', 'Opening balance', 'رصيد أول المدة', sums.opening), summaryItem('debit', 'Receipts (debit)', 'المقبوضات (مدين)', sums.debit), summaryItem('credit', 'Payments (credit)', 'المدفوعات (دائن)', sums.credit), summaryItem('closing', 'Closing balance', 'رصيد آخر المدة', sums.closing)],
    checks: [
      check('Each account\'s running balance ends at its closing balance', 'الرصيد الجاري لكل حساب ينتهي برصيده آخر المدة', !truncated && lastBalances),
      ...(truncated ? [check('All movements included', 'تم تضمين كل الحركات', false, `limited to ${C.MAX_DETAIL_ROWS} entries`)] : []),
    ],
    sections: [
      {
        key: 'accounts',
        title: L('Bank and Cash Accounts', 'البنوك وما في حكمها'),
        columns: [col('code', 'Account No.', 'رقم الحساب'), col('name', 'Account', 'الحساب', 'account'), col('opening', 'Opening Balance', 'رصيد أول المدة', 'money'), col('debit', 'Debit', 'مدين', 'money'), col('credit', 'Credit', 'دائن', 'money'), col('closing', 'Closing Balance', 'رصيد آخر المدة', 'money')],
        rows: summaryRows,
        totals: { name: 'Total', nameAr: 'الإجمالي', ...sums },
      },
      {
        key: 'movements',
        title: L('Account Movements', 'حركة الحسابات'),
        paginate: true,
        columns: [
          col('account', 'Account', 'الحساب'),
          col('date', 'Date', 'التاريخ', 'date'),
          col('entryNumber', 'Entry No.', 'رقم القيد'),
          col('description', 'Description', 'البيان'),
          col('counterparty', 'Counterparty', 'الطرف المقابل'),
          col('projectNumber', 'Project No.', 'رقم المشروع'),
          col('type', 'Type', 'النوع', 'status'),
          col('debit', 'Debit', 'مدين', 'money'),
          col('credit', 'Credit', 'دائن', 'money'),
          col('balance', 'Running Balance', 'الرصيد الجاري', 'money'),
        ],
        rows: movementRows,
        totals: { account: 'Total', accountAr: 'الإجمالي', debit: C.sumBy(movementRows, 'debit'), credit: C.sumBy(movementRows, 'credit') },
      },
    ],
    notes: [
      note(
        'Cash / Cash Equivalent accounts are the Chart of Accounts accounts in the "Cash & Cash Equivalents" group (or classified cash / cash-equivalent) - the same accounts offered as payment methods. Debit = money in, credit = money out. Each account shows both sides of transfers between cash/bank accounts, marked "Internal transfer"; across all accounts they net to zero and are not cash inflows or outflows.',
        'حسابات النقدية وما في حكمها هي حسابات مجموعة "النقدية وما في حكمها" في دليل الحسابات (أو المصنفة نقدية) - نفس الحسابات المتاحة كطرق دفع. المدين = مقبوضات، الدائن = مدفوعات. يظهر كل حساب طرفي التحويلات بين حسابات النقدية والبنوك بعلامة "تحويل داخلي"؛ وعلى مستوى كل الحسابات يصبح أثرها صفراً ولا تُعد تدفقات داخلة أو خارجة.'
      ),
    ],
  };
}

// ---------------------------------------------------------------- fixed assets
const CLASS_LABEL = { tangible: L('Tangible', 'ملموس'), intangible: L('Intangible', 'غير ملموس') };
const accText = a => (a && a.code ? `${a.code} - ${a.name}` : null);

/**
 * Accumulated depreciation of each asset as of `end`, from its depreciation journal entries
 * (status posted/reversed, dated on or before `end`) less those whose reversal is dated on or
 * before `end`. Never reads the asset's running total, so a reversed entry is handled correctly.
 */
async function depreciationLedger(assets, end) {
  const depIds = assets.flatMap(a => (a.depreciations || []).map(d => C.idOf(d.journalEntry)));
  if (!depIds.length) return { entries: new Map(), reversals: new Map() };
  const ids = toIds(depIds);
  const [entries, reversals] = await Promise.all([
    JournalEntry.collection.find({ _id: { $in: ids }, status: { $in: C.LEDGER_STATUSES } }, { projection: { date: 1, entryNumber: 1, status: 1 } }).toArray(),
    JournalEntry.collection.find({ reversalOfEntry: { $in: ids }, status: { $in: C.LEDGER_STATUSES }, ...(end ? { date: { $lte: end } } : {}) }, { projection: { date: 1, entryNumber: 1, reversalOfEntry: 1 } }).toArray(),
  ]);
  return { entries: new Map(entries.map(e => [String(e._id), e])), reversals: new Map(reversals.map(r => [String(r.reversalOfEntry), r])) };
}

function accumulatedAsOf(asset, ledger, end) {
  let total = 0;
  for (const d of asset.depreciations || []) {
    const entry = ledger.entries.get(C.idOf(d.journalEntry));
    if (entry && entry.date <= end) {
      const reversal = ledger.reversals.get(C.idOf(d.journalEntry));
      if (!(reversal && reversal.date <= end)) total += d.amount;
    }
  }
  return round2(total);
}

async function loadAssets(query) {
  const filter = {};
  const status = C.enumParam(query.assetStatus, 'asset status', ['active', 'fully_depreciated', 'disposed', 'under_maintenance']);
  if (status) filter.status = status;
  const assetClass = C.enumParam(query.assetClass, 'asset class', ['tangible', 'intangible']);
  if (assetClass) filter.assetClass = assetClass;
  const vendor = C.objectIdParam(query.vendor, 'vendor');
  if (vendor) filter.vendor = vendor;
  return FixedAsset.find(filter).sort({ acquisitionDate: 1, name: 1 }).lean();
}

// ---------------------------------------------------------------- 23. Fixed assets register
async function fixedAssetRegister(query) {
  const { asOf, end } = C.resolveAsOf(query);
  const all = await loadAssets(query);
  // An asset counts from its Asset Date; legacy assets (created before the module, no date) are listed and flagged.
  const assets = all.filter(a => !a.acquisitionDate || new Date(a.acquisitionDate) <= end);
  const ledger = await depreciationLedger(assets, end);
  const acquisitions = await JournalEntry.collection
    .find({ _id: { $in: toIds(assets.map(a => C.idOf(a.acquisitionJournalEntry))) } }, { projection: { entryNumber: 1, status: 1 } })
    .toArray();
  const acquisitionById = new Map(acquisitions.map(e => [String(e._id), e]));

  const rows = assets.map(a => {
    const legacy = !a.assetAccountId || typeof a.price !== 'number';
    const accumulated = legacy ? null : accumulatedAsOf(a, ledger, end);
    const acquisition = acquisitionById.get(C.idOf(a.acquisitionJournalEntry));
    return {
      name: a.name,
      assetClass: CLASS_LABEL[a.assetClass]?.en || (legacy ? 'Legacy asset' : null),
      assetClassAr: CLASS_LABEL[a.assetClass]?.ar || (legacy ? 'أصل قديم' : null),
      acquisitionDate: a.acquisitionDate || null,
      cost: legacy ? null : a.price,
      assetAccount: accText(a.assetAccountId),
      accumulatedAccount: accText(a.accumulatedAccountId),
      accumulated,
      netBookValue: legacy ? (typeof a.bookValue === 'number' ? a.bookValue : null) : round2(a.price - accumulated),
      status: a.status || null,
      vendor: a.vendor ? `${a.vendor.vendorNumber ?? ''} - ${a.vendor.name}` : null,
      acquisitionEntry: acquisition ? acquisition.entryNumber : null,
      _rowType: legacy ? 'muted' : undefined,
      _links: { name: { kind: 'fixedAsset', id: String(a._id) }, ...(acquisition ? { acquisitionEntry: { kind: 'journalEntry', id: String(acquisition._id) } } : {}), ...(a.vendor ? { vendor: { kind: 'vendor', id: String(a.vendor._id) } } : {}) },
    };
  });
  const totals = { name: 'Total', nameAr: 'الإجمالي', cost: C.sumBy(rows, 'cost'), accumulated: C.sumBy(rows, 'accumulated'), netBookValue: C.sumBy(rows.filter(r => r.cost != null), 'netBookValue') };

  // Reconciliation with the ledger (only without asset filters, which would leave assets out): per
  // accumulated account, the register vs the account balance.
  const unfiltered = !query.assetStatus && !query.assetClass && !query.vendor;
  const balances = unfiltered ? await C.balancesByAccount({ end }) : new Map();
  const byAccount = new Map();
  if (unfiltered) assets.forEach((a, i) => {
    const id = C.idOf(a.accumulatedAccountId);
    if (id && rows[i].accumulated != null) byAccount.set(id, round2((byAccount.get(id) || 0) + rows[i].accumulated));
  });
  const reconciliation = [...byAccount.entries()].map(([id, registerTotal]) => {
    const b = balances.get(id) || { debit: 0, credit: 0 };
    return { id, registerTotal, ledger: round2(b.credit - b.debit) };
  });

  return {
    asOf,
    summary: [summaryItem('cost', 'Total cost', 'إجمالي التكلفة', totals.cost), summaryItem('accumulated', 'Accumulated depreciation / amortization', 'مجمع الإهلاك / الاستهلاك', totals.accumulated), summaryItem('nbv', 'Net book value', 'صافي القيمة الدفترية', totals.netBookValue)],
    checks: [
      check('No asset has a negative net book value', 'لا يوجد أصل بصافي قيمة دفترية سالب', rows.every(r => r.netBookValue == null || r.netBookValue >= 0)),
      ...reconciliation.map(r =>
        check(`Register = ledger for accumulated account ${rows.find((_, i) => C.idOf(assets[i].accumulatedAccountId) === r.id)?.accumulatedAccount}`, 'السجل = دفتر الأستاذ لحساب المجمع', r.registerTotal === r.ledger, `${r.registerTotal} / ${r.ledger}`)
      ),
    ],
    sections: [
      {
        key: 'assets',
        title: L('Fixed Assets Register', 'سجل الأصول الثابتة'),
        paginate: true,
        columns: [
          col('name', 'Asset', 'الأصل', 'name'),
          col('assetClass', 'Type', 'النوع', 'status'),
          col('acquisitionDate', 'Asset Date', 'تاريخ الأصل', 'date'),
          col('cost', 'Cost', 'التكلفة', 'money'),
          col('assetAccount', 'Asset Account', 'حساب الأصل'),
          col('accumulatedAccount', 'Accumulated Account', 'حساب المجمع'),
          col('accumulated', 'Accumulated Dep. / Amort.', 'مجمع الإهلاك / الاستهلاك', 'money'),
          col('netBookValue', 'Net Book Value', 'صافي القيمة الدفترية', 'money'),
          col('status', 'Status', 'الحالة', 'status'),
          col('vendor', 'Vendor', 'المورد'),
          col('acquisitionEntry', 'Acquisition Entry', 'قيد الاقتناء'),
        ],
        rows,
        totals,
      },
    ],
    notes: [
      note(
        'Cost is the acquisition cost posted with the asset (excluding VAT). Accumulated depreciation/amortization is rebuilt from the asset\'s depreciation journal entries dated on or before the as-of date, less those reversed by then. Net book value = cost − accumulated. Assets created before the Fixed Assets module ("Legacy asset") have no acquisition entry or accounts: their cost is not available and their stored book value is shown.',
        'التكلفة هي تكلفة الاقتناء المرحلة مع الأصل (بدون ضريبة القيمة المضافة). يُحتسب مجمع الإهلاك/الاستهلاك من قيود الإهلاك المؤرخة حتى التاريخ المحدد مطروحاً منها ما تم عكسه حتى ذلك التاريخ. صافي القيمة الدفترية = التكلفة − المجمع. الأصول المنشأة قبل وحدة الأصول الثابتة ("أصل قديم") ليس لها قيد اقتناء أو حسابات: التكلفة غير متاحة وتظهر قيمتها الدفترية المسجلة.'
      ),
    ],
  };
}

// ---------------------------------------------------------------- 24. Depreciation & amortization by asset
async function depreciationByAsset(query) {
  const period = C.resolvePeriod(query);
  const assets = (await loadAssets(query)).filter(a => (a.depreciations || []).length);
  const ledger = await depreciationLedger(assets, period.end);
  const rows = [];
  for (const a of assets) {
    const accumulated = accumulatedAsOf(a, ledger, period.end);
    const base = {
      name: a.name,
      assetAccount: accText(a.assetAccountId),
      accumulatedAccount: accText(a.accumulatedAccountId),
      expenseAccount: accText(a.depreciationAccountId),
      currency: 'EGP',
      accumulatedToDate: accumulated,
    };
    for (const d of a.depreciations || []) {
      const entry = ledger.entries.get(C.idOf(d.journalEntry));
      if (entry && entry.date >= period.start && entry.date <= period.end) {
        rows.push({ ...base, month: d.period, date: entry.date, entryNumber: entry.entryNumber, kind: a.assetClass === 'intangible' ? 'Amortization' : 'Depreciation', kindAr: a.assetClass === 'intangible' ? 'استهلاك' : 'إهلاك', amount: d.amount, _links: { name: { kind: 'fixedAsset', id: String(a._id) }, entryNumber: { kind: 'journalEntry', id: String(entry._id) } } });
      }
      const reversal = ledger.reversals.get(C.idOf(d.journalEntry));
      if (reversal && reversal.date >= period.start && reversal.date <= period.end) {
        rows.push({ ...base, month: d.period, date: reversal.date, entryNumber: reversal.entryNumber, kind: 'Reversal', kindAr: 'عكس', amount: -d.amount, _rowType: 'muted', _links: { name: { kind: 'fixedAsset', id: String(a._id) }, entryNumber: { kind: 'journalEntry', id: String(reversal._id) } } });
      }
    }
  }
  rows.sort((x, y) => new Date(x.date) - new Date(y.date) || String(x.name).localeCompare(String(y.name)));
  const periodExpense = C.sumBy(rows, 'amount');
  return {
    period,
    summary: [summaryItem('expense', 'Period depreciation / amortization', 'إهلاك / استهلاك الفترة', periodExpense), summaryItem('entries', 'Entries', 'عدد القيود', rows.length, 'number')],
    checks: [],
    sections: [
      {
        key: 'depreciation',
        title: L('Depreciation and Amortization by Asset', 'الإهلاكات والاستهلاكات لكل أصل'),
        paginate: true,
        columns: [
          col('name', 'Asset', 'الأصل', 'name'),
          col('month', 'Month', 'الشهر'),
          col('kind', 'Type', 'النوع', 'status'),
          col('date', 'Entry Date', 'تاريخ القيد', 'date'),
          col('entryNumber', 'Entry No.', 'رقم القيد'),
          col('assetAccount', 'Asset Account', 'حساب الأصل'),
          col('accumulatedAccount', 'Accumulated Account', 'حساب المجمع'),
          col('expenseAccount', 'Expense Account', 'حساب المصروف'),
          col('currency', 'Currency', 'العملة'),
          col('amount', 'Period Expense', 'مصروف الفترة', 'money'),
          col('accumulatedToDate', 'Accumulated (period end)', 'المجمع (نهاية الفترة)', 'money'),
        ],
        rows,
        totals: { name: 'Total', nameAr: 'الإجمالي', amount: periodExpense },
      },
    ],
    notes: [
      note(
        'One row per depreciation/amortization journal entry dated in the period; a reversal dated in the period is shown as a negative row. "Accumulated (period end)" is the asset\'s accumulated depreciation at the end of the period. Viewing the report never posts depreciation - use "Run Depreciation" in Fixed Assets.',
        'صف لكل قيد إهلاك/استهلاك مؤرخ في الفترة؛ ويظهر القيد العكسي المؤرخ في الفترة كصف سالب. "المجمع (نهاية الفترة)" هو مجمع إهلاك الأصل في نهاية الفترة. عرض التقرير لا يرحل أي إهلاك - استخدم "تشغيل الإهلاك" في الأصول الثابتة.'
      ),
    ],
  };
}

// ---------------------------------------------------------------- 25. Expenses by account
async function expensesByAccount(query) {
  const period = C.resolvePeriod(query);
  const types = { expense: ['expense'], cogs: ['cogs'], all: ['expense', 'cogs'] }[C.enumParam(query.expenseType, 'expense type', ['expense', 'cogs', 'all']) || 'expense'];
  const accounts = await C.loadAccounts();
  const accountId = C.objectIdParam(query.account, 'account');
  const expenseIds = [...accounts.values()].filter(a => types.includes(a.type) && (!accountId || String(a._id) === String(accountId))).map(a => a._id);
  const { entries, truncated } = await C.ledgerEntries({ start: period.start, end: period.end, entryMatch: { 'lines.account': { $in: expenseIds } } });
  const isExpense = id => expenseIds.some(e => String(e) === C.idOf(id));

  const detail = [];
  const byAccount = new Map();
  for (const entry of entries) {
    for (const line of entry.lines.filter(l => isExpense(l.account))) {
      const amount = round2((line.debit || 0) - (line.credit || 0));
      if (amount !== 0) {
        // Counterparts: the lines on the other side of the entry (excluding other expense lines);
        // the expense is split across them by their weight, so the total is never duplicated.
        const opposite = entry.lines.filter(l => !isExpense(l.account) && (amount > 0 ? (l.credit || 0) > 0 : (l.debit || 0) > 0));
        const weight = opposite.reduce((s, l) => s + (amount > 0 ? l.credit : l.debit), 0);
        const counterparts = opposite.map(l => {
          const a = accounts.get(C.idOf(l.account));
          return `${a?.code || '?'} - ${a?.name || 'Unknown'}${opposite.length > 1 ? ` (${round2((amount * (amount > 0 ? l.credit : l.debit)) / weight)})` : ''}`;
        });
        const account = accounts.get(C.idOf(line.account));
        detail.push({
          date: entry.date,
          entryNumber: entry.entryNumber,
          code: account?.code,
          name: account?.name,
          nameAr: account?.nameAr || null,
          counterpart: counterparts.join(' ; ') || '-',
          description: line.description || entry.description || null,
          amount,
          _links: { entryNumber: { kind: 'journalEntry', id: String(entry._id) } },
        });
        const key = C.idOf(line.account);
        if (!byAccount.has(key)) byAccount.set(key, { account, amount: 0, counterparts: new Map() });
        const agg = byAccount.get(key);
        agg.amount = round2(agg.amount + amount);
        opposite.forEach(l => {
          const share = round2((amount * (amount > 0 ? l.credit : l.debit)) / weight);
          const cp = C.idOf(l.account);
          agg.counterparts.set(cp, round2((agg.counterparts.get(cp) || 0) + share));
        });
      }
    }
  }
  const total = round2([...byAccount.values()].reduce((s, a) => s + a.amount, 0));
  const summaryRows = C.sortAccountsByCode(
    [...byAccount.values()].map(a => ({
      code: a.account?.code || '?',
      name: a.account?.name || 'Unknown',
      nameAr: a.account?.nameAr || null,
      group: C.groupOf(a.account),
      classification: a.account?.type === 'cogs' ? 'Cost of sales' : 'Expense',
      classificationAr: a.account?.type === 'cogs' ? 'تكلفة مبيعات' : 'مصروف',
      counterpart: C.sortAccountsByCode([...a.counterparts.entries()].map(([id, amount]) => ({ code: accounts.get(id)?.code || '?', name: accounts.get(id)?.name || 'Unknown', amount })), x => x.code)
        .map(x => `${x.code} - ${x.name} (${x.amount})`)
        .join(' ; '),
      amount: a.amount,
      share: C.pct(a.amount, total),
    })),
    r => r.code
  );

  return {
    period,
    summary: [summaryItem('total', 'Total expenses', 'إجمالي المصروفات', total), summaryItem('accounts', 'Expense accounts', 'عدد حسابات المصروفات', summaryRows.length, 'number')],
    checks: [
      check('Detail lines add up to the total', 'سطور التفاصيل = الإجمالي', C.sumBy(detail, 'amount') === total),
      ...(truncated ? [check('All entries included', 'تم تضمين كل القيود', false, `limited to ${C.MAX_DETAIL_ROWS}`)] : []),
    ],
    sections: [
      {
        key: 'accounts',
        title: L('Expenses by Account', 'المصروفات حسب الحساب'),
        columns: [
          col('code', 'Account No.', 'رقم الحساب'),
          col('name', 'Expense Account', 'حساب المصروف', 'account'),
          col('group', 'Group (Chart of Accounts)', 'المجموعة (دليل الحسابات)'),
          col('classification', 'Classification', 'التصنيف', 'status'),
          col('counterpart', 'Counterpart Accounts', 'الحسابات المقابلة'),
          col('amount', 'Amount', 'المبلغ', 'money'),
          col('share', '% of Total Expenses', 'النسبة من إجمالي المصروفات', 'percent'),
        ],
        rows: summaryRows,
        totals: { name: 'Total', nameAr: 'الإجمالي', amount: total, share: total ? 100 : null },
      },
      {
        key: 'lines',
        title: L('Expense Transactions', 'حركات المصروفات'),
        paginate: true,
        columns: [col('date', 'Date', 'التاريخ', 'date'), col('entryNumber', 'Entry No.', 'رقم القيد'), col('code', 'Account No.', 'رقم الحساب'), col('name', 'Expense Account', 'حساب المصروف', 'account'), col('counterpart', 'Counterpart Account', 'الحساب المقابل'), col('description', 'Description', 'البيان'), col('amount', 'Amount', 'المبلغ', 'money')],
        rows: detail,
        totals: { date: 'Total', dateAr: 'الإجمالي', amount: C.sumBy(detail, 'amount') },
      },
    ],
    notes: [
      note(
        'Amount = debit − credit on each expense account in the period (credits such as reversals reduce it). % of total = account amount ÷ total of the listed accounts × 100 ("n/a" when the total is zero). The counterpart accounts are the lines on the other side of the same journal entry; when there are several, the expense is split across them in proportion to their amounts (shown in brackets), so no amount is counted twice.',
        'المبلغ = المدين − الدائن لكل حساب مصروف في الفترة (الأرصدة الدائنة مثل القيود العكسية تخفضه). النسبة = مبلغ الحساب ÷ إجمالي الحسابات المعروضة × 100 ("غير متاح" إذا كان الإجمالي صفراً). الحسابات المقابلة هي سطور الطرف الآخر من نفس القيد؛ وعند تعددها يوزع المصروف عليها بنسبة مبالغها (بين القوسين)، فلا يُحتسب أي مبلغ مرتين.'
      ),
    ],
  };
}

// ---------------------------------------------------------------- 6. Disclosure notes
async function disclosureNotes(query) {
  const { asOf } = C.resolveAsOf(query);
  const [position, register, customers, suppliers, bank, manual] = await Promise.all([
    financialPosition({ asOf }),
    fixedAssetRegister({ asOf }),
    customerBalances({ from: asOf, to: asOf }),
    supplierBalances({ from: asOf, to: asOf }),
    bankCash({ from: asOf, to: asOf }),
    DisclosureNote.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 }).lean(),
  ]);

  const groupRows = position.sections.flatMap(s => s.rows.filter(r => r._rowType === 'subtotal').map(r => ({ statement: s.title.en, statementAr: s.title.ar, group: r.name.replace(/^Total /, ''), groupAr: r.nameAr.replace(/^إجمالي /, ''), amount: r.amount })));
  const fixedByAccount = new Map();
  register.sections[0].rows
    .filter(r => r.cost != null)
    .forEach(r => {
      const key = r.assetAccount || '-';
      if (!fixedByAccount.has(key)) fixedByAccount.set(key, { assetAccount: key, assets: 0, cost: 0, accumulated: 0, netBookValue: 0 });
      const g = fixedByAccount.get(key);
      g.assets += 1;
      g.cost = round2(g.cost + r.cost);
      g.accumulated = round2(g.accumulated + r.accumulated);
      g.netBookValue = round2(g.netBookValue + r.netBookValue);
    });
  const fixedRows = [...fixedByAccount.values()];
  const top = (report, labelEn) =>
    report.sections[0]?.rows
      .filter(r => r.partyNumber != null && r.closing)
      .sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing))
      .slice(0, 10)
      .map(r => ({ party: `${r.partyNumber} - ${r.partyName}`, closing: r.closing, advances: r.advances, net: r.net, _links: r._links?.partyName ? { party: r._links.partyName } : undefined })) || [];
  const manualRows = manual.map((n, i) => ({ number: i + 1, title: n.title, titleAr: n.titleAr || n.title, body: n.body, bodyAr: n.bodyAr || n.body, _noteId: String(n._id) }));

  return {
    asOf,
    summary: position.summary,
    checks: [...position.checks],
    sections: [
      { key: 'groups', title: L('Note 1 - Balances by Chart of Accounts group (calculated)', 'إيضاح 1 - الأرصدة حسب مجموعات دليل الحسابات (محسوب)'), columns: [col('statement', 'Statement', 'القائمة', 'status'), col('group', 'Group', 'المجموعة', 'status'), col('amount', 'Balance', 'الرصيد', 'money')], rows: groupRows, totals: null },
      { key: 'cash', title: L('Note 2 - Cash and cash equivalents (calculated)', 'إيضاح 2 - النقدية وما في حكمها (محسوب)'), columns: [col('code', 'Account No.', 'رقم الحساب'), col('name', 'Account', 'الحساب', 'account'), col('closing', 'Balance', 'الرصيد', 'money')], rows: bank.sections[0].rows, totals: { name: 'Total', nameAr: 'الإجمالي', closing: bank.sections[0].totals.closing } },
      { key: 'fixedAssets', title: L('Note 3 - Fixed assets and accumulated depreciation (calculated)', 'إيضاح 3 - الأصول الثابتة ومجمع الإهلاك (محسوب)'), columns: [col('assetAccount', 'Asset Account', 'حساب الأصل'), col('assets', 'Assets', 'عدد الأصول', 'number'), col('cost', 'Cost', 'التكلفة', 'money'), col('accumulated', 'Accumulated', 'المجمع', 'money'), col('netBookValue', 'Net Book Value', 'صافي القيمة الدفترية', 'money')], rows: fixedRows, totals: { assetAccount: 'Total', assetAccountAr: 'الإجمالي', assets: C.sumBy(fixedRows, 'assets'), cost: C.sumBy(fixedRows, 'cost'), accumulated: C.sumBy(fixedRows, 'accumulated'), netBookValue: C.sumBy(fixedRows, 'netBookValue') } },
      { key: 'receivables', title: L('Note 4 - Outstanding receivables, largest 10 customers (calculated)', 'إيضاح 4 - المديونيات القائمة، أكبر 10 عملاء (محسوب)'), columns: [col('party', 'Customer', 'العميل'), col('closing', 'Receivable', 'المستحق', 'money'), col('advances', 'Advances', 'الدفعات المقدمة', 'money'), col('net', 'Net', 'الصافي', 'money')], rows: top(customers), totals: { party: 'Total receivables (all customers)', partyAr: 'إجمالي المديونيات (كل العملاء)', closing: customers.sections[0]?.totals?.closing ?? null } },
      { key: 'payables', title: L('Note 5 - Outstanding payables, largest 10 suppliers (calculated)', 'إيضاح 5 - الدائنيات القائمة، أكبر 10 موردين (محسوب)'), columns: [col('party', 'Supplier', 'المورد'), col('closing', 'Payable', 'المستحق', 'money'), col('advances', 'Advances', 'الدفعات المقدمة', 'money'), col('net', 'Net', 'الصافي', 'money')], rows: top(suppliers), totals: { party: 'Total payables (all suppliers)', partyAr: 'إجمالي الدائنيات (كل الموردين)', closing: suppliers.sections[0]?.totals?.closing ?? null } },
      { key: 'manual', title: L('Supplementary notes (manually maintained)', 'إيضاحات إضافية (تدخل يدوياً)'), manual: true, columns: [col('number', 'No.', 'رقم', 'number'), col('title', 'Title', 'العنوان', 'name'), col('body', 'Note', 'الإيضاح', 'longtext')], rows: manualRows, totals: null },
    ],
    notes: [
      note(
        'Notes 1-5 are calculated from the ledger at the as-of date with the same rules as the corresponding reports. The supplementary notes are text maintained by users (Add / Edit note); they never change any accounting record.',
        'الإيضاحات 1-5 محسوبة من دفتر الأستاذ في التاريخ المحدد بنفس قواعد التقارير المقابلة. الإيضاحات الإضافية نصوص يدخلها المستخدمون (إضافة / تعديل إيضاح) ولا تغير أي سجل محاسبي.'
      ),
    ],
  };
}

module.exports = { bankCash, fixedAssetRegister, depreciationByAsset, expensesByAccount, disclosureNotes, partyLookup };
