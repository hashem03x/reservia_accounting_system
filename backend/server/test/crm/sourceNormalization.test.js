const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSource, normalizeSourceFromString, isSearchReferrer, SOURCES } = require('../../utils/crm/sourceNormalization');

// Change Request 1, Feature 1 "source mapping rules" table - normalizeSource({ utmSource,
// utmMedium, referrer }) is the single backend authority every lead-intake channel (public
// website intake, the WhatsApp ref-code lookup) must resolve through, so the mapping can never
// drift between callers.

test('normalizeSource: Google Ads requires BOTH utm_source=google AND a qualifying paid medium', () => {
  assert.equal(normalizeSource({ utmSource: 'google', utmMedium: 'cpc' }), 'Google Ads');
  assert.equal(normalizeSource({ utmSource: 'GOOGLE', utmMedium: 'CPC' }), 'Google Ads', 'case-insensitive');
  assert.equal(normalizeSource({ utmSource: 'google', utmMedium: 'paid_search' }), 'Google Ads');
  // google with no qualifying paid medium is UTM-tagged but unmatched -> Other, never Organic.
  assert.equal(normalizeSource({ utmSource: 'google', utmMedium: 'organic' }), 'Other');
  assert.equal(normalizeSource({ utmSource: 'google' }), 'Other');
});

test('normalizeSource: Meta Ads recognizes facebook/instagram/meta variants with a qualifying paid medium', () => {
  assert.equal(normalizeSource({ utmSource: 'facebook', utmMedium: 'paid_social' }), 'Meta Ads');
  assert.equal(normalizeSource({ utmSource: 'instagram', utmMedium: 'cpc' }), 'Meta Ads');
  assert.equal(normalizeSource({ utmSource: 'meta', utmMedium: 'paid' }), 'Meta Ads');
  assert.equal(normalizeSource({ utmSource: 'Facebook', utmMedium: 'Paid_Social' }), 'Meta Ads', 'case-insensitive');
  // A Meta-platform source with no qualifying paid medium never silently becomes Meta Ads either.
  assert.equal(normalizeSource({ utmSource: 'facebook', utmMedium: 'organic' }), 'Other');
});

test('normalizeSource: TikTok is recognized by source alone (no medium requirement)', () => {
  assert.equal(normalizeSource({ utmSource: 'tiktok' }), 'TikTok');
  assert.equal(normalizeSource({ utmSource: 'TikTok', utmMedium: 'cpc' }), 'TikTok');
});

test('normalizeSource: no utm_source at all splits Organic vs Direct purely by referrer presence', () => {
  assert.equal(normalizeSource({ referrer: 'https://www.google.com/search?q=solar' }), 'Organic');
  assert.equal(normalizeSource({ referrer: 'https://www.bing.com/search?q=solar' }), 'Organic');
  assert.equal(normalizeSource({}), 'Direct');
  assert.equal(normalizeSource({ referrer: '' }), 'Direct');
  // A referrer from an unrelated (non-search-engine) site is still Direct, not invented as a ninth bucket.
  assert.equal(normalizeSource({ referrer: 'https://news.example.com/article' }), 'Direct');
  assert.equal(normalizeSource(undefined), 'Direct');
});

test('normalizeSource: a utm_source provided but unmatched is Other - paid/tagged traffic is never reclassified as Organic/Direct', () => {
  assert.equal(normalizeSource({ utmSource: 'some-weird-campaign-123' }), 'Other');
  assert.equal(normalizeSource({ utmSource: 'bing', utmMedium: 'cpc' }), 'Other');
  assert.equal(normalizeSource({ utmSource: 'whatsapp' }), 'Other', 'WhatsApp attribution is resolved separately, not via UTM');
});

test('normalizeSource: every possible return value is one of the fixed SOURCES list', () => {
  const cases = [
    { utmSource: 'google', utmMedium: 'cpc' },
    { utmSource: 'facebook', utmMedium: 'paid_social' },
    { utmSource: 'tiktok' },
    { referrer: 'https://www.google.com/' },
    {},
    { utmSource: 'unknown' },
  ];
  for (const c of cases) assert.ok(SOURCES.includes(normalizeSource(c)), `normalizeSource(${JSON.stringify(c)}) should be in SOURCES`);
});

test('isSearchReferrer: recognizes known search engine hosts, with or without a scheme', () => {
  assert.equal(isSearchReferrer('https://www.google.com/search?q=x'), true);
  assert.equal(isSearchReferrer('duckduckgo.com'), true);
  assert.equal(isSearchReferrer('https://news.example.com/'), false);
  assert.equal(isSearchReferrer(''), false);
  assert.equal(isSearchReferrer(undefined), false);
});

// ===================== normalizeSourceFromString - CSV import's simpler single-string form =====================

test('normalizeSourceFromString: maps free-text historical values onto the fixed SOURCES list', () => {
  assert.equal(normalizeSourceFromString('Google Ads campaign'), 'Google Ads');
  assert.equal(normalizeSourceFromString('facebook ads'), 'Meta Ads');
  assert.equal(normalizeSourceFromString('TikTok'), 'TikTok');
  assert.equal(normalizeSourceFromString('WhatsApp'), 'WhatsApp Direct');
  assert.equal(normalizeSourceFromString('Referred by a friend'), 'Referral');
  assert.equal(normalizeSourceFromString('Organic search'), 'Organic');
  assert.equal(normalizeSourceFromString('website'), 'Direct');
  assert.equal(normalizeSourceFromString(''), 'Direct');
  assert.equal(normalizeSourceFromString('some-unrecognized-value'), 'Other');
});
