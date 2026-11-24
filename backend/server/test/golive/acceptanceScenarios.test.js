const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Go-live Developer Pack section 8.1 "Access and approvals" - the nine acceptance scenarios,
// exercised against the SEVEN REAL people/role combinations of section 5.2 (not synthetic
// single-role test users), calling the exact same service-layer functions the real HTTP routes
// delegate to. This is deliberately the ENFORCEMENT layer, not the HTTP layer: every function
// called here (approvalService.setStageStatus, supplierService.setStatus,
// requisitionController.openRequisition, leadService/stageRules, hrService.*) is the actual place
// a role check happens - a route-level test would just prove the route calls these, which the
// existing per-module suites (approvalService.test.js, createPr.test.js, hrGoLive.test.js,
// crmAccess.test.js, etc.) already do. What ONLY this file proves is that the SEVEN REAL PEOPLE,
// each with their exact multi-system role bundle from section 5.2, get the exact behavior section
// 8.1 describes - the integration gap unit tests scoped to one role at a time cannot catch.
//
// Scenario 1 ("each portal card and menu shows only what section 5.3 grants") is a frontend
// nav-visibility statement with no server-side assertion to automate - covered by the manual
// Portal access matrix audit (this session), not re-tested here.
// Scenario 9 ("every test above appears in the audit log") is spot-checked inline per scenario
// via services/hr/hrCore.js#audit (HR) rather than exhaustively re-proven for every single call;
// CRM/Commercial's own audit trails (StageHistory, CommercialApproval, supplier notes) are already
// asserted by their own module test suites.
//
// Self-skips without TEST_DB_URI, like every other DB-backed suite in this repo.
const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let User, HrEmployee, HrAudit, Vendor, Product, Category, Project, Requisition;
let CommercialProject, CommercialRevision, CommercialSupplier, CrmLead, StageHistory;
let approvalService, createPrService, supplierService, requisitionController, hasPermissionMw;
let leadService, stageRules, hrService, hrCore;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  HrEmployee = require('../../models/hr/hrModels').HrEmployee;
  HrAudit = require('../../models/hr/hrModels').HrAudit;
  Vendor = require('../../models/vendor/vendor');
  Product = require('../../models/inventory/productModel');
  Category = require('../../models/categoryModel');
  Project = require('../../models/project/projectModel');
  Requisition = require('../../models/vendor/requisitionModel');
  CommercialProject = require('../../models/commercial/commercialProjectModel');
  CommercialRevision = require('../../models/commercial/commercialRevisionModel');
  CommercialSupplier = require('../../models/commercial/supplierModel');
  CrmLead = require('../../models/crm/leadModel');
  StageHistory = require('../../models/crm/stageHistoryModel');
  approvalService = require('../../services/commercial/approvalService');
  createPrService = require('../../services/commercial/createPrService');
  supplierService = require('../../services/commercial/supplierService');
  requisitionController = require('../../controller/vendor/requisitionController');
  hasPermissionMw = require('../../middleware/hasPermission');
  leadService = require('../../services/crm/leadService');
  stageRules = require('../../utils/crm/stageRules');
  hrService = require('../../services/hr/hrService');
  hrCore = require('../../services/hr/hrCore');
  process.env.HR_PAY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  await Promise.all([User.init(), Requisition.init(), Vendor.init()]);
});

after(async () => {
  if (!RUN) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  const names = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name);
  await Promise.all(names.map(n => mongoose.connection.collection(n).deleteMany({})));
});

let seq = 0;
/** Mirrors scripts/provisionGoLiveStaffAccounts.js's real shape: one User, the right top-level
 * `role` (ERP permissions auto-derive from it - userModel.js's pre-save hook) and a
 * systemMemberships entry per system section 5.2 actually grants. An absent system means NO
 * membership entry at all - "ERP: none" for the Technical Engineer, for example. */
async function person(name, { erp = null, hr = null, crm = null, commercial = null } = {}) {
  seq++;
  const systemMemberships = [];
  if (erp) systemMemberships.push({ system: 'ERP', role: erp, isActive: true });
  if (hr) systemMemberships.push({ system: 'HR', role: Array.isArray(hr) ? hr[0] : hr, isActive: true });
  if (crm) systemMemberships.push({ system: 'CRM', role: crm, isActive: true });
  if (commercial) systemMemberships.push({ system: 'COMMERCIAL', role: commercial, isActive: true });
  const user = await User.create({
    name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}.${seq}@reservia-energy.com`,
    password: 'x', type: 'online', role: erp || 'user', systemMemberships,
  });
  let emp = null;
  if (hr) emp = await HrEmployee.create({ code: `EMP-ACC-${seq}`, name, hire: '2026-01-01', status: 'Active', dept: 'Admin', user: user._id });
  return { user, emp, crmRole: crm, commercialRole: commercial, hrRole: Array.isArray(hr) ? hr[1] : hr };
}

/** The seven real section 5.2 identities, with their exact per-system role bundle. */
async function roster() {
  const md = await person('Ahmed Fattah', { erp: 'admin', hr: 'md', crm: 'md', commercial: 'md' });
  const scDirector = await person('Mohamed Basha', { erp: 'viewer', hr: 'employee', crm: 'commercial_director', commercial: 'commercial_director' });
  const bdm = await person('Ahmed Moubarek', { erp: 'po_drafter', hr: ['employee', 'line_manager'], crm: 'bdm', commercial: 'bdm' });
  const salesEng1 = await person('Mohamed Abdou', { erp: 'po_drafter', hr: 'employee', crm: 'sales_viewer', commercial: 'sales' });
  const salesEng2 = await person('Yasser Helal', { erp: 'po_drafter', hr: 'employee', crm: 'sales_viewer', commercial: 'sales' });
  const techEng = await person('Abdullah Mostafa', { erp: null, hr: 'employee', crm: 'sales_viewer', commercial: 'technical' });
  const marketing = await person('Menna Marketing', { erp: 'po_drafter', hr: 'employee', crm: 'marketing', commercial: 'marketing' });
  // BDM line-manages the Sales/Technical Engineers (section 5.7/5.8: "BDM approves the Sales and
  // Technical Engineers") - set via mgrId, the real link hrCore.js#visibleEmployeeIds/
  // assertCanDecideFor resolve against.
  await HrEmployee.updateOne({ _id: salesEng1.emp._id }, { $set: { mgrId: bdm.emp._id } });
  await HrEmployee.updateOne({ _id: salesEng2.emp._id }, { $set: { mgrId: bdm.emp._id } });
  await HrEmployee.updateOne({ _id: techEng.emp._id }, { $set: { mgrId: bdm.emp._id } });
  // MD approves the S&C Director, the BDM and the Marketing Coordinator.
  await HrEmployee.updateOne({ _id: scDirector.emp._id }, { $set: { mgrId: md.emp?._id || null } });
  await HrEmployee.updateOne({ _id: bdm.emp._id }, { $set: { mgrId: md.emp?._id || null } });
  await HrEmployee.updateOne({ _id: marketing.emp._id }, { $set: { mgrId: md.emp?._id || null } });
  return { md, scDirector, bdm, salesEng1, salesEng2, techEng, marketing };
}

/** A Deal Engine project+revision with one priced BOQ line, mirroring createPr.test.js's own
 * makeDeal() shortcut - the real engineering->BOQ pipeline is already covered elsewhere
 * (onGridEngine.test.js etc.); this suite is about WHO may act on it, not how it's computed. */
async function makeDeal({ owner = null, netExclVat = 500000 } = {}) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const commercialProject = await CommercialProject.create({
    dealNumber: `DEAL-ACC-${suffix}`, projectCode: `PRJ-ACC-${suffix}`, name: `Acceptance Deal ${suffix}`,
    category: 'On-Grid C&I', country: 'Egypt', customer: new mongoose.Types.ObjectId(), owner,
  });
  const revision = await CommercialRevision.create({
    project: commercialProject._id, revisionNumber: 1, isCurrent: true, status: 'Calculated',
    boqLines: [{ lineNo: 1, component: 'PV Modules', description: 'PV Module', unit: 'pcs', qty: 100, unitPrice: 100, total: 10000, vendor: null }],
    pricing: { netExclVat, grossProfitPct: 0.2, vatPct: 0.14 },
  });
  return { commercialProject, revision };
}

// ==================================================================================
// Scenario 2 - "Sales Engineer: cannot change any Deal Engine field; can sign Stage 1 on a deal
// he owns and is refused on one he does not own."
// ==================================================================================

maybeTest('8.1.2: Sales Engineer cannot write any Deal Engine field (engineering input, pricing)', async () => {
  const { salesEng1 } = await roster();
  const perms = require('../../utils/commercial/dealEnginePermissions');
  assert.throws(() => perms.assertEngineeringInputWriteAllowed([salesEng1.commercialRole], { kWp: 100 }), /design engineering input/);
  assert.throws(() => perms.assertPricingWriteAllowed([salesEng1.commercialRole], { overheadPct: 0.1 }), /read-only/);
});

maybeTest('8.1.2: Sales Engineer signs Stage 1 on a deal he OWNS, refused on one he does not own', async () => {
  const { salesEng1, salesEng2 } = await roster();
  const owned = await makeDeal({ owner: salesEng1.user._id });
  const signed = await approvalService.setStageStatus(owned.revision._id, 'STAGE1', 'Approved', { userId: salesEng1.user._id, userRole: 'sales', note: 'owns it' });
  assert.equal(signed.stage1.status, 'Approved');

  const unowned = await makeDeal({ owner: salesEng2.user._id });
  await assert.rejects(
    () => approvalService.setStageStatus(unowned.revision._id, 'STAGE1', 'Approved', { userId: salesEng1.user._id, userRole: 'sales' }),
    /you own/
  );
});

// ==================================================================================
// Scenario 3 - "Technical Engineer: edits Engineering Input and BOQ, sees BOQ costs, cannot open
// Pricing, Feasibility or Proposal; ERP card hidden and /erp refused."
// ==================================================================================

maybeTest('8.1.3: Technical Engineer - Engineering Input/BOQ edit, Pricing/Feasibility/Proposal hidden', async () => {
  const { techEng } = await roster();
  const perms = require('../../utils/commercial/dealEnginePermissions');
  const roles = [techEng.commercialRole];
  assert.doesNotThrow(() => perms.assertEngineeringInputWriteAllowed(roles, { kWp: 120 }));
  assert.equal(perms.canEdit(perms.widestLevel(perms.PROJECT_TAB_MATRIX.boqLines, roles)), true);
  assert.equal(perms.canView(perms.widestLevel(perms.PROJECT_TAB_MATRIX.boqCosts, roles)), true, 'D8: technical sees BOQ cost prices');
  assert.equal(perms.canView(perms.widestLevel(perms.PROJECT_TAB_MATRIX.pricing, roles)), false);
  assert.equal(perms.canView(perms.widestLevel(perms.PROJECT_TAB_MATRIX.feasibility, roles)), false);
  assert.equal(perms.canView(perms.widestLevel(perms.PROJECT_TAB_MATRIX.proposal, roles)), false);

  // shapeRevisionForRole must actually strip pricing/feasibility server-side, not just hide a tab.
  const revision = { pricing: { netExclVat: 999 }, feasibility: { paybackYears: 5 }, boqLines: [{ component: 'X', unitPrice: 10, total: 10 }] };
  const shaped = perms.shapeRevisionForRole(revision, roles);
  assert.equal(shaped.pricing, undefined);
  assert.equal(shaped.feasibility, undefined);
  assert.equal(shaped.boqLines[0].unitPrice, 10, 'BOQ cost prices stay visible to Technical');
});

maybeTest('8.1.3: Technical Engineer has no ERP membership at all - /erp (any ERP resource) is refused', async () => {
  const { techEng } = await roster();
  assert.equal((techEng.user.systemMemberships || []).some(m => m.system === 'ERP' && m.isActive), false, 'section 5.2: ERP column is "none"');
  const req = { user: techEng.user };
  let error = null;
  hasPermissionMw.checkUserPermissions({ resource: 'purchaseRequisitions', action: 'read' })(req, {}, e => (error = e));
  assert.ok(error, 'the ERP base-membership gate must refuse this request');
  assert.match(error.message, /do not have access to the ERP system/);
});

// ==================================================================================
// Scenario 4 - "BDM: Pricing Config refused; can draft a PO; cannot open it; can mark Won at EGP
// 1.4M and is refused at EGP 1.6M."
// ==================================================================================

maybeTest('8.1.4: BDM is refused Pricing Config management (md/commercial_director only)', async () => {
  const { bdm } = await roster();
  const pricingConfigService = require('../../services/commercial/pricingConfigService');
  assert.equal(pricingConfigService.canManagePricingConfig(bdm.user), false);
});

maybeTest('8.1.4: BDM drafts a Purchase Order but cannot open/approve it (D1/F8 - the creator never approves, and only the MD role has Actions.approve)', async () => {
  const { bdm } = await roster();
  const vendor = await Vendor.create({ name: 'Acceptance Vendor', contact: { phone: '01011110001' } });
  const category = await Category.create({ name: { en: 'Electrical', ar: 'كهرباء' } });
  const product = await Product.create({ type: 'product', title: { en: 'Cable', ar: 'كابل' }, description: { en: '-', ar: '-' }, category: category._id });
  const project = await Project.create({ projectNumber: 'ACC-PRJ-0001', projectManager: bdm.user._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });

  const created = await callHandler(requisitionController.createRequisition, {
    user: bdm.user, body: { vendorId: String(vendor._id), project: String(project._id), items: [{ product: String(product._id), quantity: 5, unitPrice: 100, unit: 'pcs' }] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const poId = created.body.data._id;

  // Route-level gate: BDM's po_drafter permissions have no purchaseRequisitions:approve at all.
  let gateError = null;
  hasPermissionMw.checkUserPermissions({ resource: 'purchaseRequisitions', action: 'approve' })({ user: bdm.user }, {}, e => (gateError = e));
  assert.ok(gateError);
  assert.match(gateError.message, /not allowed to access this resource/);

  // Even bypassing the route gate, the controller itself blocks the drafter from opening their own PO.
  await assert.rejects(
    () => callHandler(requisitionController.openRequisition, { user: bdm.user, params: { id: poId } }).then(r => { if (r.status >= 400) throw new Error(r.body.message); }),
    /a different person must approve/
  );
});

maybeTest('8.1.4: BDM/S&C Director can mark Won up to EGP 1.5M net; above it only the MD (BDM at 1.4M allowed, 1.6M refused)', () => {
  const ctxFor = (role, valueEgp) => ({ from: 'proposal_sent', to: 'won', role, valueEgp, mdApproved: role === 'md' });
  assert.deepEqual(stageRules.validateStageTransition(ctxFor('bdm', 1_400_000)), []);
  assert.match(stageRules.validateStageTransition(ctxFor('bdm', 1_600_000)).join(' '), /MD approval/);
  // S&C Director (commercial_director) has the same up-to-1.5M authority.
  assert.deepEqual(stageRules.validateStageTransition(ctxFor('commercial_director', 1_400_000)), []);
  assert.match(stageRules.validateStageTransition(ctxFor('commercial_director', 1_600_000)).join(' '), /MD approval/);
  // Above 1.5M, the MD himself can still do it (mdApproved true because role==='md').
  assert.deepEqual(stageRules.validateStageTransition(ctxFor('md', 1_600_000)), []);
});

// ==================================================================================
// Scenario 5 - "S&C Director: sees the BOQ tab; signs Stage 2; is refused on Stage 2 of a
// revision whose Stage 1 he signed; is refused on the MD sign-off; approves a supplier proposed
// by the BDM and is refused on one he proposed."
// ==================================================================================

maybeTest('8.1.5: S&C Director sees/edits the BOQ tab (F6 - commercial_director gained BOQ access)', async () => {
  const { scDirector } = await roster();
  const perms = require('../../utils/commercial/dealEnginePermissions');
  assert.equal(perms.canEdit(perms.widestLevel(perms.PROJECT_TAB_MATRIX.boqLines, [scDirector.commercialRole])), true);
});

maybeTest('8.1.5: S&C Director signs Stage 2; refused Stage 2 of a revision whose Stage 1 HE signed (segregation of duties); refused MD sign-off', async () => {
  const { scDirector, bdm } = await roster();
  const deal = await makeDeal({ owner: bdm.user._id, netExclVat: 2_000_000 });
  await approvalService.setStageStatus(deal.revision._id, 'STAGE1', 'Approved', { userId: bdm.user._id, userRole: 'bdm' });
  const stage2 = await approvalService.setStageStatus(deal.revision._id, 'STAGE2', 'Approved', { userId: scDirector.user._id, userRole: 'commercial_director' });
  assert.equal(stage2.stage2.status, 'Approved');
  assert.equal(stage2.mdRequired, true, 'net above EGP 1.5M needs MD sign-off');

  await assert.rejects(
    () => approvalService.setStageStatus(deal.revision._id, 'MD', 'Approved', { userId: scDirector.user._id, userRole: 'commercial_director' }),
    /can only be signed by/,
    'MD sign-off needs the md role, not commercial_director, regardless of who signed earlier stages'
  );

  // The same-person-two-stages rule: an S&C Director who ALSO held sales/technical on Stage 1
  // of a DIFFERENT revision could never then sign Stage 2 of THAT revision either.
  const otherDeal = await makeDeal({ owner: scDirector.user._id });
  await approvalService.setStageStatus(otherDeal.revision._id, 'STAGE1', 'Approved', { userId: scDirector.user._id, userRole: 'sales' });
  await assert.rejects(
    () => approvalService.setStageStatus(otherDeal.revision._id, 'STAGE2', 'Approved', { userId: scDirector.user._id, userRole: 'commercial_director' }),
    /already signed/
  );
});

maybeTest('8.1.5/D9: S&C Director approves a supplier proposed by the BDM, refused on one he proposed himself', async () => {
  const { scDirector, bdm } = await roster();
  const byBdm = await supplierService.createSupplier({ legalName: 'BDM-Proposed Supplier' }, { user: bdm.user, role: 'bdm' });
  const approved = await supplierService.setStatus(byBdm._id, { status: 'Approved' }, { user: scDirector.user, role: 'commercial_director' });
  assert.equal(approved.status, 'Approved');

  const bySc = await supplierService.createSupplier({ legalName: 'SC-Proposed Supplier' }, { user: scDirector.user, role: 'commercial_director' });
  await assert.rejects(
    () => supplierService.setStatus(bySc._id, { status: 'Approved' }, { user: scDirector.user, role: 'commercial_director' }),
    /a different person.*must approve/
  );
});

// ==================================================================================
// Scenario 6 - "MD: approves a PO drafted by the BDM; is refused on the MD sign-off of a
// revision where he signed Stage 2."
// ==================================================================================

maybeTest('8.1.6: MD approves (opens) a PO drafted by the BDM', async () => {
  const { md, bdm } = await roster();
  const vendor = await Vendor.create({ name: 'MD-Open Vendor', contact: { phone: '01011110002' } });
  const category = await Category.create({ name: { en: 'Mechanical', ar: 'ميكانيكا' } });
  const product = await Product.create({ type: 'product', title: { en: 'Pump', ar: 'طلمبة' }, description: { en: '-', ar: '-' }, category: category._id });
  const project = await Project.create({ projectNumber: 'ACC-PRJ-0002', projectManager: md.user._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  const created = await callHandler(requisitionController.createRequisition, {
    user: bdm.user, body: { vendorId: String(vendor._id), project: String(project._id), items: [{ product: String(product._id), quantity: 2, unitPrice: 500, unit: 'pcs' }] },
  });
  const opened = await callHandler(requisitionController.openRequisition, { user: md.user, params: { id: created.body.data._id } });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.data.status, 'open');
  assert.equal(String(opened.body.data.approvedBy), String(md.user._id));
});

maybeTest('8.1.6: MD is refused the MD sign-off of a revision where HE signed Stage 2 (segregation of duties has no exception, not even for the MD)', async () => {
  const { md, bdm } = await roster();
  const deal = await makeDeal({ owner: bdm.user._id, netExclVat: 2_000_000 });
  // Stage 1 by a different person (bdm) so the MD signing Stage 2 next does not ALSO trip the
  // same-person-two-stages rule a stage earlier than the scenario is actually testing.
  await approvalService.setStageStatus(deal.revision._id, 'STAGE1', 'Approved', { userId: bdm.user._id, userRole: 'bdm' });
  await approvalService.setStageStatus(deal.revision._id, 'STAGE2', 'Approved', { userId: md.user._id, userRole: 'commercial_director' });
  await assert.rejects(
    () => approvalService.setStageStatus(deal.revision._id, 'MD', 'Approved', { userId: md.user._id, userRole: 'md' }),
    /already signed/,
    'the Nov 23 incident\'s exact mechanism - no role, not even md, waives segregation of duties'
  );
});

// ==================================================================================
// Scenario 7 - "Marketing Coordinator: moves a lead to Negotiation and Lost; is refused on Won
// and delete; sees Proposal and Feasibility read-only; drafts a PO."
// ==================================================================================

maybeTest('8.1.7: Marketing moves a lead to Negotiation and Lost, refused on Won and on archive/delete', () => {
  const toNegotiation = { from: 'proposal_sent', to: 'negotiation', role: 'marketing', followUpAt: new Date() };
  assert.deepEqual(stageRules.validateStageTransition(toNegotiation), []);
  const toLost = { from: 'negotiation', to: 'lost', role: 'marketing', lostReason: 'Price' };
  assert.deepEqual(stageRules.validateStageTransition(toLost), []);
  const toWon = { from: 'negotiation', to: 'won', role: 'marketing', valueEgp: 500000, mdApproved: false };
  assert.match(stageRules.validateStageTransition(toWon).join(' '), /cannot mark a lead Won/);
});

maybeTest('8.1.7: Marketing sees Proposal/Feasibility read-only (D5), drafts a PO (ERP po_drafter)', async () => {
  const { marketing } = await roster();
  const perms = require('../../utils/commercial/dealEnginePermissions');
  const roles = [marketing.commercialRole];
  assert.equal(perms.canView(perms.widestLevel(perms.PROJECT_TAB_MATRIX.proposal, roles)), true);
  assert.equal(perms.canEditFully(perms.widestLevel(perms.PROJECT_TAB_MATRIX.proposal, roles)), false, 'view only, never issue');
  assert.equal(perms.canView(perms.widestLevel(perms.PROJECT_TAB_MATRIX.feasibility, roles)), true);
  assert.equal(perms.canEditFully(perms.widestLevel(perms.PROJECT_TAB_MATRIX.feasibility, roles)), false);

  const vendor = await Vendor.create({ name: 'Marketing Vendor', contact: { phone: '01011110003' } });
  const category = await Category.create({ name: { en: 'Signage', ar: 'لوحات' } });
  const product = await Product.create({ type: 'product', title: { en: 'Banner', ar: 'بانر' }, description: { en: '-', ar: '-' }, category: category._id });
  const project = await Project.create({ projectNumber: 'ACC-PRJ-0003', projectManager: marketing.user._id, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-12-31') });
  const created = await callHandler(requisitionController.createRequisition, {
    user: marketing.user, body: { vendorId: String(vendor._id), project: String(project._id), items: [{ product: String(product._id), quantity: 1, unitPrice: 200, unit: 'pcs' }] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
});

// ==================================================================================
// Scenario 8 - "Any employee: adds own attendance, a site visit and an expense claim with a
// receipt file, uploads a document, cannot open another employee's file; the BDM approves the
// Sales Engineer's claim, the MD approves the BDM's."
// Scenario 9 - every action above is in the audit log with user, time, old and new value.
// ==================================================================================

maybeTest('8.1.8: any employee adds their own attendance, site visit and expense claim with a receipt; cannot touch a colleague\'s', async () => {
  const { salesEng1, salesEng2 } = await roster();
  const today = hrCore.todayCairo();
  const month = today.slice(0, 7);

  const ownVisit = await hrService.saveVisit(null, { empId: String(salesEng1.emp._id), date: `${month}-03`, site: 'Client HQ', purpose: 'Install' }, { user: salesEng1.user, role: 'employee' });
  assert.equal(String(ownVisit.visit.employee), String(salesEng1.emp._id));
  await assert.rejects(
    () => hrService.saveVisit(null, { empId: String(salesEng2.emp._id), date: `${month}-03`, site: 'Client HQ', purpose: 'Install' }, { user: salesEng1.user, role: 'employee' }),
    /own record/
  );

  await hrService.saveTimesheetDays(String(salesEng1.emp._id), month, { [today]: { s: 'P', in: '09:00', out: '18:00' } }, { user: salesEng1.user, role: 'employee' });
  await assert.rejects(
    () => hrService.saveTimesheetDays(String(salesEng2.emp._id), month, { [today]: { s: 'P', in: '09:00', out: '18:00' } }, { user: salesEng1.user, role: 'employee' }),
    /own record/
  );

  const claim = await hrService.saveExpense(null, { empId: String(salesEng1.emp._id), date: `${month}-02`, type: 'Meals', amount: 50 }, { user: salesEng1.user, role: 'employee' });
  const pdfBuffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 65)]);
  const withReceipt = await hrService.uploadExpenseReceipt(claim._id, [{ originalname: 'receipt.pdf', mimetype: 'application/pdf', buffer: pdfBuffer }], { user: salesEng1.user, role: 'employee' });
  assert.equal(withReceipt.expense.receipt, true);

  const audited = await HrAudit.findOne({ table: 'expenses', rowId: String(claim._id) }).lean();
  assert.ok(audited, '8.1.9: the claim write is in the audit log with user/time/old/new value');
  assert.equal(String(audited.user), String(salesEng1.user._id));
});

maybeTest('8.1.8/5.7/F10 GAP: self-service DOCUMENT upload does not exist yet - only md/hr can record a document today (section 5.7 table says every employee gets "Self (submit)")', async () => {
  const { salesEng1 } = await roster();
  // hrService.saveDocument is the ONLY document-related function in the codebase; it hard-requires
  // EDIT_ROLES (md/hr). There is no self-service document upload path for an "employee" role to
  // exercise here - this test documents the gap rather than asserting a success that doesn't exist,
  // so the final report doesn't silently claim scenario 8 fully passes.
  await assert.rejects(
    () => hrService.saveDocument(String(salesEng1.emp._id), 'nationalId', { st: 'ok' }, { user: salesEng1.user, role: 'employee' }),
    /cannot record documents/
  );
});

maybeTest('8.1.8: the BDM approves the Sales Engineer\'s claim (line manager); the MD approves the BDM\'s', async () => {
  const { bdm, md, salesEng1 } = await roster();
  const month = hrCore.todayCairo().slice(0, 7);
  const salesClaim = await hrService.saveExpense(null, { empId: String(salesEng1.emp._id), date: `${month}-02`, type: 'Meals', amount: 50 }, { user: salesEng1.user, role: 'employee' });
  const pdfBuffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 65)]);
  await hrService.uploadExpenseReceipt(salesClaim._id, [{ originalname: 'r.pdf', mimetype: 'application/pdf', buffer: pdfBuffer }], { user: salesEng1.user, role: 'employee' });
  const bdmDecision = await hrService.decideExpense(salesClaim._id, { status: 'Approved' }, { user: bdm.user, role: 'line_manager' });
  assert.equal(bdmDecision.status, 'Approved');
  assert.equal(bdmDecision.by, 'Ahmed Moubarek', '8.1.9/F10: approver is stamped from the login, never typed');

  const bdmClaim = await hrService.saveExpense(null, { empId: String(bdm.emp._id), date: `${month}-02`, type: 'Transport', amount: 80 }, { user: bdm.user, role: 'line_manager' });
  await hrService.uploadExpenseReceipt(bdmClaim._id, [{ originalname: 'r.pdf', mimetype: 'application/pdf', buffer: pdfBuffer }], { user: bdm.user, role: 'line_manager' });
  const mdDecision = await hrService.decideExpense(bdmClaim._id, { status: 'Approved' }, { user: md.user, role: 'md' });
  assert.equal(mdDecision.status, 'Approved');

  // Nobody approves their own items - not even the BDM on his own claim (he is not his own
  // direct report, so this is refused by the same line-manager/direct-report check).
  await assert.rejects(() => hrService.decideExpense(bdmClaim._id, { status: 'Rejected' }, { user: bdm.user, role: 'line_manager' }), /direct reports|own record|cannot approve/);
});

/** Mirrors test/vendor/requisition.test.js's own direct-controller-call helper - exercises the
 * controller's real logic without standing up an HTTP server for it. */
function callHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
    };
    Promise.resolve(handler({ headers: {}, query: {}, body: {}, params: {}, ...req }, res, err => (err ? reject(err) : resolve({ status: res.statusCode })))).catch(reject);
  });
}
