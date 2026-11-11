const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const mongoose = require('mongoose');

// CRM C2-C6: encrypted credential storage, honest connection status, real-API connection tests
// (with an injected fetch), and the WhatsApp/Meta webhooks reading credentials saved on the page.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

const KEY = crypto.randomBytes(32).toString('base64');
let settings, secretBox, IntegrationSetting, Lead, Activity, server, baseUrl;

before(async () => {
  process.env.INTEGRATION_SECRETS_KEY = KEY;
  for (const k of ['WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'META_VERIFY_TOKEN', 'META_APP_SECRET', 'META_PAGE_ACCESS_TOKEN']) delete process.env[k];
  secretBox = require('../../utils/crm/secretBox');
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  settings = require('../../services/crm/integrationSettingsService');
  IntegrationSetting = require('../../models/crm/integrationSettingModel');
  Lead = require('../../models/crm/leadModel');
  Activity = require('../../models/crm/activityModel');
  require('../../models/userModel');
  await Promise.all([IntegrationSetting.init(), Lead.init(), Activity.init()]);
  const express = require('express');
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use('/api/v1/crm/whatsapp', require('../../routes/crm/whatsappRoute'));
  app.use('/api/v1/crm/integrations', require('../../routes/crm/integrationRoute'));
  app.use(require('../../middleware/errorMiddleware'));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!RUN) return;
  await new Promise(r => server.close(r));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  const names = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name);
  await Promise.all(names.map(n => mongoose.connection.collection(n).deleteMany({})));
});

test('secretBox: AES-256-GCM round trip, tamper-proof, hint shows only the last 4 characters', () => {
  const box = secretBox.encrypt('EAAG-super-secret-token-1234');
  assert.ok(!box.includes('super-secret'));
  assert.equal(secretBox.decrypt(box), 'EAAG-super-secret-token-1234');
  const tampered = box.slice(0, -4) + (box.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.equal(secretBox.decrypt(tampered), null);
  assert.equal(secretBox.hint('EAAG-super-secret-token-1234'), '••••1234');
});

maybeTest('secrets are stored encrypted, never returned; status walks not_configured -> awaiting_verification -> connected / error', async () => {
  let st = await settings.computeStatus('meta');
  assert.equal(st.state, 'not_configured');

  await settings.saveSettings('meta', { verifyToken: 'my-verify', appSecret: 'app-secret-xyz9', pageAccessToken: 'PAGE-TOKEN-abcd', pageId: '1234567' });
  const raw = await mongoose.connection.collection('crmintegrationsettings').findOne({ channel: 'meta' });
  assert.ok(!JSON.stringify(raw).includes('PAGE-TOKEN-abcd'), 'nothing in clear in the database');
  assert.equal(await settings.getValue('meta', 'pageAccessToken'), 'PAGE-TOKEN-abcd');
  const doc = await IntegrationSetting.findOne({ channel: 'meta' });
  assert.ok(!JSON.stringify(doc.toJSON()).includes('PAGE-TOKEN-abcd'), 'never serialized');

  st = await settings.computeStatus('meta');
  assert.equal(st.state, 'awaiting_verification', 'credentials alone are NOT "connected"');
  assert.ok(st.settings.every(s => !s.display || !s.display.includes('PAGE-TOKEN')));
  assert.equal(st.settings.find(s => s.key === 'pageAccessToken').display, '••••abcd');

  // Real test call (fetch injected): Graph /me answers for the configured page.
  const okFetch = async () => new Response(JSON.stringify({ id: '1234567', name: 'Reservia' }), { status: 200 });
  const ok = await settings.testConnection('meta', { fetchImpl: okFetch });
  assert.equal(ok.ok, true);
  assert.equal((await settings.computeStatus('meta')).state, 'connected');

  const badFetch = async () => new Response(JSON.stringify({ error: { code: 190, message: 'Invalid OAuth access token' } }), { status: 400 });
  const bad = await settings.testConnection('meta', { fetchImpl: badFetch });
  assert.equal(bad.ok, false);
  st = await settings.computeStatus('meta');
  assert.equal(st.state, 'error');
  assert.match(st.lastTest.message, /190/);

  await settings.setEnabled('meta', false);
  assert.equal((await settings.computeStatus('meta')).state, 'disabled');
});

maybeTest('Google Ads / TikTok tests make the documented calls and report failures honestly', async () => {
  await settings.saveSettings('google_ads', { developerToken: 'dev', clientId: 'cid', clientSecret: 'cs', refreshToken: 'rt', customerId: '123-456-7890' });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    return new Response(JSON.stringify({ resourceNames: ['customers/1234567890'] }), { status: 200 });
  };
  const r = await settings.testConnection('google_ads', { fetchImpl });
  assert.equal(r.ok, true, r.message);
  assert.match(calls[1].url, /customers:listAccessibleCustomers$/);
  assert.equal(calls[1].headers['developer-token'], 'dev');

  await settings.saveSettings('tiktok', { accessToken: 'tt', appId: 'app', appSecret: 'sec', advertiserId: '999' });
  const tk = await settings.testConnection('tiktok', { fetchImpl: async () => new Response(JSON.stringify({ code: 0, data: { list: [{ advertiser_id: '111' }] } }), { status: 200 }) });
  assert.equal(tk.ok, false, 'advertiser not authorized is a failure, not a success');
  assert.match(tk.message, /999/);
});

maybeTest('WhatsApp webhook uses the verify token / app secret saved on the page; an inbound message creates a lead; a Business-app echo counts as the first human reply', async () => {
  await settings.saveSettings('whatsapp', { verifyToken: 'wa-verify', appSecret: 'wa-secret' });
  const bad = await fetch(`${baseUrl}/api/v1/crm/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`);
  assert.equal(bad.status, 403);
  const good = await fetch(`${baseUrl}/api/v1/crm/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wa-verify&hub.challenge=42`);
  assert.equal(await good.text(), '42');
  assert.ok((await settings.computeStatus('whatsapp')).webhookVerifiedAt);

  const post = async payload => {
    const body = JSON.stringify(payload);
    const sig = `sha256=${crypto.createHmac('sha256', 'wa-secret').update(body).digest('hex')}`;
    return fetch(`${baseUrl}/api/v1/crm/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body });
  };
  const unsigned = await fetch(`${baseUrl}/api/v1/crm/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=00' }, body: '{}' });
  assert.equal(unsigned.status, 403);

  const now = Math.floor(Date.now() / 1000);
  const inbound = await post({ entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: '201011112222', profile: { name: 'Wadi' } }], messages: [{ id: 'wamid.IN1', from: '201011112222', timestamp: String(now - 600), type: 'text', text: { body: 'Hello, price for 20 feddan pump?' } }] } }] }] });
  assert.equal(inbound.status, 200);
  const lead = await Lead.findOne({ phoneE164: '+201011112222' }).lean();
  assert.ok(lead);
  assert.equal(lead.source, 'WhatsApp Direct');
  assert.equal(lead.firstReplyAt, null, 'the customer message is not a reply');

  const echo = await post({ entry: [{ changes: [{ field: 'smb_message_echoes', value: { message_echoes: [{ id: 'wamid.OUT1', from: '201211892995', to: '201011112222', timestamp: String(now - 60), type: 'text', text: { body: 'Hi Wadi, our engineer will call you.' } }] } }] }] });
  assert.equal(echo.status, 200);
  const replied = await Lead.findOne({ _id: lead._id }).lean();
  assert.ok(replied.firstReplyAt, 'first human reply recorded');
  assert.equal(replied.firstReplyVia, 'whatsapp_out');
  assert.equal(await Activity.countDocuments({ lead: lead._id, type: 'whatsapp_out' }), 1);
  await post({ entry: [{ changes: [{ field: 'smb_message_echoes', value: { message_echoes: [{ id: 'wamid.OUT1', to: '201011112222', timestamp: String(now - 60), type: 'text', text: { body: 'dup' } }] } }] }] });
  assert.equal(await Activity.countDocuments({ lead: lead._id, type: 'whatsapp_out' }), 1, 'a redelivered echo is recorded once');
});
