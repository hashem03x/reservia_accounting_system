/**
 * Creates exactly one admin user (role: 'admin', which server/middleware/hasPermission.js grants
 * unconditional full access regardless of the `permissions` array - see checkUserPermissions)
 * so a freshly-initialized (db:init'd), otherwise-empty Reversia database has a way to log in.
 *
 * This is NOT business/demo data - it is the one bootstrap credential every real deployment
 * needs, created explicitly and once, not silently seeded as part of db:init.
 *
 * Usage:
 *   npm run db:create-admin -- --email you@example.com --name "Your Name"
 *   npm run db:create-admin -- --email you@example.com --name "Your Name" --password "..."
 *
 * If --password is omitted, a strong random password is generated and printed ONCE - copy it
 * immediately, then change it after your first login (PUT /api/v1/users/updateMyPassword). It is
 * never written to any file or log by this script.
 *
 * Refuses if a user with that email already exists, unless --force is passed (which resets that
 * user's role to 'admin' and its password to a newly generated one - printed the same way).
 * Refuses against a Leopard database, same as db:init/db:reset.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { loadEnv, SafetyError, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase } = require('./lib/dbSafety');

function parseArgs() {
  const args = { force: process.argv.includes('--force') };
  for (const flag of ['--email', '--name', '--password']) {
    const i = process.argv.indexOf(flag);
    if (i !== -1 && process.argv[i + 1]) args[flag.slice(2)] = process.argv[i + 1];
  }
  return args;
}

function generateStrongPassword() {
  // 18 random bytes -> 24-char base64url string: mixed-case letters, digits, -/_ - well above
  // the app's own minimum (userValidator.js requires >= 6), safe to hand to bcrypt as-is.
  return crypto.randomBytes(18).toString('base64url');
}

async function createAdminUser() {
  loadEnv();
  assertDbUriConfigured();

  const { email, name, password: passwordArg, force } = parseArgs();
  if (!email || !name) {
    throw new SafetyError('Usage: npm run db:create-admin -- --email you@example.com --name "Your Name" [--password "..."] [--force]');
  }

  console.log('Connecting to database...');
  const mongooseConn = await mongoose.connect(process.env.DB_URI);
  const connection = mongooseConn.connection;
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);

  await assertNotLeopardDatabase(connection);

  const User = require('../models/userModel');
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing && !force) {
    throw new SafetyError(
      `Refusing to continue: a user with email "${email}" already exists (role: "${existing.role}"). ` +
        'Pass --force to reset that user to role "admin" with a newly generated password instead.'
    );
  }

  const plaintextPassword = passwordArg || generateStrongPassword();
  const hashedPassword = await bcrypt.hash(plaintextPassword, 5);

  let user;
  if (existing) {
    existing.role = 'admin';
    existing.password = hashedPassword;
    existing.name = name;
    existing.isActive = true;
    existing.isDeleted = false;
    await existing.savePermissions();
    user = await existing.save();
    console.log(`\nUpdated existing user "${email}" to role "admin" and reset its password.`);
  } else {
    user = await User.create({ name, email: email.toLowerCase(), role: 'admin', type: 'online', password: hashedPassword });
    // Cosmetic/for completeness - hasPermission.js's checkUserPermissions already grants role
    // "admin" unconditional access regardless of this array, but keep the stored document
    // consistent with what the app's own createUser controller does for a new admin.
    await user.savePermissions();
    await user.save();
    console.log(`\nCreated admin user "${email}".`);
  }

  console.log('\n=====================================================================');
  console.log('  ADMIN LOGIN CREDENTIALS - copy these now, they will not be shown again');
  console.log('=====================================================================');
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${plaintextPassword}`);
  console.log('=====================================================================');
  console.log('  Log in, then change this password immediately from the Profile page.');
  console.log('=====================================================================\n');
}

createAdminUser()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async err => {
    console.error('\ndb:create-admin failed:');
    if (err instanceof SafetyError) {
      console.error(err.message);
    } else {
      console.error(`${err.name}: operation failed. Check DB_URI in config.env/.env.`);
    }
    try {
      await mongoose.disconnect();
    } catch {
      // already disconnected / never connected
    }
    process.exit(1);
  });
