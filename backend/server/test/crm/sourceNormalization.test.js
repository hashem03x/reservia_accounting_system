const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSource, SOURCES } = require('../../utils/crm/sourceNormalization');

test('normalizeSource: recognizes common ad-platform UTM values regardless of exact spelling', () => {
  assert.equal(normalizeSource('google'), 'Google Ads');
  assert.equal(normalizeSource('google-cpc'), 'Google Ads');
  assert.equal(normalizeSource('GOOGLE_ADS'), 'Google Ads');
  assert.equal(normalizeSource('facebook'), 'Meta Ads');
  assert.equal(normalizeSource('meta'), 'Meta Ads');
  assert.equal(normalizeSource('instagram'), 'Meta Ads');
  assert.equal(normalizeSource('whatsapp'), 'WhatsApp Direct');
  assert.equal(normalizeSource('referral'), 'Referral');
});

test('normalizeSource: no utm_source at all (a direct/bare visit) is Organic, never Other', () => {
  assert.equal(normalizeSource(undefined), 'Organic');
  assert.equal(normalizeSource(null), 'Organic');
  assert.equal(normalizeSource(''), 'Organic');
  assert.equal(normalizeSource('   '), 'Organic');
});

test('normalizeSource: an explicit but unrecognized value is Other - never silently reclassified as Organic', () => {
  assert.equal(normalizeSource('tiktok'), 'Other');
  assert.equal(normalizeSource('some-weird-campaign-123'), 'Other');
});

test('normalizeSource: every possible return value is one of the fixed SOURCES list', () => {
  for (const input of ['google', 'facebook', 'whatsapp', 'referral', undefined, 'tiktok', 'website']) {
    assert.ok(SOURCES.includes(normalizeSource(input)), `normalizeSource(${input}) should be in SOURCES`);
  }
});
