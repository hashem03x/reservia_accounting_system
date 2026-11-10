'use strict';

const crypto = require('crypto');
const ApiError = require('../../utils/apiError');
const { processIntake, formatExtraAnswers } = require('./leadIntakeService');
const { parseSubmissionTimestamp } = require('../../utils/crm/businessDate');

// Reservia CRM - Meta Lead Ads (Facebook + Instagram instant forms), Change Request 2, item 9.
//
// Flow (Meta's documented Leads webhook):
//   1. Meta POSTs a `page` object webhook with `changes[].field === 'leadgen'` and only IDs in it
//      (leadgen_id, form_id, ad_id, adgroup_id, page_id, created_time) - never the contact data.
//   2. We verify X-Hub-Signature-256 with the Meta app secret, then fetch the lead itself from the
//      Graph API (GET /{leadgen_id}) with a Page access token holding `leads_retrieval`.
//   3. The lead goes through the unified intake (services/crm/leadIntakeService.js) with
//      Source "Meta Ads", keyed on leadgen_id - a redelivered webhook never creates a second lead.
//
// Configuration (all server-side env vars, never in the frontend - see docs/crm-integrations.md):
//   META_APP_SECRET          - app secret of the Meta app subscribed to the Page (signature check)
//   META_VERIFY_TOKEN        - any random string WE choose, entered in the Meta app's webhook setup
//   META_PAGE_ACCESS_TOKEN   - long-lived Page token (System User) with leads_retrieval,
//                              pages_show_list, pages_read_engagement, pages_manage_metadata, ads_read
//   META_GRAPH_API_VERSION   - optional, default v21.0
// Nothing here is "operational" until those exist and Meta has delivered a real test lead.

const DEFAULT_GRAPH_VERSION = 'v21.0';
const GRAPH_TIMEOUT_MS = 10000;
const LEAD_FIELDS = 'id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic';

const appSecret = () => process.env.META_APP_SECRET || '';

function isConfigured() {
  return {
    verifyToken: !!process.env.META_VERIFY_TOKEN,
    appSecret: !!appSecret(),
    pageAccessToken: !!process.env.META_PAGE_ACCESS_TOKEN,
  };
}

/** GET handshake: echo hub.challenge only for mode=subscribe and OUR verify token. */
function verifySubscription({ mode, token, challenge }) {
  if (mode !== 'subscribe' || !process.env.META_VERIFY_TOKEN) return null;
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(process.env.META_VERIFY_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return challenge;
}

/** X-Hub-Signature-256 over the RAW body, constant-time compare. */
function verifySignature(rawBody, signatureHeader) {
  const secret = appSecret();
  if (!secret || !rawBody || typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('hex'), 'hex');
  const given = Buffer.from(signatureHeader.slice(7), 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** Every leadgen change in a webhook payload. Anything else (feed, messages, ...) is ignored. */
function extractLeadgenChanges(payload) {
  const out = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (change.field === 'leadgen' && change.value?.leadgen_id) out.push({ ...change.value, page_id: change.value.page_id || entry.id });
    }
  }
  return out;
}

/** Fetches one lead from the Graph API. `fetchImpl` is injectable for tests. */
async function fetchLead(leadgenId, { fetchImpl = globalThis.fetch } = {}) {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new ApiError('Meta Lead Ads is not configured: META_PAGE_ACCESS_TOKEN is missing.', 503);
  const version = process.env.META_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION;
  const params = new URLSearchParams({ fields: LEAD_FIELDS });
  // appsecret_proof proves the call comes from our server even if the token leaked.
  if (appSecret()) params.set('appsecret_proof', crypto.createHmac('sha256', appSecret()).update(token).digest('hex'));
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(leadgenId)}?${params}`;
  let res;
  try {
    // The token goes in a header, so it never appears in a URL that could be logged.
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
  } catch {
    throw new ApiError('Could not reach the Meta Graph API.', 502);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Meta's error message/code only - never the request URL or token.
    throw new ApiError(`Meta Graph API refused the lead lookup (${body?.error?.code || res.status}: ${String(body?.error?.message || 'unknown error').slice(0, 150)}).`, 502);
  }
  return body;
}

const FIELD_ALIASES = {
  phone: ['phone_number', 'phone', 'mobile', 'mobile_number', 'رقم_الهاتف', 'الهاتف', 'رقم_الموبايل'],
  email: ['email', 'email_address', 'البريد_الإلكتروني'],
  fullName: ['full_name', 'name', 'الاسم', 'الاسم_بالكامل'],
  firstName: ['first_name'],
  lastName: ['last_name'],
};

/** Turns Graph `field_data` into typed contact fields + leftover answers for a note. */
function mapFieldData(fieldData) {
  const values = {};
  for (const f of Array.isArray(fieldData) ? fieldData : []) {
    if (f && f.name) values[String(f.name).toLowerCase()] = Array.isArray(f.values) ? f.values.join(', ') : String(f.values ?? '');
  }
  const take = keys => {
    for (const k of keys) {
      if (values[k]) {
        const v = values[k];
        delete values[k];
        return v;
      }
    }
    return null;
  };
  const phone = take(FIELD_ALIASES.phone);
  const email = take(FIELD_ALIASES.email);
  let name = take(FIELD_ALIASES.fullName);
  const first = take(FIELD_ALIASES.firstName);
  const last = take(FIELD_ALIASES.lastName);
  if (!name && (first || last)) name = [first, last].filter(Boolean).join(' ');
  return { phone, email, name, extra: values };
}

/** Graph lead + webhook change -> unified intake arguments. */
function toIntake(lead, change) {
  const { phone, email, name, extra } = mapFieldData(lead.field_data);
  const platform = lead.platform === 'ig' ? 'instagram' : lead.platform === 'fb' ? 'facebook' : lead.platform || null;
  const submittedAt = parseSubmissionTimestamp(lead.created_time) || parseSubmissionTimestamp(change?.created_time) || null;
  const noteLines = [`Meta Lead Ads form submission${platform ? ` (${platform})` : ''}.`];
  if (lead.is_organic) noteLines.push('Organic (not from a paid ad).');
  const extraText = formatExtraAnswers(extra);
  if (extraText) noteLines.push(extraText);
  return {
    externalId: String(lead.id || change.leadgen_id),
    lead: {
      name: name || undefined,
      phone,
      email: email || undefined,
      channel: 'ad_lead_form',
      source: 'Meta Ads',
      campaign: lead.campaign_name || undefined,
      adSetName: lead.adset_name || undefined,
      adName: lead.ad_name || undefined,
      adFormId: lead.form_id || change?.form_id ? String(lead.form_id || change.form_id) : undefined,
      adPlatform: platform || undefined,
      externalLeadId: String(lead.id || change.leadgen_id),
      submittedAt: submittedAt || undefined,
    },
    note: noteLines.join('\n'),
  };
}

/**
 * Processes every leadgen change in a verified payload. Each lead is independent: one bad lead
 * (no usable phone, Graph error) never blocks the others. Returns per-lead results; `retryable`
 * is true when at least one lead failed for a TRANSIENT reason, so the controller can answer
 * non-200 and let Meta redeliver - safe, because already-processed leads replay idempotently.
 */
async function processWebhookPayload(payload, { fetchImpl } = {}) {
  const results = [];
  let retryable = false;
  for (const change of extractLeadgenChanges(payload)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const lead = await fetchLead(change.leadgen_id, { fetchImpl });
      const args = toIntake(lead, change);
      if (!args.lead.phone) {
        results.push({ leadgenId: change.leadgen_id, skipped: 'no phone number in the form' });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const r = await processIntake({ channel: 'meta', ...args });
      results.push({ leadgenId: change.leadgen_id, ...r });
    } catch (err) {
      const transient = !err.statusCode || err.statusCode >= 500;
      if (transient) retryable = true;
      results.push({ leadgenId: change.leadgen_id, error: err.message });
    }
  }
  return { results, retryable };
}

module.exports = { isConfigured, verifySubscription, verifySignature, extractLeadgenChanges, fetchLead, mapFieldData, toIntake, processWebhookPayload };
