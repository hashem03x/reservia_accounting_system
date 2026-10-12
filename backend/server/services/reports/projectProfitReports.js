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

// ============================================================ 2. Project profit analysis - revenue less every cost
/**
 * Project Profit Analysis - revenue less costs, per project: the project's revenue, then every cost
 * account charged to it on its own line (whatever the Chart of Accounts holds: materials, labour,
 * design, depreciation, rent ...), their total, and the result = revenue - total costs (a profit when
 * positive, a loss when negative). Nothing else: no margins or estimates.
 *
 * From the posted ledger only (posted entries and entries later reversed together with their
 * reversals; drafts never count), on the project tagged on each line - so a document and the journal
 * entry it produced are never both counted. Revenue = credits less debits on revenue accounts (VAT and
 * withholding sit in their own accounts). A cost = debits less credits on a cost of sales or expense
 * account. PUC (projects under construction) is an asset, so project purchases count as cost once,
 * when they are recognized in cost of sales. Lines without a project are shown on their own row (when
 * no project filter is set), so the report adds up to the Statement of Profit or Loss.
 */
async function projectProfitAnalysis(query) {
  const period = C.resolvePeriod(query);
  const accounts = await C.loadAccounts();
  const projects = await loadProjects(query);
  const filtered = !!(query.projectStatus || query.sector || query.customer || query.project);
  const plIds = [...accounts.values()].filter(a => C.PROFIT_AND_LOSS_TYPES.has(a.type)).map(a => a._id);
  const totals = await C.ledgerTotals({ start: period.start, end: period.end, lineMatch: { 'lines.account': { $in: plIds } }, groupBy: { project: '$lines.project' } });

  const summaryRows = [];
  const breakdownRows = [];
  const keys = filtered ? projects.map(p => String(p._id)) : [...projects.map(p => String(p._id)), null];
  for (const key of keys) {
    const p = projects.find(x => String(x._id) === key) || null;
    const mine = totals.filter(t => C.idOf(t.key.project) === key);
    if (!p && !mine.length) continue;
    const revenue = round2(mine.filter(t => accounts.get(t.accountId)?.type === 'revenue').reduce((sum, t) => sum + t.periodCredit - t.periodDebit, 0));
    const costs = C.sortAccountsByCode(
      mine
        .filter(t => accounts.get(t.accountId) && accounts.get(t.accountId).type !== 'revenue')
        .map(t => ({ account: accounts.get(t.accountId), amount: round2(t.periodDebit - t.periodCredit) }))
        .filter(c => c.amount !== 0),
      c => c.account.code
    );
    const totalCost = C.sumBy(costs, 'amount');
    const net = round2(revenue - totalCost);
    const result = net > 0 ? L('Profit', 'ربح') : net < 0 ? L('Loss', 'خسارة') : L('Break-even', 'تعادل');
    const cells = p ? projectCells(p) : { projectNumber: NOT_LINKED.en, projectNumberAr: NOT_LINKED.ar, _rowType: 'muted' };
    summaryRows.push({ projectNumber: cells.projectNumber, projectNumberAr: cells.projectNumberAr, projectName: cells.projectName ?? null, customer: cells.customer ?? null, revenue, totalCost, net, result: result.en, resultAr: result.ar, _rowType: cells._rowType, _links: cells._links });

    const title = p ? `${p.projectNumber}${p.name ? ` - ${p.name}` : ''}` : null;
    breakdownRows.push({ _rowType: 'header', name: title || NOT_LINKED.en, nameAr: title || NOT_LINKED.ar });
    breakdownRows.push({ item: 'Total revenue', itemAr: 'إجمالي الإيرادات', amount: revenue, _rowType: 'subtotal' });
    costs.forEach(c => breakdownRows.push({ item: c.account.name, itemAr: c.account.nameAr || c.account.name, accountCode: c.account.code, amount: c.amount }));
    breakdownRows.push({ item: 'Total costs', itemAr: 'إجمالي التكاليف', amount: totalCost, _rowType: 'subtotal' });
    breakdownRows.push({ item: `Net result (${result.en.toLowerCase()})`, itemAr: `صافي النتيجة (${result.ar})`, amount: net, _rowType: 'total' });
  }

  // One project selected: the journal entry lines behind its figures (drill-down to the entry).
  const lines = [];
  let truncated = false;
  if (query.project && projects.length === 1) {
    const [p] = projects;
    const ledger = await C.ledgerEntries({ start: period.start, end: period.end, entryMatch: { 'lines.project': p._id, 'lines.account': { $in: plIds } } });
    truncated = ledger.truncated;
    const sourceOf = await sourceDocuments(ledger.entries);
    const plSet = new Set(plIds.map(String));
    for (const entry of ledger.entries) {
      for (const line of entry.lines) {
        const id = C.idOf(line.account);
        if (!plSet.has(id) || C.idOf(line.project) !== String(p._id)) continue;
        const account = accounts.get(id);
        const module = entry.reversalOfEntry ? 'Reversal' : entry.module || (entry.accountingAction ? null : 'Manual');
        const label = SOURCE_LABELS[module] || (module ? L(module, module) : null);
        lines.push({
          date: entry.date,
          entryNumber: entry.entryNumber,
          accountCode: account?.code,
          accountName: account?.name,
          accountNameAr: account?.nameAr || null,
          description: line.description || entry.description || null,
          sourceType: label?.en || null,
          sourceTypeAr: label?.ar || null,
          sourceNumber: sourceOf(entry),
          revenue: account?.type === 'revenue' ? round2((line.credit || 0) - (line.debit || 0)) : null,
          cost: account?.type !== 'revenue' ? round2((line.debit || 0) - (line.credit || 0)) : null,
          _links: { entryNumber: { kind: 'journalEntry', id: String(entry._id) } },
        });
      }
    }
  }

  const sum = key => C.sumBy(summaryRows, key);
  const total = { revenue: sum('revenue'), totalCost: sum('totalCost'), net: sum('net') };
  const pl = filtered ? null : await C.balancesByAccount({ start: period.start, end: period.end });
  const ledgerProfit = pl ? C.profitFrom(pl, accounts) : null;
  const shownCosts = C.sumBy(breakdownRows.filter(r => r.accountCode), 'amount');

  return {
    period,
    summary: [
      summaryItem('revenue', 'Total revenue', 'إجمالي الإيرادات', total.revenue),
      summaryItem('totalCost', 'Total costs', 'إجمالي التكاليف', total.totalCost),
      summaryItem('net', 'Net result (revenue - costs)', 'صافي النتيجة (الإيرادات - التكاليف)', total.net),
    ],
    checks: [
      check('Total costs = the sum of the cost lines shown', 'إجمالي التكاليف = مجموع بنود التكاليف المعروضة', shownCosts === total.totalCost, `${shownCosts} / ${total.totalCost}`),
      ...(ledgerProfit === null ? [] : [check('Net result of all projects (and unlinked lines) equals the Statement of Profit or Loss', 'صافي نتيجة كل المشروعات (والسطور غير المرتبطة) يساوي قائمة الدخل', total.net === ledgerProfit, `${total.net} / ${ledgerProfit}`)]),
      ...(lines.length || truncated ? [check('Transactions add up to the project figures', 'الحركات تساوي أرقام المشروع', !truncated && C.sumBy(lines, 'revenue') === total.revenue && C.sumBy(lines, 'cost') === total.totalCost, `${C.sumBy(lines, 'revenue')} / ${total.revenue} · ${C.sumBy(lines, 'cost')} / ${total.totalCost}`)] : []),
    ],
    sections: [
      {
        key: 'projects',
        title: L('Revenue - Costs by Project', 'الإيرادات - التكاليف لكل مشروع'),
        paginate: true,
        columns: [
          col('projectNumber', 'Project No.', 'رقم المشروع'),
          col('projectName', 'Project', 'المشروع'),
          col('customer', 'Customer', 'العميل'),
          money('revenue', 'Total Revenue', 'إجمالي الإيرادات'),
          money('totalCost', 'Total Costs', 'إجمالي التكاليف'),
          money('net', 'Net Result', 'صافي النتيجة'),
          col('result', 'Profit / Loss', 'ربح / خسارة', 'status'),
        ],
        rows: summaryRows,
        totals: { projectNumber: 'Total', projectNumberAr: 'الإجمالي', ...total },
      },
      {
        key: 'breakdown',
        title: L('Revenue and Each Cost', 'الإيرادات وكل بند من التكاليف'),
        columns: [col('item', 'Item', 'البند', 'account'), col('accountCode', 'Account No.', 'رقم الحساب'), money('amount', 'Amount', 'المبلغ')],
        rows: breakdownRows,
        totals: null,
      },
      ...(query.project
        ? [
            {
              key: 'transactions',
              title: L('Supporting Transactions', 'الحركات المؤيدة'),
              paginate: true,
              columns: [
                col('date', 'Date', 'التاريخ', 'date'),
                col('entryNumber', 'Entry No.', 'رقم القيد'),
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
          ]
        : []),
    ],
    notes: [
      note(
        'Net result = total revenue - total costs; a positive result is a profit and a negative one a loss. From the posted ledger for the period (reversed entries count together with their reversals, so they net to zero; drafts never count), using the project on each journal line. Revenue = credits less debits on the revenue accounts (VAT and withholding are in their own accounts). Each cost line is one cost of sales or expense account charged to the project - including depreciation when it is charged to the project. Purchases for a project count once, when they are recognized in cost of sales. Select one project to see the transactions behind its figures.',
        'صافي النتيجة = إجمالي الإيرادات - إجمالي التكاليف؛ النتيجة الموجبة ربح والسالبة خسارة. من القيود المرحلة في دفتر الأستاذ للفترة (القيود المعكوسة تُحتسب مع قيودها العكسية فيصبح أثرها صفراً؛ المسودات لا تُحتسب)، حسب المشروع المسجل على كل سطر من سطور القيد. الإيرادات = الدائن ناقص المدين في حسابات الإيرادات (ضريبة القيمة المضافة والخصم في حساباتها). كل بند تكلفة هو حساب تكلفة مبيعات أو مصروف محمل على المشروع - ومنها الإهلاك إذا حُمل على المشروع. مشتريات المشروع تُحتسب مرة واحدة عند تحميلها على تكلفة المبيعات. اختر مشروعاً واحداً لعرض الحركات المؤيدة لأرقامه.'
      ),
    ],
  };
}

module.exports = { pucEstimates, projectProfitAnalysis };
