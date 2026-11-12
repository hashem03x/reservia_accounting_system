const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');

// QA findings B1-B5 / U1-U8 + CRM launch blockers C1/C8 - end-to-end against a REAL MongoDB replica
// set (transactions) over REAL HTTP routes. Same seams as test/crm/changeRequest2Acceptance.test.js:
//   - utils/sendEmail is replaced with a recorder (notifications are asserted, never sent);
//   - authController.protect is replaced with a header login (x-test-user) that loads the REAL user;
//     every authorization check after it (requireCommercialAccess/Role, requireCrmAccess, the
//     approval role/segregation rules, the pricing-config manager check) is production code.
// Self-skips without TEST_DB_URI, like the rest of the DB suites.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

const sentEmails = [];
const sendEmailPath = require.resolve('../../utils/sendEmail');
require.cache[sendEmailPath] = { id: sendEmailPath, filename: sendEmailPath, loaded: true, exports: async (to, subject, html) => { sentEmails.push({ to, subject, html }); } };
const ApiError = require('../../utils/apiError');
const authPath = require.resolve('../../controller/user/authController');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    protect: async (req, res, next) => {
      const id = req.header('x-test-user');
      if (!id) return next(new ApiError('You are not logged in.', 401));
      req.user = await mongoose.model('User').findById(id);
      return req.user ? next() : next(new ApiError('Unknown user.', 401));
    },
    forgotPassword: (req, res) => res.status(200).json({}),
  },
};

let User, Lead, Activity, CommercialProject, CommercialRevision, CommercialApproval, CommercialSyncEvent, PricingConfig;
let leadService, publicLeadIntake, handoff;
let server, baseUrl;

const REGION = 'Cairo - 10th of Ramadan';
const REF_INPUT = { kWp: 80, pvModuleModel: 'JKM475M-7RL3', structureType: 'Hangar Roof', acLengthM: 20, acPricePerMOverride: 1195, annualConsumptionKwh: 155000 };

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  Lead = require('../../models/crm/leadModel');
  Activity = require('../../models/crm/activityModel');
  require('../../models/crm/stageHistoryModel');
  require('../../models/crm/intakeEventModel');
  CommercialProject = require('../../models/commercial/commercialProjectModel');
  CommercialRevision = require('../../models/commercial/commercialRevisionModel');
  CommercialApproval = require('../../models/commercial/commercialApprovalModel');
  CommercialSyncEvent = require('../../models/commercial/commercialSyncEventModel');
  PricingConfig = require('../../models/commercial/pricingConfigModel');
  await Promise.all([Lead.init(), CommercialProject.init(), PricingConfig.init(), User.init()]);
  leadService = require('../../services/crm/leadService');
  publicLeadIntake = require('../../services/crm/publicLeadIntakeService');
  handoff = require('../../services/crm/commercialHandoffService');

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/crm/leads', require('../../routes/crm/leadRoute'));
  app.use('/api/v1/commercial/projects', require('../../routes/commercial/projectRoute'));
  app.use('/api/v1/commercial/revisions', require('../../routes/commercial/revisionRoute'));
  app.use('/api/v1/commercial/approvals', require('../../routes/commercial/approvalRoute'));
  app.use('/api/v1/commercial/proposals', require('../../routes/commercial/proposalRoute'));
  app.use('/api/v1/commercial/suppliers', require('../../routes/commercial/supplierRoute'));
  app.use('/api/v1/commercial/pricing-config', require('../../routes/commercial/pricingConfigRoute'));
  app.use('/api/v1/commercial/handoff', require('../../routes/commercial/handoffRoute'));
  app.use(require('../../middleware/errorMiddleware'));
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!RUN) return;
  await new Promise(resolve => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  sentEmails.length = 0;
  const names = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name);
  await Promise.all(names.map(n => mongoose.connection.collection(n).deleteMany({})));
  const { seedCommercialMaterials } = require('../../scripts/seedCommercialMaterials');
  const { seedCommercialOffGridItems } = require('../../scripts/seedCommercialOffGridItems');
  const log = console.log;
  console.log = () => {};
  try {
    await seedCommercialMaterials({ dryRun: false, connect: false });
    await seedCommercialOffGridItems({ dryRun: false, connect: false });
  } finally {
    console.log = log;
  }
});

let seq = 0;
async function makeUser(name, memberships) {
  seq += 1;
  return User.create({ name, email: `${name.toLowerCase().replace(/\s+/g, '.')}.${seq}@reservia.test`, password: 'x', role: 'operator', type: 'online', systemMemberships: memberships });
}
const m = (system, role) => ({ system, role, isActive: true });
async function makeCustomer(name, phone) {
  return User.create({ name, phone, role: 'user', type: 'offline', isOffline: true });
}

async function api(method, url, { user, body } = {}) {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': String(user._id) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function team() {
  return {
    md: await makeUser('Ahmed MD', [m('COMMERCIAL', 'md'), m('CRM', 'md')]),
    director: await makeUser('Dina Director', [m('COMMERCIAL', 'commercial_director')]),
    sales: await makeUser('Sara Sales', [m('COMMERCIAL', 'sales'), m('CRM', 'sales')]),
    tech: await makeUser('Tarek Tech', [m('COMMERCIAL', 'technical')]),
    finance: await makeUser('Fatma Finance', [m('ERP', 'admin')]),
  };
}

async function createReferenceProject(user, customer, extra = {}) {
  const res = await api('POST', '/api/v1/commercial/projects', { user, body: { name: 'Reference 80 kWp', customer: customer._id, country: 'Egypt', region: REGION, category: 'On-Grid C&I', scope: 'Supply & Installation', ...extra } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.project;
}

// ===================================================================================== B3

maybeTest('B3: the pricing configuration defaults to the brief 3.3 levers; only Finance/Director/MD may change it; every change is audited', async () => {
  const t = await team();
  const read = await api('GET', '/api/v1/commercial/pricing-config', { user: t.sales });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.data.levers, { overheadPct: 0.1, contingencyPct: 0.02, profitPct: 0.1, salesBonusPct: 0.055, engineeringIncentivePct: 0.05, categoryAdditionPct: 0.19, discountPct: 0 });
  assert.equal(read.body.data.vatPctByCountry.Egypt, 0.14);
  assert.equal(read.body.data.canManage, false);

  const denied = await api('PUT', '/api/v1/commercial/pricing-config', { user: t.sales, body: { levers: { profitPct: 0.2 } } });
  assert.equal(denied.status, 403);
  const tooHigh = await api('PUT', '/api/v1/commercial/pricing-config', { user: t.finance, body: { levers: { profitPct: 19 } } });
  assert.equal(tooHigh.status, 400, 'a typo like 1900% is refused');

  const ok = await api('PUT', '/api/v1/commercial/pricing-config', { user: t.finance, body: { levers: { profitPct: 0.12 }, note: 'Q4 margin' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.version, 2);
  assert.equal(ok.body.data.levers.profitPct, 0.12);
  const audit = await PricingConfig.Audit.find({}).lean();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].before.levers.profitPct, 0.1);
  assert.equal(audit[0].after.levers.profitPct, 0.12);
  assert.equal(audit[0].changedByName, 'Fatma Finance');
});

// ===================================================================================== B2 + U1

maybeTest('B2/U1: region is a controlled list for Egypt (blank / "Cairo" refused AT CREATION); the customer must exist in the shared customer list; inline customer creation dedupes by phone', async () => {
  const t = await team();
  const customer = await makeCustomer('Acme Farms', '01001112222');
  const base = { name: 'P', customer: customer._id, country: 'Egypt', category: 'On-Grid C&I' };

  for (const region of [undefined, '', 'Cairo', 'Damanhour - Kafr El Sheikh - Mansoura - Wadi El Natrun - Alexandria']) {
    const res = await api('POST', '/api/v1/commercial/projects', { user: t.sales, body: { ...base, region } });
    assert.equal(res.status, 400, `region ${JSON.stringify(region)} must be refused`);
    assert.match(res.body.message, /Region/);
  }
  const notCustomer = await api('POST', '/api/v1/commercial/projects', { user: t.sales, body: { ...base, region: REGION, customer: t.director._id } });
  assert.equal(notCustomer.status, 400);
  assert.match(notCustomer.body.message, /customer/i);

  const opts = await api('GET', '/api/v1/commercial/projects/form-options', { user: t.sales });
  assert.deepEqual(opts.body.data.regionsByCountry.Egypt, [
    'Cairo - 10th of Ramadan', 'Sharqia - Ismailia', 'Banha - Tanta - Menoufia', 'Damanhour - Kafr El Sheikh - Mansoura',
    'Fayoum - Beni Suef', 'Minya - Sohag - Assiut', 'Qena - Luxor - Aswan', 'Kharga - Dakhla - Farafra Oases',
  ]);
  // Other countries keep free-text location behaviour.
  const ksa = await api('POST', '/api/v1/commercial/projects', { user: t.sales, body: { ...base, country: 'Saudi Arabia', region: 'Riyadh' } });
  assert.equal(ksa.status, 201);

  const search = await api('GET', '/api/v1/commercial/projects/customers?keyword=acme', { user: t.sales });
  assert.equal(search.body.data.length, 1);
  const dup = await api('POST', '/api/v1/commercial/projects/customers', { user: t.sales, body: { name: 'Acme again', phone: '+201001112222' } });
  assert.equal(dup.status, 200, 'same phone -> the existing customer, not a duplicate');
  assert.equal(String(dup.body.data.customer._id), String(customer._id));
  const created = await api('POST', '/api/v1/commercial/projects/customers', { user: t.sales, body: { name: 'New Hotel', phone: '01223334444' } });
  assert.equal(created.status, 201);
  assert.ok(created.body.data.customer.customerNumber, 'customer number generated by the shared customer model');
});

// ===================================================================================== B3/B4/B5/B6/B7 through the real revision pipeline

maybeTest('Reference deal through the real pipeline: 169 modules, standard levers from configuration (snapshotted), per kWp on 80, feasibility capex = final incl VAT, payback ~4.3 y at 10%', async () => {
  const t = await team();
  const project = await createReferenceProject(t.sales, await makeCustomer('Ref Customer', '01009998888'));
  assert.match(project.dealNumber, /^DEAL-\d{4}-\d{3}$/);
  assert.equal(project.proposalNumber, `${project.dealNumber}-P01`);
  assert.equal(project.proposedErpProjectNumber, `${project.dealNumber}-PRJ`);
  assert.equal(project.erpProject, null, 'no ERP project is fabricated');

  const res = await api('POST', `/api/v1/commercial/revisions/project/${project._id}`, { user: t.sales, body: { engineeringInput: REF_INPUT } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const rev = res.body.data;
  assert.equal(rev.boqLines.find(l => l.component === 'PV Modules').qty, 169);
  assert.equal(rev.pricing.profitPct, 0.1);
  assert.equal(rev.pricing.categoryAdditionPct, 0.19);
  assert.equal(rev.pricingConfigApplied.configVersion, 1);
  assert.equal(rev.pricingConfigApplied.source, 'config');
  assert.ok(Math.abs(rev.pricing.profitAmt - rev.pricing.cogs * 0.1) < 1e-6, 'profit on COGS');
  assert.ok(Math.abs(rev.pricing.perKwpExclVat - rev.pricing.netExclVat / 80) < 1e-6);
  assert.ok(Math.abs(rev.pricing.grossProfitPct - 0.3084) < 0.0005);
  assert.equal(rev.feasibility.priceBasis.capex, rev.pricing.grossInclVat);
  assert.equal(rev.feasibility.headline.escalation, 0.1);
  assert.ok(rev.feasibility.headline.paybackYears > 4 && rev.feasibility.headline.paybackYears < 4.5, `payback ${rev.feasibility.headline.paybackYears}`);
  assert.equal(rev.mdRequired, true, 'net above EGP 1.5M');
  assert.match(rev.waitingOn, /Stage 1/);
});

maybeTest('B3: a Finance change applies to NEW revisions only; an open revision keeps the rates it was priced with unless re-applied explicitly', async () => {
  const t = await team();
  const customer = await makeCustomer('Keep Rates', '01005556666');
  const p1 = await createReferenceProject(t.sales, customer);
  const r1 = (await api('POST', `/api/v1/commercial/revisions/project/${p1._id}`, { user: t.sales, body: { engineeringInput: REF_INPUT } })).body.data;
  await api('PUT', '/api/v1/commercial/pricing-config', { user: t.finance, body: { levers: { profitPct: 0.12 } } });

  const recalculated = (await api('PATCH', `/api/v1/commercial/revisions/${r1._id}`, { user: t.sales, body: { engineeringInput: REF_INPUT } })).body.data;
  assert.equal(recalculated.pricing.profitPct, 0.1, 'existing revision keeps its 10%');
  assert.equal(recalculated.pricingConfigApplied.configVersion, 1);

  const p2 = await createReferenceProject(t.sales, customer);
  const r2 = (await api('POST', `/api/v1/commercial/revisions/project/${p2._id}`, { user: t.sales, body: { engineeringInput: REF_INPUT } })).body.data;
  assert.equal(r2.pricing.profitPct, 0.12, 'new revision uses the new configuration');
  assert.equal(r2.pricingConfigApplied.configVersion, 2);

  const reapplied = (await api('PATCH', `/api/v1/commercial/revisions/${r1._id}`, { user: t.sales, body: { applyCurrentConfig: true } })).body.data;
  assert.equal(reapplied.pricing.profitPct, 0.12);
  assert.equal(reapplied.pricingConfigApplied.configVersion, 2);
});

// ===================================================================================== U4/U5/U6

maybeTest('U4/U5/U6: production approval roles, segregation of duties, approver names recorded, project rollups follow the stages', async () => {
  const t = await team();
  const project = await createReferenceProject(t.sales, await makeCustomer('Approvals Co', '01007770000'));
  const rev = (await api('POST', `/api/v1/commercial/revisions/project/${project._id}`, { user: t.sales, body: { engineeringInput: REF_INPUT } })).body.data;
  const decide = (user, stage, status = 'Approved') => api('PATCH', `/api/v1/commercial/approvals/${rev._id}/${stage}`, { user, body: { status, note: 'ok' } });

  assert.equal((await decide(t.md, 'stage1')).status, 403, 'the MD is not a Stage 1 signatory');
  assert.equal((await decide(t.director, 'stage1')).status, 403, 'the Director is not a Stage 1 signatory');
  assert.equal((await decide(t.sales, 'stage2')).status, 403, 'Stage 1 role cannot sign Stage 2');

  const s1 = await decide(t.sales, 'stage1');
  assert.equal(s1.status, 200);
  assert.equal(s1.body.data.stage1.approverName, 'Sara Sales');
  assert.equal((await decide(t.tech, 'stage1')).status, 400, 'an already decided stage cannot be re-signed');
  assert.equal((await CommercialProject.findById(project._id).lean()).engineeringApprovalRollup, 'APPROVED');

  assert.equal((await decide(t.sales, 'md')).status, 403, 'Stage 1 signer is NOT offered MD (QA U6)');
  assert.equal((await decide(t.md, 'md')).status, 400, 'MD waits for Stage 2');
  assert.equal((await decide(t.director, 'stage2')).status, 200);
  const md = await decide(t.md, 'md');
  assert.equal(md.status, 200);
  assert.equal(md.body.data.releaseStatus, 'APPROVED FOR ISSUE');
  assert.equal((await CommercialProject.findById(project._id).lean()).commercialApprovalRollup, 'APPROVED');

  const detail = await api('GET', `/api/v1/commercial/projects/${project._id}`, { user: t.sales });
  const cr = detail.body.data.currentRevision;
  assert.equal(cr.stage1.approver.name, 'Sara Sales');
  assert.equal(cr.stage2.approverName, 'Dina Director');
  assert.equal(cr.md.approverName, 'Ahmed MD');
  assert.equal(cr.waitingOn, null);

  const proposal = await api('POST', `/api/v1/commercial/proposals/revision/${rev._id}`, { user: t.director });
  assert.equal(proposal.status, 201);
  assert.equal(proposal.body.data.proposalNumber, `${project.dealNumber}-P01`);

  // Segregation even across a role change: the Stage 1 signer later promoted to Director cannot sign Stage 2 of the same revision.
  const p2 = await createReferenceProject(t.sales, await makeCustomer('Seg Co', '01007771111'));
  const r2 = (await api('POST', `/api/v1/commercial/revisions/project/${p2._id}`, { user: t.sales, body: { engineeringInput: REF_INPUT } })).body.data;
  assert.equal((await api('PATCH', `/api/v1/commercial/approvals/${r2._id}/stage1`, { user: t.sales, body: { status: 'Approved' } })).status, 200);
  await User.updateOne({ _id: t.sales._id }, { $set: { systemMemberships: [m('COMMERCIAL', 'commercial_director'), m('CRM', 'sales')] } });
  const seg = await api('PATCH', `/api/v1/commercial/approvals/${r2._id}/stage2`, { user: t.sales, body: { status: 'Approved' } });
  assert.equal(seg.status, 403);
  assert.match(seg.body.message, /different person/);
});

// ===================================================================================== B1

maybeTest('B1: projects are edited in place; a region change resets the revision to Draft (sign-offs reset, issue blocked) until recalculated with the new rates; a name change does not', async () => {
  const t = await team();
  const project = await createReferenceProject(t.sales, await makeCustomer('Edit Co', '01003334444'));
  const rev = (await api('POST', `/api/v1/commercial/revisions/project/${project._id}`, { user: t.sales, body: { engineeringInput: REF_INPUT } })).body.data;
  await api('PATCH', `/api/v1/commercial/approvals/${rev._id}/stage1`, { user: t.sales, body: { status: 'Approved' } });

  const rename = await api('PATCH', `/api/v1/commercial/projects/${project._id}`, { user: t.sales, body: { name: 'Edit Co - 80 kWp' } });
  assert.equal(rename.status, 200);
  assert.equal(rename.body.data.projectCode, project.projectCode, 'same project, same code');
  assert.equal(rename.body.data.currentRevision.status, 'Calculated');
  assert.equal(rename.body.data.currentRevision.stage1.status, 'Approved');

  const badRegion = await api('PATCH', `/api/v1/commercial/projects/${project._id}`, { user: t.sales, body: { region: 'Minya' } });
  assert.equal(badRegion.status, 400);

  const moved = await api('PATCH', `/api/v1/commercial/projects/${project._id}`, { user: t.sales, body: { region: 'Minya - Sohag - Assiut' } });
  assert.equal(moved.status, 200);
  const draft = moved.body.data.currentRevision;
  assert.equal(draft.status, 'Draft');
  assert.match(draft.invalidationReason, /region/);
  assert.equal(draft.stage1.status, 'Pending');
  assert.equal(draft.releaseStatus, 'NOT RELEASED');
  assert.equal(String(draft._id), String(rev._id), 'same revision, never a new project or revision');
  const p = await CommercialProject.findById(project._id).lean();
  assert.equal(p.editHistory.length, 2);
  assert.equal(p.editHistory[1].revisionReset, true);
  assert.ok((await CommercialApproval.find({ revision: rev._id, status: 'Pending' }).lean()).some(a => /Reset from Approved/.test(a.note)), 'the reset is in the append-only approval log');

  assert.equal((await api('PATCH', `/api/v1/commercial/approvals/${rev._id}/stage1`, { user: t.tech, body: { status: 'Approved' } })).status, 400, 'no signing a Draft');
  assert.equal((await api('POST', `/api/v1/commercial/proposals/revision/${rev._id}`, { user: t.md })).status, 400, 'no issuing a Draft');

  const recalc = (await api('PATCH', `/api/v1/commercial/revisions/${rev._id}`, { user: t.sales, body: { engineeringInput: REF_INPUT } })).body.data;
  assert.equal(recalc.status, 'Calculated');
  const install = recalc.boqLines.find(l => l.component === 'Installation');
  assert.equal(install.unitPrice, 400, 'Minya band 4 installation rate');
  assert.equal(recalc.boqLines.find(l => l.component === 'Transportation').unitPrice, 11000, 'Minya band 4 transport');
});

// ===================================================================================== B5 handoff

async function walkToProposal(lead, actor, role = 'md') {
  for (const to of ['contacted', 'qualified', 'site_survey', 'proposal_sent']) {
    // eslint-disable-next-line no-await-in-loop
    await leadService.changeStage(lead._id, { to, followUpAt: '2026-12-01' }, { userId: actor._id, role });
  }
  return Lead.findById(lead._id).lean();
}

maybeTest('B5: Proposal sent creates ONE Commercial deal prefilled from the lead, returns Deal/Proposal/ERP numbers to the lead; retries are idempotent; Won and Lost flow through', async () => {
  const t = await team();
  const existingCustomer = await makeCustomer('Wadi Farms', '01011112222');
  const { lead } = await leadService.intakeLead({ name: 'Wadi Farms', phone: '+201011112222', segment: 'farm', governorate: 'Fayoum', channel: 'phone', source: 'Referral', valueEgp: 900000, systemSizeKwp: 60 }, { userId: t.md._id });

  const atProposal = await walkToProposal(lead, t.md);
  assert.equal(atProposal.stage, 'proposal_sent');
  assert.equal(atProposal.commercial.syncStatus, 'synced');
  assert.match(atProposal.commercial.dealNumber, /^DEAL-/);
  assert.equal(atProposal.commercial.proposalNumber, `${atProposal.commercial.dealNumber}-P01`);
  assert.equal(atProposal.commercial.proposedErpProjectNumber, `${atProposal.commercial.dealNumber}-PRJ`);
  assert.match(atProposal.commercial.projectCode, /^PMP-/);

  const project = await CommercialProject.findOne({ crmLead: lead._id }).lean();
  assert.equal(project.category, 'Agriculture Pumping');
  assert.equal(project.region, 'Fayoum - Beni Suef');
  assert.equal(project.estimatedValueEgp, 900000);
  assert.equal(project.estimatedKwp, 60);
  assert.equal(project.crmLeadRef, lead.refCode);
  assert.equal(String(project.customer._id || project.customer), String(existingCustomer._id), 'the existing shared customer is reused, not duplicated');
  assert.equal(await User.countDocuments({ role: 'user' }), 1);

  // Retry / duplicate trigger: still exactly one project.
  const retry = await api('POST', `/api/v1/crm/leads/${lead._id}/commercial-sync`, { user: t.md });
  assert.equal(retry.status, 200);
  await handoff.syncLeadEvent(lead._id, 'proposal');
  assert.equal(await CommercialProject.countDocuments({ crmLead: lead._id }), 1);
  assert.ok((await CommercialSyncEvent.find({ lead: lead._id, event: 'proposal' }).lean()).some(e => e.replay), 'replays are recorded as such');

  // Lost (with reason) then reopened by the MD then Won.
  await leadService.changeStage(lead._id, { to: 'lost', lostReason: 'Price' }, { userId: t.md._id, role: 'md' });
  let deal = await CommercialProject.findById(project._id).lean();
  assert.equal(deal.outcome, 'Lost');
  assert.equal(deal.lostReason, 'Price');
  await leadService.changeStage(lead._id, { to: 'proposal_sent', followUpAt: '2026-12-01', overrideReason: 'Customer came back' }, { userId: t.md._id, role: 'md' });
  deal = await CommercialProject.findById(project._id).lean();
  assert.equal(deal.outcome, 'Open');
  await leadService.changeStage(lead._id, { to: 'won', valueEgp: 950000 }, { userId: t.md._id, role: 'md' });
  deal = await CommercialProject.findById(project._id).lean();
  assert.equal(deal.outcome, 'Won');
  assert.equal(deal.wonValueEgp, 950000);
  assert.equal(deal.erpProject, null, 'Won never fabricates an ERP project');
  const wonLead = await Lead.findById(lead._id).lean();
  assert.equal(wonLead.commercial.lastEvent, 'won');
  assert.equal(await CommercialProject.countDocuments({ crmLead: lead._id }), 1);

  const log = await api('GET', `/api/v1/crm/leads/${lead._id}/commercial-sync`, { user: t.md });
  assert.ok(log.body.data.length >= 4);
});

maybeTest('CRM CR 12 Nov item 1: no governorate -> refused at Qualified; a legacy lead whose sync failed cannot be marked Won; set the governorate, Retry, then Won works', async () => {
  const t = await team();
  const { lead } = await leadService.intakeLead({ name: 'Villa Owner', phone: '01022223333', segment: 'villa', channel: 'phone', source: 'Referral', valueEgp: 400000 }, { userId: t.md._id });
  await leadService.changeStage(lead._id, { to: 'contacted' }, { userId: t.md._id, role: 'md' });
  // Asked for at Qualified at the latest (not overridable, even by the MD).
  const refused = await api('PATCH', `/api/v1/crm/leads/${lead._id}/stage`, { user: t.md, body: { to: 'qualified', followUpAt: '2026-12-01' } });
  assert.equal(refused.status, 400);
  assert.match(refused.body.message, /Set the governorate/);
  const refusedOverride = await api('PATCH', `/api/v1/crm/leads/${lead._id}/stage`, { user: t.md, body: { to: 'qualified', followUpAt: '2026-12-01', overrideReason: 'try' } });
  assert.equal(refusedOverride.status, 400);
  // The governorate can be given with the move itself.
  const ok = await api('PATCH', `/api/v1/crm/leads/${lead._id}/stage`, { user: t.md, body: { to: 'qualified', followUpAt: '2026-12-01', governorate: 'Giza' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.governorate, 'Giza');

  // The RSV-1011-0009 case: a lead that reached Proposal sent BEFORE this rule, with no governorate.
  const { lead: legacy } = await leadService.intakeLead({ name: 'Legacy Villa', phone: '01022224444', segment: 'villa', channel: 'phone', source: 'Referral', valueEgp: 400000 }, { userId: t.md._id });
  await Lead.updateOne({ _id: legacy._id }, { $set: { stage: 'proposal_sent', followUpAt: '2026-12-01' } });
  await handoff.syncLeadEvent(legacy._id, 'proposal');
  let l = await Lead.findById(legacy._id).lean();
  assert.equal(l.commercial.syncStatus, 'failed');
  assert.match(l.commercial.lastError, /governorate/);
  assert.equal(await CommercialProject.countDocuments({ crmLead: legacy._id }), 0);
  assert.ok(await Activity.findOne({ lead: legacy._id, body: /Deal Engine sync \(proposal\) failed/ }));

  // Won is blocked (with the reason) while the sync is failed - even with the governorate given now.
  const wonBlocked = await api('PATCH', `/api/v1/crm/leads/${legacy._id}/stage`, { user: t.md, body: { to: 'won', valueEgp: 400000, governorate: 'Alexandria' } });
  assert.equal(wonBlocked.status, 400);
  assert.match(wonBlocked.body.message, /Deal Engine deal for this lead is not in sync.*Retry/);
  l = await Lead.findById(legacy._id).lean();
  assert.equal(l.stage, 'proposal_sent', 'the lead did not become Won');

  // Retry still fails until the governorate is set; the new details edit sets it (and logs it).
  assert.equal((await api('POST', `/api/v1/crm/leads/${legacy._id}/commercial-sync`, { user: t.md })).status, 422);
  const edited = await api('PATCH', `/api/v1/crm/leads/${legacy._id}`, { user: t.md, body: { governorate: 'Alexandria' } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.ok(await Activity.findOne({ lead: legacy._id, body: /Governorate: \(empty\) -> Alexandria/ }));
  const badGov = await api('PATCH', `/api/v1/crm/leads/${legacy._id}`, { user: t.md, body: { governorate: 'Atlantis' } });
  assert.equal(badGov.status, 400);
  const fixed = await api('POST', `/api/v1/crm/leads/${legacy._id}/commercial-sync`, { user: t.md });
  assert.equal(fixed.status, 200);
  const deal = await CommercialProject.findOne({ crmLead: legacy._id }).lean();
  assert.equal(deal.category, 'On-Grid C&I');
  assert.equal(deal.subCategory, 'Villa / building');
  assert.equal(deal.region, 'Damanhour - Kafr El Sheikh - Mansoura');
  assert.match(deal.regionNote, /Region mapped from governorate Alexandria/); // A3 (C26) maps Alexandria directly
  assert.equal((await Lead.findById(legacy._id).lean()).commercial.syncStatus, 'synced');

  // Now Won goes through and the deal follows.
  const won = await api('PATCH', `/api/v1/crm/leads/${legacy._id}/stage`, { user: t.md, body: { to: 'won', valueEgp: 400000 } });
  assert.equal(won.status, 200, JSON.stringify(won.body));
  assert.equal((await CommercialProject.findOne({ crmLead: legacy._id }).lean()).outcome, 'Won');
});

maybeTest('CRM CR 12 Nov item 2: a repeat enquiry on a Lost lead reopens it to New, notifies the owner (or the MD when unassigned), and the deal goes back to Open', async () => {
  const t = await team();
  // Owned lead with a deal, lost.
  const { lead } = await leadService.intakeLead({ name: 'Back Again', phone: '01055556666', segment: 'factory', governorate: 'Giza', channel: 'phone', source: 'Referral', owner: t.sales._id }, { userId: t.md._id });
  await Lead.updateOne({ _id: lead._id }, { $set: { owner: t.sales._id } });
  await walkToProposal(lead, t.md);
  await leadService.changeStage(lead._id, { to: 'lost', lostReason: 'Price' }, { userId: t.md._id, role: 'md' });
  assert.equal((await CommercialProject.findOne({ crmLead: lead._id }).lean()).outcome, 'Lost');
  sentEmails.length = 0;

  const again = await leadService.intakeLead({ phone: '+201055556666', channel: 'whatsapp' }, { skipRepeatNote: true });
  assert.equal(again.created, false);
  const l = await Lead.findById(lead._id).lean();
  assert.equal(l.stage, 'new');
  assert.equal(l.lostReason, null);
  assert.ok(await Activity.findOne({ lead: lead._id, body: /Reopened automatically from Lost to New: repeat enquiry .*Previous lost reason: Price.*Notified: Sara Sales/ }));
  const StageHistory = mongoose.model('CrmStageHistory');
  assert.ok(await StageHistory.findOne({ lead: lead._id, from: 'lost', to: 'new' }));
  assert.ok(sentEmails.some(e => e.to === t.sales.email && /reopened/i.test(e.subject)), 'the owner is emailed');
  assert.equal((await CommercialProject.findOne({ crmLead: lead._id }).lean()).outcome, 'Open');

  // Unassigned lost lead -> the MD is notified.
  const { lead: orphan } = await leadService.intakeLead({ name: 'Nobody', phone: '01066667777', channel: 'phone', source: 'Referral' }, { userId: t.md._id });
  await Lead.updateOne({ _id: orphan._id }, { $set: { owner: null, stage: 'lost', lostReason: 'Price' } });
  sentEmails.length = 0;
  await leadService.intakeLead({ phone: '01066667777', channel: 'phone', source: 'Referral' });
  assert.equal((await Lead.findById(orphan._id).lean()).stage, 'new');
  assert.ok(sentEmails.some(e => e.to === t.md.email), 'the MD is emailed for an unassigned lead');

  // An archived lost lead (a removed test lead) is not reopened.
  const { lead: archived } = await leadService.intakeLead({ name: 'Archived', phone: '01077778888', channel: 'phone', source: 'Referral' }, { userId: t.md._id });
  await Lead.updateOne({ _id: archived._id }, { $set: { stage: 'lost', lostReason: 'Price', archived: true } });
  await leadService.intakeLead({ phone: '01077778888', channel: 'phone', source: 'Referral' });
  assert.equal((await Lead.findById(archived._id).lean()).stage, 'lost');
});

maybeTest('B5: concurrent Proposal triggers for one lead still create exactly one project (unique crmLead index)', async () => {
  const t = await team();
  const { lead } = await leadService.intakeLead({ name: 'Race Co', phone: '01033334444', segment: 'factory', governorate: 'Giza', channel: 'phone', source: 'Referral' }, { userId: t.md._id });
  await Lead.updateOne({ _id: lead._id }, { $set: { stage: 'proposal_sent' } });
  const results = await Promise.all([1, 2, 3, 4].map(() => handoff.syncLeadEvent(lead._id, 'proposal')));
  assert.ok(results.every(r => r.ok), JSON.stringify(results.map(r => r.error)));
  assert.equal(await CommercialProject.countDocuments({ crmLead: lead._id }), 1);
  assert.equal(new Set(results.map(r => r.identifiers.dealNumber)).size, 1);
});

// ===================================================================================== C1 + C8

maybeTest('C1: website attribution - first touch /en/farms google/cpc/test survives navigation; a later Meta campaign enquiry becomes the LAST touch without destroying the first', async () => {
  await makeUser('Sam Sales', [m('CRM', 'sales')]);
  const first = { params: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'test', gclid: 'Cj0K' }, landingPage: '/en/farms', landingUrl: '/en/farms?utm_source=google&utm_medium=cpc&utm_campaign=test&gclid=Cj0K', referrer: 'https://www.google.com/', at: '2026-11-12T08:00:00.000Z' };
  const { refCode } = await publicLeadIntake.intakePublicLead({
    name: 'Farm Owner', phone: '01044445555', segment: 'agriculture', source: 'contact_form', eventId: 'evt-c1-1',
    pageUrl: '/en/farms', utm: first.params, referrer: first.referrer, submittedFrom: '/en/contact', attribution: { first, last: first },
  });
  let lead = await Lead.findOne({ refCode }).lean();
  assert.equal(lead.source, 'Google Ads');
  assert.equal(lead.utmMedium, 'cpc');
  assert.equal(lead.campaign, 'test');
  assert.equal(lead.landingPage, '/en/farms', 'never /en/contact');
  assert.equal(lead.gclid, 'Cj0K');
  assert.equal(lead.firstTouch.source, 'Google Ads');
  assert.equal(lead.lastTouch.utmCampaign, 'test');

  const metaTouch = { params: { utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'farms-dec', fbclid: 'IwAR' }, landingPage: '/en/lp/farms', at: '2026-11-20T08:00:00.000Z' };
  await publicLeadIntake.intakePublicLead({ name: 'Farm Owner', phone: '+201044445555', segment: 'agriculture', source: 'landing_form', eventId: 'evt-c1-2', attribution: { first, last: metaTouch } });
  lead = await Lead.findOne({ refCode }).lean();
  assert.equal(await Lead.countDocuments({}), 1, 'merged, not duplicated');
  assert.equal(lead.source, 'Google Ads', 'first-touch source unchanged');
  assert.equal(lead.landingPage, '/en/farms');
  assert.equal(lead.firstTouch.utmCampaign, 'test');
  assert.equal(lead.lastTouch.source, 'Meta Ads');
  assert.equal(lead.lastTouch.fbclid, 'IwAR');
  assert.ok(lead.attributionHistory.length >= 2);
});

maybeTest('C1: click ids and referrers classify correctly (gclid-only -> Google Ads, ttclid -> TikTok, search referrer -> Organic, nothing -> Direct); legacy payloads still work', async () => {
  const cases = [
    [{ params: { gclid: 'abc' }, landingPage: '/en' }, 'Google Ads'],
    [{ params: { wbraid: 'abc' }, landingPage: '/en' }, 'Google Ads'],
    [{ params: { utm_source: 'tiktok', utm_medium: 'paid', ttclid: 'E.C' }, landingPage: '/en/lp/villas' }, 'TikTok'],
    [{ params: { ttclid: 'E.C' }, landingPage: '/en' }, 'TikTok'],
    [{ params: {}, landingPage: '/en/industrial', referrer: 'https://www.google.com/search' }, 'Organic'],
    [{ params: {}, landingPage: '/en' }, 'Direct'],
    [{ params: { fbclid: 'IwAR' }, landingPage: '/en' }, 'Other'],
  ];
  let i = 0;
  for (const [touch, expected] of cases) {
    i += 1;
    // eslint-disable-next-line no-await-in-loop
    const { refCode } = await publicLeadIntake.intakePublicLead({ name: `Case ${i}`, phone: `0105555000${i}`, segment: 'villas', source: 'contact_form', eventId: `evt-cls-${i}`, attribution: { first: { ...touch, at: new Date().toISOString() } } });
    // eslint-disable-next-line no-await-in-loop
    const lead = await Lead.findOne({ refCode }).lean();
    assert.equal(lead.source, expected, `${JSON.stringify(touch)} -> ${expected}`);
  }
  const legacy = await publicLeadIntake.intakePublicLead({ name: 'Old build', phone: '01066667777', segment: 'villas', source: 'contact_form', eventId: 'evt-legacy', pageUrl: 'https://www.reservia-energy.com/en/villas?utm_source=x', utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'old' } });
  const legacyLead = await Lead.findOne({ refCode: legacy.refCode }).lean();
  assert.equal(legacyLead.source, 'Google Ads');
  assert.equal(legacyLead.landingPage, '/en/villas', 'stored as a path, query dropped');
});

maybeTest('C8: with no active CRM Sales user, an automated lead is never silently unassigned - the timeline says so and every CRM manager is emailed', async () => {
  const md = await makeUser('Ahmed MD', [m('CRM', 'md')]);
  const { refCode } = await publicLeadIntake.intakePublicLead({ name: 'Nobody Owns Me', phone: '01077778888', segment: 'villas', source: 'contact_form', eventId: 'evt-c8' });
  const lead = await Lead.findOne({ refCode }).lean();
  assert.equal(lead.owner, null);
  assert.ok(await Activity.findOne({ lead: lead._id, body: /no active user holds the CRM Sales role/ }));
  await new Promise(r => setTimeout(r, 50));
  const mail = sentEmails.find(e => e.to === md.email);
  assert.ok(mail, 'the CRM MD was notified');
  assert.match(mail.subject, /UNASSIGNED/);
});

// ===================================================================================== Deal Engine 12 Nov
// Deal Engine Changes Required (12 Nov 2026): C1-C4, C5-C9, C11 on the A4 reference deal. The figures
// it prints are the new baseline the change list asks for ("re-run A4 after steps 2 and 3").
maybeTest('Deal Engine C1-C11: reference deal re-baseline - inverter by loading, Cairo yield, tariff from bills, four scenarios, inverter replacement, discounted payback, LCOE, rule version; MC4/accessories from configuration', async () => {
  const t = await team();
  const customer = await makeCustomer('Mostafa Ragab', '01077770000');
  const project = await createReferenceProject(t.sales, customer);
  const input = { ...REF_INPUT, annualBillEgp: 434000 }; // 155,000 kWh x 2.80
  const rev = (await api('POST', `/api/v1/commercial/revisions/project/${project._id}`, { user: t.sales, body: { engineeringInput: input } })).body.data;
  const d = rev.engineeringResult;
  // C3: 80.275 kWp DC -> the 60 kW unit (1.34; no Price Book inverter lands inside 1.10-1.30), not the 100 kW one.
  assert.equal(d.inverter.model, 'SUN2000-60KTL-M0');
  assert.equal(d.dcAc.status, 'outside-target');
  assert.equal(d.dcAc.flagged, false);
  // C4 / C8: region yield and the tariff from the bills.
  const a = rev.feasibility.assumptions;
  assert.equal(a.yieldKwhPerKwp, 1734);
  assert.equal(a.yieldSource, 'region');
  assert.match(a.yieldBasis, /NREL ATB 2024/);
  assert.equal(a.tariffEgpPerKwh, 2.8);
  assert.equal(a.tariffSource, 'bill');
  // C9: headline + 3% + flat + two-phase.
  assert.deepEqual([rev.feasibility.headline.label, ...rev.feasibility.sensitivities.map(s => s.label)], ['+10% per year', '+3% per year', 'Flat tariff', '+10% for 5 years, then +5%']);
  // C7: the inverter replacement in year 13 at today's Price Book price.
  const h = rev.feasibility.headline;
  assert.deepEqual(h.inverterReplacement, { year: 13, costEgp: d.inverter.price });
  assert.equal(h.years[12].inverterReplacement, d.inverter.price);
  assert.ok(h.years[12].net < h.years[12].savings - d.inverter.price + 1);
  // C6: discounted payback is the stricter figure; simple cost per kWh and a real LCOE.
  assert.ok(h.discountedPaybackYears > h.paybackYears, `${h.discountedPaybackYears} > ${h.paybackYears}`);
  assert.ok(h.simpleCostPerKwh > 0 && h.lcoePerKwh > h.simpleCostPerKwh, 'discounted LCOE is above the undiscounted ratio');
  // C5: no irradiation entered -> PR pending.
  assert.equal(rev.feasibility.performance.status, 'pending');
  // C11 + C1/C2 defaults (today's behaviour).
  assert.equal(rev.ruleVersion, 'DE-2026-11-12');
  const mc4 = rev.boqLines.find(l => l.component === 'MC4 Connectors');
  assert.equal(mc4.unitPrice, 40);
  assert.equal(mc4.qty, d.strings.parallelStrings * 2 + 4);
  assert.equal(rev.boqLines.find(l => l.component === 'Accessories').unitPrice, 85);
  console.log(`[A4 re-baseline 12 Nov] inverter ${d.inverter.model} DC/AC ${d.dcAc.ratio.toFixed(3)} | COGS ${rev.pricing.cogs.toFixed(2)} | net ${rev.pricing.netExclVat.toFixed(2)} | incl VAT ${rev.pricing.grossInclVat.toFixed(2)} | per kWp ${rev.pricing.perKwpExclVat.toFixed(2)} | GP ${(rev.pricing.grossProfitPct * 100).toFixed(1)}% | payback ${h.paybackLabel} (discounted ${h.discountedPaybackLabel}) | IRR ${(h.irr * 100).toFixed(1)}% | NPV ${h.npv.toFixed(0)} | 25yr savings ${h.lifetimeSavings.toFixed(0)} | simple cost/kWh ${h.simpleCostPerKwh.toFixed(3)} | LCOE ${h.lcoePerKwh.toFixed(3)}`);

  // C3 acceptance: forcing the 100 kW unit shows the below-range flag.
  const forced = (await api('PATCH', `/api/v1/commercial/revisions/${rev._id}`, { user: t.sales, body: { engineeringInput: { ...input, inverterModel: 'SUN2000-100KTL-M2' } } })).body.data;
  assert.equal(forced.engineeringResult.dcAc.status, 'below');
  assert.equal(forced.engineeringResult.dcAc.flagged, true);
  assert.equal(forced.engineeringResult.dcAc.forced, true);

  // C4 site override with its source; C8 a typed tariff that differs from the bills keeps its note; C5 PR.
  const site = (await api('PATCH', `/api/v1/commercial/revisions/${rev._id}`, {
    user: t.sales,
    body: { engineeringInput: { ...input, yieldKwhPerKwp: 1760, yieldSourceNote: 'PVsyst simulation, 12 Nov', tariffEgpPerKwh: 2.55, tariffNote: 'Medium voltage tariff per the latest bill', annualIrradiationKwhPerM2: 2200 } },
  })).body.data;
  assert.equal(site.feasibility.assumptions.yieldSource, 'site');
  assert.equal(site.feasibility.assumptions.yieldBasis, 'PVsyst simulation, 12 Nov');
  assert.equal(site.feasibility.assumptions.tariffSource, 'manual-override');
  assert.equal(site.feasibility.assumptions.tariffNote, 'Medium voltage tariff per the latest bill');
  assert.equal(site.feasibility.performance.status, 'computed');
  assert.ok(Math.abs(site.feasibility.performance.performanceRatio - 1760 / 2200) < 1e-9);

  // C1 / C2: the MD switches MC4 to per-module pairs at 90 and accessories to 150 - new revisions follow.
  const cfg = await api('PUT', '/api/v1/commercial/pricing-config', { user: t.md, body: { engine: { mc4: { rule: 'modulePairs', unitPriceEgp: 90 }, accessoriesRateEgpPerKwp: 150 }, note: 'MD decision C1/C2' } });
  assert.equal(cfg.status, 200, JSON.stringify(cfg.body));
  assert.equal(cfg.body.data.engine.mc4.rule, 'modulePairs');
  const p2 = await createReferenceProject(t.sales, customer);
  const rev2 = (await api('POST', `/api/v1/commercial/revisions/project/${p2._id}`, { user: t.sales, body: { engineeringInput: input } })).body.data;
  const mc4b = rev2.boqLines.find(l => l.component === 'MC4 Connectors');
  assert.deepEqual([mc4b.qty, mc4b.unit, mc4b.unitPrice], [85, 'pair', 90]);
  assert.equal(rev2.boqLines.find(l => l.component === 'Accessories').unitPrice, 150);
  assert.equal(rev2.engineSettingsApplied.mc4.rule, 'modulePairs');
  // A bad configuration value is refused.
  assert.equal((await api('PUT', '/api/v1/commercial/pricing-config', { user: t.md, body: { engine: { mc4: { rule: 'guess' } } } })).status, 400);
  assert.equal((await api('PUT', '/api/v1/commercial/pricing-config', { user: t.sales, body: { engine: { discountRate: 0.3 } } })).status, 403);
});

// Deal Engine C12-C17: the proposal document. Writes the PDFs to $PROPOSAL_PDF_DIR when set, for a
// visual check against attachment A1.
maybeTest('Deal Engine C12-C17: DRAFT preview before approvals, internal copy for pricing roles only, issue stores the PDF with its hash, P01 then P02 (both retrievable), the CRM lead gets the PDF and moves to Proposal sent', async () => {
  const t = await team();
  const crypto = require('crypto');
  const fs = require('fs');
  const Attachment = require('../../models/system/attachmentModel');
  const raw = async (url, user) => {
    const r = await fetch(`${baseUrl}${url}`, { headers: { 'x-test-user': String(user._id) } });
    return { status: r.status, type: r.headers.get('content-type'), buf: Buffer.from(await r.arrayBuffer()) };
  };
  const out = process.env.PROPOSAL_PDF_DIR;
  // A CRM lead at Site survey, handed to the Deal Engine (as Proposal sent would) - its project is the reference deal.
  const { lead } = await leadService.intakeLead({ name: 'Mostafa Ragab', phone: '01088889999', segment: 'factory', governorate: 'Cairo', channel: 'phone', source: 'Referral', valueEgp: 1700000 }, { userId: t.md._id });
  for (const to of ['contacted', 'qualified', 'site_survey']) await leadService.changeStage(lead._id, { to, followUpAt: '2026-12-01' }, { userId: t.md._id, role: 'md' });
  const customer = await makeCustomer('Mostafa Ragab', '01088889990');
  const project = await createReferenceProject(t.sales, customer);
  await CommercialProject.updateOne({ _id: project._id }, { $set: { crmLead: lead._id, crmLeadRef: lead.refCode } });
  const rev = (await api('POST', `/api/v1/commercial/revisions/project/${project._id}`, { user: t.sales, body: { engineeringInput: { ...REF_INPUT, annualBillEgp: 434000 } } })).body.data;

  // C14: preview before approvals, watermarked; the internal copy is refused to Technical.
  const draft = await raw(`/api/v1/commercial/proposals/revision/${rev._id}/preview`, t.tech);
  assert.equal(draft.status, 200);
  assert.equal(draft.type, 'application/pdf');
  assert.ok(draft.buf.subarray(0, 5).toString() === '%PDF-' && draft.buf.length > 20000, `a real PDF (${draft.buf.length} bytes)`);
  assert.equal((await raw(`/api/v1/commercial/proposals/revision/${rev._id}/preview?copy=internal`, t.tech)).status, 403);
  const draftInternal = await raw(`/api/v1/commercial/proposals/revision/${rev._id}/preview?copy=internal`, t.sales);
  assert.equal(draftInternal.status, 200);
  assert.ok(draftInternal.buf.length > draft.buf.length, 'the internal copy carries the priced BOQ, the stack and the approval log');
  if (out) {
    fs.writeFileSync(`${out}/proposal-draft-customer.pdf`, draft.buf);
    fs.writeFileSync(`${out}/proposal-draft-internal.pdf`, draftInternal.buf);
  }
  // Issue only after approvals.
  assert.equal((await api('POST', `/api/v1/commercial/proposals/revision/${rev._id}`, { user: t.sales })).status, 400);
  const decide = (user, stage) => api('PATCH', `/api/v1/commercial/approvals/${rev._id}/${stage}`, { user, body: { status: 'Approved', note: 'ok' } });
  assert.equal((await decide(t.sales, 'stage1')).status, 200);
  assert.equal((await decide(t.director, 'stage2')).status, 200);
  assert.equal((await decide(t.md, 'md')).status, 200);

  // C15: P01 with its stored PDF and hash; the issuer and time are recorded.
  const p1 = await api('POST', `/api/v1/commercial/proposals/revision/${rev._id}`, { user: t.sales });
  assert.equal(p1.status, 201, JSON.stringify(p1.body));
  assert.equal(p1.body.data.proposalNumber, `${project.dealNumber}-P01`);
  assert.match(p1.body.data.pdfHash, /^[a-f0-9]{64}$/);
  assert.ok(p1.body.data.issuedBy && p1.body.data.issuedAt);
  const pdf1 = await raw(`/api/v1/commercial/proposals/${p1.body.data._id}/pdf`, t.sales);
  assert.equal(pdf1.status, 200);
  assert.equal(crypto.createHash('sha256').update(pdf1.buf).digest('hex'), p1.body.data.pdfHash, 'the served PDF is the stored one');
  // C17: the CRM lead has the PDF and moved to Proposal sent; its timeline says so.
  const leadAfter = await Lead.findById(lead._id).lean();
  assert.equal(leadAfter.stage, 'proposal_sent');
  assert.ok(await Attachment.findOne({ ownerType: 'CrmLead', owner: lead._id, sha256: p1.body.data.pdfHash }), 'the issued PDF is on the lead');
  assert.ok(await Activity.findOne({ lead: lead._id, body: new RegExp(`Proposal ${project.dealNumber}-P01 issued`) }));

  // C15: a re-issue is a new number; the old PDF stays retrievable.
  const p2 = await api('POST', `/api/v1/commercial/proposals/revision/${rev._id}`, { user: t.sales });
  assert.equal(p2.body.data.proposalNumber, `${project.dealNumber}-P02`);
  assert.notEqual(p2.body.data.pdfHash, p1.body.data.pdfHash);
  assert.equal((await raw(`/api/v1/commercial/proposals/${p1.body.data._id}/pdf`, t.sales)).status, 200, 'P01 is still there');
  // C16: the internal copy of an issued proposal re-renders from its frozen data.
  const int1 = await raw(`/api/v1/commercial/proposals/${p1.body.data._id}/pdf?copy=internal`, t.director);
  assert.equal(int1.status, 200);
  assert.equal((await raw(`/api/v1/commercial/proposals/${p1.body.data._id}/pdf?copy=internal`, t.tech)).status, 403);
  if (out) {
    fs.writeFileSync(`${out}/proposal-P01-customer.pdf`, pdf1.buf);
    fs.writeFileSync(`${out}/proposal-P01-internal.pdf`, int1.buf);
  }
});

// ===================================================================================== C18-C24
// Deal Engine C18-C24 + C20: approved supplier list, supplier price list upload (preview -> confirm ->
// rollback), supplier status in BOQ pricing, the release rule and its Commercial Director override.
maybeTest('Deal Engine C18-C24: suppliers (MD approves), price list preview/confirm/rollback, Approved/Conditional/Suspended pricing, RECHECK PRICE, foreign prices, open-revision flag, release rule with Director override', async () => {
  const t = await team();
  const proc = await makeUser('Pia Procurement', [m('COMMERCIAL', 'procurement')]);
  const XLSX = require('xlsx');
  const MaterialItem = require('../../models/commercial/materialItemModel');
  const xlsxFile = rows => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Price list');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  };
  const uploadFile = async (supplierId, buf, name, fields = {}, user = proc) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf]), name);
    for (const [k, v] of Object.entries(fields)) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    const r = await fetch(`${baseUrl}/api/v1/commercial/suppliers/${supplierId}/price-lists/preview`, { method: 'POST', headers: { 'x-test-user': String(user._id) }, body: fd });
    return { status: r.status, body: await r.json() };
  };

  // C18: Procurement proposes, the MD approves; Sales cannot add, Procurement cannot approve.
  assert.equal((await api('POST', '/api/v1/commercial/suppliers', { user: t.sales, body: { legalName: 'X' } })).status, 403);
  const created = await api('POST', '/api/v1/commercial/suppliers', { user: proc, body: { legalName: 'El Marwa Trading', country: 'Egypt', city: 'Cairo', categories: ['PV Modules', 'On-Grid Inverter'], brands: ['JinkoSolar', 'Huawei'], contacts: [{ name: 'Omar', role: 'Sales', email: 'omar@example.com' }], terms: { currency: 'EGP', leadTimeDays: 14 } } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const sup = created.body.data;
  assert.match(sup.code, /^SUP-\d{4}$/);
  assert.equal(sup.status, 'Candidate');
  assert.equal((await api('PATCH', `/api/v1/commercial/suppliers/${sup._id}/status`, { user: proc, body: { status: 'Approved' } })).status, 403);
  const approved = await api('PATCH', `/api/v1/commercial/suppliers/${sup._id}/status`, { user: t.md, body: { status: 'Approved' } });
  assert.equal(approved.body.data.status, 'Approved');
  assert.ok(approved.body.data.approval.reviewDate, 'annual review date set');
  // Document expiry raises a review flag.
  const doc = await api('POST', `/api/v1/commercial/suppliers/${sup._id}/documents`, { user: proc, body: { kind: 'Tax card', expiry: '2026-01-01' } });
  assert.ok(doc.body.data.reviewFlags.some(f => /Tax card expired/.test(f)));

  // An open revision priced from the Reference price, to be flagged after the upload (C24).
  const project = await createReferenceProject(t.sales, await makeCustomer('Upload Co', '01060606060'));
  const rev0 = (await api('POST', `/api/v1/commercial/revisions/project/${project._id}`, { user: t.sales, body: { engineeringInput: REF_INPUT } })).body.data;
  assert.equal(rev0.boqLines.find(l => l.component === 'PV Modules').priceSource, 'reference');

  // C21/C22/C23: preview - nothing written yet.
  const header = ['Category', 'Brand', 'Model', 'Spec', 'Unit', 'Net Price', 'Currency', 'Availability', 'Lead time (days)', 'Minimum quantity', 'Rated value', 'Rated unit', 'Validity date'];
  const modItem = await MaterialItem.findOne({ category: 'PV Modules', model: 'JKM475M-7RL3' }).lean();
  const modKey = modItem.key;
  const [modBrand, , modSpec] = modKey.split(' | ');
  const rows = [
    header,
    ['PV Modules', modBrand, 'JKM475M-7RL3', modSpec, 'pcs', 4000, 'EGP', 'In stock', 0, 20, 475, 'W', '2026-12-31'],
    ['Lithium Batteries', 'Newmox', '51.2V 314Ah', 'LiFePO4 rack', 'pcs', 2500, 'USD', 'Lead time', 45, 1, 314, 'Ah', '2026-12-31'],
    ['On-Grid Inverter', 'Huawei', 'SUN2000-70KTL-NEW', '70 kW', 'pcs', 210000, 'EGP', 'Lead time', 21, 1, '', 'kW', '2026-12-31'],
    ['DC Cable', 'NewCable', '6mm2 test', '6 mm2 solar DC', 'm', 60, 'EGP', 'In stock', 0, 100, 6, 'mm2', '2026-12-31'],
    ['DC Cable', 'NewCable', '6mm2 test', '6 mm2 solar DC', 'm', 61, 'EGP', 'In stock', 0, 100, 6, 'mm2', '2026-12-31'],
  ];
  // "Net Price" is not the template header - map it explicitly the first time.
  const pv = await uploadFile(sup._id, xlsxFile(rows), 'elmarwa-nov.xlsx', { mapping: { unitPrice: 'Net Price' }, validityDate: '2026-12-31' });
  assert.equal(pv.status, 201, JSON.stringify(pv.body));
  const prev = pv.body.data;
  const byRow = Object.fromEntries(prev.rows.map(r => [r.rowNo, r]));
  assert.equal(byRow[2].status, 'Update', JSON.stringify(byRow[2]));
  assert.ok(byRow[2].changePct < 0, 'change % against the current price');
  assert.equal(byRow[3].status, 'Error');
  assert.match(byRow[3].errors.join(' '), /Currency without rate/);
  assert.equal(byRow[4].status, 'Error');
  assert.match(byRow[4].errors.join(' '), /Rated value missing/);
  assert.equal(byRow[5].status, 'New');
  assert.match(byRow[6].errors.join(' '), /Duplicate key/);
  assert.equal((await MaterialItem.findOne({ key: modKey }).lean()).supplierPrices.length, 0, 'nothing written on preview');

  // Confirm writes Update rows and the ticked New row; the open revision is flagged.
  const conf = await api('POST', `/api/v1/commercial/suppliers/price-lists/${prev._id}/confirm`, { user: proc, body: { createNew: [5] } });
  assert.equal(conf.status, 200, JSON.stringify(conf.body));
  assert.equal(conf.body.data.changes.length, 2);
  assert.ok(conf.body.data.flaggedRevisions >= 1);
  const mod = await MaterialItem.findOne({ key: modKey }).lean();
  assert.equal(mod.supplierPrices[0].supplierCode, sup.code);
  assert.equal(mod.supplierPrices[0].sourceFile, 'elmarwa-nov.xlsx');
  assert.ok(mod.supplierPrices[0].checkedAt && mod.supplierPrices[0].validUntil);
  assert.equal((await MaterialItem.findOne({ key: 'NewCable | 6mm2 test | 6 mm2 solar DC' }).lean()).status, 'PLACEHOLDER');
  assert.equal((await CommercialRevision.findById(rev0._id).lean()).priceChangedSinceCalculation, true);
  assert.equal((await api('POST', `/api/v1/commercial/suppliers/price-lists/${prev._id}/confirm`, { user: proc })).status, 409, 'confirm once');

  // C19: a new calculation prices the module from the Approved supplier (4,000 per module).
  const rev1 = (await api('PATCH', `/api/v1/commercial/revisions/${rev0._id}`, { user: t.sales, body: { engineeringInput: REF_INPUT } })).body.data;
  const pvLine = rev1.boqLines.find(l => l.component === 'PV Modules');
  assert.equal(pvLine.priceSource, 'supplier');
  assert.equal(pvLine.supplierCode, sup.code);
  assert.ok(Math.abs(pvLine.unitPrice - 4000) < 0.01, `unit price ${pvLine.unitPrice}`);
  assert.equal(rev1.priceChangedSinceCalculation, false, 'recalculating clears the flag');

  // C21: the next upload reuses the saved mapping ("Net Price" without being told).
  const again = await uploadFile(sup._id, xlsxFile([header, ['PV Modules', modBrand, 'JKM475M-7RL3', modSpec, 'pcs', 3900, 'EGP', 'In stock', 0, 20, 475, 'W', '2026-12-31']]), 'elmarwa-dec.xlsx');
  assert.equal(again.body.data.mapping.unitPrice, 'Net Price');
  assert.equal(again.body.data.rows[0].status, 'Update');

  // C19/C20: Conditional -> flagged and release-blocked; Director override with a note releases it.
  await api('PATCH', `/api/v1/commercial/suppliers/${sup._id}/status`, { user: t.md, body: { status: 'Conditional', note: 'Missing ISO certificate' } });
  const rev2 = (await api('PATCH', `/api/v1/commercial/revisions/${rev0._id}`, { user: t.sales, body: { engineeringInput: REF_INPUT } })).body.data;
  assert.ok(rev2.boqLines.find(l => l.component === 'PV Modules').priceFlags.includes('CONDITIONAL SUPPLIER'));
  for (const [user, stage] of [[t.sales, 'stage1'], [t.director, 'stage2'], [t.md, 'md']]) assert.equal((await api('PATCH', `/api/v1/commercial/approvals/${rev0._id}/${stage}`, { user, body: { status: 'Approved' } })).status, 200);
  const check = await api('GET', `/api/v1/commercial/proposals/revision/${rev0._id}/release-check`, { user: t.sales });
  assert.ok(check.body.data.blockers.some(b => /conditional supplier/.test(b)), JSON.stringify(check.body));
  const blocked = await api('POST', `/api/v1/commercial/proposals/revision/${rev0._id}`, { user: t.sales });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.message, /cannot be released yet/);
  assert.equal((await api('POST', `/api/v1/commercial/proposals/revision/${rev0._id}`, { user: t.sales, body: { releaseOverrideNote: 'Customer accepted' } })).status, 403);
  const released = await api('POST', `/api/v1/commercial/proposals/revision/${rev0._id}`, { user: t.director, body: { releaseOverrideNote: 'ISO certificate requested; price confirmed by phone' } });
  assert.equal(released.status, 201, JSON.stringify(released.body));
  assert.match(released.body.data.releaseOverride, /Dina Director \(commercial_director\) overrode: .*Note: ISO certificate requested/);

  // Suspended never prices: back to the Reference price.
  await api('PATCH', `/api/v1/commercial/suppliers/${sup._id}/status`, { user: t.director, body: { status: 'Suspended', note: 'Late deliveries' } });
  const rev3 = (await api('PATCH', `/api/v1/commercial/revisions/${rev0._id}`, { user: t.sales, body: { engineeringInput: REF_INPUT } })).body.data;
  assert.equal(rev3.boqLines.find(l => l.component === 'PV Modules').priceSource, 'reference');

  // C23: a foreign price converts at the configured rate and the BOQ shows both; past validity -> RECHECK PRICE.
  await api('PATCH', `/api/v1/commercial/suppliers/${sup._id}/status`, { user: t.md, body: { status: 'Approved' } });
  await api('PUT', '/api/v1/commercial/pricing-config', { user: t.md, body: { engine: { fxRatesEgp: { USD: 50 } } } });
  const invKey = (await MaterialItem.findOne({ category: 'On-Grid Inverter', model: 'SUN2000-60KTL-M0' }).lean()).key;
  const [invBrand, , invSpec] = invKey.split(' | ');
  const usd = await uploadFile(sup._id, xlsxFile([header, ['On-Grid Inverter', invBrand, 'SUN2000-60KTL-M0', invSpec, 'pcs', 3800, 'USD', 'In stock', 0, 1, 60, 'kW', '2026-01-31']]), 'usd.xlsx');
  assert.equal(usd.body.data.rows[0].egp, 190000, JSON.stringify(usd.body.data.rows[0]));
  await api('POST', `/api/v1/commercial/suppliers/price-lists/${usd.body.data._id}/confirm`, { user: proc });
  const rev4 = (await api('PATCH', `/api/v1/commercial/revisions/${rev0._id}`, { user: t.sales, body: { engineeringInput: REF_INPUT } })).body.data;
  const invLine = rev4.boqLines.find(l => l.component === 'Solar Inverters');
  assert.deepEqual([invLine.foreignPrice, invLine.priceCurrency, invLine.fxRate, invLine.unitPrice], [3800, 'USD', 50, 190000]);
  assert.ok(invLine.priceFlags.includes('RECHECK PRICE'), 'past its validity date');

  // C21: rolling back an upload restores that upload's prices only.
  const rb = await api('POST', `/api/v1/commercial/suppliers/price-lists/${usd.body.data._id}/rollback`, { user: proc });
  assert.equal(rb.status, 200, JSON.stringify(rb.body));
  assert.equal((await MaterialItem.findOne({ key: invKey }).lean()).supplierPrices.length, 0);
  assert.equal((await MaterialItem.findOne({ key: modKey }).lean()).supplierPrices.length, 1, 'the module price from the other upload stays');
  const notes = (await api('GET', `/api/v1/commercial/suppliers/${sup._id}`, { user: proc })).body.data.notes.map(n => n.text).join(' | ');
  assert.match(notes, /Candidate -> Approved.*Approved -> Conditional: Missing ISO certificate.*Conditional -> Suspended: Late deliveries/);
  assert.match(notes, /rolled back/);
});
