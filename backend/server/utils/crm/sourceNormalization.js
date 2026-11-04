const { SOURCES } = require('./constants');

// Maps a raw source/UTM signal onto the fixed SOURCES list (acceptance report finding 4) -
// "Preserve source and UTM information where provided" rather than discarding it the moment a
// fixed list exists. Used by the public website intake (services/crm/publicLeadIntakeService.js)
// and CSV import (services/crm/leadImportService.js) - the two paths that receive a free-text
// `source`/`utm_source` from outside rather than a user picking from the CRM's own dropdown.
//
// Deliberately permissive matching (case-insensitive substring) - ad platforms and UTM
// conventions vary ("google", "google-ads", "google_cpc" should all land on "Google Ads"); when
// nothing recognizable matches, the raw value is kept as the lead's free-text `source` (never
// silently dropped) and "Other" is used only for the fixed-list-constrained callers that need one.
// Word-boundary-anchored, not bare substrings - "ig" (Instagram) alone would otherwise false-match
// ordinary words like "campaign" or "design"; "fb" is short enough to anchor the same way.
const PATTERNS = [
  { match: /google/i, source: 'Google Ads' },
  { match: /\b(meta|facebook|fb|instagram|ig)\b/i, source: 'Meta Ads' },
  { match: /whatsapp/i, source: 'WhatsApp Direct' },
  { match: /referral|refer/i, source: 'Referral' },
  { match: /organic|direct|^website$/i, source: 'Organic' },
];

/**
 * @returns {string} one of SOURCES - no utm_source at all (a direct visit - typed the URL,
 * bookmark, or an unattributed search result) is "Organic", the conventional bucket for
 * unattributed traffic; "Other" is reserved for a utm_source that WAS provided but doesn't match
 * anything recognizable, so it is never confused with genuinely-direct traffic.
 */
function normalizeSource(raw) {
  const value = String(raw || '').trim();
  if (!value) return 'Organic';
  for (const { match, source } of PATTERNS) {
    if (match.test(value)) return source;
  }
  return 'Other';
}

module.exports = { normalizeSource, SOURCES };
