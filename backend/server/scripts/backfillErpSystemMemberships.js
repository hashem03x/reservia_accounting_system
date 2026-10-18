/**
 * Central Business Portal migration (docs section "Migration and compatibility").
 *
 * Backfills a `systemMemberships: [{system:'ERP', role:<their existing role>, isActive:true}]`
 * entry for every EXISTING staff account (role !== 'user' - i.e. admin/moderator/operator).
 * Customers (role: 'user') get nothing - they were never ERP users and must not become one by
 * accident. Idempotent: a user that already has an ERP entry is left completely untouched, so
 * running this script twice (or against a database some users have already been migrated on) is
 * always safe.
 *
 * This MUST run before (or in the same deploy as) the ERP-membership enforcement shipped in
 * middleware/hasPermission.js#checkUserPermissions and controller/user/authController.js#allowedTo
 * - skipping this step would lock every existing staff member out of the ERP the moment that
 * enforcement goes live.
 *
 * Usage:
 *   npm run db:backfill-erp-memberships
 *   npm run db:backfill-erp-memberships -- --dry-run
 */
const mongoose = require('mongoose');
const { loadEnv, SafetyError, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase } = require('./lib/dbSafety');

async function backfillErpSystemMemberships({ dryRun = process.argv.includes('--dry-run'), connect = true } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    console.log('Connecting to database...');
    await mongoose.connect(process.env.DB_URI);
  }
  const { connection } = mongoose;
  if (connect) {
    const dbName = assertSafeDatabaseName(connection);
    console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);
    await assertNotLeopardDatabase(connection);
  }

  // eslint-disable-next-line global-require
  const User = require('../models/userModel');

  const staffWithoutErpMembership = await User.find({
    role: { $ne: 'user' },
    'systemMemberships.system': { $ne: 'ERP' },
  }).select('_id name email role systemMemberships');

  console.log(`\nFound ${staffWithoutErpMembership.length} staff account(s) without an ERP membership entry.`);

  const migrated = [];
  if (!dryRun) {
    for (const user of staffWithoutErpMembership) {
      user.systemMemberships.push({ system: 'ERP', role: user.role, isActive: true });
      // eslint-disable-next-line no-await-in-loop
      await user.save();
      migrated.push(user.email || user.name);
    }
  }

  console.log(dryRun ? '--dry-run passed - no changes written.' : `Backfilled ERP membership for ${migrated.length} user(s).`);
  return { found: staffWithoutErpMembership.length, migrated };
}

if (require.main === module) {
  backfillErpSystemMemberships()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:backfill-erp-memberships failed:');
      console.error(err instanceof SafetyError ? err.message : `${err.name}: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { backfillErpSystemMemberships };
