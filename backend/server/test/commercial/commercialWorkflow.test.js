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
  assert.match(deal.regionNote, /nearest/);
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
