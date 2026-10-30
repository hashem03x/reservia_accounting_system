const { test } = require('node:test');
const assert = require('node:assert/strict');

// Reservia CRM - the public lead-intake endpoint's own CORS allow-list, separate from app.js's
// global one (see utils/crm/publicLeadOrigins.js's header comment for why). Exercised with a
// fresh require per test (env vars are read once at module load) so WEBSITE_ALLOWED_ORIGINS
// overrides are picked up correctly.

function freshModule(envValue) {
  const key = require.resolve('../../utils/crm/publicLeadOrigins');
  delete require.cache[key];
  if (envValue === undefined) delete process.env.WEBSITE_ALLOWED_ORIGINS;
  else process.env.WEBSITE_ALLOWED_ORIGINS = envValue;
  return require('../../utils/crm/publicLeadOrigins');
}

test('isAllowedWebsiteOrigin: with no env override, the real production domain (apex and www) and local dev are allowed', () => {
  const { isAllowedWebsiteOrigin } = freshModule(undefined);
  assert.equal(isAllowedWebsiteOrigin('https://reservia-energy.com'), true);
  assert.equal(isAllowedWebsiteOrigin('https://www.reservia-energy.com'), true);
  assert.equal(isAllowedWebsiteOrigin('http://localhost:5173'), true);
});

test('isAllowedWebsiteOrigin: an arbitrary third-party origin is rejected', () => {
  const { isAllowedWebsiteOrigin } = freshModule(undefined);
  assert.equal(isAllowedWebsiteOrigin('https://evil.example.com'), false);
  assert.equal(isAllowedWebsiteOrigin('https://reserviafrontend.vercel.app'), false);
});

test('isAllowedWebsiteOrigin: a request with no Origin header (server-to-server, curl) is never blocked by this check - CORS only governs browser requests', () => {
  const { isAllowedWebsiteOrigin } = freshModule(undefined);
  assert.equal(isAllowedWebsiteOrigin(undefined), true);
});

test('isAllowedWebsiteOrigin: WEBSITE_ALLOWED_ORIGINS overrides the defaults entirely, trimmed and trailing-slash-stripped', () => {
  const { isAllowedWebsiteOrigin, PUBLIC_LEAD_ALLOWED_ORIGINS } = freshModule(' https://staging.example.com/ , https://other.example.com ');
  assert.equal(isAllowedWebsiteOrigin('https://staging.example.com'), true);
  assert.equal(isAllowedWebsiteOrigin('https://other.example.com'), true);
  assert.equal(isAllowedWebsiteOrigin('https://reservia-energy.com'), false);
  // Local dev origins are always added on top, even when overridden - a developer running the
  // website locally against the real backend should never lose that.
  assert.ok(PUBLIC_LEAD_ALLOWED_ORIGINS.includes('http://localhost:5173'));
});
