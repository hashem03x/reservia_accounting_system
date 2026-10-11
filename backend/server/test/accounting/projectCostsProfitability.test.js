const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// PUC estimated vs actual by project, the end-of-project cost adjustment, the Project Profitability
// report, and the reversal of revenue / cost recognition when a project's executed percentage goes
// down - against explicit ledger fixtures and the real posting / journal entry services. Every
// expected amount is worked out by hand in the comments.

const DB_URI = process.env.TEST_DB_URI_PROJECT_PROFIT || 'mongodb://127.0.0.1:27017/reversia_test_project_costs_profitability';
const { AutomaticJournalAccountCodes: C } = require('../../utils/accountingConstants');

let JournalEntry, ChartOfAccount, Project, User;
let R, costAdjustmentPreview, prepareCostAdjustment, postProjectExecutionRecognitionJEs, postJournalEntry, reverseJournalEntry;
let transactionsSupported = true;
const A = {};
let admin, p1, p2, p3;
let entrySeq = 600000;

function callHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
    };
    Promise.resolve(handler({ headers: {}, query: {}, body: {}, params: {}, user: admin, ...req }, res, err => (err ? reject(err) : resolve({ status: res.statusCode })))).catch(reject);
  });
}
async function inTx(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}
async function rawEntry(date, lines, extra = {}) {
  entrySeq += 1;
  const doc = { entryNumber: entrySeq, date: new Date(date), description: 'Fixture', source: 'automatic', status: 'posted', lines: lines.map(l => ({ description: 'Fixture', ...l })), totalDebit: lines.reduce((s, l) => s + (l.debit || 0), 0), totalCredit: lines.reduce((s, l) => s + (l.credit || 0), 0), ...extra };
  const { insertedId } = await JournalEntry.collection.insertOne(doc);
  return { ...doc, _id: insertedId };
}
const on = (project, acc, debit, credit) => ({ account: A[acc]._id, debit, credit, project: project._id, projectNumber: project.projectNumber });
const rowOf = (report, projectNumber, code) => report.sections[0].rows.find(r => r.projectNumber === projectNumber && r.accountCode === code);

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/inventory/warehouseModel');
  require('../../models/vendor/paymentModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  require('../../models/sales/salesOrderModel');
  require('../../models/equity/shareholderModel');
  ({ costAdjustmentPreview, prepareCostAdjustment } = require('../../services/project/projectCostEstimateService'));
  ({ postProjectExecutionRecognitionJEs } = require('../../services/accounting/accountingEventService'));
  ({ postJournalEntry, reverseJournalEntry } = require('../../controller/accounting/journalEntryController'));
  const { REPORTS_BY_KEY } = require('../../services/reports/reportRegistry');
  R = Object.fromEntries([...REPORTS_BY_KEY].map(([k, r]) => [k, r.run]));
  await Promise.all([JournalEntry.init(), Project.init(), ChartOfAccount.init()]);

  const probe = await mongoose.startSession();
  try {
    await probe.withTransaction(async () => {
      await mongoose.connection.collection('__txn_probe').insertOne({ ok: 1 }, { session: probe });
    });
  } catch (err) {
    transactionsSupported = false;
  } finally {
    probe.endSession();
  }

  const account = (k, code, name, type, extra = {}) => ChartOfAccount.create({ code, name, type, ...extra }).then(a => (A[k] = a));
  await account('bank', '11000001', 'Bank Misr', 'asset', { parentGroupNameEn: 'Cash & Cash Equivalents' });
  await account('ar', C.accountsReceivableProjects, 'Accounts Receivable (Projects)', 'asset');
  await account('suppliers', C.suppliers, 'Suppliers', 'liability');
  await account('revenue', C.revenue, 'Revenue', 'revenue');
  await account('serviceRevenue', '60000002', 'Maintenance Revenue', 'revenue');
  await account('vat', C.vatPayable, 'VAT Payable', 'liability');
  await account('whtRec', C.withholdingTaxReceivable, 'Withholding Receivable', 'asset');
  // Cost of sales accounts (the estimates) and their PUC accounts, paired by name.
  await account('cogsRaw', '50000001', 'Raw Materials', 'cogs');
  await account('cogsLabour', '50000002', 'Labour Wages', 'cogs');
  await account('cogsDesign', '50000003', 'Engineering & Design', 'cogs');
  await account('pucRaw', C.wipRawMaterials, 'PUC - Raw Materials', 'asset');
  await account('pucLabour', C.wipLabourWages, 'PUC - Labour Wages', 'asset');
  await account('pucDesign', C.wipEngineeringDesign, 'PUC - Engineering & Design', 'asset');
  await account('siteRent', '61000005', 'Site Rent', 'expense', { state: 'indirect' });
  await account('permits', '61000006', 'Permits and Inspections', 'expense', { state: 'direct' });

  admin = await User.create({ name: 'Admin', email: `admin-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  // PRJ001: materials 100,000, labour 50,000 estimated; contract 300,000.
  p1 = await Project.create({ projectNumber: 'PRJ001', name: 'Villa', contractValue: 300000, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31'), averageCostLines: [{ account: A.cogsRaw._id, amount: 100000 }, { account: A.cogsLabour._id, amount: 50000 }] });
  // PRJ002: design 20,000 estimated.
  p2 = await Project.create({ projectNumber: 'PRJ002', name: 'Factory', contractValue: 80000, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31'), averageCostLines: [{ account: A.cogsDesign._id, amount: 20000 }] });
  // PRJ003: no estimates and no activity.
  p3 = await Project.create({ projectNumber: 'PRJ003', name: 'Empty', startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });

  // Actual costs. PRJ001: materials 80,000, of which a 5,000 invoice was posted and reversed (net
  // 75,000); labour 60,000. PRJ002: design 20,000.
  await rawEntry('2026-02-01', [on(p1, 'pucRaw', 80000, 0), { account: A.suppliers._id, debit: 0, credit: 80000 }], { accountingAction: 'PO_INVENTORY_TO_WIP' });
  const wrong = await rawEntry('2026-02-05', [on(p1, 'pucRaw', 5000, 0), { account: A.suppliers._id, debit: 0, credit: 5000 }], { status: 'reversed' });
  await rawEntry('2026-02-06', [{ account: A.suppliers._id, debit: 5000, credit: 0 }, on(p1, 'pucRaw', 0, 5000)], { reversalOfEntry: wrong._id });
  await rawEntry('2026-02-10', [on(p1, 'pucLabour', 60000, 0), { account: A.suppliers._id, debit: 0, credit: 60000 }], { accountingAction: 'PO_SERVICE_TO_WIP' });
  await rawEntry('2026-02-12', [on(p2, 'pucDesign', 20000, 0), { account: A.suppliers._id, debit: 0, credit: 20000 }], { accountingAction: 'PO_SERVICE_TO_WIP' });
  // A draft never counts.
  await rawEntry('2026-02-15', [on(p1, 'pucRaw', 9999, 0), { account: A.suppliers._id, debit: 0, credit: 9999 }], { status: 'draft' });
  // Revenue: PRJ001 150,000 (50% of the contract) + 10,000 maintenance; PRJ002 none.
  await rawEntry('2026-03-01', [{ account: A.ar._id, debit: 160000, credit: 0, project: p1._id }, on(p1, 'revenue', 0, 150000), on(p1, 'serviceRevenue', 0, 10000)], { accountingAction: 'PROJECT_REVENUE_RECOGNITION' });
  // Cost recognition at 50%: materials 50,000, labour 25,000 moved from PUC to cost of sales.
  await rawEntry('2026-03-01', [on(p1, 'cogsRaw', 50000, 0), on(p1, 'cogsLabour', 25000, 0), on(p1, 'pucRaw', 0, 50000), on(p1, 'pucLabour', 0, 25000)], { accountingAction: 'PROJECT_COST_RECOGNITION' });
  // Other project costs: site rent 4,000 (indirect), permits 1,000 (direct).
  await rawEntry('2026-03-05', [on(p1, 'siteRent', 4000, 0), on(p1, 'permits', 1000, 0), { account: A.bank._id, debit: 0, credit: 5000 }]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('PUC estimated vs actual: each category of each project, overruns shown, totals and ledger agree', async () => {
  const report = await R['puc-estimates']({ asOf: '2026-03-31' });
  const raw = rowOf(report, 'PRJ001', C.wipRawMaterials);
  // Materials: estimate 100,000; actual 80,000 + 5,000 - 5,000 (reversed invoice) = 80,000; 9,999 draft ignored.
  assert.deepEqual([raw.category, raw.costAccount, raw.estimate, raw.actual, raw.recognized, raw.adjustment, raw.balance, raw.remaining, raw.status], ['Materials', '50000001 - Raw Materials', 100000, 80000, 50000, 0, 30000, 20000, 'Within estimate']);
  const labour = rowOf(report, 'PRJ001', C.wipLabourWages);
  // Labour: estimate 50,000, actual 60,000 -> overrun of 10,000 (remaining -10,000).
  assert.deepEqual([labour.estimate, labour.actual, labour.recognized, labour.balance, labour.remaining, labour.status], [50000, 60000, 25000, 35000, -10000, 'Overrun']);
  const design = rowOf(report, 'PRJ002', C.wipEngineeringDesign);
  assert.deepEqual([design.estimate, design.actual, design.remaining, design.status], [20000, 20000, 0, 'Within estimate']);
  const subtotal = report.sections[0].rows.find(r => r.projectNumber === 'Total PRJ001');
  assert.deepEqual([subtotal.estimate, subtotal.actual, subtotal.balance, subtotal.remaining], [150000, 140000, 65000, 10000]);
  assert.equal(report.sections[0].rows.some(r => r.projectNumber === 'PRJ003'), false, 'a project with no estimate and no activity has no rows');
  assert.equal(report.summary.find(s => s.key === 'estimate').value, 170000);
  assert.equal(report.summary.find(s => s.key === 'actual').value, 160000);
  assert.equal(report.summary.find(s => s.key === 'balance').value, 85000);
  const ledgerCheck = report.checks.find(c => /ledger/.test(c.label.en));
  assert.equal(ledgerCheck.ok, true, ledgerCheck.detail);
  assert.equal(report.checks.find(c => /over its estimate/.test(c.label.en)).ok, false, 'the labour overrun is flagged');
  // Before the costs: nothing actual yet.
  const january = await R['puc-estimates']({ asOf: '2026-01-31', project: String(p1._id) });
  assert.equal(rowOf(january, 'PRJ001', C.wipRawMaterials).actual, 0);
  // Category filter.
  const onlyLabour = await R['puc-estimates']({ asOf: '2026-03-31', category: 'labor' });
  assert.ok(onlyLabour.sections[0].rows.filter(r => !r._rowType).every(r => r.category === 'Labor'));
});

test('project profitability: revenue by account, every cost, direct / indirect, margins, estimates and agreement with the P&L', async () => {
  const report = await R['project-profit-analysis']({ from: '2026-01-01', to: '2026-12-31' });
  const prj1 = report.sections[0].rows.find(r => r.projectNumber === 'PRJ001');
  // Revenue 160,000; direct = cost of sales 75,000 + permits 1,000 = 76,000; indirect = rent 4,000.
  assert.deepEqual([prj1.revenue, prj1.directCost, prj1.indirectCost, prj1.totalCost, prj1.grossProfit, prj1.netProfit, prj1.margin], [160000, 76000, 4000, 80000, 85000, 80000, 50]);
  // Actual costs: PUC actual 140,000 + costs not through PUC (80,000 - 75,000 recognized) = 145,000.
  assert.deepEqual([prj1.actualCost, prj1.actualProfit, prj1.estimatedCost, prj1.estimatedProfit], [145000, 15000, 150000, 150000]);
  const prj2 = report.sections[0].rows.find(r => r.projectNumber === 'PRJ002');
  assert.deepEqual([prj2.revenue, prj2.netProfit, prj2.margin, prj2.actualCost], [0, 0, null, 20000], 'zero revenue - margin n/a, never NaN');
  const prj3 = report.sections[0].rows.find(r => r.projectNumber === 'PRJ003');
  assert.deepEqual([prj3.revenue, prj3.totalCost, prj3.estimatedCost, prj3.estimatedProfit], [0, 0, null, null]);

  const accounts = report.sections[1].rows.filter(r => r.projectNumber === 'PRJ001');
  assert.deepEqual(accounts.filter(r => r.section === 'Revenue').map(r => [r.accountCode, r.amount]).sort(), [['60000001', 150000], ['60000002', 10000]]);
  const rawCost = accounts.find(r => r.accountCode === '50000001');
  assert.deepEqual([rawCost.section, rawCost.amount, rawCost.estimate, rawCost.variance], ['Direct cost', 50000, 100000, 50000]);
  assert.equal(accounts.find(r => r.accountCode === '61000005').section, 'Indirect cost');
  assert.equal(report.sections[1].rows.find(r => r.projectNumber === 'PRJ002' && r.accountCode === '50000003').estimate, 20000, 'an estimated account with no posted cost still shows');

  assert.ok(report.checks.every(c => c.ok), JSON.stringify(report.checks));
  const pl = await R['profit-loss']({ from: '2026-01-01', to: '2026-12-31' });
  assert.equal(report.summary.find(s => s.key === 'netProfit').value, pl.summary.find(s => s.key === 'netProfit').value);
  // Drill-down: one project and one account.
  const drill = await R['project-profit-analysis']({ from: '2026-01-01', to: '2026-12-31', project: String(p1._id), account: String(A.siteRent._id) });
  assert.deepEqual(drill.sections[2].rows.map(r => [r.accountCode, r.cost]), [['61000005', 4000]]);
});

test('the end-of-project cost adjustment: only when completed, drafted (never posted by viewing), once, and it clears PUC', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const before = await JournalEntry.countDocuments({});
  await R['puc-estimates']({ asOf: '2026-12-31' });
  await costAdjustmentPreview(p1._id);
  assert.equal(await JournalEntry.countDocuments({}), before, 'viewing posts nothing');
  await assert.rejects(() => inTx(s => prepareCostAdjustment(p1._id, { date: '2026-04-30', userId: admin._id }, s)), /not completed/);

  // The project completes: the remaining 50% is recognized (materials 50,000, labour 25,000).
  await rawEntry('2026-04-01', [on(p1, 'cogsRaw', 50000, 0), on(p1, 'cogsLabour', 25000, 0), on(p1, 'pucRaw', 0, 50000), on(p1, 'pucLabour', 0, 25000)], { accountingAction: 'PROJECT_COST_RECOGNITION' });
  await Project.updateOne({ _id: p1._id }, { $set: { executedPercentage: 100, status: 'completed' } });
  // PUC left: materials 80,000 - 100,000 = -20,000 (recognized above actual); labour 60,000 - 50,000 = 10,000.
  const preview = await costAdjustmentPreview(p1._id);
  const byPuc = Object.fromEntries(preview.lines.map(l => [l.pucAccount.code, l]));
  assert.equal(byPuc[C.wipRawMaterials].balance, -20000);
  assert.equal(String(byPuc[C.wipRawMaterials].debit.account), String(A.pucRaw._id), 'Dr PUC / Cr cost of sales');
  assert.equal(byPuc[C.wipLabourWages].balance, 10000);
  assert.equal(String(byPuc[C.wipLabourWages].debit.account), String(A.cogsLabour._id), 'Dr cost of sales / Cr PUC');

  const draft = await inTx(s => prepareCostAdjustment(p1._id, { date: '2026-04-30', userId: admin._id }, s));
  assert.equal(draft.status, 'draft');
  assert.equal(draft.totalDebit, 30000);
  assert.equal(draft.totalDebit, draft.totalCredit);
  await assert.rejects(() => inTx(s => prepareCostAdjustment(p1._id, { date: '2026-04-30', userId: admin._id }, s)), /already exists/);
  assert.equal((await costAdjustmentPreview(p1._id)).pendingDraft.entryNumber, draft.entryNumber);
  // A draft does not count yet.
  assert.equal(rowOf(await R['puc-estimates']({ asOf: '2026-12-31' }), 'PRJ001', C.wipLabourWages).balance, 10000);

  await callHandler(postJournalEntry, { params: { id: String(draft._id) } });
  const after = await R['puc-estimates']({ asOf: '2026-12-31' });
  const raw = rowOf(after, 'PRJ001', C.wipRawMaterials);
  const labour = rowOf(after, 'PRJ001', C.wipLabourWages);
  assert.deepEqual([raw.adjustment, raw.balance, raw.actual], [20000, 0, 80000], 'the adjustment is shown separately and the actual cost is unchanged');
  assert.deepEqual([labour.adjustment, labour.balance], [-10000, 0]);
  assert.ok(after.checks.find(c => /ledger/.test(c.label.en)).ok);
  // Cost of sales now equals the actual cost: materials 80,000 + labour 60,000.
  const profit = await R['project-profit-analysis']({ from: '2026-01-01', to: '2026-12-31', project: String(p1._id) });
  const accounts = profit.sections[1].rows;
  assert.equal(accounts.find(r => r.accountCode === '50000001').amount, 80000);
  assert.equal(accounts.find(r => r.accountCode === '50000002').amount, 60000);
  await assert.rejects(() => inTx(s => prepareCostAdjustment(p1._id, { userId: admin._id }, s)), /Nothing to adjust/);
});

test('a lower executed percentage reverses revenue and cost recognition; recognizing again posts anew; retries never duplicate', async t => {
  if (!transactionsSupported) return t.skip('needs a replica set (transactions)');
  const p = await Project.create({ projectNumber: 'PRJ010', name: 'Plant', contractValue: 1000000, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31'), averageCostLines: [{ account: A.cogsRaw._id, amount: 400000 }] });
  const step = async pct => {
    const project = await Project.findById(p._id);
    project.executedPercentage = pct;
    await inTx(async s => {
      await postProjectExecutionRecognitionJEs(project, s);
      await project.save({ session: s });
    });
  };
  const revenueOf = async () => (await R['general-ledger']({ from: '2026-01-01', to: '2026-12-31', account: String(A.revenue._id), project: String(p._id) })).summary.find(s => s.key === 'closing').value;
  const cogsOf = async () => (await R['general-ledger']({ from: '2026-01-01', to: '2026-12-31', account: String(A.cogsRaw._id), project: String(p._id) })).summary.find(s => s.key === 'closing').value;

  await step(40); // revenue 400,000; cost 160,000
  assert.deepEqual([await revenueOf(), await cogsOf()], [400000, 160000]);
  await step(20); // a Sales Order cancelled: back to 200,000 / 80,000
  assert.deepEqual([await revenueOf(), await cogsOf()], [200000, 80000]);
  const reversal = await JournalEntry.findOne({ project: p._id, accountingAction: 'PROJECT_REVENUE_RECOGNITION', reference: 'DERECOGNITION' }).lean();
  assert.match(reversal.description, /Revenue reversal - project PRJ010 \(40% -> 20%\)/);
  const saved = await Project.findById(p._id).lean();
  assert.deepEqual([saved.revenueRecognizedPercentage, saved.costRecognizedPercentage], [20, 20]);
  await step(40); // re-sold: recognized again with new entries (not mistaken for the first 40%)
  assert.deepEqual([await revenueOf(), await cogsOf()], [400000, 160000]);
  assert.equal(await JournalEntry.countDocuments({ project: p._id, accountingAction: 'PROJECT_REVENUE_RECOGNITION' }), 3);

  // A retry of the same step with stale trackers finds the existing entries.
  const stale = await Project.findById(p._id);
  stale.revenueRecognizedPercentage = 20;
  stale.costRecognizedPercentage = 20;
  await inTx(s => postProjectExecutionRecognitionJEs(stale, s));
  assert.equal(await JournalEntry.countDocuments({ project: p._id, accountingAction: 'PROJECT_REVENUE_RECOGNITION' }), 3, 'no duplicate');
  assert.equal(await revenueOf(), 400000);

  // Recognition entries are not reversed by hand - the executed percentage drives them.
  const anyRecognition = await JournalEntry.findOne({ project: p._id, accountingAction: 'PROJECT_COST_RECOGNITION' });
  await assert.rejects(() => callHandler(reverseJournalEntry, { params: { id: String(anyRecognition._id) }, body: { reversalDate: new Date('2026-06-30') } }), /cannot be reversed by hand/);

  // The reports stay in line: PUC estimates (recognized = 160,000 of PUC raw materials) and the ledger.
  const puc = await R['puc-estimates']({ asOf: '2026-12-31', project: String(p._id) });
  assert.equal(rowOf(puc, 'PRJ010', C.wipRawMaterials).recognized, 160000);
  assert.ok(puc.checks.find(c => /ledger/.test(c.label.en)).ok);
});

test('invalid input is refused and reports never change data', async () => {
  await assert.rejects(() => R['puc-estimates']({ asOf: '2026-13-01' }), /not a valid date|YYYY-MM-DD/);
  await assert.rejects(() => R['puc-estimates']({ asOf: '2026-03-31', category: 'nope' }), /Invalid PUC category/);
  await assert.rejects(() => R['project-profit-analysis']({ from: '2026-01-01', to: '2026-12-31', account: 'x' }), /Invalid account/);
  await assert.rejects(() => costAdjustmentPreview('x'), /Invalid project id/);
  const counts = async () => Promise.all(['journalentries', 'projects'].map(c => mongoose.connection.collection(c).countDocuments()));
  const beforeCounts = await counts();
  await R['puc-estimates']({ asOf: '2026-12-31' });
  await R['project-profit-analysis']({ from: '2026-01-01', to: '2026-12-31' });
  await costAdjustmentPreview(p2._id);
  assert.deepEqual(await counts(), beforeCounts);
});
