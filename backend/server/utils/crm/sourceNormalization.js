const { SOURCES } = require('./constants');

// Centralized source-mapping rules (Change Request 1, Feature 1, section "Source mapping rules")
// - the ONE place every lead-intake channel (public website intake, CSV import, the WhatsApp
// webhook) resolves a raw signal onto the CRM's fixed SOURCES list, so the business rule can
// never drift between callers.
//
// | Incoming signal                                          | CRM Source       |
// |-----------------------------------------------------------|-------------------|
// | utm_source=google and utm_medium=cpc                      | Google Ads        |
// | utm_source=facebook, instagram or meta + a paid medium     | Meta Ads          |
// | utm_source=tiktok                                          | TikTok            |
// | WhatsApp message with a recognized Ref code                 | the code's source |
// | WhatsApp without a recognized Ref code                     | WhatsApp Direct   |
// | No UTM + gclid / gbraid / wbraid (Google Ads auto-tagging)  | Google Ads        |
// | No UTM + ttclid (TikTok ad click)                           | TikTok            |
// | No UTM + fbclid only (Meta click, paid/organic unknown)      | Other             |
// | No UTM + search engine referrer                             | Organic           |
// | No UTM + no referrer                                        | Direct            |
// | Manually entered lead                                       | user must select  |
//
// A utm_source WAS provided but didn't match a recognized ad platform/medium combination lands on
// "Other" - never "Organic"/"Direct" (those are exclusively for the NO-utm_source case) and never
// silently dropped. This is the explicit "do not classify paid traffic as Organic" rule.

const GOOGLE_SOURCES = ['google'];
const GOOGLE_PAID_MEDIA = ['cpc', 'ppc', 'paid', 'paid_search'];
const META_SOURCES = ['facebook', 'instagram', 'meta', 'fb', 'ig'];
const META_PAID_MEDIA = ['paid_social', 'cpc', 'ppc', 'paid'];
const TIKTOK_SOURCES = ['tiktok'];
// A small, extensible set of common search-engine hostnames - a referrer whose host ends in one
// of these is treated as an organic search result; anything else with a referrer is still
// "Direct" by this table's own definition (only a SEARCH referrer earns "Organic" - a referrer
// from an unrelated site, e.g. a news article linking in, isn't a paid or a search result, so it
// is not misrepresented as either; it is conservatively still Direct rather than invented as a
// ninth bucket this report never asked for).
const SEARCH_ENGINE_HOSTS = ['google.', 'bing.', 'yahoo.', 'duckduckgo.', 'baidu.', 'yandex.'];

function norm(value) {
  return String(value || '').trim().toLowerCase();
}

function isSearchReferrer(referrer) {
  const value = norm(referrer);
  if (!value) return false;
  try {
    const host = new URL(value.startsWith('http') ? value : `https://${value}`).hostname.toLowerCase();
    return SEARCH_ENGINE_HOSTS.some(h => host.includes(h));
  } catch {
    return SEARCH_ENGINE_HOSTS.some(h => value.includes(h));
  }
}

/**
 * @param {object} signal
 * @param {string|null|undefined} signal.utmSource
 * @param {string|null|undefined} signal.utmMedium
 * @param {string|null|undefined} signal.referrer - document.referrer at first arrival; only
 *   consulted when there is no utm_source at all.
 * @returns {string} one of SOURCES
 */
function normalizeSource({ utmSource, utmMedium, referrer, gclid, gbraid, wbraid, ttclid, fbclid } = {}) {
  const source = norm(utmSource);
  const medium = norm(utmMedium);
  // Ad click ids (CRM launch blocker C1/C5). Google Ads auto-tagging appends ONLY gclid (or
  // gbraid/wbraid for iOS app/web-to-app traffic) - no UTM at all - and these ids are only ever
  // issued for a paid Google Ads click, so they are conclusive. ttclid is likewise only issued for
  // a TikTok ad click. fbclid is deliberately NOT used: Meta appends it to every outbound link
  // click, organic posts included, so on its own it cannot prove a paid Meta Ads click.
  const googleClick = !!(norm(gclid) || norm(gbraid) || norm(wbraid));
  const tiktokClick = !!norm(ttclid);

  if (!source) {
    if (googleClick) return 'Google Ads';
    if (tiktokClick) return 'TikTok';
    // Came from a Meta property (fbclid) but paid vs organic is unknown: never "Direct", never
    // silently promoted to "Meta Ads" either - the fbclid itself stays on the lead for review.
    if (norm(fbclid)) return 'Other';
    return isSearchReferrer(referrer) ? 'Organic' : 'Direct';
  }

  if (GOOGLE_SOURCES.includes(source) && (GOOGLE_PAID_MEDIA.includes(medium) || googleClick)) return 'Google Ads';
  if (META_SOURCES.includes(source) && META_PAID_MEDIA.includes(medium)) return 'Meta Ads';
  if (TIKTOK_SOURCES.includes(source)) return 'TikTok';

  // A utm_source was provided but didn't match a recognized paid-platform/medium combination
  // (e.g. google with no medium, or an unknown platform) - paid or at least UTM-tagged traffic,
  // never reclassified as Organic/Direct.
  return 'Other';
}

/** Backward-compatible single-string form for CSV import and other callers with no medium/referrer context. */
function normalizeSourceFromString(raw) {
  const value = String(raw || '').trim();
  if (!value) return 'Direct';
  const lower = value.toLowerCase();
  if (GOOGLE_SOURCES.some(s => lower.includes(s))) return 'Google Ads';
  if (META_SOURCES.some(s => new RegExp(`\\b${s}\\b`, 'i').test(lower))) return 'Meta Ads';
  if (TIKTOK_SOURCES.some(s => lower.includes(s))) return 'TikTok';
  if (/whatsapp/.test(lower)) return 'WhatsApp Direct';
  if (/referral|refer/.test(lower)) return 'Referral';
  if (/organic/.test(lower)) return 'Organic';
  if (/direct|^website$/.test(lower)) return 'Direct';
  return 'Other';
}

module.exports = { normalizeSource, normalizeSourceFromString, isSearchReferrer, SOURCES };
