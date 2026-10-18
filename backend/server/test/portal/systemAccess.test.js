const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Central Business Portal - the authorization core (docs section "Authorization Model").
// Exercises the real middleware directly with a mock req/res/next (the established convention in
// this test suite - see test/project/projectManagers.test.js, test/accounting/
// journalEntryGroupingAndSourceLinks.test.js - rather than an HTTP+supertest layer), plus a real
// end-to-end JWT through `protect` for the one check that lives there (isActive).

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_portal_system_access';

let User;
let hasActiveErpMembership, getEffectiveSystemAccess;
let checkUserPermissions;
let authController;
let createToken;

before(async () => {
  require('../../config/env').loadEnv();
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  ({ hasActiveErpMembership, getEffectiveSystemAccess } = require('../../utils/systemAccess'));
  ({ checkUserPermissions } = require('../../middleware/hasPermission'));
  authController = require('../../controller/user/authController');
  ({ createToken } = require('../../utils/createToken'));
  await User.init();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await User.deleteMany({});
});

function mockRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

// ===================== hasActiveErpMembership / getEffectiveSystemAccess =====================

test('hasActiveErpMembership: false with no systemMemberships at all', () => {
  assert.equal(hasActiveErpMembership({ systemMemberships: [] }), false);
  assert.equal(hasActiveErpMembership({}), false);
});

test('hasActiveErpMembership: false when the ERP entry exists but isActive is false (revoked)', () => {
  assert.equal(hasActiveErpMembership({ systemMemberships: [{ system: 'ERP', role: 'admin', isActive: false }] }), false);
});

test('hasActiveErpMembership: true only for an active ERP entry', () => {
  assert.equal(hasActiveErpMembership({ systemMemberships: [{ system: 'HR', role: 'MEMBER', isActive: true }, { system: 'ERP', role: 'moderator', isActive: true }] }), true);
});

test('getEffectiveSystemAccess: ERP active+role reflects real membership; unimplemented systems are NEVER active even with a membership row', () => {
  const access = getEffectiveSystemAccess({
    systemMemberships: [
      { system: 'ERP', role: 'operator', isActive: true },
      { system: 'HR', role: 'MEMBER', isActive: true },
    ],
  });
  assert.equal(access.ERP.active, true);
  assert.equal(access.ERP.role, 'operator');
  assert.equal(access.HR.hasMembership, true);
  assert.equal(access.HR.active, false, 'HR is not implemented - must never read as active regardless of membership');
  assert.equal(access.CRM.active, false);
  assert.equal(access.CRM.hasMembership, false);
});

test('getEffectiveSystemAccess: a user with zero memberships gets every system disabled', () => {
  const access = getEffectiveSystemAccess({ systemMemberships: [] });
  for (const systemId of ['ERP', 'HR', 'CRM', 'COMMERCIAL', 'WEBSITE']) {
    assert.equal(access[systemId].active, false);
    assert.equal(access[systemId].hasMembership, false);
  }
});

// ===================== checkUserPermissions (ERP membership gate) =====================

test('checkUserPermissions: an ERP admin with NO ERP membership is rejected, even though role==="admin" would otherwise bypass everything', () => {
  const req = { user: { role: 'admin', permissions: [], systemMemberships: [] } };
  const res = mockRes();
  let captured = null;
  checkUserPermissions({ resource: 'products', action: 'read' })(req, res, err => { captured = err; });
  assert.ok(captured);
  assert.equal(captured.statusCode, 403);
});

test('checkUserPermissions: an ERP admin WITH active ERP membership bypasses the resource/action check as before', () => {
  const req = { user: { role: 'admin', permissions: [], systemMemberships: [{ system: 'ERP', role: 'admin', isActive: true }] } };
  const res = mockRes();
  let captured = null;
  checkUserPermissions({ resource: 'products', action: 'read' })(req, res, err => { captured = err; });
  assert.equal(captured, undefined);
});

test('checkUserPermissions: a moderator with active ERP membership and the matching permission passes', () => {
  const req = {
    user: {
      role: 'moderator',
      permissions: [{ resource: 'products', actions: ['read'] }],
      systemMemberships: [{ system: 'ERP', role: 'moderator', isActive: true }],
    },
  };
  const res = mockRes();
  let captured = null;
  checkUserPermissions({ resource: 'products', action: 'read' })(req, res, err => { captured = err; });
  assert.equal(captured, undefined);
});

test('checkUserPermissions: a moderator whose ERP membership was revoked (isActive:false) is rejected even with a matching permission', () => {
  const req = {
    user: {
      role: 'moderator',
      permissions: [{ resource: 'products', actions: ['read'] }],
      systemMemberships: [{ system: 'ERP', role: 'moderator', isActive: false }],
    },
  };
  const res = mockRes();
  let captured = null;
  checkUserPermissions({ resource: 'products', action: 'read' })(req, res, err => { captured = err; });
  assert.ok(captured);
  assert.equal(captured.statusCode, 403);
});

// ===================== allowedTo (ERP membership gate) =====================

test('allowedTo: rejects a role-matching, isAdmin:true user with no ERP membership', () => {
  const req = { user: { role: 'admin', isAdmin: true, systemMemberships: [] } };
  const res = mockRes();
  let captured = null;
  authController.allowedTo('admin')(req, res, err => { captured = err; });
  assert.ok(captured);
  assert.equal(captured.statusCode, 403);
});

test('allowedTo: accepts a role-matching user with active ERP membership (unchanged behavior once membership exists)', () => {
  const req = { user: { role: 'admin', isAdmin: false, systemMemberships: [{ system: 'ERP', role: 'admin', isActive: true }] } };
  const res = mockRes();
  let captured = null;
  authController.allowedTo('admin')(req, res, err => { captured = err; });
  assert.equal(captured, undefined);
});

// ===================== protect (isActive gate, real JWT) =====================

test('protect: rejects a disabled user (isActive:false) even with a perfectly valid token', async () => {
  const user = await User.create({ name: 'Disabled Staff', email: 'disabled-staff@example.com', role: 'moderator', password: 'x', isActive: false });
  const token = createToken(user._id.toString());
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockRes();
  let captured = null;
  await authController.protect(req, res, err => { captured = err; });
  assert.ok(captured);
  assert.equal(captured.statusCode, 401);
});

test('protect: accepts an active user with a valid token (sets req.user)', async () => {
  const user = await User.create({ name: 'Active Staff', email: 'active-staff@example.com', role: 'moderator', password: 'x', isActive: true });
  const token = createToken(user._id.toString());
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockRes();
  let captured = null;
  await authController.protect(req, res, err => { captured = err; });
  assert.equal(captured, undefined);
  assert.equal(req.user._id.toString(), user._id.toString());
});
