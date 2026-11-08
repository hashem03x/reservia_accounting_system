const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requireWebsiteAccess, requireWebsiteCapability, hasActiveWebsiteMembership, CAPABILITIES_BY_ROLE } = require('../../middleware/websiteAccess');

// Website Management access control - exercises the real middleware directly with a mock
// req/res/next (test/crm/crmAccess.test.js's own established convention for this kind of pure,
// DB-free authorization check). The point of this file: a direct URL hit with no/revoked/wrong-role
// WEBSITE membership must be rejected by THIS middleware - "hiding a menu item is not authorization".

function mockRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
function run(middleware, req) {
  let nextErr;
  middleware(req, mockRes(), err => { nextErr = err; });
  return nextErr;
}

test('requireWebsiteAccess: rejects a user with no systemMemberships at all', () => {
  const req = { user: {} };
  const err = run(requireWebsiteAccess, req);
  assert.ok(err);
  assert.equal(err.statusCode, 403);
  assert.equal(req.websiteRole, undefined);
});

test('requireWebsiteAccess: rejects a user whose WEBSITE membership exists but was revoked (isActive: false)', () => {
  const req = { user: { systemMemberships: [{ system: 'WEBSITE', role: 'editor', isActive: false }] } };
  const err = run(requireWebsiteAccess, req);
  assert.ok(err);
  assert.equal(err.statusCode, 403);
});

test('requireWebsiteAccess: rejects a user with only an ERP membership (no WEBSITE entry) - systems never bleed into each other', () => {
  const req = { user: { systemMemberships: [{ system: 'ERP', role: 'admin', isActive: true }] } };
  const err = run(requireWebsiteAccess, req);
  assert.ok(err);
  assert.equal(err.statusCode, 403);
});

test('requireWebsiteAccess: rejects a user with only a CRM membership (no WEBSITE entry)', () => {
  const req = { user: { systemMemberships: [{ system: 'CRM', role: 'sales', isActive: true }] } };
  const err = run(requireWebsiteAccess, req);
  assert.ok(err);
  assert.equal(err.statusCode, 403);
});

test('requireWebsiteAccess: an active WEBSITE membership passes through and attaches req.websiteRole/req.websiteCapabilities from the DATABASE record, not the client', () => {
  const req = { user: { systemMemberships: [{ system: 'WEBSITE', role: 'editor', isActive: true }] } };
  const err = run(requireWebsiteAccess, req);
  assert.equal(err, undefined);
  assert.equal(req.websiteRole, 'editor');
  assert.deepEqual(req.websiteCapabilities, CAPABILITIES_BY_ROLE.editor);
});

test('requireWebsiteAccess: a role/capability the client tries to smuggle onto req.body/query is irrelevant - only req.user.systemMemberships (the DB record) is read', () => {
  const req = { user: { systemMemberships: [{ system: 'WEBSITE', role: 'viewer', isActive: true }] }, body: { role: 'admin' }, query: { websiteRole: 'admin' } };
  run(requireWebsiteAccess, req);
  assert.equal(req.websiteRole, 'viewer');
});

test('requireWebsiteCapability: a viewer is rejected from an edit-only action', () => {
  const req = { websiteCapabilities: CAPABILITIES_BY_ROLE.viewer };
  const err = run(requireWebsiteCapability('edit'), req);
  assert.ok(err);
  assert.equal(err.statusCode, 403);
});

test('requireWebsiteCapability: an editor is rejected from a publish-only action (admin only)', () => {
  const req = { websiteCapabilities: CAPABILITIES_BY_ROLE.editor };
  const err = run(requireWebsiteCapability('publish'), req);
  assert.ok(err);
  assert.equal(err.statusCode, 403);
});

test('requireWebsiteCapability: an editor passes an edit/media.manage/seo.manage gate', () => {
  const req = { websiteCapabilities: CAPABILITIES_BY_ROLE.editor };
  assert.equal(run(requireWebsiteCapability('edit'), req), undefined);
  assert.equal(run(requireWebsiteCapability('media.manage'), req), undefined);
  assert.equal(run(requireWebsiteCapability('seo.manage'), req), undefined);
});

test('requireWebsiteCapability: an admin passes every gate, including integrations.manage/settings.manage/publish', () => {
  const req = { websiteCapabilities: CAPABILITIES_BY_ROLE.admin };
  assert.equal(run(requireWebsiteCapability('publish'), req), undefined);
  assert.equal(run(requireWebsiteCapability('integrations.manage'), req), undefined);
  assert.equal(run(requireWebsiteCapability('settings.manage'), req), undefined);
});

test('requireWebsiteCapability: requiring MULTIPLE capabilities needs all of them, not just one', () => {
  const req = { websiteCapabilities: CAPABILITIES_BY_ROLE.editor };
  const err = run(requireWebsiteCapability('edit', 'publish'), req);
  assert.ok(err, 'editor has edit but not publish - must fail the combined check');
});

test('requireWebsiteCapability: with no req.websiteCapabilities set at all (requireWebsiteAccess never ran, or ran and failed) - rejected, never treated as "anything allowed"', () => {
  const req = {};
  const err = run(requireWebsiteCapability('view'), req);
  assert.ok(err);
  assert.equal(err.statusCode, 403);
});

test('hasActiveWebsiteMembership: mirrors requireWebsiteAccess\'s own gate exactly', () => {
  assert.equal(hasActiveWebsiteMembership({ systemMemberships: [{ system: 'WEBSITE', role: 'viewer', isActive: true }] }), true);
  assert.equal(hasActiveWebsiteMembership({ systemMemberships: [{ system: 'WEBSITE', role: 'viewer', isActive: false }] }), false);
  assert.equal(hasActiveWebsiteMembership({}), false);
  assert.equal(hasActiveWebsiteMembership(null), false);
});
