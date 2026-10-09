const Project = require('../../models/project/projectModel');
const Sector = require('../../models/project/sectorModel');
const { ProjectStatuses } = require('../../utils/accountingConstants');
const { computeProjectExecution } = require('../../utils/projectExecution');
const C = require('./reportCommon');
const { cashMovements } = require('./financialStatements');

const { round2, col, check, note, summaryItem, L } = C;

const STATUS_LABELS = {
  active: L('Active', 'نشط'),
  completed: L('Completed', 'مكتمل'),
  cancelled: L('Cancelled', 'ملغي'),
  on_hold: L('On Hold', 'متوقف'),
};
const UNASSIGNED_SECTOR = L('No sector', 'بدون سيكتور');
const NOT_LINKED = L('Not linked to a project', 'غير مرتبط بمشروع');

/** Projects (soft-deleted ones excluded by the model) matching the shared project filters. */
async function loadProjects(query = {}) {
  const filter = {};
  const status = C.enumParam(query.projectStatus, 'project status', ProjectStatuses);
  if (status) filter.status = status;
  if (query.sector === '__none__') filter.sector = { $in: [null, ''] };
  else if (query.sector) filter.sector = String(query.sector);
  const customer = C.objectIdParam(query.customer, 'customer');
  if (customer) filter.customer = customer;
  const project = C.objectIdParam(query.project, 'project');
  if (project) filter._id = project;
  return Project.find(filter).sort({ projectNumber: 1 }).lean();
}

const projectCells = p => ({
  projectNumber: p.projectNumber,
  projectName: p.name || null,
  customer: p.customer ? `${p.customer.customerNumber != null ? `${p.customer.customerNumber} - ` : ''}${p.customer.name || ''}` : null,
  sector: p.sector || null,
  _links: { projectNumber: { kind: 'project', id: String(p._id) }, ...(p.customer?._id ? { customer: { kind: 'customer', id: String(p.customer._id) } } : {}) },
});

// ---------------------------------------------------------------- 7. Projects and their status
async function projectsStatus(query) {
  const projects = await loadProjects(query);
  const rows = projects.map(p => {
    const execution = computeProjectExecution(p);
    return {
      ...projectCells(p),
      projectManager: p.projectManager?.name || null,
      contractValue: typeof p.contractValue === 'number' ? p.contractValue : null,
      executedPercentage: typeof p.executedPercentage === 'number' ? p.executedPercentage : null,
      executedAmount: execution ? execution.executedAmount : null,
      remainingAmount: execution ? execution.remainingMoney : null,
      status: STATUS_LABELS[p.status]?.en || p.status || null,
      statusAr: STATUS_LABELS[p.status]?.ar || p.status || null,
      startDate: p.startDate || null,
      deliveryDate: p.deliveryDate || null,
    };
  });
  return {
    summary: [summaryItem('projects', 'Projects', 'عدد المشروعات', rows.length, 'number'), summaryItem('contractValue', 'Total contract value', 'إجمالي قيمة العقود', C.sumBy(rows, 'contractValue'))],
    checks: [],
    sections: [
      {
        key: 'projects',
        title: L('Projects', 'المشروعات'),
        paginate: true,
        columns: [
          col('projectNumber', 'Project No.', 'رقم المشروع'),
          col('projectName', 'Project', 'المشروع'),
          col('customer', 'Customer', 'العميل'),
          col('sector', 'Sector', 'السيكتور'),
          col('projectManager', 'Project Manager', 'مدير المشروع'),
          col('contractValue', 'Contract Value', 'قيمة العقد', 'money'),
          col('executedPercentage', 'Executed %', 'نسبة التنفيذ', 'percent'),
          col('executedAmount', 'Executed Amount', 'قيمة المنفذ', 'money'),
          col('remainingAmount', 'Remaining Amount', 'المتبقي من العقد', 'money'),
          col('status', 'Status', 'الحالة', 'status'),
          col('startDate', 'Start Date', 'تاريخ البدء', 'date'),
          col('deliveryDate', 'Delivery Date', 'تاريخ التسليم', 'date'),
        ],
        rows,
        totals: { projectNumber: 'Total', projectNumberAr: 'الإجمالي', contractValue: C.sumBy(rows, 'contractValue'), executedAmount: C.sumBy(rows, 'executedAmount'), remainingAmount: C.sumBy(rows, 'remainingAmount') },
      },
    ],
    notes: [
      note(
        'Executed Amount = Contract Value × Executed % and Remaining = Contract Value − Executed Amount (the project module\'s own calculation; Executed % comes from the project\'s Sales Orders). Projects without a contract value show "n/a".',
        'قيمة المنفذ = قيمة العقد × نسبة التنفيذ، والمتبقي = قيمة العقد − قيمة المنفذ (نفس حساب وحدة المشروعات؛ ونسبة التنفيذ ناتجة عن أوامر بيع المشروع). المشروعات بدون قيمة عقد تظهر "غير متاح".'
      ),
    ],
  };
}

// ---------------------------------------------------------------- 8. Number of projects by status
async function projectsByStatus(query) {
  const projects = await loadProjects({ ...query, projectStatus: undefined });
  const counts = new Map();
  projects.forEach(p => counts.set(p.status || 'unknown', (counts.get(p.status || 'unknown') || 0) + 1));
  const total = projects.length;
  const rows = [...ProjectStatuses, ...[...counts.keys()].filter(s => !ProjectStatuses.includes(s))].map(status => ({
    status: STATUS_LABELS[status]?.en || status,
    statusAr: STATUS_LABELS[status]?.ar || status,
    count: counts.get(status) || 0,
    share: C.pct(counts.get(status) || 0, total),
  }));
  return {
    summary: [summaryItem('projects', 'Projects', 'عدد المشروعات', total, 'number')],
    checks: [check('Counts add up to all projects', 'مجموع الأعداد = كل المشروعات', C.sumBy(rows, 'count') === total)],
    chart: { labelKey: 'status', valueKey: 'count' },
    sections: [
      {
        key: 'statuses',
        title: L('Projects by Status', 'المشروعات حسب الحالة'),
        columns: [col('status', 'Status', 'الحالة', 'status'), col('count', 'Projects', 'عدد المشروعات', 'number'), col('share', 'Share', 'النسبة', 'percent')],
        rows,
        totals: { status: 'Total', statusAr: 'الإجمالي', count: total, share: total ? 100 : null },
      },
    ],
    notes: [],
  };
}

// ---------------------------------------------------------------- project ledger figures
/**
 * Revenue / cost of sales / other expenses of each project from the ledger lines tagged with that
 * project in the window (revenue = credit - debit on revenue accounts; cost of sales = debit -
 * credit on cogs accounts; other expenses = debit - credit on expense accounts). Lines without a
 * project are returned under key null, so the totals reconcile with the Statement of Profit or Loss.
 */
async function projectLedgerFigures(period) {
  const accounts = await C.loadAccounts();
  const totals = await C.ledgerTotals({ start: period.start, end: period.end, groupBy: { project: '$lines.project' } });
  const figures = new Map();
  for (const t of totals) {
    const account = accounts.get(t.accountId);
    const type = account?.type;
    if (C.PROFIT_AND_LOSS_TYPES.has(type)) {
      const key = C.idOf(t.key.project);
      if (!figures.has(key)) figures.set(key, { revenue: 0, costOfSales: 0, otherExpenses: 0 });
      const f = figures.get(key);
      if (type === 'revenue') f.revenue = round2(f.revenue + t.periodCredit - t.periodDebit);
      if (type === 'cogs') f.costOfSales = round2(f.costOfSales + t.periodDebit - t.periodCredit);
      if (type === 'expense') f.otherExpenses = round2(f.otherExpenses + t.periodDebit - t.periodCredit);
    }
  }
  return figures;
}

const profitCells = f => {
  const grossProfit = round2(f.revenue - f.costOfSales);
  return { revenue: f.revenue, costOfSales: f.costOfSales, grossProfit, grossMargin: C.pct(grossProfit, f.revenue), otherExpenses: f.otherExpenses, contribution: round2(grossProfit - f.otherExpenses) };
};
const profitColumns = () => [
  col('revenue', 'Revenue (excl. taxes)', 'الإيرادات (بدون ضرائب)', 'money'),
  col('costOfSales', 'Cost of Sales', 'تكلفة المبيعات', 'money'),
  col('grossProfit', 'Gross Profit', 'مجمل الربح', 'money'),
  col('grossMargin', 'Gross Margin', 'نسبة مجمل الربح', 'percent'),
  col('otherExpenses', 'Other Project Expenses', 'مصروفات أخرى للمشروع', 'money'),
  col('contribution', 'Project Contribution', 'مساهمة المشروع', 'money'),
];
const profitTotals = rows => {
  const t = { revenue: C.sumBy(rows, 'revenue'), costOfSales: C.sumBy(rows, 'costOfSales'), otherExpenses: C.sumBy(rows, 'otherExpenses') };
  return profitCells(t);
};
const profitNotes = () => [
  note(
    'From the ledger, for the selected period: revenue is the project-tagged revenue lines (Sales Order revenue recognition, excluding VAT and withholding tax); cost of sales is the project-tagged cost-of-sales lines (the project cost entry loaded from the project\'s Average Cost × Executed %). Contract value, Sales Order totals and Purchase Orders are not used as revenue or cost. Costs still held in Projects Under Construction (WIP) are not yet cost of sales.',
    'من دفتر الأستاذ للفترة المحددة: الإيرادات هي سطور الإيرادات المرتبطة بالمشروع (إثبات إيراد أوامر البيع بدون ضريبة القيمة المضافة والخصم)؛ وتكلفة المبيعات هي سطور تكلفة المبيعات المرتبطة بالمشروع (قيد تحميل التكاليف من متوسط تكلفة المشروع × نسبة التنفيذ). لا تُستخدم قيمة العقد ولا إجمالي أوامر البيع ولا أوامر الشراء كإيراد أو تكلفة. التكاليف التي ما زالت في مشروعات تحت التنفيذ لم تصبح تكلفة مبيعات بعد.'
  ),
];

// ---------------------------------------------------------------- 9. Profitability of each project
async function projectProfitability(query) {
  const period = C.resolvePeriod(query);
  const [projects, figures] = await Promise.all([loadProjects(query), projectLedgerFigures(period)]);
  const filtered = !!(query.projectStatus || query.sector || query.customer || query.project);
  const rows = projects.map(p => ({ ...projectCells(p), contractValue: typeof p.contractValue === 'number' ? p.contractValue : null, ...profitCells(figures.get(String(p._id)) || { revenue: 0, costOfSales: 0, otherExpenses: 0 }) }));
  if (!filtered && figures.has(null)) rows.push({ projectNumber: NOT_LINKED.en, projectNumberAr: NOT_LINKED.ar, _rowType: 'muted', ...profitCells(figures.get(null)) });
  const totals = profitTotals(rows);
  return {
    period,
    summary: [summaryItem('revenue', 'Revenue', 'الإيرادات', totals.revenue), summaryItem('grossProfit', 'Gross profit', 'مجمل الربح', totals.grossProfit), summaryItem('grossMargin', 'Gross margin', 'نسبة مجمل الربح', totals.grossMargin, 'percent')],
    checks: [],
    sections: [
      {
        key: 'projects',
        title: L('Project Profitability', 'ربحية المشروعات'),
        paginate: true,
        columns: [col('projectNumber', 'Project No.', 'رقم المشروع'), col('projectName', 'Project', 'المشروع'), col('customer', 'Customer', 'العميل'), col('sector', 'Sector', 'السيكتور'), col('contractValue', 'Contract Value', 'قيمة العقد', 'money'), ...profitColumns()],
        rows,
        totals: { projectNumber: 'Total', projectNumberAr: 'الإجمالي', contractValue: C.sumBy(rows, 'contractValue'), ...totals },
      },
    ],
    notes: [...profitNotes(), ...(filtered ? [] : [note('The "Not linked to a project" row holds P&L lines without a project, so the totals equal the Statement of Profit or Loss.', 'صف "غير مرتبط بمشروع" يضم سطور الأرباح والخسائر بدون مشروع، فتتساوى الإجماليات مع قائمة الدخل.')])],
  };
}

// ---------------------------------------------------------------- project cash flows
/**
 * Cash in / out of each project in the window: the Cash / Cash Equivalent lines of the ledger
 * entries touching cash, by the line's project (every line of a project entry carries it).
 * Internal transfers (cash-only entries) are excluded; applying an advance against an order has
 * no cash line, so only the advance's own receipt/payment counts.
 */
async function projectCashFigures(period) {
  const accounts = await C.loadAccounts();
  const { entries, truncated, isCash } = await cashMovements(period, accounts);
  const figures = new Map();
  for (const entry of entries) {
    if (entry.lines.some(l => !isCash(l.account))) {
      for (const line of entry.lines.filter(l => isCash(l.account))) {
        const key = C.idOf(line.project);
        if (!figures.has(key)) figures.set(key, { inflow: 0, outflow: 0 });
        const f = figures.get(key);
        f.inflow = round2(f.inflow + (line.debit || 0));
        f.outflow = round2(f.outflow + (line.credit || 0));
      }
    }
  }
  return { figures, truncated };
}
const cashCells = f => ({ inflow: f.inflow, outflow: f.outflow, net: round2(f.inflow - f.outflow) });
const cashColumns = () => [col('inflow', 'Cash In', 'التدفقات الداخلة', 'money'), col('outflow', 'Cash Out', 'التدفقات الخارجة', 'money'), col('net', 'Net Cash Flow', 'صافي التدفق النقدي', 'money')];
const cashNotes = () => [
  note(
    'Actual cash only: the Cash / Cash Equivalent lines of posted entries, by project. Unpaid Sales/Purchase Orders are not cash. An advance counts once, when it is received or paid - applying it to an order moves no cash. Transfers between cash/bank accounts are excluded.',
    'النقدية الفعلية فقط: سطور حسابات النقدية وما في حكمها في القيود المرحلة حسب المشروع. أوامر البيع والشراء غير المدفوعة ليست نقدية. الدفعة المقدمة تُحتسب مرة واحدة عند استلامها أو دفعها - تطبيقها على أمر لا يحرك نقدية. التحويلات بين حسابات النقدية والبنوك مستبعدة.'
  ),
];

// ---------------------------------------------------------------- 10. Cash flows by project
async function projectCashFlows(query) {
  const period = C.resolvePeriod(query);
  const [projects, { figures, truncated }] = await Promise.all([loadProjects(query), projectCashFigures(period)]);
  const filtered = !!(query.projectStatus || query.sector || query.customer || query.project);
  const rows = projects.map(p => ({ ...projectCells(p), ...cashCells(figures.get(String(p._id)) || { inflow: 0, outflow: 0 }) }));
  if (!filtered && figures.has(null)) rows.push({ projectNumber: NOT_LINKED.en, projectNumberAr: NOT_LINKED.ar, _rowType: 'muted', ...cashCells(figures.get(null)) });
  const totals = { inflow: C.sumBy(rows, 'inflow'), outflow: C.sumBy(rows, 'outflow'), net: C.sumBy(rows, 'net') };
  return {
    period,
    summary: [summaryItem('inflow', 'Cash in', 'التدفقات الداخلة', totals.inflow), summaryItem('outflow', 'Cash out', 'التدفقات الخارجة', totals.outflow), summaryItem('net', 'Net cash flow', 'صافي التدفق', totals.net)],
    checks: truncated ? [check('All cash entries included', 'تم تضمين كل قيود النقدية', false, `limited to ${C.MAX_DETAIL_ROWS}`)] : [],
    sections: [
      {
        key: 'projects',
        title: L('Cash Flows by Project', 'التدفقات النقدية لكل مشروع'),
        paginate: true,
        columns: [col('projectNumber', 'Project No.', 'رقم المشروع'), col('projectName', 'Project', 'المشروع'), col('customer', 'Customer', 'العميل'), col('sector', 'Sector', 'السيكتور'), ...cashColumns()],
        rows,
        totals: { projectNumber: 'Total', projectNumberAr: 'الإجمالي', ...totals },
      },
    ],
    notes: [...cashNotes(), ...(filtered ? [] : [note('Without filters, the totals equal the net change in the Cash Flow Statement.', 'بدون فلاتر، تساوي الإجماليات صافي التغير في قائمة التدفقات النقدية.')])],
  };
}

// ---------------------------------------------------------------- sector helpers
async function sectorIndex() {
  const sectors = await Sector.find({}).lean();
  return new Map(sectors.map(s => [String(s.name).toLowerCase(), s]));
}
function sectorRowsFrom(projects, sectors, cellsOf) {
  const groups = new Map();
  for (const p of projects) {
    const key = p.sector ? String(p.sector).toLowerCase() : '';
    if (!groups.has(key)) groups.set(key, { name: p.sector || null, projects: [] });
    groups.get(key).projects.push(p);
  }
  // Sectors with no projects still appear (count 0) - unless a filter narrows the projects.
  for (const s of sectors.values()) if (!groups.has(String(s.name).toLowerCase())) groups.set(String(s.name).toLowerCase(), { name: s.name, projects: [] });
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([key, g]) => {
      const record = sectors.get(key);
      return {
        sector: g.name || UNASSIGNED_SECTOR.en,
        sectorAr: g.name || UNASSIGNED_SECTOR.ar,
        sectorStatus: !g.name ? null : !record ? 'No sector record' : record.isActive === false ? 'Inactive' : 'Active',
        projects: g.projects.length,
        ...cellsOf(g.projects),
      };
    });
}

// ---------------------------------------------------------------- 11. Number of projects by sector
async function projectsBySector(query) {
  const [projects, sectors] = await Promise.all([loadProjects({ ...query, sector: undefined }), sectorIndex()]);
  const rows = sectorRowsFrom(projects, sectors, () => ({}));
  rows.forEach(r => (r.share = C.pct(r.projects, projects.length)));
  return {
    summary: [summaryItem('projects', 'Projects', 'عدد المشروعات', projects.length, 'number'), summaryItem('sectors', 'Sectors', 'عدد السيكتورات', sectors.size, 'number')],
    checks: [check('Counts add up to all projects', 'مجموع الأعداد = كل المشروعات', C.sumBy(rows, 'projects') === projects.length)],
    chart: { labelKey: 'sector', valueKey: 'projects' },
    sections: [
      {
        key: 'sectors',
        title: L('Projects by Sector', 'المشروعات حسب السيكتور'),
        columns: [col('sector', 'Sector', 'السيكتور', 'status'), col('sectorStatus', 'Sector Record', 'حالة السيكتور'), col('projects', 'Projects', 'عدد المشروعات', 'number'), col('share', 'Share', 'النسبة', 'percent')],
        rows,
        totals: { sector: 'Total', sectorAr: 'الإجمالي', projects: projects.length, share: projects.length ? 100 : null },
      },
    ],
    notes: [note('Grouped by the project\'s sector. Projects without a sector, or whose sector has no record, are listed separately.', 'التجميع حسب سيكتور المشروع. المشروعات بدون سيكتور أو التي لا يوجد سجل لسيكتورها تظهر منفصلة.')],
  };
}

// ---------------------------------------------------------------- 12. Profitability by sector
async function sectorProfitability(query) {
  const period = C.resolvePeriod(query);
  const [projects, sectors, figures] = await Promise.all([loadProjects({ ...query, sector: undefined }), sectorIndex(), projectLedgerFigures(period)]);
  const rows = sectorRowsFrom(projects, sectors, list =>
    profitCells(
      list.reduce(
        (sum, p) => {
          const f = figures.get(String(p._id)) || { revenue: 0, costOfSales: 0, otherExpenses: 0 };
          return { revenue: round2(sum.revenue + f.revenue), costOfSales: round2(sum.costOfSales + f.costOfSales), otherExpenses: round2(sum.otherExpenses + f.otherExpenses) };
        },
        { revenue: 0, costOfSales: 0, otherExpenses: 0 }
      )
    )
  );
  const totals = profitTotals(rows);
  return {
    period,
    summary: [summaryItem('revenue', 'Revenue', 'الإيرادات', totals.revenue), summaryItem('grossProfit', 'Gross profit', 'مجمل الربح', totals.grossProfit), summaryItem('grossMargin', 'Gross margin', 'نسبة مجمل الربح', totals.grossMargin, 'percent')],
    checks: [],
    sections: [{ key: 'sectors', title: L('Profitability by Sector', 'ربحية السيكتورات'), columns: [col('sector', 'Sector', 'السيكتور', 'status'), col('projects', 'Projects', 'عدد المشروعات', 'number'), ...profitColumns()], rows, totals: { sector: 'Total', sectorAr: 'الإجمالي', projects: projects.length, ...totals } }],
    notes: [...profitNotes(), note('Each sector is the sum of its projects in the Project Profitability report (same rules), so the two reports reconcile. P&L lines without a project are not part of any sector.', 'كل سيكتور هو مجموع مشروعاته في تقرير ربحية المشروعات (نفس القواعد)، فيتطابق التقريران. سطور الأرباح والخسائر بدون مشروع لا تتبع أي سيكتور.')],
  };
}

// ---------------------------------------------------------------- 13. Cash flows by sector
async function sectorCashFlows(query) {
  const period = C.resolvePeriod(query);
  const [projects, sectors, { figures, truncated }] = await Promise.all([loadProjects({ ...query, sector: undefined }), sectorIndex(), projectCashFigures(period)]);
  const rows = sectorRowsFrom(projects, sectors, list =>
    cashCells(
      list.reduce(
        (sum, p) => {
          const f = figures.get(String(p._id)) || { inflow: 0, outflow: 0 };
          return { inflow: round2(sum.inflow + f.inflow), outflow: round2(sum.outflow + f.outflow) };
        },
        { inflow: 0, outflow: 0 }
      )
    )
  );
  const totals = { inflow: C.sumBy(rows, 'inflow'), outflow: C.sumBy(rows, 'outflow'), net: C.sumBy(rows, 'net') };
  return {
    period,
    summary: [summaryItem('inflow', 'Cash in', 'التدفقات الداخلة', totals.inflow), summaryItem('outflow', 'Cash out', 'التدفقات الخارجة', totals.outflow), summaryItem('net', 'Net cash flow', 'صافي التدفق', totals.net)],
    checks: truncated ? [check('All cash entries included', 'تم تضمين كل قيود النقدية', false, `limited to ${C.MAX_DETAIL_ROWS}`)] : [],
    sections: [{ key: 'sectors', title: L('Cash Flows by Sector', 'التدفقات النقدية لكل سيكتور'), columns: [col('sector', 'Sector', 'السيكتور', 'status'), col('projects', 'Projects', 'عدد المشروعات', 'number'), ...cashColumns()], rows, totals: { sector: 'Total', sectorAr: 'الإجمالي', projects: projects.length, ...totals } }],
    notes: [...cashNotes(), note('Each sector is the sum of its projects in the Cash Flows by Project report (same rules). Cash lines without a project are not part of any sector.', 'كل سيكتور هو مجموع مشروعاته في تقرير التدفقات النقدية لكل مشروع (نفس القواعد). سطور النقدية بدون مشروع لا تتبع أي سيكتور.')],
  };
}

module.exports = {
  projectsStatus,
  projectsByStatus,
  projectProfitability,
  projectCashFlows,
  projectsBySector,
  sectorProfitability,
  sectorCashFlows,
  projectLedgerFigures,
  projectCashFigures,
  loadProjects,
  profitCells,
  profitColumns,
  profitTotals,
  profitNotes,
  NOT_LINKED,
};
