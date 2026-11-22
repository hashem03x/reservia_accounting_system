/**
 * Creates the dedicated TEST Global Super Administrator (Feature 5) - an account that bypasses
 * system-membership checks AND specific business-workflow restrictions (CRM stage transitions via
 * the existing MD-override path, Deal Engine approval-role checks via a logged override - see
 * utils/systemAccess.js#isGlobalSuperAdmin and its call sites) for end-to-end platform testing.
 *
 * SAFETY, by explicit requirement:
 *   - Refuses outright against anything that looks like a production database (an Atlas SRV
 *     connection string, or a hostname under mongodb.net). There is no override flag for this -
 *     if the target really is production, that is a separate, explicitly-authorized action this
 *     script will never perform automatically.
 *   - The initial password is read ONLY from the SUPER_ADMIN_BOOTSTRAP_PASSWORD environment
 *     variable - never a CLI flag (shell history), never hardcoded here. Not logged, not printed.
 *   - Still requires an explicit --confirm (or SUPER_ADMIN_BOOTSTRAP_CONFIRM=true), same convention
 *     as bootstrapPlatformAdmin.js, for a deliberate, unambiguous action.
 *   - Sets mustChangePassword: true - the bootstrap password must be changed at first login
 *     (PUT /api/v1/users/updateMyPassword clears the flag on any successful change).
 *   - Safe to re-run: if the account already exists, only flips globalSuperAdmin on (and
 *     mustChangePassword, if the account has never actually changed its password) - never resets
 *     an already-chosen password.
 *
 * Usage (PowerShell-safe - env vars, not argv, carry the real values):
 *   $env:SUPER_ADMIN_BOOTSTRAP_PASSWORD="<the initial password>"
 *   $env:SUPER_ADMIN_BOOTSTRAP_CONFIRM="true"
 *   npm run db:bootstrap-super-admin
 *
 *   (--email=<email> overrides the default superadmin@reservia.com; --confirm also works in place
 *   of the CONFIRM env var on shells where argv survives intact.)
 */
const mongoose = require('mongoose');
const { loadEnv, SafetyError, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase } = require('./lib/dbSafety');

const DEFAULT_EMAIL = 'superadmin@reservia.com';
const PRODUCTION_SHAPED_URI = /mongodb\+srv:\/\/|\.mongodb\.net/i;

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  let email = DEFAULT_EMAIL;
  let confirm = false;
  for (const token of argv) {
    if (token === '--confirm') confirm = true;
    else if (token.startsWith('--email=')) email = token.slice('--email='.length);
  }
  if (!confirm && String(env.SUPER_ADMIN_BOOTSTRAP_CONFIRM).toLowerCase() === 'true') confirm = true;
  return { email: email.trim().toLowerCase(), confirm, password: env.SUPER_ADMIN_BOOTSTRAP_PASSWORD };
}

async function bootstrapSuperAdmin({ connect = true, argv, env = process.env } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
  }

  const { email, confirm, password } = parseArgs(argv, env);

  if (PRODUCTION_SHAPED_URI.test(process.env.DB_URI || '')) {
    throw new SafetyError(
      'STOPPING: the configured DB_URI looks like a production database (Atlas SRV / mongodb.net host). ' +
        'The Global Super Admin is a TEST account and this script never provisions it against production automatically. ' +
        'If you genuinely want this account in production, that needs your own separate, explicit authorization - this script will not do it for you.'
    );
  }
  if (!password) {
    throw new SafetyError('Set SUPER_ADMIN_BOOTSTRAP_PASSWORD (environment variable, not a CLI flag) to the initial password before running this script.');
  }
  if (!confirm) {
    throw new SafetyError('Refusing to continue without --confirm (or SUPER_ADMIN_BOOTSTRAP_CONFIRM=true). This grants a powerful, cross-system testing account - confirm only once you have verified this is the intended (non-production) database.');
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
  let user = await User.findOne({ email });

  if (user) {
    if (user.globalSuperAdmin) {
      console.log(`\nUser "${email}" is already a Global Super Admin. Nothing to do.`);
      return;
    }
    user.globalSuperAdmin = true;
    // Only force a password change if this account has never actually logged in/changed its own
    // password yet - never reset or disrupt an account that is already in real use.
    if (!user.passwordChangedAt) user.mustChangePassword = true;
    await user.save();
    console.log(`\nGranted Global Super Admin to the existing user "${email}".`);
  } else {
    user = await User.create({
      name: 'Super Admin (Test)',
      email,
      role: 'admin',
      type: 'online',
      password,
      globalSuperAdmin: true,
      mustChangePassword: true,
    });
    await user.savePermissions();
    await user.save();
    console.log(`\nCreated Global Super Admin "${email}".`);
  }

  console.log('\n=====================================================================');
  console.log('  Log in with the email above and the SUPER_ADMIN_BOOTSTRAP_PASSWORD you set.');
  console.log('  The account must change its password immediately (mustChangePassword: true).');
  console.log('  The password itself is never printed by this script.');
  console.log('=====================================================================\n');
}

if (require.main === module) {
  bootstrapSuperAdmin()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:bootstrap-super-admin failed:');
      console.error(err instanceof SafetyError ? err.message : `${err.name}: ${err.message}`);
      try {
        await mongoose.disconnect();
      } catch {
        // already disconnected / never connected
      }
      process.exit(1);
    });
}

module.exports = { bootstrapSuperAdmin, parseArgs, DEFAULT_EMAIL, PRODUCTION_SHAPED_URI };
