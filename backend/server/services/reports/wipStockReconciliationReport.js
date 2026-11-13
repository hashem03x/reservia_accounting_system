const JournalEntry = require('../../models/accounting/journalEntryModel');
const C = require('./reportCommon');
const { loadProjects } = require('./projectReports');
const { pucAccountsOf, pucCategoryOf } = require('../project/pucAccountService');
const { loadMovements, emptyBalance, addMovement, finishBalance } = require('../inventory/pucMaterialBalanceService');

const { round2, col, check, note, summaryItem, L } = C;

// ERP CHG-01 (12 Nov 2026) - "GL WIP per project equals project stock value". On AGR-0000003 the
// ledger's materials WIP went to -6,700 while the project inventory screen showed 0, because cost
// was relieved twice for the same goods: once by the % executed mechanism (JV0011,
// PROJECT_COST_RECOGNITION, ledger only) and once by the units sold (SALES_PUC_CONSUMPTION, ledger
// and stock ledger together). This report puts the two side by side for every project:
//   - cost added to / relieved from the materials PUC accounts in the ledger (posted entries, the
//     same lines the PUC / Project Cost report uses), relief split by mechanism;
//   - the project stock ledger value (the Project Inventory figures);
// and flags negative WIP, relief above cost added, both mechanisms on one project, and any gap.
// Which mechanism stays is CHG-02's business decision; this report is independent of it.

const MECHANISMS = { SALES_PUC_CONSUMPTION: 'units', PROJECT_COST_RECOGNITION: 'percent' };
const EPS = 0.005;

async function wipStockReconciliation(query) {
  const asOf = C.resolveAsOf(query);
  const accounts = await C.loadAccounts();
  const materials = (await pucAccountsOf(accounts)).filter(a => pucCategoryOf(a).key === 'materials');
  const ids = materials.map(a => a._id);

  // Ledger: per project and accounting action, debits (added) and credits (relieved).
  const ledger = ids.length
    ? await JournalEntry.aggregate([
        { $match: C.ledgerMatch({ end: asOf.end }) },
        { $unwind: '$lines' },
        { $match: { 'lines.account': { $in: ids } } },
        { $group: { _id: { project: '$lines.project', action: '$accountingAction' }, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
      ])
    : [];
  const gl = new Map();
  const glRow = key => {
    if (!gl.has(key)) gl.set(key, { added: 0, relievedUnits: 0, relievedPercent: 0, relievedOther: 0 });
    return gl.get(key);
  };
  for (const r of ledger) {
    const g = glRow(C.idOf(r._id.project));
    // A reversal posts the opposite side under the same action; netting by side keeps the totals right.
    g.added = round2(g.added + r.debit);
    const bucket = MECHANISMS[r._id.action] === 'units' ? 'relievedUnits' : MECHANISMS[r._id.action] === 'percent' ? 'relievedPercent' : 'relievedOther';
    g[bucket] = round2(g[bucket] + r.credit);
  }

  // Stock ledger: per project, the value of what it holds (Project Inventory).
  const movements = await loadMovements({ dateTo: asOf.end });
  const stockBalances = new Map();
  for (const m of movements) {
    const key = C.idOf(m.project);
    if (!stockBalances.has(key)) stockBalances.set(key, emptyBalance());
    addMovement(stockBalances.get(key), m, false);
  }
  const stock = new Map([...stockBalances].map(([k, b]) => [k, finishBalance(b)]));

  const projectIds = [...new Set([...gl.keys(), ...stock.keys()])].filter(Boolean);
  const projects = projectIds.length ? (await loadProjects({})).filter(p => projectIds.includes(String(p._id))) : [];
  const byId = new Map(projects.map(p => [String(p._id), p]));

  const rows = projectIds
    .map(id => {
      const g = gl.get(id) || { added: 0, relievedUnits: 0, relievedPercent: 0, relievedOther: 0 };
      const s = stock.get(id);
      const relieved = round2(g.relievedUnits + g.relievedPercent + g.relievedOther);
      const glWip = round2(g.added - relieved);
      const stockValue = s ? s.closingValue : 0;
      const difference = round2(glWip - stockValue);
      const flags = [];
      if (glWip < -EPS) flags.push(L('Negative WIP', 'رصيد سالب'));
      if (relieved > g.added + EPS) flags.push(L('Relieved more than added', 'المحمل أكبر من المضاف'));
      if (g.relievedUnits > EPS && g.relievedPercent > EPS) flags.push(L('Two cost mechanisms', 'آليتان لتحميل التكلفة'));
      if (Math.abs(difference) > EPS) flags.push(L('Ledger and stock differ', 'اختلاف الدفاتر عن المخزون'));
      const p = byId.get(id);
      return {
        projectId: id,
        projectNumber: p?.projectNumber || id,
        projectName: p?.name || '',
        costAdded: g.added,
        relievedUnits: g.relievedUnits,
        relievedPercent: g.relievedPercent,
        relievedOther: g.relievedOther,
        glWip,
        stockValue,
        difference,
        status: flags.length ? flags : [L('Agrees', 'متطابق')],
        ok: !flags.length,
      };
    })
    .sort((a, b) => Number(a.ok) - Number(b.ok) || String(a.projectNumber).localeCompare(String(b.projectNumber)));

  const bad = rows.filter(r => !r.ok);
  const money = (k, en, ar) => col(k, en, ar, 'money');
  return {
    asOf: asOf.asOf,
    summary: [
      summaryItem('projects', 'Projects checked', 'المشروعات', rows.length, 'number'),
      summaryItem('flagged', 'Projects needing review', 'مشروعات تحتاج مراجعة', bad.length, 'number'),
      summaryItem('glWip', 'Ledger materials WIP', 'رصيد المواد بالدفاتر', C.sumBy(rows, 'glWip')),
      summaryItem('stockValue', 'Project stock value', 'قيمة مخزون المشروعات', C.sumBy(rows, 'stockValue')),
    ],
    checks: [
      check('No project has negative materials WIP', 'لا يوجد مشروع برصيد مواد سالب', !rows.some(r => r.glWip < -EPS), rows.filter(r => r.glWip < -EPS).map(r => r.projectNumber).join(', ') || null),
      check('Cost relieved never exceeds cost added', 'التكلفة المحملة لا تتجاوز المضافة', !rows.some(r => r.relievedUnits + r.relievedPercent + r.relievedOther > r.costAdded + EPS)),
      check('Ledger WIP equals project stock value for every project', 'رصيد الدفاتر يساوي قيمة مخزون كل مشروع', !rows.some(r => Math.abs(r.difference) > EPS)),
    ],
    sections: [
      {
        key: 'projects',
        title: L('Materials WIP: ledger against project stock', 'المواد تحت التنفيذ: الدفاتر مقابل مخزون المشروع'),
        paginate: true,
        columns: [
          col('projectNumber', 'Project No.', 'رقم المشروع'),
          col('projectName', 'Project', 'المشروع'),
          money('costAdded', 'Cost added', 'تكلفة مضافة'),
          money('relievedUnits', 'Relieved - units sold', 'محمل - وحدات مباعة'),
          money('relievedPercent', 'Relieved - % executed', 'محمل - نسبة التنفيذ'),
          money('relievedOther', 'Relieved - other', 'محمل - أخرى'),
          money('glWip', 'Ledger WIP', 'رصيد الدفاتر'),
          money('stockValue', 'Project stock value', 'قيمة مخزون المشروع'),
          money('difference', 'Difference', 'الفرق'),
          col('status', 'Status', 'الحالة', 'status'),
        ],
        rows: rows.map(r => ({ ...r, status: r.status.map(s => s.en).join('; '), statusAr: r.status.map(s => s.ar).join('؛ ') })),
      },
    ],
    notes: [
      note(
        'Materials PUC accounts only (the goods the project stock ledger tracks). "Units sold" is the cost of the units on each sales invoice (ledger and stock ledger together); "% executed" is the project cost recognition by executed percentage (ledger only). Using both on one project relieves the same goods twice - which one stays is the cost rule decision (CHG-02).',
        'حسابات المواد فقط (البضاعة التي يتتبعها مخزون المشروع). "الوحدات المباعة" هي تكلفة الوحدات في كل فاتورة بيع (الدفاتر والمخزون معاً)؛ "نسبة التنفيذ" هي تحميل تكلفة المشروع بنسبة التنفيذ (الدفاتر فقط). استخدام الآليتين في مشروع واحد يحمل نفس البضاعة مرتين - واختيار الآلية قرار قاعدة التكلفة (CHG-02).'
      ),
    ],
  };
}

module.exports = { wipStockReconciliation };
