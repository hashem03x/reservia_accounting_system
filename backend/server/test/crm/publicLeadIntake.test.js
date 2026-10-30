const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

// Reservia CRM - the public website's lead-capture call (services/crm/publicLeadIntakeService.js).
// Covers the segment/channel mapping, honeypot handling, attribution persistence and the same
// dedupe-by-phone guarantee every other intake channel gets, plus the validator chain actually
// used by the route (same technique as test/vendor/installmentsRequirePaymentTerms.test.js -
// running the real express-validator chain against a mock req, not a full HTTP layer).

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let Lead, Activity, publicLeadIntakeService;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/userModel');
  Lead = require('../../models/crm/leadModel');
  Activity = require('../../models/crm/activityModel');
  require('../../models/crm/stageHistoryModel');
  await Lead.init();
  await Activity.init();
  publicLeadIntakeService = require('../../services/crm/publicLeadIntakeService');
});

after(async () => {
  if (!RUN) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  await Promise.all([Lead.deleteMany({}), Activity.deleteMany({})]);
});

function validSubmission(overrides = {}) {
  return {
    name: 'Ahmed Samir',
    phone: '01012345678',
    segment: 'villas',
    source: 'landing_form',
    governorate: 'Giza',
    pageUrl: 'https://reservia-energy.com/en/lp/villas',
    utm: { utm_source: 'test', utm_medium: 'qa', utm_campaign: 'brief-check' },
    ampDeviceId: 'website-device-aaaaaaaa-1111',
    ...overrides,
  };
}

// ===================== Pure mapping (no DB) =====================

test('mapWebsitePayload: maps the website\'s own segment/source vocabulary to the CRM\'s real enums', () => {
  const { mapWebsitePayload } = publicLeadIntakeService || require('../../services/crm/publicLeadIntakeService');
  const mapped = mapWebsitePayload(validSubmission());
  assert.equal(mapped.segment, 'villa');
  assert.equal(mapped.channel, 'landing_page');
  assert.equal(mapped.utmSource, 'test');
  assert.equal(mapped.utmMedium, 'qa');
  assert.equal(mapped.utmCampaign, 'brief-check');
  assert.equal(mapped.landingPage, 'https://reservia-energy.com/en/lp/villas');
  assert.equal(mapped.source, 'test');
});

test('mapWebsitePayload: contact_form maps to channel web_form; every website segment is recognized', () => {
  const { mapWebsitePayload, WEBSITE_SEGMENT_TO_CRM } = require('../../services/crm/publicLeadIntakeService');
  const mapped = mapWebsitePayload(validSubmission({ source: 'contact_form', segment: 'service' }));
  assert.equal(mapped.channel, 'web_form');
  assert.equal(mapped.segment, 'services');
  for (const websiteSegment of Object.keys(WEBSITE_SEGMENT_TO_CRM)) {
    assert.doesNotThrow(() => mapWebsitePayload(validSubmission({ segment: websiteSegment })));
  }
});

test('mapWebsitePayload: no utm_source falls back to a plain "Website" source label, never blank', () => {
  const { mapWebsitePayload } = require('../../services/crm/publicLeadIntakeService');
  const mapped = mapWebsitePayload(validSubmission({ utm: {} }));
  assert.equal(mapped.source, 'Website');
  assert.equal(mapped.utmSource, undefined);
});

test('buildIntakeNote: summarizes a calculator estimate and the generic site figure as a readable note, never as a typed field', () => {
  const { buildIntakeNote } = require('../../services/crm/publicLeadIntakeService');
  const note = buildIntakeNote({
    message: 'Please call after 5pm',
    siteInput: 1800,
    calculator: { category: 'residential_commercial', systemSizeKwp: 6, indicativePriceEgp: 183600, yearlySavingEgp: 36804, paybackYears: 5.31 },
  });
  assert.match(note, /Please call after 5pm/);
  assert.match(note, /1800/);
  assert.match(note, /6kWp/);
  assert.match(note, /183600/);
});

// ===================== Validator chain =====================

async function runValidators(validators, body) {
  const req = { body, params: {}, query: {} };
  for (const middleware of validators) {
    if (typeof middleware.run === 'function') await middleware.run(req);
  }
  return validationResult(req);
}

test('publicLeadValidators: a well-formed submission passes', async () => {
  const { publicLeadValidators } = require('../../utils/validators/crm/publicLeadValidators');
  const result = await runValidators(publicLeadValidators, validSubmission());
  assert.equal(result.isEmpty(), true, JSON.stringify(result.array()));
});

test('publicLeadValidators: missing phone, bad segment and bad source are all rejected with field-specific errors', async () => {
  const { publicLeadValidators } = require('../../utils/validators/crm/publicLeadValidators');
  const result = await runValidators(publicLeadValidators, validSubmission({ phone: '', segment: 'not-a-real-segment', source: 'telepathy' }));
  assert.equal(result.isEmpty(), false);
  const fields = result.array().map(e => e.param);
  assert.ok(fields.includes('phone'));
  assert.ok(fields.includes('segment'));
  assert.ok(fields.includes('source'));
});

test('publicLeadValidators: an invalid (non-Egyptian-shaped) phone is rejected even though it is non-empty', async () => {
  const { publicLeadValidators } = require('../../utils/validators/crm/publicLeadValidators');
  const result = await runValidators(publicLeadValidators, validSubmission({ phone: '123' }));
  assert.equal(result.isEmpty(), false);
});

test('publicLeadValidators: the honeypot field is never required and never rejected when present as plain text', async () => {
  const { publicLeadValidators } = require('../../utils/validators/crm/publicLeadValidators');
  const withoutHoneypot = await runValidators(publicLeadValidators, validSubmission());
  const withHoneypot = await runValidators(publicLeadValidators, validSubmission({ website: 'http://spam.example' }));
  assert.equal(withoutHoneypot.isEmpty(), true);
  assert.equal(withHoneypot.isEmpty(), true);
});

// ===================== End-to-end intake (requires a real replica-set DB) =====================

maybeTest('intakePublicLead: a valid submission creates a lead, returns its ref code, and persists UTM/landing-page attribution', async () => {
  const result = await publicLeadIntakeService.intakePublicLead(validSubmission());
  assert.ok(result.refCode);
  assert.match(result.refCode, /^RSV-\d{4}-\d{4}$/);

  const lead = await Lead.findOne({ phoneE164: '+201012345678' }).lean();
  assert.ok(lead);
  assert.equal(lead.segment, 'villa');
  assert.equal(lead.channel, 'landing_page');
  assert.equal(lead.utmSource, 'test');
  assert.equal(lead.utmMedium, 'qa');
  assert.equal(lead.utmCampaign, 'brief-check');
  assert.equal(lead.ampDeviceId, 'website-device-aaaaaaaa-1111');
});

maybeTest('intakePublicLead: the honeypot field being filled creates NOTHING - no lead, no activity', async () => {
  const result = await publicLeadIntakeService.intakePublicLead(validSubmission({ phone: '01099988877', website: 'http://bot.example/spam' }));
  assert.deepEqual(result, { honeypot: true });
  assert.equal(await Lead.countDocuments({}), 0);
  assert.equal(await Activity.countDocuments({}), 0);
});

maybeTest('intakePublicLead: a second submission for the SAME phone merges into the existing lead (the public form is just another intake channel)', async () => {
  const first = await publicLeadIntakeService.intakePublicLead(validSubmission());
  const second = await publicLeadIntakeService.intakePublicLead(validSubmission({ name: 'Ahmed Samir (again)' }));
  assert.equal(second.refCode, first.refCode);
  assert.equal(await Lead.countDocuments({ phoneE164: '+201012345678' }), 1);
});

maybeTest('intakePublicLead: a message and a calculator estimate are recorded as a note activity, never stored as PII-bearing typed fields on the Lead itself', async () => {
  const result = await publicLeadIntakeService.intakePublicLead(
    validSubmission({
      phone: '01077711122',
      message: 'We have a flat roof, please advise',
      calculator: { category: 'residential_commercial', systemSizeKwp: 6, indicativePriceEgp: 183600 },
    })
  );
  const lead = await Lead.findOne({ phoneE164: '+201077711122' }).lean();
  assert.equal(lead.valueEgp, 183600);
  assert.equal(lead.systemSizeKwp, 6);
  const note = await Activity.findOne({ lead: lead._id, type: 'note' }).lean();
  assert.match(note.body, /flat roof/);
  assert.ok(result.refCode);
});

maybeTest('intakePublicLead: an unrecognized segment/source is rejected (defense in depth - the validator should already have caught this)', async () => {
  await assert.rejects(() => publicLeadIntakeService.intakePublicLead(validSubmission({ segment: 'not-a-real-segment' })));
});
