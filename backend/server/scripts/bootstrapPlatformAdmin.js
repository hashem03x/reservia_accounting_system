/**
 * Central Business Portal - the ONLY way to grant the very first platform-wide `SUPER_ADMIN`
 * (docs section "Migration and compatibility" - "Provides a controlled way to establish the
 * initial platform administrator... Do not make the first existing user a super administrator
 * automatically without a verified, deliberate bootstrap process").
 *
 * Requires an EXISTING user's --email (never creates one) and an explicit --confirm flag - there
 * is no "first user ever" magic and no environment-variable-only path that could be left enabled
 * after initialization (the PLATFORM_ADMIN_CONFIRM env var below is just an alternate way to
 * supply the SAME one-shot, explicit confirmation for this one invocation - it is not read from
 * any persisted .env file convention, and nothing about it survives past this process exit).
 * Safe to run again on a user who is already a platform admin (no-op).
 *
 * ROOT CAUSE of "npm run ... -- --email ... --confirm fails with the usage message even though
 * both flags were given": on Windows PowerShell with npm 7+, `npm run <script> -- <args>` does
 * NOT reliably forward `--flag`-style tokens through to the invoked script - PowerShell's own
 * argv handling for the `npm` call strips recognized `--xxx` tokens before they ever reach
 * node, regardless of the flag's name (reproduced here with --email/--confirm AND with
 * arbitrary unrelated flag names - this is an environment/npm-CLI quirk, not specific to this
 * script's own flags). A BARE value with no flags (e.g. just the email) survives as a plain
 * positional argument; `--confirm` alone, having no value, leaves no trace at all once stripped.
 * The original parser was logically correct for well-formed argv - it simply had no way to
 * recover from argv that arrives already mangled. The fix below is defense in depth: it accepts
 * the historical `--email value` / `--confirm` form AND `--email=value` (a single token, less
 * likely to be split apart by any shell) AND a bare positional value as the email AND the
 * PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_CONFIRM environment variables (which are never subject to
 * this argv-stripping, since they bypass argv entirely) - while still requiring an unambiguous,
 * explicit confirmation signal before ever promoting anyone.
 *
 * Usage (any ONE of the following - all require an EXISTING user and explicit confirmation):
 *   node server/scripts/bootstrapPlatformAdmin.js --email you@example.com --confirm
 *   node server/scripts/bootstrapPlatformAdmin.js --email=you@example.com --confirm
 *   npm run db:bootstrap-platform-admin -- --email you@example.com --confirm   (POSIX shells)
 *   $env:PLATFORM_ADMIN_EMAIL="you@example.com"; $env:PLATFORM_ADMIN_CONFIRM="true"; npm run db:bootstrap-platform-admin   (PowerShell - recommended on Windows)
 */
const mongoose = require('mongoose');
const { loadEnv, SafetyError, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase } = require('./lib/dbSafety');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USAGE =
  'Usage: node server/scripts/bootstrapPlatformAdmin.js --email you@example.com --confirm\n' +
  '   or: node server/scripts/bootstrapPlatformAdmin.js --email=you@example.com --confirm\n' +
  '   or (PowerShell-safe): $env:PLATFORM_ADMIN_EMAIL="you@example.com"; $env:PLATFORM_ADMIN_CONFIRM="true"; npm run db:bootstrap-platform-admin';

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  let email;
  let confirm = false;
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--confirm') {
      confirm = true;
    } else if (token === '--email') {
      // Only consume the next token as the value if it isn't itself another flag - an
      // `--email` with no value right before `--confirm` must not silently swallow it.
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        email = argv[i + 1];
        i += 1;
      }
    } else if (token.startsWith('--email=')) {
      email = token.slice('--email='.length);
    } else if (!token.startsWith('--')) {
      // A bare value with no recognized flag - the npm/PowerShell quirk described above leaves
      // exactly this behind when it strips `--email`. Only ever used as a fallback email value,
      // never as an implicit confirmation.
      positionals.push(token);
    }
  }

  if (!email && positionals.length > 0) email = positionals[0];

  // Environment variables are immune to the argv-stripping above - the most reliable channel on
  // an affected shell. Argv (when it does arrive intact) still wins if both are somehow given.
  if (!email && env.PLATFORM_ADMIN_EMAIL) email = env.PLATFORM_ADMIN_EMAIL;
  if (!confirm && String(env.PLATFORM_ADMIN_CONFIRM).toLowerCase() === 'true') confirm = true;

  return { email: email?.trim(), confirm };
}

// `connect`/`argv`/`env` are injectable so tests can exercise the real function against their own
// already-open test database and synthetic argv/env, the same way test/project/sectors.test.js
// exercises scripts/seedSectors.js's `seedSectors({connect:false})` - never against a real DB_URI
// by accident.
async function bootstrapPlatformAdmin({ connect = true, argv, env } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
  }

  const { email, confirm } = parseArgs(argv, env);
  if (!email) {
    throw new SafetyError(USAGE);
  }
  if (!EMAIL_REGEX.test(email)) {
    throw new SafetyError(`"${email}" does not look like a valid email address. ${USAGE}`);
  }
  if (!confirm) {
    throw new SafetyError('Refusing to continue without --confirm (or PLATFORM_ADMIN_CONFIRM=true). This grants permanent platform-wide administrator access - confirm only once you have verified the email above is correct.');
  }

  let connection = mongoose.connection;
  if (connect) {
    console.log('Connecting to database...');
    const mongooseConn = await mongoose.connect(process.env.DB_URI);
    connection = mongooseConn.connection;
    const dbName = assertSafeDatabaseName(connection);
    console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);
  }

  await assertNotLeopardDatabase(connection);

  const User = require('../models/userModel');

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    throw new SafetyError(`Refusing to continue: no existing user found with email "${email}". This script never creates a user - create one first (e.g. npm run db:create-admin), then re-run this script.`);
  }

  if (user.platformAdmin) {
    console.log(`\nUser "${email}" is already a platform administrator. Nothing to do.`);
    return;
  }

  user.platformAdmin = true;
  await user.save();

  console.log(`\nGranted platform administrator access to "${email}" (role: ${user.role}).`);
  console.log('They can now sign in and manage system memberships at /portal/admin/users.');
}

if (require.main === module) {
  bootstrapPlatformAdmin()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:bootstrap-platform-admin failed:');
      if (err instanceof SafetyError) {
        console.error(err.message);
      } else {
        console.error(`${err.name}: ${err.message}`);
      }
      try {
        await mongoose.disconnect();
      } catch {
        // already disconnected / never connected
      }
      process.exit(1);
    });
}

module.exports = { bootstrapPlatformAdmin, parseArgs, EMAIL_REGEX };
