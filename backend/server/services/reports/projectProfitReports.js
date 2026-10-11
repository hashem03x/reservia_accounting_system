const JournalEntry = require('../../models/accounting/journalEntryModel');
const C = require('./reportCommon');
const { loadProjects, projectCells, NOT_LINKED } = require('./projectReports');
const { sourceDocuments, SOURCE_LABELS } = require('./generalLedgerReport');
const { projectPucPositions } = require('../project/projectCostEstimateService');
const { PUC_CATEGORIES } = require('../project/pucAccountService');

const { round2, col, check, note, summaryItem, L } = C;
const money = (k, en, ar) => col(k, en, ar, 'money');
const CATEGORY_KEYS = PUC_CATEGORIES.map(c => c.key);
const statusText = row => (row.remaining === null ? L('No estimate', 'بدون تقدير') : row.overrun ? L('Overrun', 'تجاوز التقدير') : L('Within estimate', 'ضمن التقدير'));

// ============================================================ 1. PUC - estimated vs actual by project
/**
 * For each project and PUC category (PUC account): the estimated cost (the project's Average Cost
 * line), actual accumulated cost, cost already recognized to cost of sales, posted cost adjustments,
 * the PUC balance, and remaining = estimate - actual (negative = overrun). At the end of a project
 * the PUC balance is the cost adjustment still to post. Read-only - nothing is posted.
 */
async function pucEstimates(query) {
  const asOf = C.resolveAsOf(query);
  const accounts = await C.loadAccounts();
  const category = C.enumParam(query.category, 'PUC category', CATEGORY_KEYS);
  const projects = await loadProjects(query);
  const { positions, pucAccounts } = await projectPucPositions({ projects, accounts, end: asOf.end });

  const rows = [];
  const grand = { estimate: 0, actual: 0, recognized: 0, adjustment: 0, balance: 0 };
  let estimateTotal = 0;
  for (const p of projects) {
    const items = (positions.get(String(p._id)) || []).filter(r => !category || r.category?.key === category);
    if (!items.length) continue;
    const projectRow = { ...projectCells(p), _rowType: 'header', name: `${p.projectNumber}${p.name ? ` - ${p.name}` : ''}`, nameAr: `${p.projectNumber}${p.name ? ` - ${p.name}` : ''}` };
    rows.push(projectRow);
    const sub = { estimate: 0, actual: 0, recognized: 0, adjustment: 0, balance: 0, hasEstimate: false };
    C.sortAccountsByCode(items, r => r.pucAccount?.code || r.costAccount?.code).forEach(r => {
      const st = statusText(r);
      rows.push({
        projectNumber: p.projectNumber,
        category: r.category ? r.category.title.en : 'No PUC account',
        categoryAr: r.category ? r.category.title.ar : 'بدون حساب مشروعات تحت التنفيذ',
        accountCode: r.pucAccount?.code || null,
        accountName: r.pucAccount?.name || null,
        accountNameAr: r.pucAccount?.nameAr || null,
        costAccount: r.costAccount ? `${r.costAccount.code} - ${r.costAccount.name}` : null,
        estimate: r.hasEstimate ? r.estimate : null,
        actual: r.actual,
        recognized: r.recognized,
        adjustment: r.adjustment,
        balance: r.balance,
        remaining: r.remaining,
        status: st.en,
        statusAr: st.ar,
        _links: { projectNumber: { kind: 'project', id: String(p._id) } },
      });
      ['estimate', 'actual', 'recognized', 'adjustment', 'balance'].forEach(k => (sub[k] = round2(sub[k] + (k === 'estimate' ? (r.hasEstimate ? r.estimate : 0) : r[k]))));
      if (r.hasEstimate) sub.hasEstimate = true;
    });
    const remaining = sub.hasEstimate ? round2(sub.estimate - sub.actual) : null;
    rows.push({ projectNumber: `Total ${p.projectNumber}`, projectNumberAr: `إجمالي ${p.projectNumber}`, _rowType: 'subtotal', estimate: sub.hasEstimate ? sub.estimate : null, actual: sub.actual, recognized: sub.recognized, adjustment: sub.adjustment, balance: sub.balance, remaining, status: remaining === null ? null : remaining < 0 ? 'Overrun' : 'Within estimate', statusAr: remaining === null ? null : remaining < 0 ? 'تجاوز التقدير' : 'ضمن التقدير' });
    ['estimate', 'actual', 'recognized', 'adjustment', 'balance'].forEach(k => (grand[k] = round2(grand[k] + sub[k])));
    if (sub.hasEstimate) estimateTotal = round2(estimateTotal + sub.estimate);
  }

  // Reconciliation: the report's PUC balances against the PUC accounts' project-tagged ledger balance.
  const ledger = category ? null : await C.ledgerTotals({ end: asOf.end, lineMatch: { 'lines.account': { $in: pucAccounts.map(a => a._id) }, 'lines.project': { $in: projects.map(p => p._id) } } });
  const ledgerBalance = ledger ? round2(ledger.reduce((s, t) => s + t.periodDebit - t.periodCredit, 0)) : null;
  const overruns = rows.filter(r => !r._rowType && r.status === 'Overrun').length;

  return {
    asOf: asOf.asOf,
    summary: [
      summaryItem('estimate', 'Estimated cost', 'التكلفة التقديرية', estimateTotal),
      summaryItem('actual', 'Actual accumulated cost', 'التكلفة الفعلية المتراكمة', grand.actual),
      summaryItem('recognized', 'Recognized to cost of sales', 'المحمل على تكلفة المبيعات', grand.recognized),
      summaryItem('adjustment', 'Cost adjustments posted', 'تسويات التكلفة المرحلة', grand.adjustment),
      summaryItem('balance', 'PUC balance', 'رصيد مشروعات تحت التنفيذ', grand.balance),
      summaryItem('remaining', 'Remaining (estimate - actual)', 'المتبقي (التقدير - الفعلي)', round2(estimateTotal - grand.actual)),
    ],
    checks: [
      ...(ledgerBalance === null ? [] : [check('PUC balances equal the project-tagged PUC accounts in the ledger', 'أرصدة مشروعات تحت التنفيذ تساوي أرصدتها في دفتر الأستاذ', grand.balance === ledgerBalance, `${grand.balance} / ${ledgerBalance}`)]),
      check('No category over its estimate', 'لا توجد فئة تجاوزت تقديرها', overruns === 0, overruns ? `${overruns} overrun(s)` : null),
    ],
    sections: [
      {
        key: 'categories',
        title: L('PUC by Project and Category - Estimated vs Actual', 'مشروعات تحت التنفيذ لكل مشروع وفئة - التقديري مقابل الفعلي'),
        paginate: true,
        columns: [
          col('projectNumber', 'Project', 'المشروع'),
          col('category', 'PUC Category', 'فئة التكلفة', 'status'),
          col('accountCode', 'PUC Account No.', 'رقم الحساب'),
          col('accountName', 'PUC Account', 'حساب مشروعات تحت التنفيذ', 'account'),
          col('costAccount', 'Estimate / Cost Account', 'حساب التكلفة التقديرية'),
          money('estimate', 'Estimated Cost', 'التكلفة التقديرية'),
          money('actual', 'Actual Accumulated Cost', 'التكلفة الفعلية المتراكمة'),
          money('recognized', 'Recognized to Cost of Sales', 'المحمل على تكلفة المبيعات'),
          money('adjustment', 'Cost Adjustments Posted', 'تسويات مرحلة'),
          money('balance', 'PUC Balance (adjustment still to post)', 'رصيد مشروعات تحت التنفيذ (التسوية المتبقية)'),
          money('remaining', 'Remaining (Estimate - Actual)', 'المتبقي (التقدير - الفعلي)'),
          col('status', 'Status', 'الحالة', 'status'),
        ],
        rows,
        totals: { projectNumber: 'Grand total', projectNumberAr: 'الإجمالي العام', estimate: estimateTotal, ...grand, remaining: round2(estimateTotal - grand.actual) },
      },
    ],
    notes: [
      note(
        'Estimated cost = the project\'s Average Cost lines, each matched to its PUC account by the same rule the cost recognition entry uses. Actual accumulated cost = the PUC account\'s ledger movements for the project (purchases, PUC transfers in and out, manual entries, returns and reversals), excluding cost recognition and cost adjustment entries. Recognized = what Sales Orders moved to cost of sales (estimate x executed %). PUC balance = actual - recognized + adjustments: at the end of a project it is the cost adjustment still to post (a debit balance = actual above estimate). Remaining = estimate - actual; a negative remaining is an overrun. Only posted entries count (including reversed ones together with their reversals); drafts never do. Viewing this report posts nothing - the adjustment is prepared on request from the project page as a draft entry.',
        'التكلفة التقديرية = بنود متوسط تكلفة المشروع، كل منها مقترن بحساب مشروعات تحت التنفيذ بنفس قاعدة قيد تحميل التكاليف. التكلفة الفعلية المتراكمة = حركة حساب مشروعات تحت التنفيذ للمشروع في دفتر الأستاذ (المشتريات، التحويلات الواردة والصادرة، القيود اليدوية، المرتجعات والقيود العكسية) دون قيود تحميل التكاليف وقيود التسوية. المحمل = ما نقلته أوامر البيع لتكلفة المبيعات (التقدير × نسبة التنفيذ). الرصيد = الفعلي - المحمل + التسويات: في نهاية المشروع هو تسوية التكلفة المتبقية (رصيد مدين = الفعلي أكبر من التقدير). المتبقي = التقدير - الفعلي؛ والمتبقي السالب تجاوز. تُحتسب القيود المرحلة فقط (بما فيها المعكوسة مع قيودها العكسية) ولا تُحتسب المسودات. عرض التقرير لا يرحل شيئاً - تُعد التسوية عند الطلب من صفحة المشروع كقيد مسودة.'
      ),
    ],
  };
}

// ============================================================ 2. Project profitability - revenue and every cost
/**
 * For each project: recognized revenue by revenue account; every cost account tagged with the
 * project (cost of sales = direct; expense accounts classified 'direct' = direct, other expenses =
 * indirect), with the estimate and variance where the account has an Average Cost line; gross profit,
 * net profit and margin; actual costs incurred (PUC actual + direct costs not routed through PUC +
 * expenses) and the profit on them; estimated profit = contract value - estimated cost. Every figure
 * drills down to its ledger lines and source documents.
 */
async function projectProfitAnalysis(query) {
  const period = C.resolvePeriod(query);
  const accounts = await C.loadAccounts();
  const accountId = C.objectIdParam(query.account, 'account');
  const projects = await loadProjects(query);
  const filtered = !!(query.projectStatus || query.sector || query.customer || query.project);
  const plIds = [...accounts.values()].filter(a => C.PROFIT_AND_LOSS_TYPES.has(a.type)).map(a => a._id);

  const [totals, { positions }] = await Promise.all([
    C.ledgerTotals({ start: period.start, end: period.end, lineMatch: { 'lines.account': { $in: plIds } }, groupBy: { project: '$lines.project' } }),
    projectPucPositions({ projects, accounts, start: period.start, end: period.end }),
  ]);
  // Cost of sales posted by cost recognition / cost adjustments (and their reversals, which follow
  // the entry they reverse) is the estimate-based, adjusted cost; other cost lines never went
  // through PUC.
  const viaPuc = await JournalEntry.aggregate([
    { $match: C.ledgerMatch({ start: period.start, end: period.end }) },
    { $lookup: { from: 'journalentries', localField: 'reversalOfEntry', foreignField: '_id', as: 'original', pipeline: [{ $project: { accountingAction: 1, sourceType: 1 } }] } },
    { $addFields: { effAction: { $ifNull: [{ $first: '$original.accountingAction' }, '$accountingAction'] }, effSource: { $ifNull: [{ $first: '$original.sourceType' }, '$sourceType'] } } },
    { $match: { $or: [{ effAction: 'PROJECT_COST_RECOGNITION' }, { effSource: 'PUC_ADJUSTMENT' }] } },
    { $unwind: '$lines' },
    { $match: { 'lines.account': { $in: plIds } } },
    { $group: { _id: { project: '$lines.project', account: '$lines.account' }, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]).then(rows => rows.map(r => ({ key: { project: r._id.project }, accountId: C.idOf(r._id.account), periodDebit: r.debit, periodCredit: r.credit })));

  const typeOf = id => accounts.get(id)?.type;
  const costGroup = account => (account.type === 'cogs' || account.state === 'direct' ? 'direct' : 'indirect');
  const summaryRows = [];
  const accountRows = [];
  const keys = filtered ? projects.map(p => String(p._id)) : [...projects.map(p => String(p._id)), null];
  for (const key of keys) {
    const p = projects.find(x => String(x._id) === key) || null;
    const mine = totals.filter(t => C.idOf(t.key.project) === key);
    if (!p && !mine.length) continue;
    const estimates = new Map();
    (p?.averageCostLines || []).forEach(l => estimates.set(C.idOf(l.account), round2((estimates.get(C.idOf(l.account)) || 0) + (l.amount || 0))));

    const rev = mine.filter(t => typeOf(t.accountId) === 'revenue');
    const cost = mine.filter(t => typeOf(t.accountId) !== 'revenue');
    const revenue = round2(rev.reduce((s, t) => s + t.periodCredit - t.periodDebit, 0));
    const amountOf = t => round2(t.periodDebit - t.periodCredit);
    const direct = round2(cost.filter(t => costGroup(accounts.get(t.accountId)) === 'direct').reduce((s, t) => s + amountOf(t), 0));
    const indirect = round2(cost.filter(t => costGroup(accounts.get(t.accountId)) === 'indirect').reduce((s, t) => s + amountOf(t), 0));
    const cogs = round2(cost.filter(t => typeOf(t.accountId) === 'cogs').reduce((s, t) => s + amountOf(t), 0));
    const totalCost = round2(direct + indirect);
    const pucViaCogs = round2(viaPuc.filter(t => C.idOf(t.key.project) === key && typeOf(t.accountId) !== 'revenue').reduce((s, t) => s + t.periodDebit - t.periodCredit, 0));
    const pucActual = p ? round2((positions.get(key) || []).reduce((s, r) => s + r.actual, 0)) : 0;
    const actualCost = round2(pucActual + (totalCost - pucViaCogs));
    const estimatedCost = p && (p.averageCostLines || []).length ? round2(p.averageCost || [...estimates.values()].reduce((s, v) => s + v, 0)) : null;
    const contract = typeof p?.contractValue === 'number' ? p.contractValue : null;

    summaryRows.push({
      ...(p ? projectCells(p) : { projectNumber: NOT_LINKED.en, projectNumberAr: NOT_LINKED.ar, _rowType: 'muted' }),
      contractValue: contract,
      revenue,
      directCost: direct,
      indirectCost: indirect,
      totalCost,
      grossProfit: round2(revenue - cogs),
      netProfit: round2(revenue - totalCost),
      margin: C.pct(round2(revenue - totalCost), revenue),
      actualCost,
      actualProfit: round2(revenue - actualCost),
      estimatedCost,
      estimatedProfit: contract !== null && estimatedCost !== null ? round2(contract - estimatedCost) : null,
    });

    // Every revenue and cost account of the project, with its estimate and variance.
    const seen = new Set();
    for (const t of [...rev, ...cost]) {
      const account = accounts.get(t.accountId);
      if (!account) continue;
      if (accountId && String(account._id) !== String(accountId)) continue;
      seen.add(t.accountId);
      const isRevenue = account.type === 'revenue';
      const amount = isRevenue ? round2(t.periodCredit - t.periodDebit) : amountOf(t);
      const estimate = estimates.has(t.accountId) ? estimates.get(t.accountId) : null;
      accountRows.push({
        projectNumber: p ? p.projectNumber : NOT_LINKED.en,
        projectNumberAr: p ? p.projectNumber : NOT_LINKED.ar,
        section: isRevenue ? 'Revenue' : costGroup(account) === 'direct' ? 'Direct cost' : 'Indirect cost',
        sectionAr: isRevenue ? 'إيرادات' : costGroup(account) === 'direct' ? 'تكلفة مباشرة' : 'تكلفة غير مباشرة',
        accountCode: account.code,
        accountName: account.name,
        accountNameAr: account.nameAr || null,
        amount,
        estimate,
        variance: estimate === null ? null : round2(estimate - amount),
        _links: p ? { projectNumber: { kind: 'project', id: String(p._id) } } : {},
      });
    }
    // Estimated cost accounts with no posted cost yet still show their estimate.
    for (const [id, estimate] of estimates) {
      if (seen.has(id) || (accountId && id !== String(accountId))) continue;
      const account = accounts.get(id);
      if (!account) continue;
      accountRows.push({ projectNumber: p.projectNumber, projectNumberAr: p.projectNumber, section: 'Direct cost', sectionAr: 'تكلفة مباشرة', accountCode: account.code, accountName: account.name, accountNameAr: account.nameAr || null, amount: 0, estimate, variance: estimate, _links: { projectNumber: { kind: 'project', id: String(p._id) } } });
    }
  }

  // Drill-down: the ledger lines behind the figures (one project, or every project when filtered).
  const projectIds = new Set(projects.map(p => String(p._id)));
  const { entries, truncated } = await C.ledgerEntries({ start: period.start, end: period.end, entryMatch: { 'lines.account': { $in: accountId ? [accountId] : plIds } } });
  const sourceOf = await sourceDocuments(entries);
  const plSet = new Set(plIds.map(String));
  const lines = [];
  for (const entry of entries) {
    entry.lines.forEach(line => {
      const id = C.idOf(line.account);
      const project = C.idOf(line.project);
      if (!plSet.has(id) || (accountId && id !== String(accountId))) return;
      if (filtered ? !(project && projectIds.has(project)) : project && !projectIds.has(project)) return;
      const account = accounts.get(id);
      const p = projects.find(x => String(x._id) === project);
      const module = entry.reversalOfEntry ? 'Reversal' : entry.module || (entry.accountingAction ? null : 'Manual');
      const label = SOURCE_LABELS[module] || (module ? L(module, module) : null);
      lines.push({
        date: entry.date,
        entryNumber: entry.entryNumber,
        projectNumber: p?.projectNumber || NOT_LINKED.en,
        accountCode: account?.code,
        accountName: account?.name,
        accountNameAr: account?.nameAr || null,
        description: line.description || entry.description || null,
        sourceType: label?.en || null,
        sourceTypeAr: label?.ar || null,
        sourceNumber: sourceOf(entry),
        revenue: account?.type === 'revenue' ? round2((line.credit || 0) - (line.debit || 0)) : null,
        cost: account?.type !== 'revenue' ? round2((line.debit || 0) - (line.credit || 0)) : null,
        _links: { entryNumber: { kind: 'journalEntry', id: String(entry._id) }, ...(p ? { projectNumber: { kind: 'project', id: String(p._id) } } : {}) },
      });
    });
  }

  const sum = key => C.sumBy(summaryRows, key);
  const totals2 = { revenue: sum('revenue'), directCost: sum('directCost'), indirectCost: sum('indirectCost'), totalCost: sum('totalCost'), grossProfit: sum('grossProfit'), netProfit: sum('netProfit'), actualCost: sum('actualCost'), actualProfit: sum('actualProfit') };
  const pl = filtered ? null : await C.balancesByAccount({ start: period.start, end: period.end });
  const ledgerProfit = pl ? C.profitFrom(pl, accounts) : null;

  return {
    period,
    summary: [
      summaryItem('revenue', 'Recognized revenue', 'الإيرادات المثبتة', totals2.revenue),
      summaryItem('totalCost', 'Total project costs', 'إجمالي تكاليف المشروعات', totals2.totalCost),
      summaryItem('grossProfit', 'Gross profit', 'مجمل الربح', totals2.grossProfit),
      summaryItem('netProfit', 'Net project profit', 'صافي ربح المشروعات', totals2.netProfit),
      summaryItem('margin', 'Profit margin', 'هامش الربح', C.pct(totals2.netProfit, totals2.revenue), 'percent'),
      summaryItem('actualProfit', 'Profit on actual costs', 'الربح على التكاليف الفعلية', totals2.actualProfit),
    ],
    checks: [
      ...(ledgerProfit === null ? [] : [check('Net profit of all projects (and unlinked lines) equals the Statement of Profit or Loss', 'صافي ربح كل المشروعات (والسطور غير المرتبطة) يساوي قائمة الدخل', totals2.netProfit === ledgerProfit, `${totals2.netProfit} / ${ledgerProfit}`)]),
      ...(accountId ? [] : [check('Detail lines add up to the project revenue and costs', 'تفاصيل السطور تساوي إيرادات وتكاليف المشروعات', !truncated && C.sumBy(lines, 'revenue') === totals2.revenue && C.sumBy(lines, 'cost') === totals2.totalCost, `${C.sumBy(lines, 'revenue')} / ${totals2.revenue} · ${C.sumBy(lines, 'cost')} / ${totals2.totalCost}`)]),
    ],
    sections: [
      {
        key: 'projects',
        title: L('Project Profitability Summary', 'ملخص ربحية المشروعات'),
        paginate: true,
        columns: [
          col('projectNumber', 'Project No.', 'رقم المشروع'),
          col('projectName', 'Project', 'المشروع'),
          col('customer', 'Customer', 'العميل'),
          money('contractValue', 'Contract Value', 'قيمة العقد'),
          money('revenue', 'Recognized Revenue', 'الإيرادات المثبتة'),
          money('directCost', 'Direct Costs', 'تكاليف مباشرة'),
          money('indirectCost', 'Indirect Costs', 'تكاليف غير مباشرة'),
          money('totalCost', 'Total Costs', 'إجمالي التكاليف'),
          money('grossProfit', 'Gross Profit', 'مجمل الربح'),
          money('netProfit', 'Net Profit / Loss', 'صافي الربح / الخسارة'),
          col('margin', 'Margin', 'الهامش', 'percent'),
          money('actualCost', 'Actual Costs Incurred', 'التكاليف الفعلية'),
          money('actualProfit', 'Profit on Actual Costs', 'الربح على التكاليف الفعلية'),
          money('estimatedCost', 'Estimated Cost', 'التكلفة التقديرية'),
          money('estimatedProfit', 'Estimated Profit', 'الربح التقديري'),
        ],
        rows: summaryRows,
        totals: { projectNumber: 'Total', projectNumberAr: 'الإجمالي', contractValue: sum('contractValue'), ...totals2, margin: C.pct(totals2.netProfit, totals2.revenue), estimatedCost: sum('estimatedCost'), estimatedProfit: sum('estimatedProfit') },
      },
      {
        key: 'accounts',
        title: L('Revenue and Costs by Account', 'الإيرادات والتكاليف حسب الحساب'),
        paginate: true,
        columns: [
          col('projectNumber', 'Project', 'المشروع'),
          col('section', 'Section', 'القسم', 'status'),
          col('accountCode', 'Account No.', 'رقم الحساب'),
          col('accountName', 'Account', 'الحساب', 'account'),
          money('amount', 'Actual Posted', 'الفعلي المرحل'),
          money('estimate', 'Estimated Cost', 'التكلفة التقديرية'),
          money('variance', 'Variance (Estimate - Actual)', 'الفرق (التقدير - الفعلي)'),
        ],
        rows: accountRows,
        totals: null,
      },
      {
        key: 'transactions',
        title: L('Supporting Transactions', 'الحركات المؤيدة'),
        paginate: true,
        columns: [
          col('date', 'Date', 'التاريخ', 'date'),
          col('entryNumber', 'Entry No.', 'رقم القيد'),
          col('projectNumber', 'Project', 'المشروع'),
          col('accountCode', 'Account No.', 'رقم الحساب'),
          col('accountName', 'Account', 'الحساب', 'account'),
          col('description', 'Description', 'البيان'),
          col('sourceType', 'Source Document', 'نوع المستند', 'status'),
          col('sourceNumber', 'Document No.', 'رقم المستند'),
          money('revenue', 'Revenue', 'إيراد'),
          money('cost', 'Cost', 'تكلفة'),
        ],
        rows: lines,
        totals: { date: null, entryNumber: 'Total', entryNumberAr: 'الإجمالي', revenue: C.sumBy(lines, 'revenue'), cost: C.sumBy(lines, 'cost') },
      },
    ],
    notes: [
      note(
        'From the ledger for the period (posted entries, including reversed ones with their reversals; drafts excluded). Revenue = credits less debits on revenue accounts tagged with the project, excluding VAT and withholding (posted to their own accounts). Costs = every cost-of-sales and expense account tagged with the project: cost of sales and expenses classified "direct" are direct costs, other expenses indirect. Gross profit = revenue - cost of sales; net profit = revenue - all costs; margin = net profit / revenue (n/a without revenue). Cost of sales of a project is recognized from its estimate x executed % (PUC), so "Actual costs incurred" replaces it with the actual PUC costs: profit on actual costs = revenue - (actual PUC costs + costs not routed through PUC). Estimated profit = contract value - estimated cost (Average Cost). Depreciation and other costs are included for a project only when their lines carry it - unassigned depreciation appears under "Not linked to a project".',
        'من دفتر الأستاذ للفترة (القيود المرحلة بما فيها المعكوسة مع قيودها العكسية؛ دون المسودات). الإيرادات = الدائن ناقص المدين في حسابات الإيرادات المرتبطة بالمشروع، دون ضريبة القيمة المضافة والخصم (مرحلة لحساباتها). التكاليف = كل حسابات تكلفة المبيعات والمصروفات المرتبطة بالمشروع: تكلفة المبيعات والمصروفات المصنفة "مباشرة" تكاليف مباشرة، وباقي المصروفات غير مباشرة. مجمل الربح = الإيرادات - تكلفة المبيعات؛ صافي الربح = الإيرادات - كل التكاليف؛ الهامش = صافي الربح / الإيرادات (غير متاح بدون إيرادات). تكلفة مبيعات المشروع تُحمل من التقدير × نسبة التنفيذ (مشروعات تحت التنفيذ)، لذا "التكاليف الفعلية" تستبدلها بالتكاليف الفعلية: الربح على التكاليف الفعلية = الإيرادات - (تكاليف مشروعات تحت التنفيذ الفعلية + التكاليف التي لم تمر بها). الربح التقديري = قيمة العقد - التكلفة التقديرية. الإهلاك وغيره يدخل في المشروع فقط إذا حملت سطوره المشروع - والإهلاك غير المخصص يظهر في "غير مرتبط بمشروع".'
      ),
    ],
  };
}

module.exports = { pucEstimates, projectProfitAnalysis };
