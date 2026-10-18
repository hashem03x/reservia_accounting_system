const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Central Business Portal - the `/me`, `/me/systems`, and platform-admin user-management API
// (docs section "API Design"). Controllers are exercised directly with a mock req/res (this test
// suite's established convention), not an HTTP+supertest layer.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_portal_api';

let User, PlatformAuditLog;
let portalController, platformAdminController;
let requirePlatformAdmin;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  PlatformAuditLog = require('../../models/platformAuditLogModel');
  portalController = require('../../controller/portal/portalController');
  platformAdminController = require('../../controller/portal/platformAdminController');
  requirePlatformAdmin = require('../../middleware/requirePlatformAdmin');
  await Promise.all([User.init(), PlatformAuditLog.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), PlatformAuditLog.deleteMany({})]);
});

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

let seq = 0;
async function makeUser(overrides = {}) {
  seq += 1;
  return User.create({ name: `User ${seq}`, email: `user${seq}@example.com`, phone: `0100000${String(seq).padStart(4, '0')}`, role: 'user', password: 'x', ...overrides });
}

// ===================== requirePlatformAdmin =====================

test('requirePlatformAdmin: rejects a user with platformAdmin !== true', () => {
  const req = { user: { platformAdmin: false } };
  const res = mockRes();
  let captured = null;
  requirePlatformAdmin(req, res, err => { captured = err; });
  assert.ok(captured);
  assert.equal(captured.statusCode, 403);
});

test('requirePlatformAdmin: an ordinary ERP admin (role: "admin") is NOT automatically a platform admin', () => {
  const req = { user: { role: 'admin', isAdmin: true, platformAdmin: false } };
  const res = mockRes();
  let captured = null;
  requirePlatformAdmin(req, res, err => { captured = err; });
  assert.ok(captured, 'role===admin must never bypass the platformAdmin check');
  assert.equal(captured.statusCode, 403);
});

test('requirePlatformAdmin: passes for platformAdmin:true', () => {
  const req = { user: { platformAdmin: true } };
  const res = mockRes();
  let captured = null;
  requirePlatformAdmin(req, res, err => { captured = err; });
  assert.equal(captured, undefined);
});

// ===================== GET /me, GET /me/systems =====================

test('getMe: returns only the caller\'s own identity, never the password', async () => {
  const user = await makeUser({ role: 'moderator', systemMemberships: [{ system: 'ERP', role: 'moderator', isActive: true }] });
  const req = { user };
  const res = mockRes();
  await portalController.getMe(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data._id.toString(), user._id.toString());
  assert.equal(res.body.data.password, undefined);
});

test('getMySystems: ERP-only user sees ERP active, everything else disabled', async () => {
  const user = await makeUser({ role: 'moderator', systemMemberships: [{ system: 'ERP', role: 'moderator', isActive: true }] });
  const req = { user };
  const res = mockRes();
  await portalController.getMySystems(req, res);
  assert.equal(res.body.data.ERP.active, true);
  assert.equal(res.body.data.HR.active, false);
  assert.equal(res.body.data.CRM.active, false);
});

test('getMySystems: a user with no memberships gets every system disabled, not an error', async () => {
  const user = await makeUser();
  const req = { user };
  const res = mockRes();
  await portalController.getMySystems(req, res);
  for (const id of ['ERP', 'HR', 'CRM', 'COMMERCIAL', 'WEBSITE']) assert.equal(res.body.data[id].active, false);
});

// ===================== Platform admin: users =====================

test('createUser: creates a user with no auto-granted system memberships', async () => {
  const admin = await makeUser({ platformAdmin: true });
  const req = { user: admin, body: { name: 'New Staffer', email: 'new-staffer@example.com', phone: '01099990000', password: 'secret1', role: 'moderator' } };
  const res = mockRes();
  await platformAdminController.createUser(req, res, err => { throw err; });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.systemMemberships.length, 0, 'creation must never auto-grant any system access');
  assert.equal(res.body.data.password, undefined);
});

test('createUser: rejects a duplicate email', async () => {
  await makeUser({ email: 'dup@example.com' });
  const admin = await makeUser({ platformAdmin: true });
  const req = { user: admin, body: { name: 'Dup', email: 'dup@example.com', password: 'secret1' } };
  const res = mockRes();
  let captured = null;
  await platformAdminController.createUser(req, res, err => { captured = err; });
  assert.ok(captured);
  assert.equal(captured.statusCode, 400);
});

test('updateUserSystems: rejects an unknown system id', async () => {
  const admin = await makeUser({ platformAdmin: true });
  const target = await makeUser({ role: 'moderator' });
  const req = { user: admin, params: { id: target._id.toString() }, body: { systemMemberships: [{ system: 'FINANCE', role: 'MEMBER' }] } };
  const res = mockRes();
  let captured = null;
  await platformAdminController.updateUserSystems(req, res, err => { captured = err; });
  assert.ok(captured);
  assert.equal(captured.statusCode, 400);
});

test('updateUserSystems: rejects a role that is not valid for the given system', async () => {
  const admin = await makeUser({ platformAdmin: true });
  const target = await makeUser({ role: 'moderator' });
  const req = { user: admin, params: { id: target._id.toString() }, body: { systemMemberships: [{ system: 'ERP', role: 'NOT_A_REAL_ROLE' }] } };
  const res = mockRes();
  let captured = null;
  await platformAdminController.updateUserSystems(req, res, err => { captured = err; });
  assert.ok(captured);
  assert.equal(captured.statusCode, 400);
});

test('updateUserSystems: rejects duplicate entries for the same system', async () => {
  const admin = await makeUser({ platformAdmin: true });
  const target = await makeUser({ role: 'moderator' });
  const req = {
    user: admin,
    params: { id: target._id.toString() },
    body: { systemMemberships: [{ system: 'ERP', role: 'moderator' }, { system: 'ERP', role: 'operator' }] },
  };
  const res = mockRes();
  let captured = null;
  await platformAdminController.updateUserSystems(req, res, err => { captured = err; });
  assert.ok(captured);
  assert.equal(captured.statusCode, 400);
});

test('updateUserSystems: valid replacement succeeds and is recorded in the audit log', async () => {
  const admin = await makeUser({ platformAdmin: true });
  const target = await makeUser({ role: 'moderator' });
  const req = {
    user: admin,
    params: { id: target._id.toString() },
    body: { systemMemberships: [{ system: 'ERP', role: 'moderator', isActive: true }, { system: 'HR', role: 'MEMBER', isActive: true }] },
  };
  const res = mockRes();
  await platformAdminController.updateUserSystems(req, res, err => { throw err; });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.systemMemberships.length, 2);

  const logs = await PlatformAuditLog.find({ targetUser: target._id, action: 'user.systems.update' });
  assert.equal(logs.length, 1);
});

test('updateUserSystems: revoking ERP (isActive:false) takes effect - hasActiveErpMembership reflects it immediately', async () => {
  const { hasActiveErpMembership } = require('../../utils/systemAccess');
  const admin = await makeUser({ platformAdmin: true });
  const target = await makeUser({ role: 'moderator', systemMemberships: [{ system: 'ERP', role: 'moderator', isActive: true }] });
  const req = { user: admin, params: { id: target._id.toString() }, body: { systemMemberships: [{ system: 'ERP', role: 'moderator', isActive: false }] } };
  const res = mockRes();
  await platformAdminController.updateUserSystems(req, res, err => { throw err; });

  const reloaded = await User.findById(target._id);
  assert.equal(hasActiveErpMembership(reloaded), false);
});

// ===================== Platform admin: last-admin protection =====================

test('updatePlatformAdmin: refuses to revoke the LAST remaining platform admin', async () => {
  const onlyAdmin = await makeUser({ platformAdmin: true });
  const req = { user: onlyAdmin, params: { id: onlyAdmin._id.toString() }, body: { platformAdmin: false } };
  const res = mockRes();
  let captured = null;
  await platformAdminController.updatePlatformAdmin(req, res, err => { captured = err; });
  assert.ok(captured);
  assert.equal(captured.statusCode, 400);

  const reloaded = await User.findById(onlyAdmin._id);
  assert.equal(reloaded.platformAdmin, true, 'the revoke must not have been applied');
});

test('updatePlatformAdmin: revoking one of TWO platform admins succeeds', async () => {
  const admin1 = await makeUser({ platformAdmin: true });
  const admin2 = await makeUser({ platformAdmin: true });
  const req = { user: admin1, params: { id: admin2._id.toString() }, body: { platformAdmin: false } };
  const res = mockRes();
  await platformAdminController.updatePlatformAdmin(req, res, err => { throw err; });
  assert.equal(res.statusCode, 200);
  assert.equal((await User.findById(admin2._id)).platformAdmin, false);
});

test('updatePlatformAdmin: granting platform admin to a new user succeeds and is audited', async () => {
  const admin = await makeUser({ platformAdmin: true });
  const target = await makeUser();
  const req = { user: admin, params: { id: target._id.toString() }, body: { platformAdmin: true } };
  const res = mockRes();
  await platformAdminController.updatePlatformAdmin(req, res, err => { throw err; });
  assert.equal((await User.findById(target._id)).platformAdmin, true);
  const logs = await PlatformAuditLog.find({ targetUser: target._id, action: 'user.platformAdmin.update' });
  assert.equal(logs.length, 1);
});

// ===================== listUsers / listAuditLog =====================

test('listUsers: paginates and never leaks the password field', async () => {
  for (let i = 0; i < 3; i += 1) await makeUser(); // eslint-disable-line no-await-in-loop
  const req = { user: await makeUser({ platformAdmin: true }), query: { page: '1', limit: '2' } };
  const res = mockRes();
  await platformAdminController.listUsers(req, res);
  assert.equal(res.body.data.length, 2);
  assert.ok(res.body.data.every(u => !('password' in u.toObject())));
  assert.equal(res.body.pagination.total, 4);
});

test('listAuditLog: lists recorded entries, most recent first', async () => {
  const admin = await makeUser({ platformAdmin: true });
  const target = await makeUser();
  await platformAdminController.updatePlatformAdmin({ user: admin, params: { id: target._id.toString() }, body: { platformAdmin: true } }, mockRes(), err => { if (err) throw err; });

  const req = { user: admin, query: {} };
  const res = mockRes();
  await platformAdminController.listAuditLog(req, res);
  assert.ok(res.body.data.length >= 1);
  assert.equal(res.body.data[0].action, 'user.platformAdmin.update');
});
