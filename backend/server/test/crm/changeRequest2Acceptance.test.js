const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const mongoose = require('mongoose');

// Change Request 2 - end-to-end acceptance scenarios (the brief's Tests 1-10 plus the access
// restoration and cleanup scripts) against a REAL MongoDB replica set (lead intake and stage
// changes run in transactions). Same TEST_DB_URI self-skip convention as the rest of the CRM suite.
//
// Two seams, both installed BEFORE any app module loads (node:test runs each file in its own
// process, so nothing leaks into other test files):
//   - utils/sendEmail is replaced with a recorder, so "owner notified" is asserted on the real
//     notification the CRM generates rather than assumed.
//   - controller/user/authController.protect is replaced with a header-based login
//     (x-test-user: <user id>) that loads the REAL user document from the DB. Every authorization
//     check after it - requireCrmAccess, requireCrmRole, requirePlatformAdmin, the services' own
//     role checks - is the production code, exercised over real HTTP.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

const sentEmails = [];
const sendEmailPath = require.resolve('../../utils/sendEmail');
require.cache[sendEmailPath] = {
  id: sendEmailPath,
  filename: sendEmailPath,
  loaded: true,
  exports: async (to, subject, html) => {
    sentEmails.push({ to, subject, html });
  },
};
const ApiError = require('../../utils/apiError');

const authPath = require.resolve('../../controller/user/authController');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
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

let User, Lead, Activity, StageHistory, IntakeEvent, CrmTarget, CrmAdSpend, PlatformAuditLog;
let leadService, reportService, publicLeadIntake, leadIntake, keyService, metaLeadAds, googleAds, whatsappService;
let previewImport, commitImport, crmImportSchema, buildLeadExportRows;
let server;
let baseUrl;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  Lead = require('../../models/crm/leadModel');
  Activity = require('../../models/crm/activityModel');
  StageHistory = require('../../models/crm/stageHistoryModel');
  IntakeEvent = require('../../models/crm/intakeEventModel');
  require('../../models/crm/integrationKeyModel');
  CrmTarget = require('../../models/crm/targetModel');
  CrmAdSpend = require('../../models/crm/adSpendModel');
  PlatformAuditLog = require('../../models/platformAuditLogModel');
  require('../../models/crm/waRefCodeModel');
  await Promise.all([Lead.init(), Activity.init(), IntakeEvent.init(), mongoose.model('CrmIntegrationKey').init(), CrmTarget.init(), CrmAdSpend.init()]);

  leadService = require('../../services/crm/leadService');
  reportService = require('../../services/crm/reportService');
  publicLeadIntake = require('../../services/crm/publicLeadIntakeService');
  leadIntake = require('../../services/crm/leadIntakeService');
  keyService = require('../../services/crm/integrationKeyService');
  metaLeadAds = require('../../services/crm/metaLeadAdsService');
  googleAds = require('../../services/crm/googleAdsLeadService');
  whatsappService = require('../../services/crm/whatsappService');
  ({ previewImport, commitImport } = require('../../services/csvImport/csvImportRunner'));
  crmImportSchema = require('../../utils/validators/import/crmLeadImportSchema');
  ({ buildLeadExportRows } = require('../../services/crm/leadExportService'));

  const express = require('express');
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use('/api/v1/crm/leads', require('../../routes/crm/leadRoute'));
  app.use('/api/v1/crm/integrations', require('../../routes/crm/integrationRoute'));
  app.use('/api/v1/crm/targets', require('../../routes/crm/targetRoute'));
  app.use('/api/v1/crm/ad-spend', require('../../routes/crm/adSpendRoute'));
  app.use('/api/v1/crm/reports', require('../../routes/crm/reportRoute'));
  app.use('/api/v1/admin/platform', require('../../routes/portal/platformAdminRoute'));
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
});

let userSeq = 0;
async function makeUser(name, memberships, extra = {}) {
  userSeq += 1;
  return User.create({
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}.${userSeq}@reservia.test`,
    password: 'x',
    role: 'operator',
    type: 'online',
    systemMemberships: memberships,
    ...extra,
  });
}
const crm = role => [{ system: 'CRM', role, isActive: true }];
// The Lead/StageHistory pre-find hooks populate refs even on .lean() reads.
const idOf = v => String(v?._id ?? v);

async function api(method, url, { user, body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': String(user._id) } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function writeTempCsv(content) {
  const file = path.join(os.tmpdir(), `cr2-import-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  await fs.writeFile(file, Buffer.from(content, 'utf8'));
  return { path: file };
}

// ===================================================================================== Test 1

maybeTest('Test 1 - website attribution: ?utm_source=google&utm_medium=cpc&utm_campaign=test on the farm page -> Google Ads, campaign "test", owner assigned, owner notified', async () => {
  const sales = await makeUser('Sara Sales', crm('sales'));
  const result = await publicLeadIntake.intakePublicLead({
    name: 'Farm Owner',
    phone: '0100 123 4567',
    segment: 'agriculture',
    source: 'landing_form',
    pageUrl: 'https://reservia-energy.com/lp/farms',
    eventId: 'evt-farm-1',
    utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'test' },
    message: 'Need a pump for 20 feddan',
  });
  assert.match(result.refCode, /^RSV-\d{4}-\d{4}$/);

  const lead = await Lead.findOne({ refCode: result.refCode }).lean();
  assert.equal(lead.phoneE164, '+201001234567', 'phone normalized to +20');
  assert.equal(lead.source, 'Google Ads');
  assert.equal(lead.campaign, 'test');
  assert.equal(lead.utmCampaign, 'test');
  assert.equal(lead.utmSource, 'google');
  assert.equal(lead.utmMedium, 'cpc');
  assert.equal(lead.segment, 'farm');
  assert.equal(idOf(lead.owner), String(sales._id), 'owner assigned by the CRM rules');
  assert.ok(lead.replyDueAt > lead.createdAt, 'SLA clock started');

  // Notification - the real email the CRM generated for the assigned owner.
  await new Promise(r => setImmediate(r));
  const mail = sentEmails.find(m => m.to === sales.email);
  assert.ok(mail, 'the assigned owner was notified');
  assert.match(mail.subject, new RegExp(result.refCode));
  assert.match(mail.html, /Google Ads/);
  assert.match(mail.html, /Campaign:<\/strong> test/);

  // A double-submit / retried request with the same eventId changes nothing.
  await publicLeadIntake.intakePublicLead({ name: 'Farm Owner', phone: '01001234567', segment: 'agriculture', source: 'landing_form', eventId: 'evt-farm-1', utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'test' }, message: 'Need a pump for 20 feddan' });
  assert.equal(await Lead.countDocuments({}), 1);
  assert.equal(await Activity.countDocuments({ lead: lead._id, type: 'note' }), 1, 'the message note is recorded once');
});

// ===================================================================================== Test 2

maybeTest('Test 2 - stage progression: New -> Contacted -> Site survey is BLOCKED; New -> Contacted -> Qualified -> Site survey works', async () => {
  const sales = await makeUser('Rep', crm('sales'));
  const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01011110001', channel: 'phone', source: 'Referral' }, { userId: sales._id });
  await leadService.changeStage(lead._id, { to: 'contacted' }, { userId: sales._id, role: 'sales' });
  await assert.rejects(
    leadService.changeStage(lead._id, { to: 'site_survey', followUpAt: '2026-11-12' }, { userId: sales._id, role: 'sales' }),
    err => err.statusCode === 400 && /move it to Qualified first/.test(err.message)
  );
  assert.equal((await Lead.findById(lead._id).lean()).stage, 'contacted', 'nothing changed');

  await leadService.changeStage(lead._id, { to: 'qualified', followUpAt: '2026-11-12' }, { userId: sales._id, role: 'sales' });
  const done = await leadService.changeStage(lead._id, { to: 'site_survey', followUpAt: '2026-11-13' }, { userId: sales._id, role: 'sales' });
  assert.equal(done.stage, 'site_survey');
  const trail = (await StageHistory.find({ lead: lead._id }).sort({ createdAt: 1 }).lean()).map(h => `${h.from}->${h.to}`);
  assert.deepEqual(trail, ['null->new', 'new->contacted', 'contacted->qualified', 'qualified->site_survey'], 'stage history intact and in order');
});

maybeTest('Test 2 - MD override: needs a reason; records previous stage, new stage, who, why, when, and appears in the timeline', async () => {
  const md = await makeUser('Managing Director', crm('md'));
  const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01011110002', channel: 'phone', source: 'Referral' }, { userId: md._id });
  await leadService.changeStage(lead._id, { to: 'contacted' }, { userId: md._id, role: 'md' });

  // Without a reason the MD is told the move CAN be overridden.
  await assert.rejects(
    leadService.changeStage(lead._id, { to: 'site_survey', followUpAt: '2026-11-12' }, { userId: md._id, role: 'md' }),
    err => err.statusCode === 400 && err.details?.overridable === true && err.details.rules.includes('STAGE_SKIP')
  );

  const before = Date.now();
  const moved = await leadService.changeStage(
    lead._id,
    { to: 'site_survey', followUpAt: '2026-11-12', overrideReason: 'Customer already qualified by phone with the MD' },
    { userId: md._id, role: 'md' }
  );
  assert.equal(moved.stage, 'site_survey');
  const h = await StageHistory.findOne({ lead: lead._id, to: 'site_survey' }).lean();
  assert.equal(h.from, 'contacted');
  assert.equal(h.override, true);
  assert.equal(h.overrideReason, 'Customer already qualified by phone with the MD');
  assert.deepEqual(h.overriddenRules, ['STAGE_SKIP']);
  assert.equal(idOf(h.changedBy), String(md._id));
  assert.ok(h.createdAt.getTime() >= before - 1000);
  const note = await Activity.findOne({ lead: lead._id, body: /MD OVERRIDE/ }).lean();
  assert.ok(note && /already qualified by phone/.test(note.body), 'visible in the activity timeline');

  // The funnel still counts it as Qualified (it passed that point), so "Qualified 0 / Surveys 1" can't recur.
  const now = new Date();
  const targets = await reportService.getTargetsBlock({ year: Number(now.toISOString().slice(0, 4)), month: now.getUTCMonth() + 1, ownerId: null });
  assert.equal(targets.surveys.actual, 1);
  assert.equal(targets.qualified.actual, 1);
});

maybeTest('Test 2 / Test 10 - override is MD-only and data-integrity rules can never be overridden', async () => {
  const admin = await makeUser('Admin Officer', crm('admin'));
  const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01011110003', channel: 'phone', source: 'Referral' }, { userId: admin._id });
  await leadService.changeStage(lead._id, { to: 'contacted' }, { role: 'admin' });
  for (const role of ['admin', 'sales', 'technical']) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(
      leadService.changeStage(lead._id, { to: 'site_survey', followUpAt: '2026-11-12', overrideReason: 'trying' }, { role }),
      err => err.statusCode === 403 && /Only the MD/.test(err.message),
      role
    );
  }
  // Even the MD cannot skip AND leave out the mandatory follow-up date.
  await assert.rejects(
    leadService.changeStage(lead._id, { to: 'site_survey', overrideReason: 'skip' }, { role: 'md' }),
    err => err.statusCode === 400 && /follow-up date/.test(err.message)
  );
});

// ===================================================================================== Test 3

maybeTest('Test 3 - follow-up 12 November 2026 is stored, returned and exported as 2026-11-12 (no 02:00 AM), and legacy Date values read back correctly', async () => {
  const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01011110004', channel: 'phone', source: 'Referral' });
  await leadService.changeStage(lead._id, { to: 'contacted' }, { role: 'sales' });
  const moved = await leadService.changeStage(lead._id, { to: 'qualified', followUpAt: '2026-11-12' }, { role: 'sales' });
  assert.equal(moved.followUpAt, '2026-11-12', 'API response');
  const raw = await mongoose.connection.collection('crmleads').findOne({ _id: lead._id });
  assert.equal(raw.followUpAt, '2026-11-12', 'stored as a date-only string, not a timestamp');
  assert.equal(JSON.parse(JSON.stringify(await Lead.findById(lead._id))).followUpAt, '2026-11-12', 'JSON serialization');

  // A legacy record written the old way (new Date('2026-11-12') = UTC midnight).
  await mongoose.connection.collection('crmleads').updateOne({ _id: lead._id }, { $set: { followUpAt: new Date('2026-11-12') } });
  assert.equal((await Lead.findById(lead._id)).followUpAt, '2026-11-12', 'legacy Date read back as the Cairo calendar day');
  const exportRow = (await buildLeadExportRows({ _id: lead._id }))[0];
  assert.equal(exportRow[12], '2026-11-12', 'CSV export column FollowUpAt');

  // The CR2 migration rewrites stored legacy values (dry run first, then apply).
  const { migrateCrmChangeRequest2 } = require('../../scripts/migrateCrmChangeRequest2');
  const dry = await migrateCrmChangeRequest2({ apply: false, connect: false, log: () => {} });
  assert.equal(dry.followUpsConverted, 1);
  assert.ok((await mongoose.connection.collection('crmleads').findOne({ _id: lead._id })).followUpAt instanceof Date, 'dry run wrote nothing');
  await migrateCrmChangeRequest2({ apply: true, connect: false, log: () => {} });
  assert.equal((await mongoose.connection.collection('crmleads').findOne({ _id: lead._id })).followUpAt, '2026-11-12');
});

maybeTest('Test 3 - an impossible follow-up date is rejected, not silently shifted', async () => {
  const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01011110005', channel: 'phone', source: 'Referral' });
  await leadService.changeStage(lead._id, { to: 'contacted' }, { role: 'sales' });
  await assert.rejects(leadService.changeStage(lead._id, { to: 'qualified', followUpAt: '2026-02-30' }, { role: 'sales' }), /calendar date|Cast/);
});

// ===================================================================================== Test 4

maybeTest('Test 4 - logging one call on a new lead sets the first reply; hours to first reply, average and % within 8h all populate', async () => {
  const sales = await makeUser('Caller', crm('sales'));
  const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01011110006', channel: 'phone', source: 'Referral' }, { userId: sales._id });
  const now = new Date();
  const ym = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  const before = await reportService.getSpeedBlock({ ...ym, ownerId: null });
  assert.equal(before.avgHoursToFirstReply, null, 'nothing replied yet - shown as "-", never 0');

  await leadService.recordActivity(lead._id, { type: 'call', body: 'Called, interested' }, { userId: sales._id });
  const fresh = await Lead.findById(lead._id).lean();
  assert.ok(fresh.firstReplyAt, 'first reply timestamp populated');
  assert.equal(fresh.firstReplyVia, 'call');

  const after_ = await reportService.getSpeedBlock({ ...ym, ownerId: null });
  assert.notEqual(after_.avgHoursToFirstReply, null);
  assert.equal(after_.firstReply.repliedCount, 1);
  assert.equal(after_.pctWithinSla, 100);

  // Performance uses the SAME calculation.
  const perf = await require('../../services/crm/performanceReportService').getSpeedSection({ ...ym, ownerId: null });
  assert.equal(perf.hoursToFirstReply.sampleSize, 1, 'n=1, not n=0');
  assert.equal(perf.hoursToFirstReply.avgHours, after_.avgHoursToFirstReply);
  assert.equal(perf.hoursToFirstReply.pctWithin8h, after_.pctWithinSla);
});

maybeTest('Test 4 - the first move out of New counts as the first reply (the reported "moved to Contacted at once, yet n=0" case)', async () => {
  const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01011110007', channel: 'phone', source: 'Referral' });
  await leadService.changeStage(lead._id, { to: 'contacted' }, { role: 'sales' });
  const fresh = await Lead.findById(lead._id).lean();
  assert.ok(fresh.firstReplyAt);
  assert.equal(fresh.firstReplyVia, 'stage_change');
});

maybeTest('Test 4 - WhatsApp and email replies count; the EARLIEST event wins and a later or duplicate reply never overwrites it; notes/assignment never count', async () => {
  const owner = await makeUser('Owner', crm('sales'));
  const other = await makeUser('Other', crm('sales'));
  const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01011110008', channel: 'phone', source: 'Referral' }, { userId: owner._id });

  await leadService.recordActivity(lead._id, { type: 'note', body: 'internal note' });
  await leadService.reassignLead(lead._id, other._id, {});
  assert.equal((await Lead.findById(lead._id).lean()).firstReplyAt, null, 'a note or a reassignment is not a reply');

  await leadService.recordActivity(lead._id, { type: 'whatsapp_out', body: 'Sent brochure on WhatsApp' });
  const first = (await Lead.findById(lead._id).lean()).firstReplyAt;
  assert.ok(first);
  assert.equal((await Lead.findById(lead._id).lean()).firstReplyVia, 'whatsapp_out');

  await leadService.recordActivity(lead._id, { type: 'email', body: 'Follow-up email' });
  await leadService.recordActivity(lead._id, { type: 'call', body: 'Call' });
  await leadService.changeStage(lead._id, { to: 'contacted' }, { role: 'sales' });
  const final = await Lead.findById(lead._id).lean();
  assert.equal(final.firstReplyAt.getTime(), first.getTime(), 'later replies never overwrite the first');
  assert.equal(final.firstReplyVia, 'whatsapp_out');

  // Email on a fresh lead.
  const { lead: l2 } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01011110009', channel: 'email', source: 'Referral' });
  await leadService.recordActivity(l2._id, { type: 'email', body: 'Replied by email' });
  assert.equal((await Lead.findById(l2._id).lean()).firstReplyVia, 'email');
});

maybeTest('Test 4 - the historical backfill sets first replies only from real history and never moves one later', async () => {
  const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01011110010', channel: 'phone', source: 'Referral' });
  const { lead: untouched } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01011110011', channel: 'phone', source: 'Referral' });
  const callAt = new Date(Date.now() - 3600000);
  await mongoose.connection.collection('crmactivities').insertOne({ lead: lead._id, type: 'call', body: 'old call', createdAt: callAt, updatedAt: callAt });
  const { migrateCrmChangeRequest2 } = require('../../scripts/migrateCrmChangeRequest2');
  const result = await migrateCrmChangeRequest2({ apply: true, connect: false, log: () => {} });
  assert.equal(result.firstRepliesSet, 1);
  const fresh = await Lead.findById(lead._id).lean();
  assert.equal(fresh.firstReplyAt.getTime(), callAt.getTime());
  assert.equal((await Lead.findById(untouched._id).lean()).firstReplyAt, null, 'no history, no invented reply');
  const again = await migrateCrmChangeRequest2({ apply: true, connect: false, log: () => {} });
  assert.equal(again.firstRepliesSet, 0, 'idempotent');
});

// ===================================================================================== Test 5

maybeTest('Test 5 - pipeline valuation: full and weighted values reported separately, with stage probabilities; won/lost/archived excluded', async () => {
  const seed = async (phone, stage, valueEgp, extra = {}) => {
    const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone, channel: 'phone', source: 'Referral', valueEgp });
    await Lead.updateOne({ _id: lead._id }, { $set: { stage, ...extra } });
  };
  await seed('01020000001', 'proposal_sent', 900000);
  await seed('01020000002', 'qualified', 200000);
  await seed('01020000003', 'won', 5000000);
  await seed('01020000004', 'lost', 300000);
  await seed('01020000005', 'proposal_sent', 1000000, { archived: true });

  const block = await reportService.getPipelineBlock({ ownerId: null });
  assert.equal(block.totalValueEgp, 1100000, 'full pipeline value = 900,000 + 200,000');
  assert.equal(block.totalWeightedValueEgp, 495000 + 50000, 'weighted = 900,000 x 55% + 200,000 x 25%');
  assert.equal(block.stages.find(s => s.stage === 'proposal_sent').probability, 0.55);
  assert.equal(block.probabilities.length, 6);

  // The Pipeline board's own endpoint agrees.
  const md = await makeUser('MD Viewer', crm('md'));
  const board = await api('GET', '/api/v1/crm/leads/pipeline', { user: md });
  assert.equal(board.status, 200);
  const open = board.body.data.filter(r => ['new', 'contacted', 'qualified', 'site_survey', 'proposal_sent', 'negotiation'].includes(r.stage));
  assert.equal(open.reduce((s, r) => s + r.valueEgp, 0), block.totalValueEgp);
  assert.equal(open.reduce((s, r) => s + r.weightedValueEgp, 0), block.totalWeightedValueEgp);
  assert.equal(board.body.data.find(r => r.stage === 'proposal_sent').probability, 0.55);
});

// ===================================================================================== Test 6

maybeTest('Test 6 - targets and planned spend from Change Request 1 section 5 load and drive Cost per Qualified Lead / Cost per Enquiry', async () => {
  const { seedCrmChangeRequest1Targets } = require('../../scripts/seedCrmChangeRequest1Targets');
  const seeded = await seedCrmChangeRequest1Targets({ connect: false, dryRun: false });
  assert.deepEqual(seeded.createdTargets.sort(), ['all 2026-11', 'all 2026-12']);

  const nov = await reportService.getTargetsBlock({ year: 2026, month: 11, ownerId: null });
  assert.deepEqual(
    [nov.enquiries.target, nov.qualified.target, nov.surveys.target, nov.proposals.target, nov.signed.target],
    [24, 7, 4, 2, 0],
    'November targets exactly as Change Request 1 section 5'
  );
  const dec = await reportService.getTargetsBlock({ year: 2026, month: 12, ownerId: null });
  assert.deepEqual([dec.surveys.target, dec.proposals.target, dec.signed.target, dec.valueEgp.target], [4, 3, 1, 990000]);
  assert.equal(dec.enquiries.target, null, 'December enquiries were left "to be entered after week 1" - not invented');

  // Two farm enquiries in November (Cairo), one of them qualified -> farm planned spend 7,000.
  const novDate = new Date('2026-11-05T09:00:00Z');
  const mk = async phone => {
    const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone, channel: 'phone', source: 'Referral', segment: 'farm', submittedAt: novDate });
    return lead;
  };
  const a = await mk('01030000001');
  await mk('01030000002');
  await mongoose.connection.collection('crmstagehistories').insertMany([
    { lead: a._id, from: 'new', to: 'contacted', createdAt: new Date('2026-11-05T10:00:00Z') },
    { lead: a._id, from: 'contacted', to: 'qualified', createdAt: new Date('2026-11-05T11:00:00Z') },
  ]);

  const quality = await reportService.getSegmentQualityBlock({ year: 2026, month: 11, ownerId: null });
  const farm = quality.segments.find(s => s.segment === 'farm');
  assert.equal(farm.plannedSpendEgp, 7000);
  assert.equal(farm.spendBasis, 'planned', 'labelled as planned until an actual is entered');
  assert.equal(farm.costPerEnquiry, 3500, '7,000 / 2 enquiries');
  assert.equal(farm.costPerQualifiedLead, 7000, '7,000 / 1 qualified');
  assert.equal(quality.totals.costPerEnquiry, 3500);

  // The MD enters the actual spend -> cost figures switch to actual and say so.
  await CrmAdSpend.updateOne({ channel: 'Farm test', year: 2026, month: 11 }, { $set: { actualAmountEgp: 6000 } });
  const actual = (await reportService.getSegmentQualityBlock({ year: 2026, month: 11, ownerId: null })).segments.find(s => s.segment === 'farm');
  assert.equal(actual.spendBasis, 'actual');
  assert.equal(actual.costPerEnquiry, 3000);

  // A segment with spend but zero leads is listed with a null (not 0, not Infinity) cost.
  const decQuality = await reportService.getSegmentQualityBlock({ year: 2026, month: 12, ownerId: null });
  const villas = decQuality.segments.find(s => s.segment === 'villa');
  assert.equal(villas.plannedSpendEgp, 2700);
  assert.equal(villas.costPerEnquiry, null);
});

maybeTest('Test 6 / Test 10 - the MD can open Targets and Spend (read and write); other roles can read but never write', async () => {
  const md = await makeUser('MD', crm('md'));
  const sales = await makeUser('Sales', crm('sales'));
  const put = user => api('PUT', '/api/v1/crm/targets', { user, body: { segment: 'all', year: 2026, month: 11, targetEnquiries: 24 } });
  assert.equal((await put(md)).status, 200);
  assert.equal((await put(sales)).status, 403);
  assert.equal((await api('GET', '/api/v1/crm/targets?year=2026&month=11', { user: md })).status, 200);
  assert.equal((await api('GET', '/api/v1/crm/targets?year=2026&month=11', { user: sales })).status, 200);
  const spend = await api('PUT', '/api/v1/crm/ad-spend', { user: md, body: { channel: 'Farms', segment: 'farm', year: 2026, month: 12, amountEgp: 14500, actualAmountEgp: 13900 } });
  assert.equal(spend.status, 200);
  assert.equal(spend.body.data.actualAmountEgp, 13900);
  assert.equal((await api('PUT', '/api/v1/crm/ad-spend', { user: sales, body: { channel: 'X', year: 2026, month: 12, amountEgp: 1 } })).status, 403);
  // An older client that sends only the planned amount never wipes the actual.
  await api('PUT', '/api/v1/crm/ad-spend', { user: md, body: { channel: 'Farms', segment: 'farm', year: 2026, month: 12, amountEgp: 15000 } });
  assert.equal((await CrmAdSpend.findOne({ channel: 'Farms' }).lean()).actualAmountEgp, 13900);
});

// ===================================================================================== Test 7

maybeTest('Test 7 - the same Egyptian number through two channels -> one lead, the new activity on it, original attribution and history kept', async () => {
  await makeUser('Pool', crm('sales'));
  const { refCode } = await publicLeadIntake.intakePublicLead({ name: 'Mona', phone: '01055556666', segment: 'villas', source: 'contact_form', utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'brand' } });
  const original = await Lead.findOne({ refCode }).lean();
  const historyBefore = await StageHistory.countDocuments({ lead: original._id });

  const r = await leadIntake.processIntake({
    channel: 'meta',
    externalId: 'meta-lead-1',
    lead: leadIntake.mapUnifiedPayload('meta', { externalId: 'meta-lead-1', phone: '+20 105 555 6666', email: 'mona@x.com', campaign: 'Villas retargeting' }),
  });
  assert.equal(r.created, false);
  assert.equal(await Lead.countDocuments({}), 1, 'no duplicate lead');
  const merged = await Lead.findById(original._id).lean();
  assert.equal(merged.source, 'Google Ads', 'first-touch source preserved');
  assert.equal(merged.campaign, 'brand', 'first-touch campaign preserved');
  assert.equal(merged.email, 'mona@x.com', 'a still-empty field is filled, nothing overwritten');
  assert.equal(idOf(merged.owner), idOf(original.owner));
  assert.equal(await StageHistory.countDocuments({ lead: original._id }), historyBefore, 'history untouched');
  const repeat = await Activity.findOne({ lead: original._id, body: /Repeat enquiry/ }).lean();
  assert.match(repeat.body, /source Meta Ads/);
  assert.match(repeat.body, /Villas retargeting/);
});

// ===================================================================================== Test 8

maybeTest('Test 8 - CSV: a lead submitted Monday 10:00 and imported later keeps Monday 10:00 as its original time; the SLA runs from it', async () => {
  const importer = await makeUser('Importer', crm('admin'));
  const sales = await makeUser('Sales Pool', crm('sales'));
  const csv =
    'Name,Phone,Email,Source,Campaign,SubmittedAt,Channel\n' +
    'TikTok Lead,01040000001,t@x.com,TikTok,Villas Nov,2026-11-09 10:00,\n' +
    'Google Lead,01040000002,,Google Ads,Brand search,2026-11-09 11:30,\n' +
    'Meta Lead,01040000003,,meta ads,Farms,2026-11-09T12:00:00+02:00,\n' +
    'Walk In,01040000004,,Referral,,,walk_in\n';
  const file = await writeTempCsv(csv);
  const preview = await previewImport(file, crmImportSchema);
  assert.equal(preview.validCount, 4, JSON.stringify(preview.errors));
  const { created, failed } = await commitImport(file, crmImportSchema, { userId: importer._id });
  assert.equal(failed.length, 0, JSON.stringify(failed));
  assert.equal(created.length, 4);

  const tiktok = await Lead.findOne({ phoneE164: '+201040000001' }).lean();
  assert.equal(tiktok.submittedAt.toISOString(), '2026-11-09T08:00:00.000Z', 'Monday 10:00 Cairo preserved');
  assert.equal(tiktok.replyDueAt.toISOString(), '2026-11-09T16:00:00.000Z', 'due Monday 18:00 Cairo - from the ORIGINAL time, not import time');
  assert.ok(tiktok.createdAt > tiktok.submittedAt, 'import time is kept separately');
  assert.equal(tiktok.source, 'TikTok');
  assert.equal(tiktok.campaign, 'Villas Nov');
  assert.equal(tiktok.email, 't@x.com');
  assert.equal(tiktok.channel, 'ad_lead_form');
  assert.equal(idOf(tiktok.owner), String(sales._id), 'integration-style rows follow the CRM assignment rules');
  assert.equal((await Lead.findOne({ phoneE164: '+201040000003' }).lean()).source, 'Meta Ads');
  assert.equal(idOf((await Lead.findOne({ phoneE164: "+201040000004" }).lean()).owner), String(importer._id), 'a hand-entered channel keeps the importer as owner (unchanged)');

  // Re-importing the same file: timestamped rows are recognized as already imported; the
  // timestamp-less row keeps the original merge behaviour.
  const again = await commitImport(file, crmImportSchema, { userId: importer._id });
  assert.equal(again.skipped.length, 3);
  assert.equal(again.failed.length, 0);
  assert.equal(await Lead.countDocuments({}), 4);
  assert.equal(await Activity.countDocuments({ lead: tiktok._id, body: /Repeat enquiry/ }), 0, 'no duplicate activity for an already-imported row');
  await fs.unlink(file.path);
});

maybeTest('Test 8 - invalid rows get clear row-level errors and are never imported', async () => {
  const csv = 'Name,Phone,Source,SubmittedAt\nBad Date,01040000009,TikTok,09/11/2026 10:00\nBad Phone,12345,TikTok,2026-11-09 10:00\n';
  const file = await writeTempCsv(csv);
  const preview = await previewImport(file, crmImportSchema);
  assert.equal(preview.invalidCount, 2);
  assert.equal(preview.errors[0].row, 2);
  assert.equal(preview.errors[0].errors[0].column, 'SubmittedAt');
  assert.equal(preview.errors[1].errors[0].column, 'Phone');
  const { created } = await commitImport(file, crmImportSchema, { userId: null });
  assert.equal(created.length, 0);
  assert.equal(await Lead.countDocuments({}), 0);
  await fs.unlink(file.path);
});

// ===================================================================================== Test 9

const metaGraphLead = id => ({
  id,
  created_time: '2026-11-09T07:00:00+0000',
  campaign_name: 'Farms Nov',
  adset_name: 'Delta',
  ad_name: 'Pump video',
  form_id: 'F1',
  platform: 'fb',
  field_data: [
    { name: 'full_name', values: ['Hassan'] },
    { name: 'phone_number', values: ['+201066667777'] },
    { name: 'farm_size', values: ['40 feddan'] },
  ],
});

maybeTest('Test 9 - Meta Lead Ads: the same webhook delivered twice creates ONE lead and ONE set of activities', async () => {
  await makeUser('Pool', crm('sales'));
  process.env.META_PAGE_ACCESS_TOKEN = 'test-page-token';
  let calls = 0;
  const fetchImpl = async (url, opts) => {
    calls += 1;
    assert.ok(!url.includes('test-page-token'), 'the access token is never put in the URL');
    assert.equal(opts.headers.Authorization, 'Bearer test-page-token');
    return { ok: true, status: 200, json: async () => metaGraphLead('LG-1') };
  };
  const payload = { object: 'page', entry: [{ id: 'P1', changes: [{ field: 'leadgen', value: { leadgen_id: 'LG-1', form_id: 'F1' } }] }] };

  const first = await metaLeadAds.processWebhookPayload(payload, { fetchImpl });
  const second = await metaLeadAds.processWebhookPayload(payload, { fetchImpl });
  assert.equal(first.results[0].created, true);
  assert.equal(second.results[0].replay, true);
  assert.equal(await Lead.countDocuments({}), 1);
  const lead = await Lead.findOne({}).lean();
  assert.equal(lead.source, 'Meta Ads');
  assert.equal(lead.campaign, 'Farms Nov');
  assert.equal(lead.adSetName, 'Delta');
  assert.equal(lead.adName, 'Pump video');
  assert.equal(lead.adFormId, 'F1');
  assert.equal(lead.externalLeadId, 'LG-1');
  assert.equal(lead.submittedAt.toISOString(), '2026-11-09T07:00:00.000Z', 'Meta original submission time');
  assert.ok(lead.owner, 'owner assigned');
  assert.equal(await Activity.countDocuments({ lead: lead._id, type: 'note' }), 1, 'form answers recorded once');
  assert.equal(await IntakeEvent.countDocuments({ channel: 'meta', status: 'processed' }), 1);
  assert.equal(calls, 2, 'the redelivery is recognized after the lookup, before ANY write');
  delete process.env.META_PAGE_ACCESS_TOKEN;
});

maybeTest('Test 9 - a transient failure is retryable, and the retry completes without duplicating anything', async () => {
  process.env.META_PAGE_ACCESS_TOKEN = 'test-page-token';
  const payload = { entry: [{ id: 'P1', changes: [{ field: 'leadgen', value: { leadgen_id: 'LG-2' } }] }] };
  const down = await metaLeadAds.processWebhookPayload(payload, { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: { code: 2, message: 'temporarily unavailable' } }) }) });
  assert.equal(down.retryable, true, 'answer non-200 so Meta redelivers');
  assert.equal(await Lead.countDocuments({}), 0);
  const ok = await metaLeadAds.processWebhookPayload(payload, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => metaGraphLead('LG-2') }) });
  assert.equal(ok.retryable, false);
  assert.equal(await Lead.countDocuments({}), 1);
  delete process.env.META_PAGE_ACCESS_TOKEN;
});

maybeTest('Test 9 - partial failure: lead written but the note step failed -> the retry finishes ONLY the missing step', async () => {
  const claim = await leadIntake.claimEvent('tiktok', 'tt-1');
  const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01070000001', channel: 'ad_lead_form', source: 'TikTok' }, { autoAssign: true });
  await IntakeEvent.updateOne({ _id: claim.event._id }, { $set: { lead: lead._id, leadCreated: true, status: 'failed', lastError: 'simulated crash' } });

  const r = await leadIntake.processIntake({ channel: 'tiktok', externalId: 'tt-1', lead: { phone: '01070000001', channel: 'ad_lead_form', source: 'TikTok' }, note: 'Form answers' });
  assert.equal(r.replay, false);
  assert.equal(await Activity.countDocuments({ lead: lead._id, body: /Repeat enquiry/ }), 0, 'intakeLead was NOT run again');
  assert.equal(await Activity.countDocuments({ lead: lead._id, type: 'note' }), 1);
  const ev = await IntakeEvent.findById(claim.event._id).lean();
  assert.equal(ev.status, 'processed');
  assert.equal(ev.attempts, 2);
});

maybeTest('Test 9 - WhatsApp: a redelivered message adds nothing (no duplicate message, no "Repeat enquiry" note); a new message appends to the same lead', async () => {
  await makeUser('Pool', crm('sales'));
  const message = id => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [{ wa_id: '201211110000', profile: { name: 'Karim' } }], messages: [{ id, from: '201211110000', timestamp: '1794211200', type: 'text', text: { body: 'Hello, price?' } }] } }] }] });
  await whatsappService.processWebhookPayload(message('wamid.1'));
  await whatsappService.processWebhookPayload(message('wamid.1'));
  const lead = await Lead.findOne({ phoneE164: '+201211110000' }).lean();
  assert.equal(lead.source, 'WhatsApp Direct');
  assert.ok(lead.owner, 'owner assigned');
  const count = await Activity.countDocuments({ lead: lead._id });
  await whatsappService.processWebhookPayload(message('wamid.1'));
  assert.equal(await Activity.countDocuments({ lead: lead._id }), count, 'third delivery adds nothing');
  assert.equal(await Activity.countDocuments({ lead: lead._id, body: /Repeat enquiry/ }), 0);
  await whatsappService.processWebhookPayload(message('wamid.2'));
  assert.equal(await Lead.countDocuments({}), 1);
  assert.equal(await Activity.countDocuments({ lead: lead._id, type: 'whatsapp_in' }), 2, 'conversation history preserved on the one lead');
});

maybeTest('Test 9 - Google Ads lead form webhook: key-authenticated, idempotent on lead_id, test submissions kept out of the pipeline', async () => {
  await makeUser('Pool', crm('sales'));
  const { key } = await keyService.createKey('google_ads', { label: 'Lead form asset' });
  const body = {
    lead_id: 'GA-1',
    campaign_id: 123,
    form_id: 9,
    google_key: key,
    user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Nour' }, { column_id: 'PHONE_NUMBER', string_value: '+201088880000' }],
  };
  const first = await api('POST', '/api/v1/crm/integrations/google_ads/webhook', { body });
  const second = await api('POST', '/api/v1/crm/integrations/google_ads/webhook', { body });
  assert.equal(first.status, 200);
  assert.equal(first.body.created, true);
  assert.equal(second.body.replay, true);
  assert.equal(await Lead.countDocuments({}), 1);
  assert.equal((await Lead.findOne({}).lean()).source, 'Google Ads');

  assert.equal((await api('POST', '/api/v1/crm/integrations/google_ads/webhook', { body: { ...body, google_key: 'wrong' } })).status, 401);
  const testLead = await api('POST', '/api/v1/crm/integrations/google_ads/webhook', { body: { ...body, lead_id: 'GA-TEST', is_test: true } });
  assert.equal(testLead.body.test, true);
  assert.equal(await Lead.countDocuments({}), 1, 'a Google "Send test data" lead never reaches the sales pipeline');
});

maybeTest('Test 9 / item 6 - unified endpoint: per-channel key, validation errors, idempotency, rotation and revocation', async () => {
  await makeUser('Pool', crm('sales'));
  const { key: tiktokKey, record } = await keyService.createKey('tiktok', { label: 'Cangrow relay' });
  const payload = { externalId: 'TT-77', name: 'Laila', phone: '01012121212', campaign: 'Compounds Nov', submittedAt: '2026-11-09T09:00:00+02:00' };

  const noKey = await api('POST', '/api/v1/crm/integrations/tiktok/leads', { body: payload });
  assert.equal(noKey.status, 401);
  const wrongChannel = await api('POST', '/api/v1/crm/integrations/meta/leads', { body: payload, headers: { 'X-Api-Key': tiktokKey } });
  assert.equal(wrongChannel.status, 401, 'a TikTok key cannot create Meta leads');
  const unknown = await api('POST', '/api/v1/crm/integrations/snapchat/leads', { body: payload, headers: { 'X-Api-Key': tiktokKey } });
  assert.equal(unknown.status, 404);
  const invalid = await api('POST', '/api/v1/crm/integrations/tiktok/leads', { body: { externalId: 'TT-x', phone: '555' }, headers: { 'X-Api-Key': tiktokKey } });
  assert.equal(invalid.status, 400);

  const created = await api('POST', '/api/v1/crm/integrations/tiktok/leads', { body: payload, headers: { 'X-Api-Key': tiktokKey } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.created, true);
  assert.equal(JSON.stringify(created.body).includes('01012121212'), false, 'contact data is never echoed back');
  const replay = await api('POST', '/api/v1/crm/integrations/tiktok/leads', { body: payload, headers: { Authorization: `Bearer ${tiktokKey}` } });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.replay, true);
  const lead = await Lead.findOne({}).lean();
  assert.equal(lead.source, 'TikTok');
  assert.equal(lead.campaign, 'Compounds Nov');
  assert.equal(lead.submittedAt.toISOString(), '2026-11-09T07:00:00.000Z');

  // Rotation: a second key works alongside the first; revoking the first stops it.
  const { key: newKey } = await keyService.createKey('tiktok', { label: 'rotated' });
  await keyService.revokeKey(record._id);
  assert.equal((await api('POST', '/api/v1/crm/integrations/tiktok/leads', { body: { ...payload, externalId: 'TT-78' }, headers: { 'X-Api-Key': tiktokKey } })).status, 401);
  assert.equal((await api('POST', '/api/v1/crm/integrations/tiktok/leads', { body: { ...payload, externalId: 'TT-78' }, headers: { 'X-Api-Key': newKey } })).status, 200);

  const stored = await mongoose.connection.collection('crmintegrationkeys').findOne({ _id: record._id });
  assert.ok(!JSON.stringify(stored).includes(tiktokKey.split('.')[1]), 'the plaintext secret is never stored');
});

// ===================================================================================== Test 10

maybeTest('Test 10 - permissions over HTTP: MD / admin / sales / technical each keep their intended access', async () => {
  const md = await makeUser('MD', crm('md'));
  const admin = await makeUser('Admin', crm('admin'));
  const sales = await makeUser('Sales', crm('sales'));
  const tech = await makeUser('Tech', crm('technical'));
  const outsider = await makeUser('ERP Only', [{ system: 'ERP', role: 'operator', isActive: true }]);

  // Integration admin: status/keys list for MD + admin, key creation MD only, nothing for sales/technical/outsiders.
  for (const [user, status] of [[md, 200], [admin, 200], [sales, 403], [tech, 403], [outsider, 403]]) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await api('GET', '/api/v1/crm/integrations/status', { user })).status, status, user.name);
  }
  for (const [user, status] of [[md, 201], [admin, 403], [sales, 403], [tech, 403]]) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await api('POST', '/api/v1/crm/integrations/keys', { user, body: { channel: 'meta', label: 'x' } })).status, status, user.name);
  }
  const keys = await api('GET', '/api/v1/crm/integrations/keys', { user: md });
  assert.ok(keys.body.data.every(k => k.secretHash === undefined), 'hashes are never serialized');

  // Stage override over HTTP.
  const { lead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01077770000', channel: 'phone', source: 'Referral' }, { userId: sales._id });
  await leadService.changeStage(lead._id, { to: 'contacted' }, { role: 'sales' });
  const body = { to: 'site_survey', followUpAt: '2026-11-12', overrideReason: 'skip' };
  assert.equal((await api('PATCH', `/api/v1/crm/leads/${lead._id}/stage`, { user: sales, body })).status, 403);
  assert.equal((await api('PATCH', `/api/v1/crm/leads/${lead._id}/stage`, { user: admin, body })).status, 403);
  const noReason = await api('PATCH', `/api/v1/crm/leads/${lead._id}/stage`, { user: md, body: { to: 'site_survey', followUpAt: '2026-11-12' } });
  assert.equal(noReason.status, 400);
  const ok = await api('PATCH', `/api/v1/crm/leads/${lead._id}/stage`, { user: md, body });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.followUpAt, '2026-11-12');

  // Archive stays MD-only; technical keeps its own stage restriction; an ERP-only user has no CRM at all.
  assert.equal((await api('PATCH', `/api/v1/crm/leads/${lead._id}/archive`, { user: admin, body: { reason: 'x' } })).status, 403);
  assert.equal((await api('GET', '/api/v1/crm/leads', { user: outsider })).status, 403);
  const techMove = await api('PATCH', `/api/v1/crm/leads/${lead._id}/stage`, { user: tech, body: { to: 'lost', lostReason: 'Price' } });
  assert.equal(techMove.status, 400);
  assert.match(techMove.body.message, /Technical can move leads to Site survey or Proposal sent only/);
});

// ===================================================================================== Phase 0 / item 13

maybeTest('Phase 0 - the admin screen can no longer remove the LAST CRM MD / Commercial MD membership; removing one of two still works', async () => {
  const platformAdmin = await makeUser('Platform Admin', [{ system: 'ERP', role: 'admin', isActive: true }], { platformAdmin: true });
  const mdUser = await makeUser('Hashem Ahmed', [
    { system: 'ERP', role: 'admin', isActive: true },
    { system: 'CRM', role: 'md', isActive: true },
    { system: 'COMMERCIAL', role: 'md', isActive: true },
  ]);
  // Exactly the 9 Nov save: Website granted, CRM + Commercial dropped.
  const res = await api('PUT', `/api/v1/admin/platform/users/${mdUser._id}/systems`, {
    user: platformAdmin,
    body: { systemMemberships: [{ system: 'ERP', role: 'admin' }, { system: 'WEBSITE', role: 'admin' }] },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /last active CRM "md" membership/);
  assert.equal((await User.findById(mdUser._id).lean()).systemMemberships.length, 3, 'nothing changed');

  // With a second CRM MD and Commercial MD in place, the same change is allowed (it is not a lock-out).
  await makeUser('Second MD', [{ system: 'CRM', role: 'md', isActive: true }, { system: 'COMMERCIAL', role: 'md', isActive: true }]);
  const ok = await api('PUT', `/api/v1/admin/platform/users/${mdUser._id}/systems`, { user: platformAdmin, body: { systemMemberships: [{ system: 'ERP', role: 'admin' }] } });
  assert.equal(ok.status, 200);

  const systems = await api('GET', '/api/v1/admin/platform/systems', { user: platformAdmin });
  assert.deepEqual(systems.body.data.find(s => s.id === 'CRM').roles, ['md', 'admin', 'sales', 'technical'], 'the UI gets the REAL roles from the registry');
});

maybeTest('Phase 0 - restoreSystemAccess: read-only diagnosis names the removing save; --apply restores exactly CRM md + COMMERCIAL md and nothing else', async () => {
  const { restoreSystemAccess } = require('../../scripts/restoreSystemAccess');
  const admin = await makeUser('Platform Admin', [], { platformAdmin: true });
  const mdUser = await makeUser('Hashem Ahmed', [{ system: 'ERP', role: 'admin', isActive: true }, { system: 'WEBSITE', role: 'admin', isActive: true }]);
  const bystander = await makeUser('Bystander', crm('sales'));
  await PlatformAuditLog.create({
    actor: admin._id,
    actorName: admin.name,
    action: 'user.systems.update',
    targetUser: mdUser._id,
    before: [{ system: 'ERP', role: 'admin', isActive: true }, { system: 'CRM', role: 'md', isActive: true }, { system: 'COMMERCIAL', role: 'md', isActive: true }],
    after: [{ system: 'ERP', role: 'admin', isActive: true }, { system: 'WEBSITE', role: 'admin', isActive: true }],
  });

  const quiet = console.log;
  console.log = () => {};
  try {
    const dry = await restoreSystemAccess({ connect: false, argv: ['node', 'x', `--email=${mdUser.email}`] });
    assert.deepEqual(dry.plan.items.filter(p => p.action === 'add' || p.action === 'set').map(p => `${p.system}:${p.role}`), ['CRM:md', 'COMMERCIAL:md']);
    assert.equal(dry.applied, false);
    assert.equal((await User.findById(mdUser._id).lean()).systemMemberships.length, 2, 'read-only run changed nothing');

    const applied = await restoreSystemAccess({ connect: false, argv: ['node', 'x', `--email=${mdUser.email}`, '--apply', `--actor-email=${admin.email}`, `--confirm-db=${mongoose.connection.db.databaseName}`] });
    assert.equal(applied.applied, true);
  } finally {
    console.log = quiet;
  }
  const after_ = (await User.findById(mdUser._id).lean()).systemMemberships.map(m => `${m.system}:${m.role}:${m.isActive}`).sort();
  assert.deepEqual(after_, ['COMMERCIAL:md:true', 'CRM:md:true', 'ERP:admin:true', 'WEBSITE:admin:true'], 'HR not added; ERP and Website untouched');
  assert.deepEqual((await User.findById(bystander._id).lean()).systemMemberships.map(m => `${m.system}:${m.role}`), ['CRM:sales'], 'other users untouched');
  assert.equal(await PlatformAuditLog.countDocuments({ targetUser: mdUser._id }), 2, 'the restoration itself is audited');
});

maybeTest('Item 13 - test-lead cleanup archives only confirmed TEST leads (never deletes) and refuses a real-looking customer', async () => {
  const { auditCrmTestLeads } = require('../../scripts/auditCrmTestLeads');
  const md = await makeUser('MD', crm('md'));
  const { lead: testLead } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01090000001', channel: 'phone', source: 'Referral', name: 'TEST - delete Farm Wadi' });
  await Lead.updateOne({ _id: testLead._id }, { $set: { refCode: 'RSV-0811-0008', stage: 'proposal_sent' } });
  const { lead: real } = await leadService.intakeLead({ governorate: 'Cairo', phone: '01090000002', channel: 'phone', source: 'Referral', name: 'Real Customer' });

  const quiet = console.log;
  console.log = () => {};
  const argv = process.argv;
  try {
    process.argv = ['node', 'x', `--archive=RSV-0811-0008,${real.refCode}`, `--actor-email=${md.email}`];
    const dry = await auditCrmTestLeads({ connect: false });
    assert.deepEqual(dry.archived.map(r => r.outcome), ['would_archive', 'refused']);
    assert.equal((await Lead.findById(testLead._id).lean()).archived, false, 'dry run');
    process.argv = [...process.argv, '--apply'];
    const done = await auditCrmTestLeads({ connect: false });
    assert.deepEqual(done.archived.map(r => r.outcome), ['archived', 'refused']);
  } finally {
    process.argv = argv;
    console.log = quiet;
  }
  const archived = await Lead.findById(testLead._id).lean();
  assert.equal(archived.archived, true);
  assert.match(archived.archiveReason, /RSV-0811-0008/);
  assert.equal(idOf(archived.archivedBy), String(md._id));
  assert.equal((await Lead.findById(real._id).lean()).archived, false, 'the real customer is untouched');
  assert.equal(await Lead.countDocuments({}), 2, 'nothing deleted');

  // Archived leads leave the dashboard counts.
  const pipeline = await reportService.getPipelineBlock({ ownerId: null });
  assert.equal(pipeline.stages.find(s => s.stage === 'proposal_sent').count, 0);
});
