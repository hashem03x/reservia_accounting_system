const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// Change Request 2 - pure, DB-free unit tests: Cairo business dates, pipeline valuation, first-reply
// metrics, intake payload mapping (unified / Meta / Google Ads), webhook signatures, CSV row
// validation. The DB-backed end-to-end scenarios live in changeRequest2Acceptance.test.js.

const {
  toDateOnly,
  isValidDateOnly,
  cairoDateOf,
  cairoMonthBounds,
  isFollowUpOverdue,
  parseSubmissionTimestamp,
  cairoWallTimeToInstant,
} = require('../../utils/crm/businessDate');
const { valuePipeline, stageProbabilities, unconfiguredStages } = require('../../services/crm/pipelineValuation');
const { computeFirstReplyMetrics, replyViaForActivityType, hoursToFirstReply } = require('../../services/crm/firstReplyService');
const { mapUnifiedPayload, contentDigestId } = require('../../services/crm/leadIntakeService');
const metaLeadAds = require('../../services/crm/metaLeadAdsService');
const googleAds = require('../../services/crm/googleAdsLeadService');
const { KEY_PATTERN } = require('../../services/crm/integrationKeyService');
const crmImport = require('../../utils/validators/import/crmLeadImportSchema');
const { STAGE_WEIGHTS } = require('../../utils/crm/constants');

// =========================================================== item 2: follow-up dates (Cairo)

test('item 2: a date-only follow-up "2026-11-12" is kept verbatim - never turned into a UTC timestamp', () => {
  assert.equal(toDateOnly('2026-11-12'), '2026-11-12');
  assert.equal(toDateOnly(' 2026-11-12 '), '2026-11-12');
});

test('item 2: a LEGACY follow-up stored as new Date("2026-11-12") (UTC midnight = 02:00 Cairo) reads back as 12 November, not "Nov 12, 2:00 AM" or Nov 11', () => {
  assert.equal(toDateOnly(new Date('2026-11-12')), '2026-11-12');
  assert.equal(toDateOnly('2026-11-12T00:00:00.000Z'), '2026-11-12');
});

test('item 2: timezone boundaries - an instant late on the 11th UTC that is already the 12th in Cairo maps to the 12th', () => {
  // 22:30 UTC on the 11th = 00:30 Cairo on the 12th (UTC+2).
  assert.equal(cairoDateOf(new Date('2026-11-11T22:30:00Z')), '2026-11-12');
  // 21:59 UTC on the 11th = 23:59 Cairo on the 11th.
  assert.equal(cairoDateOf(new Date('2026-11-11T21:59:00Z')), '2026-11-11');
  // A client that sent local midnight with an explicit +02:00 offset.
  assert.equal(toDateOnly('2026-11-12T00:00:00+02:00'), '2026-11-12');
});

test('item 2: impossible calendar dates are rejected, null/empty clears', () => {
  assert.equal(isValidDateOnly('2026-02-30'), false);
  assert.equal(isValidDateOnly('2026-13-01'), false);
  assert.equal(toDateOnly('2026-02-30'), undefined);
  assert.equal(toDateOnly('not a date'), undefined);
  assert.equal(toDateOnly(null), null);
  assert.equal(toDateOnly(''), null);
});

test('item 2: a follow-up is overdue only AFTER its Cairo day has ended - due today is not overdue', () => {
  const nov12at0230Cairo = new Date('2026-11-12T00:30:00Z');
  assert.equal(isFollowUpOverdue('2026-11-12', nov12at0230Cairo), false, 'the old code flagged this at 02:00 on the day itself');
  assert.equal(isFollowUpOverdue('2026-11-11', nov12at0230Cairo), true);
  assert.equal(isFollowUpOverdue('2026-11-12', new Date('2026-11-12T21:59:00Z')), false, '23:59 Cairo on the 12th');
  assert.equal(isFollowUpOverdue('2026-11-12', new Date('2026-11-12T22:00:00Z')), true, '00:00 Cairo on the 13th');
});

test('reports: a Cairo month starts at Cairo midnight - a lead at 00:30 on 1 Nov Cairo time is in November, not October', () => {
  const { start, end } = cairoMonthBounds(2026, 11);
  assert.equal(start.toISOString(), '2026-10-31T22:00:00.000Z');
  assert.equal(end.toISOString(), '2026-11-30T22:00:00.000Z');
  const dec = cairoMonthBounds(2026, 12);
  assert.equal(dec.end.toISOString(), '2026-12-31T22:00:00.000Z', 'December rolls into January of the next year');
});

// =========================================================== item 12: original timestamps

test('item 12: a CSV timestamp without a timezone is read as CAIRO local time', () => {
  assert.equal(parseSubmissionTimestamp('2026-11-09 10:00').toISOString(), '2026-11-09T08:00:00.000Z');
  assert.equal(parseSubmissionTimestamp('2026-11-09T10:00:30').toISOString(), '2026-11-09T08:00:30.000Z');
});

test('item 12: explicit offsets, Z and Unix timestamps (seconds and ms) are honoured as-is', () => {
  assert.equal(parseSubmissionTimestamp('2026-11-09T10:00:00+02:00').toISOString(), '2026-11-09T08:00:00.000Z');
  assert.equal(parseSubmissionTimestamp('2026-11-09T08:00:00Z').toISOString(), '2026-11-09T08:00:00.000Z');
  assert.equal(parseSubmissionTimestamp('1794211200').toISOString(), new Date(1794211200 * 1000).toISOString());
  assert.equal(parseSubmissionTimestamp(1794211200000).toISOString(), new Date(1794211200000).toISOString());
});

test('item 12: ambiguous or malformed timestamps are rejected rather than guessed', () => {
  assert.equal(parseSubmissionTimestamp('09/11/2026 10:00'), null, 'day/month order is ambiguous');
  assert.equal(parseSubmissionTimestamp('2026-11-31 10:00'), null);
  assert.equal(parseSubmissionTimestamp('2026-11-09 25:00'), null);
  assert.equal(parseSubmissionTimestamp('yesterday'), null);
});

test('cairoWallTimeToInstant resolves Cairo wall time to the right UTC instant', () => {
  assert.equal(cairoWallTimeToInstant(2026, 11, 8, 10, 39).toISOString(), '2026-11-08T08:39:00.000Z');
});

// =========================================================== item 4: pipeline valuation

test('item 4: one 900,000 EGP lead at Proposal sent -> Pipeline value 900,000 and Weighted value 495,000 (55%) - BOTH reported', () => {
  const v = valuePipeline([{ _id: 'proposal_sent', count: 1, valueEgp: 900000 }]);
  assert.equal(v.totalValueEgp, 900000);
  assert.equal(v.totalWeightedValueEgp, 495000);
  const row = v.stages.find(s => s.stage === 'proposal_sent');
  assert.equal(row.probability, 0.55);
  assert.equal(row.weightedValueEgp, 495000);
});

test('item 4: weighted = sum(value x configured stage probability); won/lost never count toward either open total', () => {
  const rows = [
    { _id: 'new', count: 2, valueEgp: 100000 },
    { _id: 'qualified', count: 1, valueEgp: 200000 },
    { _id: 'negotiation', count: 1, valueEgp: 400000 },
    { _id: 'won', count: 3, valueEgp: 5000000 },
    { _id: 'lost', count: 1, valueEgp: 70000 },
  ];
  const v = valuePipeline(rows, { includeClosedStages: true });
  assert.equal(v.totalValueEgp, 700000);
  assert.equal(v.totalWeightedValueEgp, Math.round(100000 * 0.05) + Math.round(200000 * 0.25) + Math.round(400000 * 0.75));
  assert.equal(v.openLeadCount, 4);
  assert.equal(v.stages.find(s => s.stage === 'won').weightedValueEgp, 0);
  assert.equal(v.stages.find(s => s.stage === 'won').probability, null);
});

test('item 4: every open stage has a configured probability, and the payload exposes them for printing', () => {
  assert.deepEqual(unconfiguredStages(), []);
  const probs = Object.fromEntries(stageProbabilities().map(p => [p.stage, p.probability]));
  assert.deepEqual(probs, STAGE_WEIGHTS);
});

// =========================================================== item 3: first reply

test('item 3: only call / email / outbound WhatsApp activities are first replies - never notes, inbound messages or system entries', () => {
  assert.equal(replyViaForActivityType('call'), 'call');
  assert.equal(replyViaForActivityType('email'), 'email');
  assert.equal(replyViaForActivityType('whatsapp_out'), 'whatsapp_out');
  for (const t of ['note', 'whatsapp_in', 'system', 'survey', 'proposal']) assert.equal(replyViaForActivityType(t), null, t);
});

test('item 3: hours to first reply are WORKING hours from the ORIGINAL submission time, not the import time', () => {
  // Submitted Monday 10:00 Cairo, imported Tuesday 09:00, replied Tuesday 10:00.
  const lead = {
    submittedAt: new Date('2026-11-09T08:00:00Z'),
    createdAt: new Date('2026-11-10T07:00:00Z'),
    firstReplyAt: new Date('2026-11-10T08:00:00Z'),
  };
  assert.equal(hoursToFirstReply(lead), 9, '8h left on Monday (10-18) + 1h Tuesday (09-10)');
  assert.equal(hoursToFirstReply({ ...lead, submittedAt: null }), 1, 'legacy lead with no submittedAt falls back to createdAt');
});

test('item 3: metrics - avg over replied leads, % within 8h over leads with a KNOWN outcome, pending leads excluded', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const base = { createdAt: new Date('2026-11-08T07:00:00Z'), submittedAt: null }; // Sunday 09:00 Cairo
  const leads = [
    { ...base, firstReplyAt: new Date('2026-11-08T09:00:00Z'), replyDueAt: new Date('2026-11-08T15:00:00Z') }, // 2h - within
    { ...base, firstReplyAt: new Date('2026-11-09T09:00:00Z'), replyDueAt: new Date('2026-11-08T15:00:00Z') }, // 11h - late
    { ...base, firstReplyAt: null, replyDueAt: new Date('2026-11-09T15:00:00Z') }, // unreplied, deadline passed - a miss
    { ...base, firstReplyAt: null, replyDueAt: new Date('2026-11-10T15:00:00Z') }, // unreplied, still in time - pending
  ];
  const m = computeFirstReplyMetrics(leads, { now });
  assert.equal(m.repliedCount, 2);
  assert.equal(m.avgHours, 6.5);
  assert.equal(m.withinSlaCount, 1);
  assert.equal(m.overdueUnrepliedCount, 1);
  assert.equal(m.pendingCount, 1);
  assert.equal(m.slaSampleSize, 3);
  assert.equal(m.pctWithinSla, 33.3);
});

test('item 3: no replied leads -> null averages, never 0 or NaN', () => {
  const m = computeFirstReplyMetrics([], {});
  assert.equal(m.avgHours, null);
  assert.equal(m.pctWithinSla, null);
  assert.equal(m.sampleSize, 0);
});

// =========================================================== items 6-11: intake mapping

test('item 6: the unified payload takes its Source from the CHANNEL (the key), never from the body', () => {
  const meta = mapUnifiedPayload('meta', { externalId: 'x', phone: '01012345678', source: 'Organic', campaign: 'Villas Nov' });
  assert.equal(meta.source, 'Meta Ads');
  assert.equal(meta.channel, 'ad_lead_form');
  assert.equal(meta.campaign, 'Villas Nov');
  assert.equal(mapUnifiedPayload('tiktok', { phone: '01012345678' }).source, 'TikTok');
  assert.equal(mapUnifiedPayload('google_ads', { phone: '01012345678' }).source, 'Google Ads');
});

test('item 7: the website channel maps UTM with the shared rules: google + cpc -> Google Ads, campaign kept, utm_term captured', () => {
  const w = mapUnifiedPayload('website', { phone: '01012345678', utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'test', utm_term: 'solar farm' } });
  assert.equal(w.source, 'Google Ads');
  assert.equal(w.channel, 'web_form');
  assert.equal(w.campaign, 'test');
  assert.equal(w.utmTerm, 'solar farm');
});

test('item 8: a WhatsApp relay may pass a Ref-code source from the fixed list; anything else is WhatsApp Direct', () => {
  assert.equal(mapUnifiedPayload('whatsapp', { phone: '01012345678', source: 'Google Ads' }).source, 'Google Ads');
  assert.equal(mapUnifiedPayload('whatsapp', { phone: '01012345678', source: 'made up' }).source, 'WhatsApp Direct');
  assert.equal(mapUnifiedPayload('whatsapp', { phone: '01012345678' }).source, 'WhatsApp Direct');
});

test('item 6: an unparseable submittedAt is a clear 400, never silently replaced by "now"', () => {
  assert.throws(() => mapUnifiedPayload('meta', { phone: '01012345678', submittedAt: '09/11/2026' }), err => err.statusCode === 400 && /ISO 8601/.test(err.message));
});

test('item 9: Meta field_data maps phone/email/name (incl. first+last) and keeps other answers for the timeline', () => {
  const mapped = metaLeadAds.mapFieldData([
    { name: 'first_name', values: ['Ahmed'] },
    { name: 'last_name', values: ['Samir'] },
    { name: 'phone_number', values: ['+201012345678'] },
    { name: 'email', values: ['a@x.com'] },
    { name: 'monthly_bill', values: ['2000'] },
  ]);
  assert.equal(mapped.name, 'Ahmed Samir');
  assert.equal(mapped.phone, '+201012345678');
  assert.equal(mapped.email, 'a@x.com');
  assert.deepEqual(mapped.extra, { monthly_bill: '2000' });
});

test('item 9: a Graph lead becomes a Meta Ads intake with campaign, ad set, ad, form id, platform and the ORIGINAL created_time', () => {
  const args = metaLeadAds.toIntake(
    {
      id: '9001',
      created_time: '2026-11-15T09:30:00+0000',
      campaign_name: 'Farms Nov',
      adset_name: 'Delta farmers',
      ad_name: 'Pump video',
      form_id: '555',
      platform: 'ig',
      field_data: [{ name: 'full_name', values: ['Mona'] }, { name: 'phone_number', values: ['01011112222'] }],
    },
    { leadgen_id: '9001' }
  );
  assert.equal(args.externalId, '9001');
  assert.equal(args.lead.source, 'Meta Ads');
  assert.equal(args.lead.campaign, 'Farms Nov');
  assert.equal(args.lead.adSetName, 'Delta farmers');
  assert.equal(args.lead.adName, 'Pump video');
  assert.equal(args.lead.adFormId, '555');
  assert.equal(args.lead.adPlatform, 'instagram');
  // Meta writes "+0000" without a colon - still parsed, as the original submission instant.
  assert.equal(args.lead.submittedAt.toISOString(), '2026-11-15T09:30:00.000Z');
});

test('item 9: Meta webhook signatures - valid accepted, tampered/missing rejected, nothing accepted without an app secret', () => {
  const body = Buffer.from(JSON.stringify({ object: 'page', entry: [] }));
  const prev = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = 'meta-secret-for-tests';
  const sig = `sha256=${crypto.createHmac('sha256', 'meta-secret-for-tests').update(body).digest('hex')}`;
  assert.equal(metaLeadAds.verifySignature(body, sig), true);
  assert.equal(metaLeadAds.verifySignature(Buffer.from('{"tampered":true}'), sig), false);
  assert.equal(metaLeadAds.verifySignature(body, undefined), false);
  delete process.env.META_APP_SECRET;
  assert.equal(metaLeadAds.verifySignature(body, sig), false);
  if (prev !== undefined) process.env.META_APP_SECRET = prev;
});

test('item 9: only leadgen changes are extracted from a Meta page webhook', () => {
  const changes = metaLeadAds.extractLeadgenChanges({
    entry: [{ id: 'PAGE1', changes: [{ field: 'leadgen', value: { leadgen_id: 'L1', form_id: 'F1' } }, { field: 'feed', value: {} }] }],
  });
  assert.deepEqual(changes, [{ leadgen_id: 'L1', form_id: 'F1', page_id: 'PAGE1' }]);
});

test('item 11: Google Ads user_column_data maps to name/phone/email, other answers to the note, campaign id kept', () => {
  const args = googleAds.toIntake({
    lead_id: 'G-1',
    campaign_id: 777,
    form_id: 42,
    user_column_data: [
      { column_id: 'FULL_NAME', string_value: 'Omar Said' },
      { column_id: 'PHONE_NUMBER', string_value: '+201099990000' },
      { column_id: 'EMAIL', string_value: 'o@x.com' },
      { column_name: 'Farm size (feddan)', string_value: '40' },
    ],
  });
  assert.equal(args.externalId, 'G-1');
  assert.equal(args.lead.source, 'Google Ads');
  assert.equal(args.lead.name, 'Omar Said');
  assert.equal(args.lead.phone, '+201099990000');
  assert.equal(args.lead.campaign, 'Google Ads campaign 777');
  assert.equal(args.lead.adFormId, '42');
  assert.match(args.note, /Farm size \(feddan\): 40/);
});

test('item 6: API key format is channel-bound: rsv_<channel>_<12 hex>.<secret>', () => {
  assert.ok(KEY_PATTERN.test(`rsv_meta_${'a'.repeat(12)}.${'B'.repeat(43)}`));
  assert.ok(!KEY_PATTERN.test(`rsv_meta_${'a'.repeat(11)}.${'B'.repeat(43)}`));
  assert.ok(!KEY_PATTERN.test('Bearer something'));
});

test('CSV idempotency ids are deterministic for identical row content and differ otherwise', () => {
  assert.equal(contentDigestId(['+201012345678', 'TikTok', 'Nov', '2026-11-09T08:00:00.000Z']), contentDigestId(['+201012345678', 'TikTok', 'Nov', '2026-11-09T08:00:00.000Z']));
  assert.notEqual(contentDigestId(['+201012345678', 'TikTok', 'Nov', '2026-11-09T08:00:00.000Z']), contentDigestId(['+201012345678', 'TikTok', 'Nov', '2026-11-09T08:01:00.000Z']));
});

// =========================================================== item 12: CSV row validation

const NOW = new Date('2026-11-10T07:00:00Z'); // Tuesday 09:00 Cairo

test('item 12: a Cangrow-style row (Name, Phone, Email, Source, Campaign, timestamp) validates with Channel inferred from an ad Source', async () => {
  const { errors, value } = await crmImport.validateRow(
    { Name: 'Sara', Phone: '01012345678', Email: 'Sara@X.com', Source: 'tiktok', Campaign: 'Villas Nov', SubmittedAt: '2026-11-09 10:00' },
    { now: NOW }
  );
  assert.deepEqual(errors, []);
  assert.equal(value.channel, 'ad_lead_form');
  assert.equal(value.source, 'TikTok', 'canonical casing');
  assert.equal(value.email, 'sara@x.com');
  assert.equal(value.campaign, 'Villas Nov');
  assert.equal(value.submittedAt.toISOString(), '2026-11-09T08:00:00.000Z', 'Monday 10:00 Cairo');
});

test('item 12: header names are matched tolerantly ("Submitted At", "Campaign Name")', async () => {
  const { errors, value } = await crmImport.validateRow({ Phone: '01012345678', Source: 'Google Ads', 'Campaign Name': 'Brand', 'Submitted At': '2026-11-09 10:00' }, { now: NOW });
  assert.deepEqual(errors, []);
  assert.equal(value.campaign, 'Brand');
  assert.ok(value.submittedAt);
});

test('item 12: row-level errors explain exactly what to fix (bad timestamp, future, too old, bad email, no channel)', async () => {
  const check = async (row, column, pattern) => {
    const { errors } = await crmImport.validateRow(row, { now: NOW });
    const err = errors.find(e => e.column === column);
    assert.ok(err, `expected an error on ${column}, got ${JSON.stringify(errors)}`);
    assert.match(err.message, pattern);
  };
  await check({ Phone: '01012345678', Source: 'TikTok', SubmittedAt: '09/11/2026 10:00' }, 'SubmittedAt', /YYYY-MM-DD HH:mm/);
  await check({ Phone: '01012345678', Source: 'TikTok', SubmittedAt: '2026-11-11 10:00' }, 'SubmittedAt', /future/);
  await check({ Phone: '01012345678', Source: 'TikTok', SubmittedAt: '2025-11-09 10:00' }, 'SubmittedAt', /check the year/);
  await check({ Phone: '01012345678', Source: 'TikTok', Email: 'not-an-email' }, 'Email', /valid email/);
  await check({ Phone: '01012345678', Source: 'Referral' }, 'Channel', /required unless Source/);
});

test('item 12: the OLD template (Name, Phone, Channel, Segment, Source, ...) still validates unchanged', async () => {
  const { errors, value } = await crmImport.validateRow({ Name: 'Ahmed', Phone: '01011111111', Channel: 'phone', Segment: 'villa', Source: 'Google Ads', Governorate: 'giza' }, { now: NOW });
  assert.deepEqual(errors, []);
  assert.equal(value.channel, 'phone');
  assert.equal(value.governorate, 'Giza');
  assert.equal(value.submittedAt, undefined);
});
