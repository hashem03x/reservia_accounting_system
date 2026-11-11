'use strict';

const crypto = require('crypto');
const ApiError = require('../../utils/apiError');
const IntegrationSetting = require('../../models/crm/integrationSettingModel');
const secretBox = require('../../utils/crm/secretBox');

// Reservia CRM - integration configuration + honest connection status (CRM C2-C6).
//
// Credentials come from the Integrations page (stored encrypted - secretBox.js) or, as a fallback,
// from the server environment variables below; a value saved on the page wins over the env var.
// Secrets are NEVER returned to the browser - only "set / not set" and a 4-character hint.
//
// Status is what has actually been VERIFIED, never "credentials were typed in":
//   not_configured          - a required setting is missing
//   awaiting_verification   - settings present, but no webhook handshake / successful test / processed event yet
//   connected               - verified (handshake or successful API test) and no newer error
//   error                   - the latest test or delivery failed (message shown)
//   disabled                - switched off on the Integrations page

const GRAPH_VERSION = () => process.env.META_GRAPH_API_VERSION || 'v21.0';
const TIMEOUT_MS = 10000;

// Field definitions per channel. `env` = fallback environment variable; `required` = needed for the
// channel to work at all; `secret` = stored encrypted and never returned.
const CHANNELS = {
  whatsapp: {
    label: 'WhatsApp Business (Cloud API)',
    fields: {
      verifyToken: { env: 'WHATSAPP_VERIFY_TOKEN', secret: true, required: true, label: 'Webhook verify token (a random string you choose)' },
      appSecret: { env: 'WHATSAPP_APP_SECRET', secret: true, required: true, label: 'Meta app secret (signs every webhook delivery)' },
      accessToken: { env: 'WHATSAPP_ACCESS_TOKEN', secret: true, required: false, label: 'WhatsApp Cloud API access token (System User permanent token with whatsapp_business_messaging / whatsapp_business_management)' },
      phoneNumberId: { env: 'WHATSAPP_PHONE_NUMBER_ID', secret: false, required: false, label: 'Phone number ID (WhatsApp Manager -> API setup)' },
      businessAccountId: { env: 'WHATSAPP_BUSINESS_ACCOUNT_ID', secret: false, required: false, label: 'WhatsApp Business Account ID' },
    },
  },
  meta: {
    label: 'Meta Lead Ads (Facebook / Instagram)',
    fields: {
      verifyToken: { env: 'META_VERIFY_TOKEN', secret: true, required: true, label: 'Webhook verify token (a random string you choose)' },
      appSecret: { env: 'META_APP_SECRET', secret: true, required: true, label: 'Meta app secret' },
      pageAccessToken: { env: 'META_PAGE_ACCESS_TOKEN', secret: true, required: true, label: 'Page access token (System User, leads_retrieval + pages_manage_metadata + pages_read_engagement + pages_show_list + ads_read)' },
      pageId: { env: 'META_PAGE_ID', secret: false, required: false, label: 'Facebook Page ID' },
    },
  },
  tiktok: {
    label: 'TikTok Lead Generation',
    fields: {
      accessToken: { env: 'TIKTOK_ACCESS_TOKEN', secret: true, required: false, label: 'TikTok Marketing API long-term access token (for the connection test / reporting)' },
      appId: { env: 'TIKTOK_APP_ID', secret: false, required: false, label: 'TikTok developer app ID' },
      appSecret: { env: 'TIKTOK_APP_SECRET', secret: true, required: false, label: 'TikTok developer app secret' },
      advertiserId: { env: 'TIKTOK_ADVERTISER_ID', secret: false, required: false, label: 'TikTok advertiser ID' },
    },
  },
  google_ads: {
    label: 'Google Ads',
    fields: {
      developerToken: { env: 'GOOGLE_ADS_DEVELOPER_TOKEN', secret: true, required: false, label: 'Google Ads API developer token' },
      clientId: { env: 'GOOGLE_ADS_CLIENT_ID', secret: false, required: false, label: 'OAuth client ID' },
      clientSecret: { env: 'GOOGLE_ADS_CLIENT_SECRET', secret: true, required: false, label: 'OAuth client secret' },
      refreshToken: { env: 'GOOGLE_ADS_REFRESH_TOKEN', secret: true, required: false, label: 'OAuth refresh token (scope https://www.googleapis.com/auth/adwords)' },
      loginCustomerId: { env: 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', secret: false, required: false, label: 'Manager (MCC) customer ID, digits only' },
      customerId: { env: 'GOOGLE_ADS_CUSTOMER_ID', secret: false, required: false, label: 'Ads account customer ID, digits only' },
      conversionActionName: { env: 'GOOGLE_ADS_CONVERSION_NAME', secret: false, required: false, label: 'Offline conversion action name (for the Won-deal conversion export)' },
    },
  },
};

const CHANNEL_IDS = Object.keys(CHANNELS);

function assertChannel(channel) {
  if (!CHANNELS[channel]) throw new ApiError(`Unknown integration "${channel}".`, 400);
}

async function loadDoc(channel) {
  return IntegrationSetting.findOne({ channel });
}

function fieldFromDoc(doc, key) {
  if (!doc?.fields) return null;
  const f = doc.fields.get ? doc.fields.get(key) : doc.fields[key];
  if (!f) return null;
  return f.secret ? secretBox.decrypt(f.box) : f.value;
}

/** The effective value of one setting: saved on the page (decrypted) else the environment variable. */
async function getValue(channel, key, { doc } = {}) {
  assertChannel(channel);
  const def = CHANNELS[channel].fields[key];
  if (!def) throw new Error(`Unknown setting ${channel}.${key}`);
  const d = doc === undefined ? await loadDoc(channel) : doc;
  const saved = fieldFromDoc(d, key);
  if (saved) return saved;
  return process.env[def.env] || null;
}

async function getAll(channel) {
  const doc = await loadDoc(channel);
  const out = {};
  for (const key of Object.keys(CHANNELS[channel].fields)) out[key] = await getValue(channel, key, { doc });
  return { values: out, doc };
}

/** Saves settings from the Integrations page. `null`/'' clears a saved value (the env var fallback then applies). */
async function saveSettings(channel, input, { userId = null } = {}) {
  assertChannel(channel);
  const defs = CHANNELS[channel].fields;
  const doc = (await loadDoc(channel)) || new IntegrationSetting({ channel });
  for (const [key, raw] of Object.entries(input || {})) {
    const def = defs[key];
    if (!def) throw new ApiError(`Unknown setting "${key}" for ${channel}.`, 400);
    if (raw === undefined) continue;
    if (raw === null || String(raw).trim() === '') {
      doc.fields.delete(key);
      continue;
    }
    const value = String(raw).trim();
    if (value.length > 2000) throw new ApiError(`${def.label} is too long.`, 400);
    if (['loginCustomerId', 'customerId'].includes(key) && !/^\d{10}$/.test(value.replace(/-/g, ''))) {
      throw new ApiError(`${def.label} must be a 10-digit Google Ads customer ID.`, 400);
    }
    if (def.secret) {
      if (!secretBox.isConfigured()) {
        throw new ApiError('Secrets cannot be saved: the server has no INTEGRATION_SECRETS_KEY. Set it (32 random bytes, base64) in the backend environment, or provide this credential as an environment variable.', 400);
      }
      doc.fields.set(key, { secret: true, box: secretBox.encrypt(value), value: null, hint: secretBox.hint(value), updatedAt: new Date(), updatedBy: userId });
    } else {
      doc.fields.set(key, { secret: false, box: null, value: key.endsWith('Id') ? value.replace(/-/g, '') : value, hint: null, updatedAt: new Date(), updatedBy: userId });
    }
  }
  // New credentials invalidate the previous verification - they have not been proven yet.
  doc.status = { ...(doc.status?.toObject ? doc.status.toObject() : doc.status || {}), lastTestOk: null, lastTestMessage: null, lastTestAt: null };
  doc.updatedBy = userId;
  await doc.save();
  return doc;
}

async function setEnabled(channel, enabled, { userId = null } = {}) {
  assertChannel(channel);
  const doc = (await loadDoc(channel)) || new IntegrationSetting({ channel });
  doc.enabled = !!enabled;
  doc.updatedBy = userId;
  await doc.save();
  return doc;
}

async function isEnabled(channel) {
  const doc = await loadDoc(channel);
  return doc ? doc.enabled !== false : true;
}

async function recordStatus(channel, patch) {
  const set = {};
  for (const [k, v] of Object.entries(patch)) set[`status.${k}`] = v;
  await IntegrationSetting.updateOne({ channel }, { $set: set, $setOnInsert: { channel } }, { upsert: true }).catch(() => {});
}

const recordWebhookVerified = channel => recordStatus(channel, { webhookVerifiedAt: new Date() });
const recordDeliveryError = (channel, message) => recordStatus(channel, { lastErrorAt: new Date(), lastError: String(message || '').slice(0, 300) });

// ---------------------------------------------------------------- connection tests (real API calls)

async function fetchJson(url, init, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { ok: false, status: 0, body: null, network: true };
  }
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

const appsecretProof = (token, secret) => crypto.createHmac('sha256', secret).update(token).digest('hex');

const TESTS = {
  async whatsapp(v, fetchImpl) {
    if (!v.accessToken || !v.phoneNumberId) return { ok: false, message: 'Enter the access token and phone number ID to test the Cloud API connection.' };
    const params = new URLSearchParams({ fields: 'display_phone_number,verified_name,quality_rating' });
    if (v.appSecret) params.set('appsecret_proof', appsecretProof(v.accessToken, v.appSecret));
    const r = await fetchJson(`https://graph.facebook.com/${GRAPH_VERSION()}/${encodeURIComponent(v.phoneNumberId)}?${params}`, { headers: { Authorization: `Bearer ${v.accessToken}` } }, fetchImpl);
    if (r.network) return { ok: false, message: 'Could not reach the Meta Graph API.' };
    if (!r.ok) return { ok: false, message: `Meta refused the token / phone number ID (${r.body?.error?.code || r.status}: ${String(r.body?.error?.message || 'error').slice(0, 150)}).` };
    return { ok: true, message: `Connected to ${r.body.display_phone_number || 'the number'}${r.body.verified_name ? ` (${r.body.verified_name})` : ''}.` };
  },
  async meta(v, fetchImpl) {
    if (!v.pageAccessToken) return { ok: false, message: 'Enter the page access token to test.' };
    const params = new URLSearchParams({ fields: 'id,name' });
    if (v.appSecret) params.set('appsecret_proof', appsecretProof(v.pageAccessToken, v.appSecret));
    const r = await fetchJson(`https://graph.facebook.com/${GRAPH_VERSION()}/me?${params}`, { headers: { Authorization: `Bearer ${v.pageAccessToken}` } }, fetchImpl);
    if (r.network) return { ok: false, message: 'Could not reach the Meta Graph API.' };
    if (!r.ok) return { ok: false, message: `Meta refused the page token (${r.body?.error?.code || r.status}: ${String(r.body?.error?.message || 'error').slice(0, 150)}).` };
    if (v.pageId && String(r.body.id) !== String(v.pageId)) return { ok: false, message: `The token belongs to page ${r.body.id} (${r.body.name}), not the configured page ${v.pageId}.` };
    return { ok: true, message: `Token is valid for page "${r.body.name}" (${r.body.id}).` };
  },
  async tiktok(v, fetchImpl) {
    if (!v.accessToken || !v.appId || !v.appSecret) return { ok: false, message: 'Enter the access token, app ID and app secret to test the TikTok Marketing API.' };
    const params = new URLSearchParams({ app_id: v.appId, secret: v.appSecret });
    const r = await fetchJson(`https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/?${params}`, { headers: { 'Access-Token': v.accessToken } }, fetchImpl);
    if (r.network) return { ok: false, message: 'Could not reach the TikTok Marketing API.' };
    if (!r.ok || r.body?.code !== 0) return { ok: false, message: `TikTok refused the credentials (${r.body?.code ?? r.status}: ${String(r.body?.message || 'error').slice(0, 150)}).` };
    const list = r.body?.data?.list || [];
    if (v.advertiserId && !list.some(a => String(a.advertiser_id) === String(v.advertiserId))) {
      return { ok: false, message: `The token is valid but advertiser ${v.advertiserId} has not authorized this app.` };
    }
    return { ok: true, message: `Token valid - ${list.length} authorized advertiser account(s).` };
  },
  async google_ads(v, fetchImpl) {
    if (!v.developerToken || !v.clientId || !v.clientSecret || !v.refreshToken) return { ok: false, message: 'Enter the developer token, OAuth client ID/secret and refresh token to test.' };
    const tok = await fetchJson(
      'https://oauth2.googleapis.com/token',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: v.clientId, client_secret: v.clientSecret, refresh_token: v.refreshToken }).toString() },
      fetchImpl
    );
    if (tok.network) return { ok: false, message: 'Could not reach Google OAuth.' };
    if (!tok.ok || !tok.body?.access_token) return { ok: false, message: `Google OAuth refused the refresh token (${tok.body?.error || tok.status}).` };
    const version = process.env.GOOGLE_ADS_API_VERSION || 'v26';
    const headers = { Authorization: `Bearer ${tok.body.access_token}`, 'developer-token': v.developerToken };
    if (v.loginCustomerId) headers['login-customer-id'] = v.loginCustomerId;
    const r = await fetchJson(`https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`, { headers }, fetchImpl);
    if (r.network) return { ok: false, message: 'Could not reach the Google Ads API.' };
    if (!r.ok) return { ok: false, message: `Google Ads API refused the request (${r.status}: ${String(r.body?.error?.message || 'error').slice(0, 150)}). Check GOOGLE_ADS_API_VERSION and the developer token access level.` };
    const names = r.body?.resourceNames || [];
    if (v.customerId && !names.includes(`customers/${v.customerId}`)) return { ok: false, message: `Authenticated, but customer ${v.customerId} is not accessible with these credentials.` };
    return { ok: true, message: `Authenticated - ${names.length} accessible Google Ads account(s).` };
  },
};

/** Runs the channel's real API test with the effective credentials and records the outcome. */
async function testConnection(channel, { fetchImpl = globalThis.fetch } = {}) {
  assertChannel(channel);
  const { values } = await getAll(channel);
  const result = await TESTS[channel](values, fetchImpl);
  await recordStatus(channel, { lastTestAt: new Date(), lastTestOk: result.ok, lastTestMessage: result.message.slice(0, 300), ...(result.ok ? {} : { lastErrorAt: new Date(), lastError: result.message.slice(0, 300) }) });
  return result;
}

// ---------------------------------------------------------------- status

/**
 * @param {string} channel
 * @param {{ lastProcessedAt?: Date|null, recentFailures?: number, lastFailureAt?: Date|null, activeKeys?: number }} activity
 */
async function computeStatus(channel, activity = {}) {
  assertChannel(channel);
  const { values, doc } = await getAll(channel);
  const defs = CHANNELS[channel].fields;
  const settings = Object.entries(defs).map(([key, def]) => {
    const saved = !!fieldFromDoc(doc, key);
    const fromEnv = !saved && !!process.env[def.env];
    const f = doc?.fields?.get ? doc.fields.get(key) : null;
    return {
      key, label: def.label, env: def.env, secret: def.secret, required: def.required,
      set: !!values[key], source: saved ? 'page' : fromEnv ? 'env' : null,
      // Never the secret itself: a hint for secrets, the value for plain identifiers.
      display: values[key] ? (def.secret ? (saved ? f?.hint : secretBox.hint(values[key])) : values[key]) : null,
    };
  });
  const st = doc?.status || {};
  const enabled = doc ? doc.enabled !== false : true;

  // A channel is configured when its required settings are present; TikTok / Google Ads lead forms
  // authenticate with a CRM-issued API key instead, so for those an active key also counts.
  const requiredOk = settings.filter(s => s.required).every(s => s.set);
  const keyBased = ['tiktok', 'google_ads'].includes(channel);
  const anySetting = settings.some(s => s.set);
  const configured = keyBased ? (activity.activeKeys || 0) > 0 || anySetting : requiredOk;

  const lastErrorAt = [st.lastErrorAt, activity.lastFailureAt].filter(Boolean).map(d => new Date(d)).sort((a, b) => b - a)[0] || null;
  const lastOkAt = [st.webhookVerifiedAt, st.lastTestOk ? st.lastTestAt : null, activity.lastProcessedAt].filter(Boolean).map(d => new Date(d)).sort((a, b) => b - a)[0] || null;

  let state;
  if (!enabled) state = 'disabled';
  else if (!configured) state = 'not_configured';
  else if (st.lastTestOk === false || (lastErrorAt && (!lastOkAt || lastErrorAt > lastOkAt))) state = 'error';
  else if (lastOkAt) state = 'connected';
  else state = 'awaiting_verification';

  return {
    state,
    enabled,
    settings,
    secretsStorageAvailable: secretBox.isConfigured(),
    webhookVerifiedAt: st.webhookVerifiedAt || null,
    lastTest: st.lastTestAt ? { at: st.lastTestAt, ok: st.lastTestOk, message: st.lastTestMessage } : null,
    lastError: lastErrorAt ? { at: lastErrorAt, message: st.lastErrorAt && new Date(st.lastErrorAt).getTime() === lastErrorAt.getTime() ? st.lastError : 'A recent delivery failed - see the event log below.' } : null,
    lastSuccessAt: lastOkAt,
  };
}

module.exports = {
  CHANNELS,
  CHANNEL_IDS,
  getValue,
  getAll,
  saveSettings,
  setEnabled,
  isEnabled,
  testConnection,
  computeStatus,
  recordWebhookVerified,
  recordDeliveryError,
  TESTS,
};
