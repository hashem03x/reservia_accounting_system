const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const mongoose = require('mongoose');

// Needed before anything requires createToken.js/authController.js - same convention as
// test/website/cmsApi.test.js. This test deliberately goes through the REAL JWT sign/verify path
// (not a test-auth stub), since the bug it targets lives in that exact path (login's bcrypt.compare).
process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || crypto.randomBytes(24).toString('hex');
process.env.REFRESH_TOKEN_SECRET_KEY = process.env.REFRESH_TOKEN_SECRET_KEY || crypto.randomBytes(24).toString('hex');
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
process.env.REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';

// Pre-launch audit (22 Nov 2026): a platform-admin-created user (and, by the same root cause, a
// user created via POST /api/v1/users or scripts/createAdminUser.js, or anyone who reset their
// password via /auth/forgotPassword) could never log in. Root cause: userModel.js's password
// pre-save hook already bcrypt-hashes `password` on every create/save that modifies it, but every
// one of those call sites ALSO pre-hashed the password itself before calling create()/save() -
// double-hashing it, so authController.js#login's single bcrypt.compare against the plaintext
// never matched. This test exercises the REAL routes end-to-end (real JWT auth via /auth/login,
// not a test-auth stub) so it catches a regression at the exact layer the bug lived in, not just
// in the model hook (server/test/userPasswordHashing.test.js already covers the hook in isolation
// and would NOT have caught this, since it never calls through the controllers).
//
// Also covers the same audit's follow-up requests: the admin can set a user's password directly
// (no email), a user can change their own password with current+new (already existed - verified
// here for real), and Google OAuth login is gone entirely.
//
// Self-skips without TEST_DB_URI, like every other DB-backed suite in this repo.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

let User, server, baseUrl;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  await User.init();

  const express = require('express');
  const cookieParser = require('cookie-parser');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/auth', require('../../routes/authRoute'));
  app.use('/api/v1/admin/platform', require('../../routes/portal/platformAdminRoute'));
  app.use('/api/v1/users', require('../../routes/userRoute'));
  app.use(require('../../middleware/errorMiddleware'));
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!RUN) return;
  await new Promise(resolve => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

async function post(path, body, token) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

maybeTest('a platform-admin-created user can log in with the exact password the admin set (the reported bug)', async () => {
  // A platform admin, created directly in the DB (not through the buggy path - this fixture is not
  // what's under test) so we have a real JWT to call the real admin-only endpoint with.
  const admin = await User.create({ name: 'Platform Admin', email: 'pre-launch-admin@example.com', password: 'AdminPass123!', type: 'online', role: 'admin', platformAdmin: true });
  const adminLogin = await post('/api/v1/auth/login', { email: admin.email, password: 'AdminPass123!' });
  assert.equal(adminLogin.status, 200, `admin fixture must itself be able to log in: ${JSON.stringify(adminLogin.body)}`);
  const adminToken = adminLogin.body.token;

  const created = await post('/api/v1/admin/platform/users', { name: 'Prelaunch Test User', email: 'prelaunch-test-user@example.com', password: 'NewUserPass123!' }, adminToken);
  assert.equal(created.status, 201, `user creation must succeed: ${JSON.stringify(created.body)}`);

  const newUserLogin = await post('/api/v1/auth/login', { email: 'prelaunch-test-user@example.com', password: 'NewUserPass123!' });
  assert.equal(newUserLogin.status, 200, `THE BUG: admin-created user could not log in with the password the admin set - got ${JSON.stringify(newUserLogin.body)}`);
  assert.equal(newUserLogin.body.data.email, 'prelaunch-test-user@example.com');
  assert.ok(newUserLogin.body.token, 'login must return a usable JWT');
});

maybeTest('a user created via POST /api/v1/users (the ordinary ERP create-user route) can log in with the password set', async () => {
  const admin = await User.create({ name: 'ERP Admin', email: 'erp-admin@example.com', password: 'ErpAdminPass123!', type: 'online', role: 'admin', systemMemberships: [{ system: 'ERP', role: 'admin', isActive: true }] });
  const adminLogin = await post('/api/v1/auth/login', { email: admin.email, password: 'ErpAdminPass123!' });
  assert.equal(adminLogin.status, 200, `admin fixture must itself be able to log in: ${JSON.stringify(adminLogin.body)}`);

  const created = await post(
    '/api/v1/users',
    { name: 'ERP Created User', email: 'erp-created-user@example.com', phone: '01011112222', password: 'ErpUserPass123!', passwordConfirm: 'ErpUserPass123!', role: 'user' },
    adminLogin.body.token
  );
  assert.equal(created.status, 201, `user creation must succeed: ${JSON.stringify(created.body)}`);

  const login = await post('/api/v1/auth/login', { email: 'erp-created-user@example.com', password: 'ErpUserPass123!' });
  assert.equal(login.status, 200, `THE SAME BUG, different route: ${JSON.stringify(login.body)}`);
});

maybeTest('resetting a password via the forgot-password flow lets the user log in with the NEW password', async () => {
  const user = await User.create({ name: 'Reset Flow User', email: 'reset-flow-user@example.com', password: 'OldPass123!', type: 'online' });

  // Drive the real verified-reset-code state directly (bypassing email delivery, which is a
  // separate concern from the hashing bug this test targets), then call the real resetPassword
  // route exactly as a verified user would.
  user.passwordResetVerified = true;
  await user.save();

  const put = await fetch(`${baseUrl}/api/v1/auth/resetPassword`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, newPassword: 'BrandNewPass456!' }),
  });
  const putBody = await put.json();
  assert.equal(put.status, 200, `password reset must succeed: ${JSON.stringify(putBody)}`);

  const login = await post('/api/v1/auth/login', { email: user.email, password: 'BrandNewPass456!' });
  assert.equal(login.status, 200, `THE SAME BUG in the reset-password flow: ${JSON.stringify(login.body)}`);

  const oldLogin = await post('/api/v1/auth/login', { email: user.email, password: 'OldPass123!' });
  assert.equal(oldLogin.status, 401, 'the old password must no longer work');
});

maybeTest('admin can directly set a specific new password for a user - no email involved', async () => {
  const admin = await User.create({ name: 'Reset Admin', email: 'reset-admin@example.com', password: 'ResetAdminPass123!', type: 'online', platformAdmin: true });
  const adminToken = (await post('/api/v1/auth/login', { email: admin.email, password: 'ResetAdminPass123!' })).body.token;
  const target = await User.create({ name: 'Reset Target', email: 'reset-target@example.com', password: 'OriginalPass123!', type: 'online' });

  const reset = await post(`/api/v1/admin/platform/users/${target._id}/reset-password`, { newPassword: 'AdminSetThis789!' }, adminToken);
  assert.equal(reset.status, 200, `admin direct reset must succeed: ${JSON.stringify(reset.body)}`);
  assert.equal(reset.body.data.generated, false);
  assert.equal(reset.body.data.password, undefined, 'a typed password is never echoed back');

  const login = await post('/api/v1/auth/login', { email: target.email, password: 'AdminSetThis789!' });
  assert.equal(login.status, 200, `the admin-set password must work immediately: ${JSON.stringify(login.body)}`);
});

maybeTest('admin can generate a random new password for a user when none is typed, shown once in the response', async () => {
  const admin = await User.create({ name: 'Gen Admin', email: 'gen-admin@example.com', password: 'GenAdminPass123!', type: 'online', platformAdmin: true });
  const adminToken = (await post('/api/v1/auth/login', { email: admin.email, password: 'GenAdminPass123!' })).body.token;
  const target = await User.create({ name: 'Gen Target', email: 'gen-target@example.com', password: 'OriginalPass123!', type: 'online' });

  const reset = await post(`/api/v1/admin/platform/users/${target._id}/reset-password`, {}, adminToken);
  assert.equal(reset.status, 200, `generated reset must succeed: ${JSON.stringify(reset.body)}`);
  assert.equal(reset.body.data.generated, true);
  assert.ok(reset.body.data.password && reset.body.data.password.length >= 16, 'a real generated password must be returned once');

  const login = await post('/api/v1/auth/login', { email: target.email, password: reset.body.data.password });
  assert.equal(login.status, 200, `the generated password must actually work: ${JSON.stringify(login.body)}`);
});

maybeTest('a logged-in user can change their own password by providing the current password and a new one', async () => {
  const user = await User.create({ name: 'Self Service User', email: 'self-service-user@example.com', password: 'CurrentPass123!', type: 'online' });
  const token = (await post('/api/v1/auth/login', { email: user.email, password: 'CurrentPass123!' })).body.token;

  const res = await fetch(`${baseUrl}/api/v1/users/updateMyPassword`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: 'CurrentPass123!', password: 'BrandNewSelfPass456!', passwordConfirm: 'BrandNewSelfPass456!' }),
  });
  assert.equal(res.status, 200, `self-service change must succeed: ${JSON.stringify(await res.json())}`);

  const newLogin = await post('/api/v1/auth/login', { email: user.email, password: 'BrandNewSelfPass456!' });
  assert.equal(newLogin.status, 200, `the new self-chosen password must work: ${JSON.stringify(newLogin.body)}`);

  const oldLogin = await post('/api/v1/auth/login', { email: user.email, password: 'CurrentPass123!' });
  assert.equal(oldLogin.status, 401, 'the old password must no longer work');
});

maybeTest('changing your own password is refused without the correct current password', async () => {
  const user = await User.create({ name: 'Self Service Guard', email: 'self-service-guard@example.com', password: 'RealPass123!', type: 'online' });
  const token = (await post('/api/v1/auth/login', { email: user.email, password: 'RealPass123!' })).body.token;

  const res = await fetch(`${baseUrl}/api/v1/users/updateMyPassword`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: 'WrongGuess!', password: 'WouldBeNew123!', passwordConfirm: 'WouldBeNew123!' }),
  });
  assert.equal(res.status, 400, 'a wrong current password must be refused, never silently accepted');

  const login = await post('/api/v1/auth/login', { email: user.email, password: 'RealPass123!' });
  assert.equal(login.status, 200, 'the original password must still be the one that works');
});

maybeTest('a user can be created with CRM and Deal Engine access but ERP left disabled - no ERP role, no ERP membership, login still works', async () => {
  const admin = await User.create({ name: 'Systems Admin', email: 'systems-admin@example.com', password: 'SystemsAdminPass123!', type: 'online', platformAdmin: true });
  const adminToken = (await post('/api/v1/auth/login', { email: admin.email, password: 'SystemsAdminPass123!' })).body.token;

  // Exactly what the redesigned Create User modal sends: no `role` at all when ERP is left off.
  const created = await post('/api/v1/admin/platform/users', { name: 'CRM Only User', email: 'crm-only-user@example.com', password: 'CrmOnlyPass123!' }, adminToken);
  assert.equal(created.status, 201, `creation without an ERP role must succeed: ${JSON.stringify(created.body)}`);
  assert.equal(created.body.data.role, 'user', 'no ERP role was granted - the field must default, never be forced to admin/moderator/operator');

  const systemsRes = await fetch(`${baseUrl}/api/v1/admin/platform/users/${created.body.data._id}/systems`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ systemMemberships: [{ system: 'CRM', role: 'sales', isActive: true }, { system: 'COMMERCIAL', role: 'sales', isActive: true }] }),
  });
  assert.equal(systemsRes.status, 200, `granting CRM + Deal Engine (no ERP) must succeed: ${JSON.stringify(await systemsRes.json())}`);

  const login = await post('/api/v1/auth/login', { email: 'crm-only-user@example.com', password: 'CrmOnlyPass123!' });
  assert.equal(login.status, 200, `the user must be able to log in even with zero ERP access: ${JSON.stringify(login.body)}`);

  const saved = await User.findById(created.body.data._id).lean();
  const { hasActiveErpMembership } = require('../../utils/systemAccess');
  assert.equal(hasActiveErpMembership(saved), false, 'ERP must stay fully disabled - no ERP entry was ever granted');
  assert.deepEqual(
    saved.systemMemberships.map(m => m.system).sort(),
    ['COMMERCIAL', 'CRM'],
    'exactly the two granted systems, nothing else invented'
  );
});

maybeTest('Google OAuth login has been removed - the route no longer exists', async () => {
  const res = await fetch(`${baseUrl}/api/v1/auth/oauth2/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: 'anything' }) });
  assert.equal(res.status, 404, 'POST /api/v1/auth/oauth2/google must no longer be a registered route');
});
