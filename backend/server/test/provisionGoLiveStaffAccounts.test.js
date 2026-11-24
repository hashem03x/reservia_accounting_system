const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../scripts/provisionGoLiveStaffAccounts');

// Pure-function tests for scripts/provisionGoLiveStaffAccounts.js's argument parsing - no DB
// connection, no process.exit, nothing that touches a real database. Exists because the first
// shipped version of this script was reported stuck in dry-run mode even with --yes passed both
// directly to node and through `npm run ... -- --yes` - root cause: npm reserves its own global
// `--yes`/`-y` config flag (the one `npm init`/`npx` use to auto-confirm), which on some npm/shell
// combinations intercepts a bare `--yes` before it ever reaches this script's own argv, even past
// the `--` separator. These tests lock in the fix: a pure, well-tested parser that never silently
// falls back to dry-run on bad input, plus an env-var trigger immune to any shell/npm quirk.

test('no arguments: defaults to dry run', () => {
  assert.deepEqual(parseArgs([]), { apply: false, dryRun: true, updateExisting: false, resetPassword: false, mennaEmail: null });
});

test('--yes alone: activates apply mode', () => {
  const result = parseArgs(['--yes']);
  assert.equal(result.apply, true);
  assert.equal(result.dryRun, false);
});

test('a stray leading "--" separator before --yes is normalized, not rejected (the exact npm -- --yes shape)', () => {
  const result = parseArgs(['--', '--yes']);
  assert.equal(result.apply, true);
  assert.equal(result.dryRun, false);
});

test('--dry-run explicitly: stays a dry run', () => {
  const result = parseArgs(['--dry-run']);
  assert.equal(result.apply, false);
  assert.equal(result.dryRun, true);
});

test('GOLIVE_STAFF_APPLY=true env var alone: activates apply mode exactly like --yes, with no argv at all', () => {
  const result = parseArgs([], { GOLIVE_STAFF_APPLY: 'true' });
  assert.equal(result.apply, true);
  assert.equal(result.dryRun, false);
});

test('GOLIVE_STAFF_APPLY=true is some OTHER truthy-looking string (not the literal "true"): does not activate apply mode', () => {
  const result = parseArgs([], { GOLIVE_STAFF_APPLY: '1' });
  assert.equal(result.apply, false);
});

test('--dry-run always wins over the env var - an explicit dry run can never be silently upgraded to apply', () => {
  const result = parseArgs(['--dry-run'], { GOLIVE_STAFF_APPLY: 'true' });
  assert.equal(result.apply, false);
  assert.equal(result.dryRun, true);
});

test('--yes together with --dry-run is a contradiction - rejected outright, never silently resolved either way', () => {
  assert.throws(() => parseArgs(['--yes', '--dry-run']), /contradictory/);
});

test('an unrecognized argument is a hard error naming every accepted flag - never a silent fallback to dry run', () => {
  assert.throws(() => parseArgs(['--bogus']), err => {
    assert.match(err.message, /Unrecognized argument "--bogus"/);
    assert.match(err.message, /--yes/);
    assert.match(err.message, /--update-existing/);
    assert.match(err.message, /GOLIVE_STAFF_APPLY/);
    return true;
  });
});

test('a misspelled flag (e.g. --yess) is rejected, not silently ignored', () => {
  assert.throws(() => parseArgs(['--yess']), /Unrecognized argument "--yess"/);
});

test('--menna-email with a real value is accepted and carried through', () => {
  const result = parseArgs(['--yes', '--menna-email', 'menna@reservia.com']);
  assert.equal(result.mennaEmail, 'menna@reservia.com');
});

test('--menna-email with no value (end of argv) is a clear error, not silently treated as unset', () => {
  assert.throws(() => parseArgs(['--yes', '--menna-email']), /--menna-email requires a value/);
});

test('--menna-email immediately followed by another flag (missing value) is a clear error', () => {
  assert.throws(() => parseArgs(['--yes', '--menna-email', '--update-existing']), /--menna-email requires a value/);
});

test('--update-existing and --reset-password combine correctly alongside --yes', () => {
  const result = parseArgs(['--yes', '--update-existing', '--reset-password']);
  assert.equal(result.apply, true);
  assert.equal(result.updateExisting, true);
  assert.equal(result.resetPassword, true);
});

test('flag order does not matter', () => {
  const a = parseArgs(['--update-existing', '--yes', '--menna-email', 'x@reservia.com']);
  const b = parseArgs(['--menna-email', 'x@reservia.com', '--yes', '--update-existing']);
  assert.deepEqual(a, b);
});
