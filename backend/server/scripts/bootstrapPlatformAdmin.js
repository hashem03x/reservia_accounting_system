/**
 * Central Business Portal - the ONLY way to grant the very first platform-wide `SUPER_ADMIN`
 * (docs section "Migration and compatibility" - "Provides a controlled way to establish the
 * initial platform administrator... Do not make the first existing user a super administrator
 * automatically without a verified, deliberate bootstrap process").
 *
 * Requires an EXISTING user's --email (never creates one) and an explicit --confirm flag - there
 * is no "first user ever" magic and no environment-variable-only path that could be left enabled
 * after initialization. Safe to run again on a user who is already a platform admin (no-op).
 *
 * Usage:
 *   npm run db:bootstrap-platform-admin -- --email you@example.com --confirm
 */
const mongoose = require('mongoose');
const { loadEnv, SafetyError, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase } = require('./lib/dbSafety');

function parseArgs() {
  const args = { confirm: process.argv.includes('--confirm') };
  const i = process.argv.indexOf('--email');
  if (i !== -1 && process.argv[i + 1]) args.email = process.argv[i + 1];
  return args;
}

async function bootstrapPlatformAdmin() {
  loadEnv();
  assertDbUriConfigured();

  const { email, confirm } = parseArgs();
  if (!email) {
    throw new SafetyError('Usage: npm run db:bootstrap-platform-admin -- --email you@example.com --confirm');
  }
  if (!confirm) {
    throw new SafetyError('Refusing to continue without --confirm. This grants permanent platform-wide administrator access - pass --confirm once you have verified the email above is correct.');
  }

  console.log('Connecting to database...');
  const mongooseConn = await mongoose.connect(process.env.DB_URI);
  const connection = mongooseConn.connection;
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);

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
