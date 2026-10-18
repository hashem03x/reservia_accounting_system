const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Central Business Portal - scripts/bootstrapPlatformAdmin.js. Covers the real root cause found
// in production use: on Windows PowerShell, `npm run <script> -- --flag value` strips every
// `--flag`-style token before it reaches node (reproduced directly against this npm/shell
// combination - not specific to --email/--confirm), leaving only a bare positional value (or
// nothing, for a flag with no value like --confirm). parseArgs is exercised directly with
// synthetic argv/env (never real process.argv) so these tests never depend on - or are broken by
// - the very shell quirk they're guarding against. bootstrapPlatformAdmin itself is exercised
// with `connect:false` against this test's own already-open database, the same technique
// test/project/sectors.test.js uses for scripts/seedSectors.js - never against a real DB_URI.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_bootstrap_platform_admin';

let User;
let bootstrapPlatformAdmin, parseArgs, EMAIL_REGEX;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  ({ bootstrapPlatformAdmin, parseArgs, EMAIL_REGEX } = require('../../scripts/bootstrapPlatformAdmin'));
  await User.init();
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await User.deleteMany({});
});

let seq = 0;
async function makeUser(overrides = {}) {
  seq += 1;
  return User.create({ name: `User ${seq}`, email: `bootstrap-user${seq}@example.com`, role: 'admin', password: 'x', ...overrides });
}

// ===================== parseArgs =====================

test('parseArgs: the documented --email value --confirm form', () => {
  assert.deepEqual(parseArgs(['--email', 'you@example.com', '--confirm'], {}), { email: 'you@example.com', confirm: true });
});

test('parseArgs: the --email=value form (a single token, safer under shells that split arguments)', () => {
  assert.deepEqual(parseArgs(['--email=you@example.com', '--confirm'], {}), { email: 'you@example.com', confirm: true });
});

test('parseArgs: order does not matter', () => {
  assert.deepEqual(parseArgs(['--confirm', '--email', 'you@example.com'], {}), { email: 'you@example.com', confirm: true });
});

test('parseArgs: missing --email leaves email undefined', () => {
  assert.deepEqual(parseArgs(['--confirm'], {}), { email: undefined, confirm: true });
});

test('parseArgs: missing --confirm leaves confirm false', () => {
  assert.deepEqual(parseArgs(['--email', 'you@example.com'], {}), { email: 'you@example.com', confirm: false });
});

test('parseArgs: an --email with no value (immediately followed by another flag) is never swallowed into confirm\'s slot', () => {
  const result = parseArgs(['--email', '--confirm'], {});
  assert.equal(result.email, undefined, '--confirm must not be consumed as the email value');
  assert.equal(result.confirm, true);
});

test('parseArgs: ROOT CAUSE scenario - npm/PowerShell strips every --flag token, leaving only the bare email value; --confirm leaves no trace', () => {
  // This is the EXACT argv this environment's npm (10.x) produces for
  // `npm run db:bootstrap-platform-admin -- --email you@example.com --confirm` when run from
  // Windows PowerShell - reproduced directly against this npm/shell combination before this fix.
  const mangledArgv = ['you@example.com'];
  const result = parseArgs(mangledArgv, {});
  assert.equal(result.email, 'you@example.com', 'the bare positional value is recovered as the email');
  assert.equal(result.confirm, false, 'confirm must NEVER be inferred just because an email value is present');
});

test('parseArgs: PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_CONFIRM env vars work when argv is empty (immune to the shell-stripping above)', () => {
  assert.deepEqual(parseArgs([], { PLATFORM_ADMIN_EMAIL: 'you@example.com', PLATFORM_ADMIN_CONFIRM: 'true' }), { email: 'you@example.com', confirm: true });
});

test('parseArgs: PLATFORM_ADMIN_CONFIRM must be exactly "true" (case-insensitive) - any other value is not a confirmation', () => {
  assert.equal(parseArgs([], { PLATFORM_ADMIN_CONFIRM: 'yes' }).confirm, false);
  assert.equal(parseArgs([], { PLATFORM_ADMIN_CONFIRM: '1' }).confirm, false);
  assert.equal(parseArgs([], { PLATFORM_ADMIN_CONFIRM: 'TRUE' }).confirm, true);
});

test('parseArgs: a real argv value takes precedence over the env var fallback', () => {
  const result = parseArgs(['--email', 'argv@example.com', '--confirm'], { PLATFORM_ADMIN_EMAIL: 'env@example.com' });
  assert.equal(result.email, 'argv@example.com');
});

test('EMAIL_REGEX: accepts well-formed emails, rejects obviously malformed ones', () => {
  assert.ok(EMAIL_REGEX.test('you@example.com'));
  assert.ok(!EMAIL_REGEX.test('not-an-email'));
  assert.ok(!EMAIL_REGEX.test('missing-domain@'));
  assert.ok(!EMAIL_REGEX.test('@no-local-part.com'));
  assert.ok(!EMAIL_REGEX.test('has spaces@example.com'));
});

// ===================== bootstrapPlatformAdmin =====================

test('bootstrapPlatformAdmin: missing email throws the usage message and touches no data', async () => {
  const before_ = await User.countDocuments({ platformAdmin: true });
  await assert.rejects(() => bootstrapPlatformAdmin({ connect: false, argv: ['--confirm'], env: {} }), /Usage:/);
  assert.equal(await User.countDocuments({ platformAdmin: true }), before_);
});

test('bootstrapPlatformAdmin: missing confirmation is refused even with a valid, existing email', async () => {
  const user = await makeUser();
  await assert.rejects(
    () => bootstrapPlatformAdmin({ connect: false, argv: ['--email', user.email], env: {} }),
    /Refusing to continue without --confirm/,
  );
  assert.equal((await User.findById(user._id)).platformAdmin, false);
});

test('bootstrapPlatformAdmin: an invalid email format is rejected before any database lookup', async () => {
  await assert.rejects(
    () => bootstrapPlatformAdmin({ connect: false, argv: ['--email', 'not-an-email', '--confirm'], env: {} }),
    /does not look like a valid email address/,
  );
});

test('bootstrapPlatformAdmin: refuses an email with no matching existing user - never creates one', async () => {
  await assert.rejects(
    () => bootstrapPlatformAdmin({ connect: false, argv: ['--email', 'nobody-here@example.com', '--confirm'], env: {} }),
    /no existing user found/,
  );
  assert.equal(await User.countDocuments({ email: 'nobody-here@example.com' }), 0);
});

test('bootstrapPlatformAdmin: valid email + --confirm promotes an existing user to platformAdmin', async () => {
  const user = await makeUser();
  assert.equal(user.platformAdmin, false);
  await bootstrapPlatformAdmin({ connect: false, argv: ['--email', user.email, '--confirm'], env: {} });
  assert.equal((await User.findById(user._id)).platformAdmin, true);
});

test('bootstrapPlatformAdmin: using the env-var form (PowerShell-safe) works identically', async () => {
  const user = await makeUser();
  await bootstrapPlatformAdmin({ connect: false, argv: [], env: { PLATFORM_ADMIN_EMAIL: user.email, PLATFORM_ADMIN_CONFIRM: 'true' } });
  assert.equal((await User.findById(user._id)).platformAdmin, true);
});

test('bootstrapPlatformAdmin: running it again on an already-promoted user is a safe no-op', async () => {
  const user = await makeUser({ platformAdmin: true });
  await bootstrapPlatformAdmin({ connect: false, argv: ['--email', user.email, '--confirm'], env: {} });
  assert.equal((await User.findById(user._id)).platformAdmin, true);
});
