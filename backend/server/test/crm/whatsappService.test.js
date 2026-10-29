const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

const ORIGINAL_ENV = { verify: process.env.WHATSAPP_VERIFY_TOKEN, secret: process.env.WHATSAPP_APP_SECRET };

process.env.WHATSAPP_VERIFY_TOKEN = 'reservia-test-verify-token';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';

const whatsappService = require('../../services/crm/whatsappService');

let Lead, Activity;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/userModel');
  Lead = require('../../models/crm/leadModel');
  Activity = require('../../models/crm/activityModel');
  await Lead.init();
  await Activity.init();
});

after(async () => {
  process.env.WHATSAPP_VERIFY_TOKEN = ORIGINAL_ENV.verify;
  process.env.WHATSAPP_APP_SECRET = ORIGINAL_ENV.secret;
  if (!RUN) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  await Promise.all([Lead.deleteMany({}), Activity.deleteMany({})]);
});

// ===================== Pure checks (no DB required) =====================

test('verifySubscription: the handshake echoes the challenge only when mode=subscribe and the token matches OUR configured verify token', () => {
  assert.equal(whatsappService.verifySubscription({ mode: 'subscribe', token: 'reservia-test-verify-token', challenge: 'abc123' }), 'abc123');
});

test('verifySubscription: a wrong token is rejected (returns null), never echoed', () => {
  assert.equal(whatsappService.verifySubscription({ mode: 'subscribe', token: 'wrong-token', challenge: 'abc123' }), null);
});

test('verifySubscription: a mode other than "subscribe" is rejected', () => {
  assert.equal(whatsappService.verifySubscription({ mode: 'unsubscribe', token: 'reservia-test-verify-token', challenge: 'abc123' }), null);
});

test('verifySignature: a correctly-HMACed body is accepted', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));
  const sig = `sha256=${crypto.createHmac('sha256', 'test-app-secret').update(body).digest('hex')}`;
  assert.equal(whatsappService.verifySignature(body, sig), true);
});

test('verifySignature: a tampered body (signature computed over different bytes) is rejected', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }));
  const tampered = Buffer.from(JSON.stringify({ hello: 'mallory' }));
  const sig = `sha256=${crypto.createHmac('sha256', 'test-app-secret').update(body).digest('hex')}`;
  assert.equal(whatsappService.verifySignature(tampered, sig), false);
});

test('verifySignature: a missing or malformed header is rejected, never treated as "no check needed"', () => {
  const body = Buffer.from('{}');
  assert.equal(whatsappService.verifySignature(body, undefined), false);
  assert.equal(whatsappService.verifySignature(body, 'not-a-real-header'), false);
});

// ===================== Inbound message processing (requires a real replica-set DB - see
// test/crm/leadService.test.js's header comment on why) =====================

function metaPayload({ from, id, text, name }) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              contacts: name ? [{ profile: { name }, wa_id: from }] : [],
              messages: [{ from, id, timestamp: `${Math.floor(Date.now() / 1000)}`, type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}

maybeTest('processWebhookPayload: an inbound message from a brand-new number creates a lead via the "whatsapp" channel and logs it as whatsapp_in (never counts as a first human reply)', async () => {
  await whatsappService.processWebhookPayload(metaPayload({ from: '201012345678', id: 'wamid.ONE', text: 'Hi, interested in solar', name: 'Mona Khaled' }));

  const lead = await Lead.findOne({ phoneE164: '+201012345678' }).lean();
  assert.ok(lead);
  assert.equal(lead.channel, 'whatsapp');
  assert.equal(lead.name, 'Mona Khaled');
  assert.equal(lead.firstReplyAt, null);

  const activity = await Activity.findOne({ whatsappMessageId: 'wamid.ONE' }).lean();
  assert.equal(activity.type, 'whatsapp_in');
  assert.equal(activity.body, 'Hi, interested in solar');
});

maybeTest('processWebhookPayload: Meta redelivering the identical message id never creates a second activity', async () => {
  const payload = metaPayload({ from: '201022233344', id: 'wamid.DUP', text: 'Hello again' });
  await whatsappService.processWebhookPayload(payload);
  await whatsappService.processWebhookPayload(payload); // Meta's at-least-once retry

  const count = await Activity.countDocuments({ whatsappMessageId: 'wamid.DUP' });
  assert.equal(count, 1);
  const leadCount = await Lead.countDocuments({ phoneE164: '+201022233344' });
  assert.equal(leadCount, 1);
});

maybeTest('processWebhookPayload: a second, later message from the SAME number appends to the existing lead rather than creating a new one', async () => {
  await whatsappService.processWebhookPayload(metaPayload({ from: '201033344455', id: 'wamid.FIRST', text: 'First message' }));
  await whatsappService.processWebhookPayload(metaPayload({ from: '201033344455', id: 'wamid.SECOND', text: 'Second message' }));

  const leadCount = await Lead.countDocuments({ phoneE164: '+201033344455' });
  assert.equal(leadCount, 1);
  const activityCount = await Activity.countDocuments({ whatsappMessageId: { $in: ['wamid.FIRST', 'wamid.SECOND'] } });
  assert.equal(activityCount, 2);
});
