const mongoose = require('mongoose');
const ApiError = require('../../utils/apiError');
const C = require('./reportCommon');
const { loadProjects, projectCells, NOT_LINKED } = require('./projectReports');
const { sourceDocuments, partyNames, SOURCE_LABELS } = require('./generalLedgerReport');
const { pucAccountsOf, pucCategoryOf, PUC_CATEGORIES } = require('../project/pucAccountService');
const { computeProjectExecution } = require('../../utils/projectExecution');

const { round2, col, check, note, summaryItem, L } = C;
const coll = name => mongoose.connection.collection(name);
const oid = id => new mongoose.Types.ObjectId(String(id));
// Valid ids only - a historical record may lack a reference.
const validId = id => id != null && mongoose.Types.ObjectId.isValid(String(id));

// PUC / Project Cost report. PUC keeps Reservia's meaning: each project's Projects Under
// Construction (WIP) accounts. The source of truth is the ledger lines on those accounts tagged
// with the project (posted entries, including reversed ones and their reversals; drafts excluded):
//   - a debit is a cost added to the project's PUC (Purchase Order materials and services, PUC
//     transfers in, manual entries),
//   - a credit is a cost leaving it (project cost recognized to cost of sales by Sales Orders, PUC
//     transfers out).
// A cost is therefore counted once - at the journal entry that put it into PUC - never again from
// its Purchase Order or inventory movement, which only describe it. Purchase Order amounts are shown
// separately (ordered / received / recognized / paid) and never added to the PUC totals.

const CATEGORY_KEYS = PUC_CATEGORIES.map(c => c.key);

async function projectCosts(query) {
  const period = C.resolvePeriod(query);
  const accounts = await C.loadAccounts();
  const pucAccounts = await pucAccountsOf(accounts);
  const category = C.enumParam(query.category, 'PUC category', CATEGORY_KEYS);
  const accountId = C.objectIdParam(query.account, 'account');
  if (accountId && !pucAccounts.some(a => String(a._id) === String(accountId))) throw new ApiError('The selected account is not a PUC account.', 400);
  const vendorId = C.objectIdParam(query.vendor, 'supplier');
  const source = query.source ? C.enumParam(query.source, 'source document type', Object.keys(SOURCE_LABELS)) : null;

  const projects = await loadProjects(query);
  const filteredProjects = !!(query.projectStatus || query.sector || query.customer || query.project);
  const projectIds = new Set(projects.map(p => String(p._id)));
  const inScope = id => (filteredProjects ? projectIds.has(String(id)) : true);
  const selected = pucAccounts.filter(a => (!accountId || String(a._id) === String(accountId)) && (!category || pucCategoryOf(a).key === category));
  const selectedIds = selected.map(a => a._id);
  const categoryOfId = new Map(pucAccounts.map(a => [String(a._id), pucCategoryOf(a)]));

  const vendor = vendorId ? await coll('vendors').findOne({ _id: vendorId }, { projection: { vendorNumber: 1, name: 1 } }) : null;

  // Balances by project and account (opening before the period, movements in it).
  const [totals, revenueToDate, cogsInPeriod, { entries, truncated }] = await Promise.all([
    selectedIds.length ? C.ledgerTotals({ start: period.start, end: period.end, lineMatch: { 'lines.account': { $in: selectedIds } }, groupBy: { project: '$lines.project' } }) : [],
    C.ledgerTotals({ end: period.end, lineMatch: { 'lines.account': { $in: [...accounts.values()].filter(a => a.type === 'revenue').map(a => a._id) } }, groupBy: { project: '$lines.project' } }),
    C.ledgerTotals({ start: period.start, end: period.end, lineMatch: { 'lines.account': { $in: [...accounts.values()].filter(a => a.type === 'cogs').map(a => a._id) } }, groupBy: { project: '$lines.project' } }),
    selectedIds.length ? C.ledgerEntries({ start: period.start, end: period.end, entryMatch: { 'lines.account': { $in: selectedIds } } }) : { entries: [], truncated: false },
  ]);

  const byProject = new Map(); // projectId|null -> { opening, added, relieved, byCategory }
  const bucket = key => {
    if (!byProject.has(key)) byProject.set(key, { opening: 0, added: 0, relieved: 0, byCategory: Object.fromEntries(CATEGORY_KEYS.map(k => [k, 0])) });
    return byProject.get(key);
  };
  for (const t of totals) {
    const key = C.idOf(t.key.project);
    if (key && !inScope(key)) continue;
    const b = bucket(key);
    b.opening = round2(b.opening + t.openingDebit - t.openingCredit);
    b.added = round2(b.added + t.periodDebit);
    b.relieved = round2(b.relieved + t.periodCredit);
    const cat = categoryOfId.get(t.accountId)?.key || 'other';
    b.byCategory[cat] = round2(b.byCategory[cat] + t.periodDebit - t.periodCredit);
  }
  // Revenue recognized to the end of the period (no start date - every line up to `end`).
  const revenueOf = project => round2(revenueToDate.filter(r => C.idOf(r.key.project) === project).reduce((s, r) => s + r.periodCredit - r.periodDebit, 0));
  const cogsBy = project => round2(cogsInPeriod.filter(r => C.idOf(r.key.project) === project).reduce((s, r) => s + r.periodDebit - r.periodCredit, 0));

  // 1. Project summary and cost analysis.
  const summaryRows = projects.map(p => {
    const b = byProject.get(String(p._id)) || { opening: 0, added: 0, relieved: 0 };
    const execution = computeProjectExecution(p);
    const revenue = revenueOf(String(p._id));
    return {
      ...projectCells(p),
      contractValue: typeof p.contractValue === 'number' ? p.contractValue : null,
      executedPercentage: typeof p.executedPercentage === 'number' ? p.executedPercentage : null,
      pucOpening: b.opening,
      costsAdded: b.added,
      costsRelieved: b.relieved,
      pucClosing: round2(b.opening + b.added - b.relieved),
      costOfSales: cogsBy(String(p._id)),
      revenueToDate: revenue,
      remainingContract: execution ? round2((p.contractValue || 0) - revenue) : null,
    };
  });
  if (!filteredProjects && byProject.has(null)) {
    const b = byProject.get(null);
    summaryRows.push({ projectNumber: NOT_LINKED.en, projectNumberAr: NOT_LINKED.ar, _rowType: 'muted', pucOpening: b.opening, costsAdded: b.added, costsRelieved: b.relieved, pucClosing: round2(b.opening + b.added - b.relieved), costOfSales: cogsBy(null), revenueToDate: revenueOf(null) });
  }

  // 2. Category breakdown / project comparison (net movement of each category in the period).
  const breakdownRows = summaryRows.map(r => {
    const b = byProject.get(r._links?.projectNumber?.id || null) || { byCategory: {} };
    const cells = Object.fromEntries(CATEGORY_KEYS.map(k => [`cat_${k}`, b.byCategory[k] || 0]));
    return { projectNumber: r.projectNumber, projectNumberAr: r.projectNumberAr, projectName: r.projectName, _rowType: r._rowType, _links: r._links, ...cells, total: round2(Object.values(cells).reduce((s, v) => s + v, 0)) };
  });
  const usedCategories = PUC_CATEGORIES.filter(c => breakdownRows.some(r => r[`cat_${c.key}`] !== 0) || c.key === category);

  // 3. Detailed transactions.
  const flat = [];
  entries.forEach(entry =>
    entry.lines.forEach(line => {
      const id = C.idOf(line.account);
      if (!selectedIds.some(s => String(s) === id)) return;
      const projectRef = C.idOf(line.project);
      if (filteredProjects && !(projectRef && projectIds.has(projectRef))) return;
      flat.push({ entry, line });
    })
  );
  const [sourceOf, parties] = await Promise.all([sourceDocuments(entries), partyNames(entries.flatMap(e => e.lines))]);
  const poIds = [...new Set(entries.filter(e => e.sourceType === 'PO').map(e => String(e.sourceId)))].filter(validId).map(oid);
  const [orders, transfers, projectDocs] = await Promise.all([
    poIds.length ? coll('purchaseorders').find({ _id: { $in: poIds } }, { projection: { code: 1, vendorId: 1, items: 1, totalAmount: 1, grandTotal: 1, paidAmount: 1, project: 1, createdAt: 1 } }).toArray() : [],
    coll('puctransfers').find({ journalEntry: { $in: entries.filter(e => e.accountingAction === 'PUC_TRANSFER').map(e => e._id) } }).toArray(),
    coll('projects').find({ _id: { $in: [...new Set(flat.map(f => C.idOf(f.line.project)).filter(Boolean))].filter(validId).map(oid) } }, { projection: { projectNumber: 1, name: 1 } }).toArray(),
  ]);
  const productIds = [...new Set([...orders.flatMap(o => (o.items || []).map(i => String(i.productId))), ...transfers.map(t => String(t.product))])].filter(validId).map(oid);
  const [products, vendors] = await Promise.all([
    productIds.length ? coll('products').find({ _id: { $in: productIds } }, { projection: { title: 1, sku: 1, type: 1 } }).toArray() : [],
    coll('vendors').find({ _id: { $in: [...new Set(orders.map(o => String(o.vendorId)))].filter(validId).map(oid) } }, { projection: { name: 1, vendorNumber: 1 } }).toArray(),
  ]);
  const productName = id => {
    const p = products.find(x => String(x._id) === String(id));
    return p ? p.title?.en || p.sku || String(p._id) : 'Product';
  };
  const orderOf = new Map(orders.map(o => [String(o._id), o]));
  const vendorOf = new Map(vendors.map(v => [String(v._id), v]));
  const transferOf = new Map(transfers.map(t => [String(t.journalEntry), t]));
  const projectOf = new Map(projectDocs.map(p => [String(p._id), p]));

  let detail = flat.map(({ entry, line }) => {
    const account = accounts.get(C.idOf(line.account));
    const cat = pucCategoryOf(account);
    const order = entry.sourceType === 'PO' ? orderOf.get(String(entry.sourceId)) : null;
    const transfer = transferOf.get(String(entry._id));
    const partyLine = entry.lines.find(l => l.partyType === 'vendor' && l.partyNumber != null);
    const orderVendor = order ? vendorOf.get(String(order.vendorId)) : null;
    const vendorName = orderVendor ? `${orderVendor.vendorNumber ?? ''} - ${orderVendor.name}` : partyLine ? `${partyLine.partyNumber} - ${parties.get(`vendor|${partyLine.partyNumber}`)?.name || ''}` : null;
    const vendorNumber = orderVendor?.vendorNumber ?? partyLine?.partyNumber ?? null;
    let item = null;
    let quantity = null;
    let unitCost = null;
    if (transfer) {
      item = productName(transfer.product);
      quantity = transfer.quantity;
      unitCost = transfer.unitCost;
    } else if (order) {
      const items = (order.items || []).filter(i => (line.debit > 0 || line.credit > 0) && i.subtotal !== 0);
      item = items.map(i => `${productName(i.productId)} x ${round2((i.starterQuantity || 0) - (i.returnedQuantity || 0))} @ ${i.unitPriceAfterDiscount ?? i.unitPrice}`).join('; ') || null;
    }
    const project = projectOf.get(C.idOf(line.project));
    const module = entry.reversalOfEntry ? 'Reversal' : entry.module || (entry.accountingAction ? null : 'Manual');
    const label = SOURCE_LABELS[module] || (module ? L(module, module) : null);
    return {
      date: entry.date,
      entryNumber: entry.entryNumber,
      projectNumber: project?.projectNumber || line.projectNumber || NOT_LINKED.en,
      projectName: project?.name || null,
      category: cat.title.en,
      categoryAr: cat.title.ar,
      accountCode: account?.code || '?',
      accountName: account?.name || 'Unknown account',
      accountNameAr: account?.nameAr || null,
      description: line.description || entry.description || null,
      sourceType: label?.en || null,
      sourceTypeAr: label?.ar || null,
      sourceNumber: sourceOf(entry),
      vendor: vendorName,
      item,
      quantity,
      unitCost,
      currency: line.currency || 'EGP',
      exchangeRate: line.exchangeRate ?? (line.currency ? null : 1),
      costAdded: line.debit || 0,
      costRelieved: line.credit || 0,
      _module: module,
      _vendorNumber: vendorNumber,
      _links: { entryNumber: { kind: 'journalEntry', id: String(entry._id) }, ...(project ? { projectNumber: { kind: 'project', id: String(project._id) } } : {}), ...(order ? { sourceNumber: { kind: 'purchaseOrder', id: String(order._id) } } : {}) },
    };
  });
  if (vendor) detail = detail.filter(r => r._vendorNumber === vendor.vendorNumber);
  if (source) detail = detail.filter(r => r._module === source);
  detail = detail.map(({ _module, _vendorNumber, ...r }) => r);

  // 4. Purchase Orders of the projects: ordered / received / recognized in PUC / paid - shown for
  // reference, never added to the PUC totals.
  const poFilter = { project: filteredProjects ? { $in: [...projectIds].filter(validId).map(oid) } : { $ne: null }, createdAt: { $gte: period.start, $lte: period.end } };
  if (vendor) poFilter.vendorId = vendorId;
  const periodOrders = await coll('purchaseorders').find(poFilter, { projection: { code: 1, vendorId: 1, project: 1, items: 1, starterTotalAmount: 1, totalAmount: 1, vatAmount: 1, grandTotal: 1, paidAmount: 1, createdAt: 1 } }).toArray();
  const recognized = await coll('journalentries')
    .aggregate([
      { $match: { sourceType: 'PO', sourceId: { $in: periodOrders.map(o => o._id) }, status: { $in: C.LEDGER_STATUSES } } },
      { $unwind: '$lines' },
      { $match: { 'lines.account': { $in: pucAccounts.map(a => a._id) } } },
      { $group: { _id: '$sourceId', amount: { $sum: { $subtract: ['$lines.debit', '$lines.credit'] } } } },
    ])
    .toArray();
  const recognizedOf = new Map(recognized.map(r => [String(r._id), round2(r.amount)]));
  const orderVendors = await coll('vendors').find({ _id: { $in: [...new Set(periodOrders.map(o => String(o.vendorId)))].filter(validId).map(oid) } }, { projection: { name: 1, vendorNumber: 1 } }).toArray();
  const orderProjects = await coll('projects').find({ _id: { $in: [...new Set(periodOrders.map(o => String(o.project)))].filter(validId).map(oid) } }, { projection: { projectNumber: 1 } }).toArray();
  const poRows = periodOrders.map(o => {
    const v = orderVendors.find(x => String(x._id) === String(o.vendorId));
    const total = o.grandTotal ?? o.totalAmount ?? 0;
    return {
      date: o.createdAt,
      code: o.code || String(o._id),
      projectNumber: orderProjects.find(p => String(p._id) === String(o.project))?.projectNumber || null,
      vendor: v ? `${v.vendorNumber ?? ''} - ${v.name}` : null,
      ordered: round2(o.starterTotalAmount ?? o.totalAmount ?? 0),
      received: round2(o.totalAmount ?? 0),
      recognized: recognizedOf.get(String(o._id)) ?? 0,
      vat: round2(o.vatAmount || 0),
      total: round2(total),
      paid: round2(o.paidAmount || 0),
      outstanding: round2(total - (o.paidAmount || 0)),
      _links: { code: { kind: 'purchaseOrder', id: String(o._id) } },
    };
  });

  // Reconciliation: the projects' PUC closing balances against the PUC accounts' closing balance.
  const closingBalances = await C.balancesByAccount({ end: period.end });
  const companyClosing = round2(selected.reduce((s, a) => s + (closingBalances.get(String(a._id))?.debit || 0) - (closingBalances.get(String(a._id))?.credit || 0), 0));
  const pucTotals = { pucOpening: C.sumBy(summaryRows, 'pucOpening'), costsAdded: C.sumBy(summaryRows, 'costsAdded'), costsRelieved: C.sumBy(summaryRows, 'costsRelieved'), pucClosing: C.sumBy(summaryRows, 'pucClosing'), costOfSales: C.sumBy(summaryRows, 'costOfSales') };
  const detailFiltered = !!(vendor || source);
  const money = (k, en, ar) => col(k, en, ar, 'money');

  return {
    period,
    summary: [
      summaryItem('pucOpening', 'PUC opening balance', 'رصيد أول المدة', pucTotals.pucOpening),
      summaryItem('costsAdded', 'Costs added to PUC', 'تكاليف مضافة', pucTotals.costsAdded),
      summaryItem('costsRelieved', 'Costs relieved from PUC', 'تكاليف محملة / محولة', pucTotals.costsRelieved),
      summaryItem('pucClosing', 'PUC closing balance', 'رصيد آخر المدة', pucTotals.pucClosing),
      summaryItem('costOfSales', 'Cost of sales recognized', 'تكلفة المبيعات المثبتة', pucTotals.costOfSales),
    ],
    checks: [
      ...(filteredProjects ? [] : [check('Project PUC balances add up to the PUC accounts', 'أرصدة المشروعات تساوي أرصدة حسابات مشروعات تحت التنفيذ', !truncated && pucTotals.pucClosing === companyClosing, `${pucTotals.pucClosing} / ${companyClosing}`)]),
      ...(detailFiltered
        ? []
        : [check('Detailed transactions add up to the period movements', 'تفاصيل الحركات تساوي حركة الفترة', !truncated && C.sumBy(detail, 'costAdded') === pucTotals.costsAdded && C.sumBy(detail, 'costRelieved') === pucTotals.costsRelieved, `${C.sumBy(detail, 'costAdded')} / ${pucTotals.costsAdded}`)]),
      ...(truncated ? [check('All transactions included', 'تم تضمين كل الحركات', false, `limited to ${C.MAX_DETAIL_ROWS}`)] : []),
    ],
    sections: [
      {
        key: 'projects',
        title: L('Project Summary and Cost Analysis', 'ملخص المشروعات وتحليل التكاليف'),
        paginate: true,
        columns: [
          col('projectNumber', 'Project No.', 'رقم المشروع'),
          col('projectName', 'Project', 'المشروع'),
          col('customer', 'Customer', 'العميل'),
          col('sector', 'Sector', 'السيكتور'),
          money('contractValue', 'Contract Value', 'قيمة العقد'),
          col('executedPercentage', 'Executed %', 'نسبة التنفيذ', 'percent'),
          money('pucOpening', 'PUC Opening', 'رصيد أول المدة'),
          money('costsAdded', 'Costs Added', 'تكاليف مضافة'),
          money('costsRelieved', 'Costs Relieved', 'تكاليف محملة / محولة'),
          money('pucClosing', 'PUC Balance', 'رصيد مشروعات تحت التنفيذ'),
          money('costOfSales', 'Cost of Sales (period)', 'تكلفة المبيعات (الفترة)'),
          money('revenueToDate', 'Revenue Recognized to Date', 'الإيراد المثبت حتى تاريخه'),
          money('remainingContract', 'Contract Not Yet Recognized', 'المتبقي من العقد'),
        ],
        rows: summaryRows,
        totals: { projectNumber: 'Total', projectNumberAr: 'الإجمالي', contractValue: C.sumBy(summaryRows, 'contractValue'), ...pucTotals, revenueToDate: C.sumBy(summaryRows, 'revenueToDate'), remainingContract: C.sumBy(summaryRows, 'remainingContract') },
      },
      {
        key: 'categories',
        title: L('Cost Categories by Project (net movement in the period)', 'فئات التكلفة لكل مشروع (صافي حركة الفترة)'),
        paginate: true,
        columns: [col('projectNumber', 'Project No.', 'رقم المشروع'), col('projectName', 'Project', 'المشروع'), ...usedCategories.map(c => money(`cat_${c.key}`, c.title.en, c.title.ar)), money('total', 'Total', 'الإجمالي')],
        rows: breakdownRows,
        totals: { projectNumber: 'Total', projectNumberAr: 'الإجمالي', ...Object.fromEntries(usedCategories.map(c => [`cat_${c.key}`, C.sumBy(breakdownRows, `cat_${c.key}`)])), total: C.sumBy(breakdownRows, 'total') },
      },
      {
        key: 'transactions',
        title: L('Detailed Transactions', 'تفاصيل الحركات'),
        paginate: true,
        columns: [
          col('date', 'Date', 'التاريخ', 'date'),
          col('entryNumber', 'Entry No.', 'رقم القيد'),
          col('projectNumber', 'Project No.', 'رقم المشروع'),
          col('category', 'PUC Category', 'فئة التكلفة', 'status'),
          col('accountCode', 'Account No.', 'رقم الحساب'),
          col('accountName', 'Account', 'الحساب', 'account'),
          col('description', 'Description', 'البيان'),
          col('sourceType', 'Source Document', 'نوع المستند', 'status'),
          col('sourceNumber', 'Document No.', 'رقم المستند'),
          col('vendor', 'Supplier', 'المورد'),
          col('item', 'Product / Service', 'الصنف / الخدمة', 'longtext'),
          col('quantity', 'Quantity', 'الكمية', 'number'),
          money('unitCost', 'Unit Cost', 'تكلفة الوحدة'),
          col('currency', 'Currency', 'العملة'),
          col('exchangeRate', 'Rate', 'سعر الصرف', 'number'),
          money('costAdded', 'Cost Added (excl. VAT)', 'تكلفة مضافة (بدون الضريبة)'),
          money('costRelieved', 'Cost Relieved', 'تكلفة محملة / محولة'),
        ],
        rows: detail,
        totals: { date: null, entryNumber: 'Total', entryNumberAr: 'الإجمالي', costAdded: C.sumBy(detail, 'costAdded'), costRelieved: C.sumBy(detail, 'costRelieved') },
      },
      {
        key: 'purchaseOrders',
        title: L('Project Purchase Orders (for reference - not added to PUC)', 'أوامر شراء المشروعات (للاسترشاد - لا تضاف لمشروعات تحت التنفيذ)'),
        paginate: true,
        columns: [
          col('date', 'Date', 'التاريخ', 'date'),
          col('code', 'Purchase Order', 'أمر الشراء'),
          col('projectNumber', 'Project No.', 'رقم المشروع'),
          col('vendor', 'Supplier', 'المورد'),
          money('ordered', 'Ordered (excl. VAT)', 'المطلوب (بدون الضريبة)'),
          money('received', 'Received, net of returns', 'المستلم بعد المرتجعات'),
          money('recognized', 'Recognized in PUC', 'المثبت في مشروعات تحت التنفيذ'),
          money('vat', 'Recoverable VAT', 'ضريبة قابلة للخصم'),
          money('total', 'Total Payable', 'الإجمالي المستحق'),
          money('paid', 'Paid', 'المدفوع'),
          money('outstanding', 'Outstanding', 'المتبقي'),
        ],
        rows: poRows,
        totals: poRows.length ? { date: null, code: 'Total', codeAr: 'الإجمالي', ...Object.fromEntries(['ordered', 'received', 'recognized', 'vat', 'total', 'paid', 'outstanding'].map(k => [k, C.sumBy(poRows, k)])) } : null,
      },
    ],
    notes: [
      note(
        'PUC (Projects Under Construction) = each project\'s WIP accounts in the ledger. Costs added = debits to them (Purchase Order materials and services, PUC transfers in, manual entries); costs relieved = credits (project cost recognized to cost of sales by Sales Orders, PUC transfers out). Each cost is counted once, at the journal entry that put it into PUC - never again from its Purchase Order or inventory movement. VAT on purchases is posted to Input VAT (recoverable), so PUC amounts exclude it; the system records no non-recoverable VAT. Categories come from the PUC account (Materials, Labor, Designs and Engineering, Equipment, Subcontractors, Services, Other).',
        'مشروعات تحت التنفيذ = حسابات الأعمال تحت التنفيذ لكل مشروع في دفتر الأستاذ. التكاليف المضافة = المدين فيها (مواد وخدمات أوامر الشراء، التحويلات الواردة، القيود اليدوية)؛ والتكاليف المحملة = الدائن (تكلفة المشروع المحملة على تكلفة المبيعات بأوامر البيع، التحويلات الصادرة). كل تكلفة تُحتسب مرة واحدة عند القيد الذي أدخلها - ولا تُحتسب مرة أخرى من أمر الشراء أو حركة المخزون. ضريبة المشتريات ترحل لحساب ضريبة المدخلات (قابلة للخصم)، فالمبالغ بدونها؛ ولا يسجل النظام ضريبة غير قابلة للخصم. الفئات من حساب مشروعات تحت التنفيذ (مواد، عمالة، تصميمات وهندسة، معدات، مقاولو الباطن، خدمات، أخرى).'
      ),
      note(
        'Purchase Orders are listed for reference: ordered amount, received amount net of returns (in Reservia an order is received into stock when it is created), the amount its journal entries put into PUC, recoverable VAT, total payable, paid and outstanding. Their totals are never added to PUC. Paid and outstanding are the order\'s recorded payments.',
        'أوامر الشراء معروضة للاسترشاد: المطلوب، والمستلم بعد المرتجعات (في ريزرفيا يُستلم الأمر في المخزون عند إنشائه)، والمبلغ الذي أدخلته قيوده في مشروعات تحت التنفيذ، والضريبة القابلة للخصم، والإجمالي المستحق، والمدفوع والمتبقي. لا تضاف إجمالياتها لمشروعات تحت التنفيذ. المدفوع والمتبقي من مدفوعات الأمر المسجلة.'
      ),
    ],
  };
}

module.exports = { projectCosts, CATEGORY_KEYS };
