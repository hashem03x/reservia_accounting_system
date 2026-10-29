const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requireCrmAccess, requireCrmRole, hasActiveCrmMembership } = require('../../middleware/crmAccess');

// Reservia CRM access control - exercises the real middleware directly with a mock req/res/next
// (test/portal/systemAccess.test.js's own established convention for this kind of pure,
// DB-free authorization check). The point of this file: a direct URL hit with no/revoked/wrong-role
// CRM membership must be rejected by THIS middleware - "hiding a menu item is not authorization".

function mockRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
function run(middleware, req) {
  let nextErr;
  middleware(req, mockRes(), err => { nextErr = err; });
  return nextErr;
}

test('requireCrmAccess: rejects a user with no systemMemberships at all', () => {
  const req = { user: {} };
  const err = run(requireCrmAccess, req);
  assert.ok(err);
  assert.equal(err.statusCode, 403);
  assert.equal(req.crmRole, undefined);
});

test('requireCrmAccess: rejects a user whose CRM membership exists but was revoked (isActive: false)', () => {
  const req = { user: { systemMemberships: [{ system: 'CRM', role: 'sales', isActive: false }] } };
  const err = run(requireCrmAccess, req);
  assert.ok(err);
  assert.equal(err.statusCode, 403);
});

test('requireCrmAccess: rejects a user with only an ERP membership (no CRM entry) - systems never bleed into each other', () => {
  const req = { user: { systemMemberships: [{ system: 'ERP', role: 'admin', isActive: true }] } };
  const err = run(requireCrmAccess, req);
  assert.ok(err);
  assert.equal(err.statusCode, 403);
});

test('requireCrmAccess: an active CRM membership passes through and attaches req.crmRole from the DATABASE record, not the client', () => {
  const req = { user: { systemMemberships: [{ system: 'CRM', role: 'sales', isActive: true }] } };
  const err = run(requireCrmAccess, req);
  assert.equal(err, undefined);
  assert.equal(req.crmRole, 'sales');
});

test('requireCrmAccess: a role string the client tries to smuggle onto req.body/query is irrelevant - only req.user.systemMemberships (the DB record) is read', () => {
  const req = { user: { systemMemberships: [{ system: 'CRM', role: 'sales', isActive: true }] }, body: { role: 'md' }, query: { crmRole: 'md' } };
  run(requireCrmAccess, req);
  assert.equal(req.crmRole, 'sales');
});

test('requireCrmRole: a sales rep is rejected from an admin/md-only action (reassigning a lead)', () => {
  const req = { crmRole: 'sales' };
  const err = run(requireCrmRole('admin', 'md'), req);
  assert.ok(err);
  assert.equal(err.statusCode, 403);
});

test('requireCrmRole: an admin passes an admin/md-only gate', () => {
  const req = { crmRole: 'admin' };
  const err = run(requireCrmRole('admin', 'md'), req);
  assert.equal(err, undefined);
});

test('requireCrmRole: with no req.crmRole set at all (requireCrmAccess never ran, or ran and failed) - rejected, never treated as "any role allowed"', () => {
  const req = {};
  const err = run(requireCrmRole('admin', 'md'), req);
  assert.ok(err);
  assert.equal(err.statusCode, 403);
});

test('hasActiveCrmMembership: mirrors requireCrmAccess\'s own gate exactly', () => {
  assert.equal(hasActiveCrmMembership({ systemMemberships: [{ system: 'CRM', role: 'technical', isActive: true }] }), true);
  assert.equal(hasActiveCrmMembership({ systemMemberships: [{ system: 'CRM', role: 'technical', isActive: false }] }), false);
  assert.equal(hasActiveCrmMembership({}), false);
  assert.equal(hasActiveCrmMembership(null), false);
});
