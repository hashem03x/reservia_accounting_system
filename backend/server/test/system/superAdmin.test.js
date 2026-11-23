const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// CRM's changeStage() runs inside session.withTransaction() (services/crm/leadService.js), same
// as test/crm/leadService.test.js's own header comment explains - a standalone (non-replica-set)
// MongoDB rejects this outright. These CRM tests self-skip, not fail, on exactly that environment
// (the same pre-existing limitation already true for the whole of leadService.test.js) - the Deal
// Engine tests above/below this guard never touch a session and are unaffected.
let crmTransactionsSupported = false;

// Feature 5 - the Global Super Administrator. Previously let a globalSuperAdmin-flagged account
// sign ANY Deal Engine approval stage regardless of role, and waived segregation of duties for
// consecutive approvals by the same account - this was the exact mechanism behind the 23 Nov 2026
// go-live incident (a Commercial Director account completed an approval stage that should have
// required the MD's explicit `md` role). Go-live Developer Pack section 3/4: "the platform
// administrator must not be able to impersonate the MD approval authority simply by possessing
// administrator permissions." Both bypasses are now removed (services/commercial/
// approvalService.js, middleware/commercialAccess.js, middleware/crmAccess.js): a super admin
// needs a REAL, explicit module membership and is bound by the SAME role/segregation-of-duties
// rules as everyone else. This file now verifies the ABSENCE of the old bypass, end to end.
//
// Self-skips without TEST_DB_URI, like every other DB-backed suite in this repo.
const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let User, CommercialRevision, SuperAdminOverrideLog, systemAccess, approvalService, leadService, superAdmin, ordinaryUser;
const superAdminTest = (...args) => (RUN && crmTransactionsSupported ? test(...args) : test.skip(...args));

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  CommercialRevision = require('../../models/commercial/commercialRevisionModel');
  SuperAdminOverrideLog = require('../../models/system/superAdminOverrideLogModel');
  systemAccess = require('../../utils/systemAccess');
  approvalService = require('../../services/commercial/approvalService');
  leadService = require('../../services/crm/leadService');

  superAdmin = await User.create({ name: 'Super Admin (Test)', email: 'super-admin-test@reservia-test.local', role: 'user', type: 'online', password: 'Pass1234!', globalSuperAdmin: true });
  ordinaryUser = await User.create({ name: 'Ordinary User', email: 'ordinary-user-test@reservia-test.local', role: 'user', type: 'online', password: 'Pass1234!' });

  const probe = await mongoose.startSession();
  try {
    await probe.withTransaction(async () => {});
    crmTransactionsSupported = true;
  } catch {
    crmTransactionsSupported = false;
  } finally {
    probe.endSession();
  }
});

after(async () => {
  if (!RUN) return;
  await mongoose.disconnect();
});

maybeTest('isGlobalSuperAdmin is true only for the flagged account', () => {
  assert.equal(systemAccess.isGlobalSuperAdmin(superAdmin), true);
  assert.equal(systemAccess.isGlobalSuperAdmin(ordinaryUser), false);
  assert.equal(systemAccess.isGlobalSuperAdmin(null), false);
});

maybeTest('hasActiveErpMembership bypasses for the super admin, stays false for an ordinary user with no membership', () => {
  assert.equal(systemAccess.hasActiveErpMembership(superAdmin), true);
  assert.equal(systemAccess.hasActiveErpMembership(ordinaryUser), false);
});

maybeTest('getEffectiveSystemAccess: super admin is active (with the owning role) on every implemented system; ordinary user is not', () => {
  const superAccess = systemAccess.getEffectiveSystemAccess(superAdmin);
  assert.equal(superAccess.ERP.active, true);
  assert.equal(superAccess.ERP.role, 'admin');
  assert.equal(superAccess.CRM.active, true);
  assert.equal(superAccess.CRM.role, 'md');
  assert.equal(superAccess.COMMERCIAL.active, true);
  assert.equal(superAccess.COMMERCIAL.role, 'md');
  assert.equal(superAccess.HR.active, true);
  assert.equal(superAccess.HR.role, 'md');
  assert.equal(superAccess.WEBSITE.active, true);
  assert.equal(superAccess.WEBSITE.role, 'admin');

  const ordinaryAccess = systemAccess.getEffectiveSystemAccess(ordinaryUser);
  assert.equal(ordinaryAccess.ERP.active, false);
  assert.equal(ordinaryAccess.CRM.active, false);
  assert.equal(ordinaryAccess.COMMERCIAL.active, false);
});

maybeTest('Deal Engine: a super admin acting under a role that cannot sign the stage is rejected exactly like anyone else - no bypass, nothing logged', async () => {
  const revision = await CommercialRevision.create({
    project: new mongoose.Types.ObjectId(),
    revisionNumber: 1,
    pricing: { netExclVat: 500000 }, // below the MD threshold - mdRequired stays false
  });

  // STAGE1 requires 'sales'/'technical' - acting as 'md' (even as the super admin) is refused.
  await assert.rejects(
    approvalService.setStageStatus(revision._id, 'STAGE1', 'Approved', { userId: superAdmin._id, userRole: 'md', note: 'super admin test' }),
    /can only be signed by/
  );

  const logs = await SuperAdminOverrideLog.find({ targetId: revision._id });
  assert.equal(logs.length, 0, 'the role_override mechanism no longer exists - nothing is ever logged for it');
});

maybeTest('Deal Engine: segregation of duties applies to a super admin too - signing Stage 1 then Stage 2 of the SAME revision as the same person is refused, no waiver', async () => {
  const revision = await CommercialRevision.create({
    project: new mongoose.Types.ObjectId(),
    revisionNumber: 1,
    pricing: { netExclVat: 500000 },
  });
  // The super admin acts under two DIFFERENT real roles here (sales for Stage 1, commercial_director
  // for Stage 2) purely to isolate the segregation-of-duties check from the role check - the point
  // is that being the SAME PERSON still blocks the second signature, super admin or not.
  await approvalService.setStageStatus(revision._id, 'STAGE1', 'Approved', { userId: superAdmin._id, userRole: 'sales' });
  await assert.rejects(
    approvalService.setStageStatus(revision._id, 'STAGE2', 'Approved', { userId: superAdmin._id, userRole: 'commercial_director' }),
    /already signed Stage 1/
  );

  const logs = await SuperAdminOverrideLog.find({ targetId: revision._id, action: 'commercial.approval.segregation_of_duties_override' });
  assert.equal(logs.length, 0, 'the segregation-of-duties waiver no longer exists - nothing is ever logged for it');
});

maybeTest('Deal Engine: an ORDINARY user (even one with both sales and commercial_director roles) is still blocked by segregation of duties - the waiver is super-admin-only, no leak', async () => {
  const revision = await CommercialRevision.create({
    project: new mongoose.Types.ObjectId(),
    revisionNumber: 1,
    pricing: { netExclVat: 500000 },
  });
  await approvalService.setStageStatus(revision._id, 'STAGE1', 'Approved', { userId: ordinaryUser._id, userRole: 'sales', actor: ordinaryUser });
  await assert.rejects(
    approvalService.setStageStatus(revision._id, 'STAGE2', 'Approved', { userId: ordinaryUser._id, userRole: 'commercial_director', actor: ordinaryUser }),
    /already signed Stage 1/
  );
});

// ---------------------------------------------------------------- CRM (changeStage, transactional)

superAdminTest('CRM: super admin can skip stages (New -> Proposal sent in one move) - an ordinary sales rep cannot', async () => {
  const { lead: superLead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01000000001', channel: 'phone' });
  const moved = await leadService.changeStage(superLead._id, { to: 'proposal_sent', followUpAt: new Date(), overrideReason: 'Super admin test: skipping stages' }, { role: 'md', actor: superAdmin, userId: superAdmin._id });
  assert.equal(moved.stage, 'proposal_sent');

  const { lead: ordinaryLead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01000000002', channel: 'phone' });
  await assert.rejects(
    leadService.changeStage(ordinaryLead._id, { to: 'proposal_sent', followUpAt: new Date() }, { role: 'sales', actor: ordinaryUser, userId: ordinaryUser._id }),
    /must pass through every stage in order/
  );
});

superAdminTest('CRM: super admin can reopen a Won lead (WON_IS_FINAL) with a reason; an ordinary MD cannot', async () => {
  const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01000000003', channel: 'phone' });
  await leadService.changeStage(lead._id, { to: 'proposal_sent', followUpAt: new Date() }, { role: 'sales' });
  await leadService.changeStage(lead._id, { to: 'won', valueEgp: 50000 }, { role: 'md' });

  await assert.rejects(
    leadService.changeStage(lead._id, { to: 'contacted' }, { role: 'md' }),
    /won deal cannot change stage/
  );

  const reopened = await leadService.changeStage(lead._id, { to: 'contacted', overrideReason: 'Super admin test: reopening a Won lead' }, { role: 'md', actor: superAdmin, userId: superAdmin._id });
  assert.equal(reopened.stage, 'contacted');

  const logs = await (require('../../models/system/superAdminOverrideLogModel')).find({ targetId: lead._id, action: 'crm.stage.super_admin_only_override' });
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].details.rules, ['WON_IS_FINAL']);
});

superAdminTest('CRM: super admin can reopen a Lost lead regardless of role (LOST_REOPEN_ROLE) - "technical" normally cannot', async () => {
  const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01000000004', channel: 'phone' });
  await leadService.changeStage(lead._id, { to: 'lost', lostReason: 'Budget' }, { role: 'sales' });

  await assert.rejects(
    leadService.changeStage(lead._id, { to: 'contacted' }, { role: 'technical' }),
    /Only Admin or the MD can reopen/
  );

  const reopened = await leadService.changeStage(lead._id, { to: 'contacted', overrideReason: 'Super admin test: reopening a Lost lead as a non-admin role' }, { role: 'technical', actor: superAdmin, userId: superAdmin._id });
  assert.equal(reopened.stage, 'contacted');
});

superAdminTest('CRM: data-integrity rules stay hard blocks even for the super admin - a Won move still needs a real contract value', async () => {
  const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01000000005', channel: 'phone' });
  await leadService.changeStage(lead._id, { to: 'proposal_sent', followUpAt: new Date() }, { role: 'sales' });
  await assert.rejects(
    leadService.changeStage(lead._id, { to: 'won', overrideReason: 'Trying to skip the contract value anyway' }, { role: 'md', actor: superAdmin, userId: superAdmin._id }),
    /Enter the contract value/
  );
});

maybeTest('Deal Engine: an ORDINARY user (no super admin flag) is still rejected by the role check - no leak', async () => {
  const revision = await CommercialRevision.create({
    project: new mongoose.Types.ObjectId(),
    revisionNumber: 1,
    pricing: { netExclVat: 500000 },
  });
  await assert.rejects(
    approvalService.setStageStatus(revision._id, 'STAGE1', 'Approved', { userId: ordinaryUser._id, userRole: 'member', actor: ordinaryUser }),
    /can only be signed by/
  );
});

maybeTest('setStageStatus never logs an override for a role check that would have passed anyway', async () => {
  const revision = await CommercialRevision.create({
    project: new mongoose.Types.ObjectId(),
    revisionNumber: 1,
    pricing: { netExclVat: 500000 },
  });
  await approvalService.setStageStatus(revision._id, 'STAGE1', 'Approved', { userId: ordinaryUser._id, userRole: 'sales', actor: ordinaryUser });
  const logs = await SuperAdminOverrideLog.find({ targetId: revision._id });
  assert.equal(logs.length, 0);
});
