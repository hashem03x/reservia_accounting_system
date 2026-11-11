'use strict';

const { normalizeSource } = require('./sourceNormalization');

// Reservia CRM - marketing attribution "touches" (CRM launch blocker C1).
//
// A touch is one attributable arrival: the campaign parameters / ad click ids it carried, the page
// it landed on and the external referrer. Every lead keeps:
//   firstTouch          - how the customer was first acquired. Set once at creation, NEVER
//                         overwritten (a repeat enquiry, a merge or a later campaign never touch it).
//   lastTouch           - the most recent attributable touch (a campaign / ad click / ad lead form)
//                         before conversion. Updated by a later enquiry that carries a campaign.
//   attributionHistory  - every distinct touch received, oldest first, capped - so merging duplicate
//                         enquiries into one lead never destroys an earlier attribution.
//
// Touches arriving from the public website are CLIENT-SUPPLIED: they are shape-checked and
// length-capped here (and by utils/validators/crm/publicLeadValidators.js) and only ever ADDED -
// they can never overwrite a lead's existing first touch or any field staff entered.

const CLICK_ID_KEYS = ['gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid'];
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const PARAM_KEYS = [...UTM_KEYS, ...CLICK_ID_KEYS];
const HISTORY_LIMIT = 25;
const MAX = { param: 150, path: 300, url: 600, referrer: 300, text: 200 };

function str(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Reduces a landing page to its PATH. The website sends a path ("/en/farms"); older builds sent
 * "https://www.reservia-energy.com/en/farms". Query strings are dropped (they can carry campaign or
 * personal values that are stored separately, allowlisted, in the params).
 */
function toPath(value) {
  const s = str(value, 1000);
  if (!s) return null;
  try {
    const u = new URL(s, 'https://reservia-energy.invalid');
    return (u.pathname || '/').slice(0, MAX.path);
  } catch {
    return s.split('?')[0].slice(0, MAX.path);
  }
}

/** Keeps only a referrer's origin + path, never its query string. */
function toReferrer(value) {
  const s = str(value, 1000);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return null;
    return `${u.origin}${u.pathname}`.slice(0, MAX.referrer);
  } catch {
    return null;
  }
}

function toDate(value, now = new Date()) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // A touch can't be in the future (clock skew / tampering) - clamp to now.
  return d.getTime() > now.getTime() ? now : d;
}

/** Allowlisted campaign params from an arbitrary object (e.g. the website's `utm` or `touch.params`). */
function pickParams(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const key of PARAM_KEYS) {
    const v = str(obj[key], MAX.param);
    if (v) out[key] = v;
  }
  return out;
}

/**
 * Builds a normalized touch document (models/crm/leadModel.js#touchSchema shape).
 * @param {object} t
 * @param {string} t.channel - lead channel this touch arrived through
 * @param {object} [t.params] - utm_* / click-id keyed object
 * @param {string} [t.source] - explicit SOURCES value (ad platforms); derived from params otherwise
 */
function buildTouch({ channel = null, params = {}, source = null, landingPage = null, landingUrl = null, referrer = null, campaign = null, adSetName = null, adName = null, at = null } = {}, now = new Date()) {
  const p = pickParams(params);
  const ref = toReferrer(referrer);
  const derivedSource =
    source ||
    normalizeSource({
      utmSource: p.utm_source,
      utmMedium: p.utm_medium,
      referrer: ref,
      gclid: p.gclid,
      gbraid: p.gbraid,
      wbraid: p.wbraid,
      ttclid: p.ttclid,
      fbclid: p.fbclid,
    });
  return {
    channel: str(channel, 40),
    source: derivedSource,
    utmSource: p.utm_source || null,
    utmMedium: p.utm_medium || null,
    utmCampaign: p.utm_campaign || null,
    utmTerm: p.utm_term || null,
    utmContent: p.utm_content || null,
    gclid: p.gclid || null,
    gbraid: p.gbraid || null,
    wbraid: p.wbraid || null,
    fbclid: p.fbclid || null,
    ttclid: p.ttclid || null,
    campaign: str(campaign, MAX.text) || p.utm_campaign || null,
    adSetName: str(adSetName, MAX.text),
    adName: str(adName, MAX.text),
    landingPage: toPath(landingPage),
    landingUrl: str(landingUrl, MAX.url),
    referrer: ref,
    at: toDate(at, now) || now,
  };
}

/** True when a touch carries something attributable (campaign params, a click id, or an ad platform source). */
function isAttributable(touch) {
  if (!touch) return false;
  if (CLICK_ID_KEYS.some(k => touch[k]) || touch.utmSource || touch.utmCampaign || touch.campaign) return true;
  return ['Google Ads', 'Meta Ads', 'TikTok'].includes(touch.source);
}

const FINGERPRINT_KEYS = ['channel', 'source', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'campaign', 'adSetName', 'adName', 'landingPage', 'referrer'];

/** Two touches describe the same arrival (time ignored) - used to keep the history free of duplicates. */
function sameTouch(a, b) {
  if (!a || !b) return false;
  return FINGERPRINT_KEYS.every(k => (a[k] ?? null) === (b[k] ?? null));
}

/** Touch from the public website payload: the new `attribution.{first,last}` shape, else the legacy utm/pageUrl/referrer fields. */
function touchesFromWebsite(body, channel, now = new Date()) {
  const a = body && typeof body.attribution === 'object' && body.attribution ? body.attribution : null;
  const fromWire = (t, fallbackAt) =>
    buildTouch(
      {
        channel,
        params: t.params,
        landingPage: t.landingPage,
        landingUrl: t.landingUrl,
        referrer: t.referrer,
        at: t.at || fallbackAt,
      },
      now
    );
  if (a && a.first && typeof a.first === 'object') {
    const first = fromWire(a.first, body.submittedAt);
    const last = a.last && typeof a.last === 'object' ? fromWire(a.last, body.submittedAt) : first;
    return { first, last };
  }
  // Older website builds: first-touch utm + landing page + referrer only.
  const first = buildTouch({ channel, params: body?.utm, landingPage: body?.pageUrl, referrer: body?.referrer, at: body?.submittedAt }, now);
  return { first, last: first };
}

/** Touch for any non-website intake (ad lead forms, WhatsApp, CSV, manual) from leadService.intakeLead's input. */
function touchFromIntakeInput(input, now = new Date()) {
  return buildTouch(
    {
      channel: input.channel,
      source: input.source || null,
      params: {
        utm_source: input.utmSource,
        utm_medium: input.utmMedium,
        utm_campaign: input.utmCampaign,
        utm_term: input.utmTerm,
        utm_content: input.utmContent,
        gclid: input.gclid,
        gbraid: input.gbraid,
        wbraid: input.wbraid,
        fbclid: input.fbclid,
        ttclid: input.ttclid,
      },
      campaign: input.campaign,
      adSetName: input.adSetName,
      adName: input.adName,
      landingPage: input.landingPage,
      referrer: input.referrer,
      at: input.submittedAt,
    },
    now
  );
}

/**
 * The first touch to DISPLAY for a lead: the stored one, or - for a lead created before touches
 * existed - one reconstructed from its legacy first-touch fields (never persisted by this function).
 */
function effectiveFirstTouch(lead) {
  if (lead.firstTouch && (lead.firstTouch.source || lead.firstTouch.channel)) return lead.firstTouch;
  return {
    channel: lead.channel || null,
    source: lead.source || null,
    utmSource: lead.utmSource || null,
    utmMedium: lead.utmMedium || null,
    utmCampaign: lead.utmCampaign || null,
    utmTerm: lead.utmTerm || null,
    utmContent: lead.utmContent || null,
    gclid: lead.gclid || null,
    gbraid: lead.gbraid || null,
    wbraid: lead.wbraid || null,
    fbclid: lead.fbclid || null,
    ttclid: lead.ttclid || null,
    campaign: lead.campaign || null,
    adSetName: lead.adSetName || null,
    adName: lead.adName || null,
    landingPage: lead.landingPage || null,
    landingUrl: null,
    referrer: lead.referrer || null,
    at: lead.submittedAt || lead.createdAt || null,
    reconstructed: true,
  };
}

module.exports = {
  CLICK_ID_KEYS,
  UTM_KEYS,
  PARAM_KEYS,
  HISTORY_LIMIT,
  buildTouch,
  isAttributable,
  sameTouch,
  touchesFromWebsite,
  touchFromIntakeInput,
  effectiveFirstTouch,
  pickParams,
  toPath,
  toReferrer,
};
