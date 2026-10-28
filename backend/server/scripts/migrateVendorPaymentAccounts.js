/**
 * Copies each vendor's existing single payment method (`paymentInfo`, and the older `bankInfo`)
 * into the new multi-account list `paymentAccounts` (utils/vendorPaymentAccounts.js), so vendors
 * created before multiple accounts existed show their account in the new Payment Accounts section.
 *
 * Additive and idempotent:
 *   - only vendors whose `paymentAccounts` is still EMPTY are touched, and only that field is set
 *     (paymentInfo / bankInfo are never modified or deleted);
 *   - running it again changes nothing.
 * The method `paymentInfo.mode` selected becomes the primary account. A legacy value that does not
 * pass today's rules (e.g. a bank with no account number / IBAN) is reported, not invented around.
 *
 * Usage:
 *   npm run db:migrate-vendor-payment-accounts -- --dry-run   # report only
 *   npm run db:migrate-vendor-payment-accounts               # apply
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');
const { accountsFromLegacy } = require('../utils/vendorPaymentAccounts');

async function migrateVendorPaymentAccounts({ dryRun = process.argv.includes('--dry-run'), connect = true, log = console.log } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    log('Connecting to database...');
    await mongoose.connect(process.env.DB_URI);
    const dbName = assertSafeDatabaseName(mongoose.connection);
    log(`Connected (host: ${mongoose.connection.host}, db: ${dbName}).`);
    await assertNotLeopardDatabase(mongoose.connection);
  }

  const vendors = mongoose.connection.collection('vendors');
  const candidates = await vendors
    .find({ $or: [{ paymentAccounts: { $exists: false } }, { paymentAccounts: { $size: 0 } }] }, { projection: { name: 1, vendorNumber: 1, paymentInfo: 1, bankInfo: 1 } })
    .toArray();

  const result = { scanned: candidates.length, migrated: 0, accountsCreated: 0, nothingToMigrate: 0, skipped: [] };
  for (const vendor of candidates) {
    const accounts = accountsFromLegacy({ paymentInfo: vendor.paymentInfo, bankInfo: vendor.bankInfo }).map(a => ({
      ...a,
      _id: new mongoose.Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const hadSomething = !!(vendor.paymentInfo?.mode || vendor.bankInfo?.bankName || vendor.bankInfo?.accountNumber);
    if (!accounts.length) {
      if (hadSomething) result.skipped.push({ vendorNumber: vendor.vendorNumber, name: vendor.name, reason: 'payment details are incomplete (e.g. a bank without account number / IBAN) - add the account by hand' });
      else result.nothingToMigrate += 1;
      continue;
    }
    result.migrated += 1;
    result.accountsCreated += accounts.length;
    if (!dryRun) {
      // The empty-list condition is repeated in the update itself, so a concurrent edit (or a second
      // run) can never overwrite accounts that were added in the meantime.
      await vendors.updateOne({ _id: vendor._id, $or: [{ paymentAccounts: { $exists: false } }, { paymentAccounts: { $size: 0 } }] }, { $set: { paymentAccounts: accounts } });
    }
  }

  log(`Vendors without payment accounts: ${result.scanned}`);
  log(`${dryRun ? 'Would migrate' : 'Migrated'}: ${result.migrated} vendor(s), ${result.accountsCreated} account(s)`);
  log(`No legacy payment details: ${result.nothingToMigrate}`);
  log(`Skipped (incomplete legacy details): ${result.skipped.length}`);
  result.skipped.forEach(s => log(`  - #${s.vendorNumber} ${s.name}: ${s.reason}`));
  if (dryRun) log('\n--dry-run: no changes made.');
  return result;
}

if (require.main === module) {
  migrateVendorPaymentAccounts()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:migrate-vendor-payment-accounts failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { migrateVendorPaymentAccounts };
