const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Won to ERP Handover, Changes Required (19 Nov 2026), W4 + W6-W14. Pure-function/budget-check
// tests and the account/product-matching tests run against a throwaway LOCAL database (no
// transaction involved, so this environment's standalone MongoDB is fine - see this suite's sibling
// test files, e.g. wonReadiness.test.js, for the same convention). The full end-to-end
// createErpProjectForWonDeal flow uses mongoose.startSession().withTransaction() and needs a real
// replica set; it self-skips without TEST_DB_URI, exactly like test/commercial/commercialWorkflow.test.js.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_won_to_erp';
const RUN_TRANSACTIONAL = !!process.env.TEST_DB_URI;
const maybeTest = RUN_TRANSACTIONAL ? test : test.skip;

let wonToErpService, ChartOfAccount, Product, Category, CommercialProject, CommercialRevision, CommercialProposal, Project, Sector, User, Lead, Activity, PricingConfig;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  Product = require('../../models/inventory/productModel');
  Category = require('../../models/categoryModel');
  CommercialProject = require('../../models/commercial/commercialProjectModel');
  CommercialRevision = require('../../models/commercial/commercialRevisionModel');
  CommercialProposal = require('../../models/commercial/commercialProposalModel');
  Project = require('../../models/project/projectModel');
  Sector = require('../../models/project/sectorModel');
  User = require('../../models/userModel');
  Lead = require('../../models/crm/leadModel');
  Activity = require('../../models/crm/activityModel');
  PricingConfig = require('../../models/commercial/pricingConfigModel');
  wonToErpService = require('../../services/crm/wonToErpService');
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ---------------------------------------------------------------- W12: budget check formula

test('W12: the document\'s own worked example (DEAL-2026-005) balances to zero', () => {
  const { computeBudgetCheck } = wonToErpService;
  const result = computeBudgetCheck({
    contractValue: 1142784.78,
    totalAverageCost: 883071.04,
    pricing: { profitAmt: 77252.30, categoryAdditionAmt: 182461.44, discountAmt: 0 },
  });
  assert.equal(result.balanced, true);
  assert.ok(Math.abs(result.difference) < 1);
});

test('W12: a real mismatch (missing cost) is reported, never silently absorbed', () => {
  const { computeBudgetCheck } = wonToErpService;
  const result = computeBudgetCheck({
    contractValue: 200000,
    totalAverageCost: 100000, // 50,000 of cost is missing from this total
    pricing: { profitAmt: 30000, categoryAdditionAmt: 15000, discountAmt: 0 },
  });
  assert.equal(result.balanced, false);
  assert.equal(result.difference, 55000);
});

// ---------------------------------------------------------------- W11: Average Cost mapping

test('W11: Raw Materials/Labour Wages/Fuel & Logistics are found BY NAME; a lever account with no configured code is skipped with a warning, never guessed by name', async () => {
  await ChartOfAccount.create([
    { code: 'TST-RM', name: 'Raw Materials', type: 'cogs' },
    { code: 'TST-LW', name: 'Labour Wages', type: 'cogs' },
    { code: 'TST-FL', name: 'Fuel & Logistics', type: 'cogs' },
    // Deliberately create an account literally named "Contingency" that is NOT cogs-typed and NOT
    // configured via erpCostAccountCodes - buildAverageCostLines must never fall back to it by name.
    { code: 'TST-CONTINGENCY-DECOY', name: 'Contingency', type: 'expense' },
  ]);
  const revision = {
    boqLines: [
      { component: 'PV Modules', total: 100000 },
      { component: 'Installation', total: 20000 },
      { component: 'Transportation', total: 5000 },
    ],
    pricing: { overheadAmt: 12500, contingencyAmt: 6250, salesBonusAmt: 2000, engineeringIncentiveAmt: 1500, profitAmt: 0, categoryAdditionAmt: 0, discountAmt: 0 },
  };
  const config = { erpCostAccountCodes: { overhead: null, contingency: null, salesBonus: null, engineeringIncentive: null } };
  const { lines, warnings } = await wonToErpService.buildAverageCostLines(revision, config, null);

  assert.equal(lines.length, 3); // only the 3 by-name accounts; all 4 levers skipped (no code configured)
  const byAccount = async id => (await ChartOfAccount.findById(id).lean()).code;
  const codes = await Promise.all(lines.map(l => byAccount(l.account)));
  assert.deepEqual(new Set(codes), new Set(['TST-RM', 'TST-LW', 'TST-FL']));
  assert.equal(warnings.length, 4); // overhead, contingency, sales bonus, engineering incentive
  assert.ok(warnings.every(w => !w.includes('TST-CONTINGENCY-DECOY')));
});

test('W11/W14: a configured lever account code IS used, but only when it is a real cogs account', async () => {
  await ChartOfAccount.create([
    { code: 'TST-OH-REAL', name: 'Project Overhead Allocation', type: 'cogs' },
    { code: 'TST-SB-WRONG-TYPE', name: 'Sales Bonus (misfiled)', type: 'expense' }, // not cogs - must be rejected
  ]);
  const revision = { boqLines: [], pricing: { overheadAmt: 5000, salesBonusAmt: 1000, contingencyAmt: 0, engineeringIncentiveAmt: 0, profitAmt: 0, categoryAdditionAmt: 0, discountAmt: 0 } };
  const config = { erpCostAccountCodes: { overhead: 'TST-OH-REAL', salesBonus: 'TST-SB-WRONG-TYPE', contingency: null, engineeringIncentive: null } };
  const { lines, warnings } = await wonToErpService.buildAverageCostLines(revision, config, null);

  assert.equal(lines.length, 1);
  const account = await ChartOfAccount.findById(lines[0].account).lean();
  assert.equal(account.code, 'TST-OH-REAL');
  assert.equal(lines[0].amount, 5000);
  assert.ok(warnings.some(w => w.includes('TST-SB-WRONG-TYPE')));
});

// ---------------------------------------------------------------- W13: BOQ transfer

test('W13: BOQ lines are matched to real products via their model/brand (description), not the generic category label (component); unmatched lines are skipped with a named warning; two lines matching the SAME product are merged (never rejected for a duplicate product)', async () => {
  const category = await Category.create({ name: { en: 'Solar Equipment', ar: 'معدات الطاقة الشمسية' } });
  const product = await Product.create({ type: 'product', title: { en: 'JKM475M-7RL3 PV Module', ar: 'لوح شمسي' }, description: { en: 'd', ar: 'د' }, category: category._id });
  // Realistic shape (onGridEngine.js): `component` is a generic category label repeated across
  // many deals; the actual model/brand that a catalog Product title would match is in `description`.
  const boqLines = [
    { component: 'PV Modules', description: 'JKM475M-7RL3', unit: 'pcs', qty: 100, unitPrice: 500, total: 50000 },
    { component: 'PV Modules', description: 'JKM475M-7RL3', unit: 'pcs', qty: 100, unitPrice: 500, total: 50000 }, // same product as above
    { component: 'Mounting Structure', description: 'Hangar Roof', unit: 'kWp', qty: 80, unitPrice: 200, total: 16000 }, // no catalog match
  ];
  const { lines, warnings } = await wonToErpService.buildErpBoqLines(boqLines, null);

  assert.equal(lines.length, 1); // the two PV Module rows merged into one Project.boqLines entry
  assert.equal(String(lines[0].product), String(product._id));
  assert.equal(lines[0].quantity, 200);
  assert.equal(lines[0].unitPrice, 500);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('Mounting Structure'));
});

// ---------------------------------------------------------------- W4: lock revision edits after Won

test('W4: recomputeRevision refuses to recalculate the current revision once the deal is Won', async () => {
  const revisionController = require('../../controller/commercial/revisionController');
  const category = 'Off-Grid';
  const sector = await Sector.create({ name: category, isActive: true });
  const customer = await User.create({ name: 'Lock Test Customer', phone: '01200000001', role: 'user', isOffline: true, type: 'offline' });
  const project = await CommercialProject.create({
    projectCode: 'LOCK-TEST-0001', name: 'Lock test deal', customer: customer._id, country: 'Egypt', category, dealNumber: 'DEAL-LOCK-0001', outcome: 'Won',
  });
  const revision = await CommercialRevision.create({ project: project._id, revisionNumber: 1 });

  let caught = null;
  const req = { params: { id: String(revision._id) }, body: { engineeringInput: { kWp: 90 } }, commercialRoles: ['md'], user: { _id: customer._id, name: 'MD' } };
  const res = { status() { return this; }, json() {} };
  await revisionController.recomputeRevision(req, res, err => { caught = err; });

  assert.ok(caught, 'expected the Won-lock to produce an error');
  assert.match(caught.message, /is Won.*locked/i);
  await sector.deleteOne();
});

// ---------------------------------------------------------------- B5: Project Manager sync
// A single-document `updateOne`, unlike createErpProjectForWonDeal's own multi-document
// transaction below - runs for real on this environment's standalone Mongo, so it is NOT gated
// behind maybeTest/TEST_DB_URI.

test('B5: syncProjectManagerToErp pushes the Deal Engine project\'s manager onto its linked ERP project', async () => {
  const projectService = require('../../services/commercial/projectService');
  const ProjectManager = require('../../models/project/projectManagerModel');
  const sector = await Sector.create({ name: 'B5 Sync Unit Sector', isActive: true });
  const manager = await ProjectManager.create({ name: 'B5 Sync Unit Manager' });
  const erpProject = await Project.create({ projectNumber: 'B5-SYNC-0001', name: 'B5 sync target', sector: sector.name });

  await projectService.syncProjectManagerToErp({ erpProject: erpProject._id, projectManager: manager._id });
  // Project.js's own find hook auto-populates projectManager - compare by id, not the whole object.
  let fresh = await Project.findById(erpProject._id).select('projectManager').lean();
  assert.equal(String(fresh.projectManager._id), String(manager._id));

  // Clearing it on the Deal Engine side clears it on the ERP project too.
  await projectService.syncProjectManagerToErp({ erpProject: erpProject._id, projectManager: null });
  fresh = await Project.findById(erpProject._id).select('projectManager').lean();
  assert.equal(fresh.projectManager, null);

  await sector.deleteOne();
});

test('B5: syncProjectManagerToErp is a no-op for a deal with no linked ERP project yet (nothing to push to)', async () => {
  const projectService = require('../../services/commercial/projectService');
  // No erpProject on this plain object - must resolve without throwing and without touching anything.
  await assert.doesNotReject(projectService.syncProjectManagerToErp({ erpProject: null, projectManager: 'irrelevant' }));
});

// ---------------------------------------------------------------- End-to-end (needs a replica set)

maybeTest('W6-W10: end-to-end ERP project creation from a Won deal - idempotent, correctly mapped, write-back on both sides', async () => {
  const sector = await Sector.create({ name: 'Off-Grid', isActive: true });
  await ChartOfAccount.create([
    { code: 'E2E-RM', name: 'Raw Materials', type: 'cogs' },
    { code: 'E2E-LW', name: 'Labour Wages', type: 'cogs' },
    { code: 'E2E-FL', name: 'Fuel & Logistics', type: 'cogs' },
    { code: 'E2E-OH', name: 'Project Overhead Allocation (E2E)', type: 'cogs' },
    { code: 'E2E-CT', name: 'Contingency (E2E)', type: 'cogs' },
    { code: 'E2E-SB', name: 'Sales Bonus (E2E)', type: 'cogs' },
    { code: 'E2E-EI', name: 'Engineering Incentive (E2E)', type: 'cogs' },
  ]);
  await PricingConfig.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { version: 1, levers: { overheadPct: 0.1, contingencyPct: 0.05, profitPct: 0.1, salesBonusPct: 0.01, engineeringIncentivePct: 0.01, categoryAdditionPct: 0.19, discountPct: 0 } }, $set: { erpCostAccountCodes: { overhead: 'E2E-OH', contingency: 'E2E-CT', salesBonus: 'E2E-SB', engineeringIncentive: 'E2E-EI' } } },
    { upsert: true }
  );
  const category = await Category.create({ name: { en: 'E2E Equipment', ar: 'معدات' } });
  const product = await Product.create({ type: 'product', title: { en: 'E2E PV Module', ar: 'لوح' }, description: { en: 'd', ar: 'د' }, category: category._id });

  const customer = await User.create({ name: 'E2E Customer', phone: '01200000099', role: 'user', isOffline: true, type: 'offline' });
  const project = await CommercialProject.create({
    projectCode: 'E2E-0001', name: 'E2E Won deal', customer: customer._id, country: 'Egypt', category: 'Off-Grid', dealNumber: 'DEAL-E2E-0001', outcome: 'Won',
  });
  const revision = await CommercialRevision.create({
    project: project._id,
    revisionNumber: 1,
    boqLines: [
      { lineNo: 1, component: 'E2E PV Module', unit: 'pcs', qty: 200, unitPrice: 500, total: 100000 },
      { lineNo: 2, component: 'Installation', unit: 'lump', qty: 1, unitPrice: 20000, total: 20000 },
      { lineNo: 3, component: 'Transportation', unit: 'lump', qty: 1, unitPrice: 5000, total: 5000 },
    ],
    pricing: { netExclVat: 192250, overheadAmt: 12500, contingencyAmt: 6250, salesBonusAmt: 2000, engineeringIncentiveAmt: 1500, profitAmt: 30000, categoryAdditionAmt: 15000, discountAmt: 0, designKwp: 80 },
  });
  project.currentRevision = revision._id;
  await project.save();
  const proposal = await CommercialProposal.create({
    revision: revision._id, project: project._id, version: 1, proposalNumber: 'DEAL-E2E-0001-P01', validUntil: new Date(Date.now() + 86400000),
    boqLinesSnapshot: revision.boqLines, pricingSnapshot: revision.pricing, issuedBy: customer._id,
  });

  const { erpProject, created, warnings } = await wonToErpService.createErpProjectForWonDeal(project._id, { userId: customer._id });
  assert.equal(created, true);
  assert.equal(warnings.length, 0, `expected no warnings, got: ${warnings.join(' | ')}`);
  assert.equal(erpProject.status, 'active'); // budget balances exactly -> not on_hold
  assert.equal(erpProject.budgetCheck.balanced, true);
  assert.equal(erpProject.sector, 'Off-Grid');
  assert.equal(erpProject.dealNumber, 'DEAL-E2E-0001');
  assert.equal(erpProject.dealProjectNumber, 'DEAL-E2E-0001-PRJ');
  assert.equal(erpProject.proposalNumber, 'DEAL-E2E-0001-P01');
  assert.equal(String(erpProject.customer._id || erpProject.customer), String(customer._id));
  assert.equal(erpProject.averageCostLines.length, 7); // 3 by-name + 4 configured lever accounts
  assert.equal(erpProject.boqLines.length, 1); // only the matched PV Module line (Installation/Transportation have no catalog product)

  const reloadedProject = await CommercialProject.findById(project._id);
  assert.equal(String(reloadedProject.erpProject), String(erpProject._id));
  assert.equal(reloadedProject.erpProjectNumber, erpProject.projectNumber);

  // W6: idempotent retry - never a second ERP project.
  const retry = await wonToErpService.createErpProjectForWonDeal(project._id, { userId: customer._id });
  assert.equal(retry.created, false);
  assert.equal(String(retry.erpProject._id), String(erpProject._id));
  assert.equal(await Project.countDocuments({ dealNumber: 'DEAL-E2E-0001' }), 1);

  await sector.deleteOne();
});

maybeTest('B5: the Deal Engine project\'s Project Manager is carried over to the new ERP project, and a later change is pushed through to it', async () => {
  const sector = await Sector.create({ name: 'B5 Off-Grid', isActive: true });
  const ProjectManager = require('../../models/project/projectManagerModel');
  const projectService = require('../../services/commercial/projectService');
  const manager = await ProjectManager.create({ name: 'B5 Test Manager' });
  const otherManager = await ProjectManager.create({ name: 'B5 Other Manager' });

  const customer = await User.create({ name: 'B5 Customer', phone: '01200000097', role: 'user', isOffline: true, type: 'offline' });
  const project = await CommercialProject.create({
    projectCode: 'B5-0001', name: 'B5 Won deal', customer: customer._id, country: 'Egypt', category: 'Off-Grid', dealNumber: 'DEAL-B5-0001', outcome: 'Won', projectManager: manager._id,
  });
  const revision = await CommercialRevision.create({
    project: project._id,
    revisionNumber: 1,
    boqLines: [{ lineNo: 1, component: 'Installation', unit: 'lump', qty: 1, unitPrice: 1000, total: 1000 }],
    pricing: { netExclVat: 1000 },
  });
  project.currentRevision = revision._id;
  await project.save();
  await CommercialProposal.create({
    revision: revision._id, project: project._id, version: 1, proposalNumber: 'DEAL-B5-0001-P01', validUntil: new Date(Date.now() + 86400000),
    boqLinesSnapshot: revision.boqLines, pricingSnapshot: revision.pricing, issuedBy: customer._id,
  });

  const { erpProject } = await wonToErpService.createErpProjectForWonDeal(project._id, { userId: customer._id });
  assert.equal(String(erpProject.projectManager), String(manager._id));

  // B5: a later Deal Engine change (e.g. through projectController.js#updateProject) is pushed
  // through to the already-created ERP project - never left to drift silently.
  const reloadedProject = await CommercialProject.findById(project._id);
  reloadedProject.projectManager = otherManager._id;
  await reloadedProject.save();
  await projectService.syncProjectManagerToErp(reloadedProject);
  const erpAfter = await Project.findById(erpProject._id).select('projectManager');
  assert.equal(String(erpAfter.projectManager), String(otherManager._id));

  await sector.deleteOne();
});

maybeTest('B5: a deal with no Project Manager set creates the ERP project with none, still flagged "to assign"', async () => {
  const sector = await Sector.create({ name: 'B5 No-PM Off-Grid', isActive: true });
  const customer = await User.create({ name: 'B5 No-PM Customer', phone: '01200000096', role: 'user', isOffline: true, type: 'offline' });
  const project = await CommercialProject.create({
    projectCode: 'B5-0002', name: 'B5 Won deal no PM', customer: customer._id, country: 'Egypt', category: 'Off-Grid', dealNumber: 'DEAL-B5-0002', outcome: 'Won',
  });
  const revision = await CommercialRevision.create({
    project: project._id,
    revisionNumber: 1,
    boqLines: [{ lineNo: 1, component: 'Installation', unit: 'lump', qty: 1, unitPrice: 1000, total: 1000 }],
    pricing: { netExclVat: 1000 },
  });
  project.currentRevision = revision._id;
  await project.save();
  await CommercialProposal.create({
    revision: revision._id, project: project._id, version: 1, proposalNumber: 'DEAL-B5-0002-P01', validUntil: new Date(Date.now() + 86400000),
    boqLinesSnapshot: revision.boqLines, pricingSnapshot: revision.pricing, issuedBy: customer._id,
  });

  const { erpProject } = await wonToErpService.createErpProjectForWonDeal(project._id, { userId: customer._id });
  assert.equal(erpProject.projectManager, null);

  await sector.deleteOne();
});

maybeTest('W7: an unresolvable sector throws, and leaves no partial ERP project behind', async () => {
  const customer = await User.create({ name: 'No Sector Customer', phone: '01200000098', role: 'user', isOffline: true, type: 'offline' });
  const project = await CommercialProject.create({
    projectCode: 'NOSECTOR-0001', name: 'No sector deal', customer: customer._id, country: 'Egypt', category: 'Street Lighting', dealNumber: 'DEAL-NOSECTOR-0001', outcome: 'Won',
  });
  const revision = await CommercialRevision.create({ project: project._id, revisionNumber: 1, pricing: { netExclVat: 50000 } });
  project.currentRevision = revision._id;
  await project.save();
  await CommercialProposal.create({ revision: revision._id, project: project._id, version: 1, proposalNumber: 'DEAL-NOSECTOR-0001-P01', validUntil: new Date(Date.now() + 86400000), boqLinesSnapshot: [], pricingSnapshot: revision.pricing, issuedBy: customer._id });

  // No Sector named "Street Lighting" was ever created for this test - resolveProjectSector must throw.
  await assert.rejects(() => wonToErpService.createErpProjectForWonDeal(project._id, { userId: customer._id }), /not a valid sector/i);
  assert.equal(await Project.countDocuments({ dealNumber: 'DEAL-NOSECTOR-0001' }), 0);
  const reloaded = await CommercialProject.findById(project._id);
  assert.equal(reloaded.erpProject, null);
});
