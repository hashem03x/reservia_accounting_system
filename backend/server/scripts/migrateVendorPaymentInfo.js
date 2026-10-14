/**
 * One-time, additive migration (docs section "Vendor Payment Information"): for every existing
 * Vendor with `bankInfo` data but no `paymentInfo.mode` set yet, copies the bank fields into the
 * new `paymentInfo.bank` structure and sets `paymentInfo.mode = 'bank'` - so existing vendors show
 * up correctly in the new "Payment Information" UI without re-entry.
 *
 * `bankInfo` itself is NEVER deleted, renamed, or modified by this script - it stays exactly as it
 * is, in full, for backward compatibility with anything still reading it directly. This only adds
 * the new `paymentInfo` field; nothing is removed.
 *
 * Idempotent and safe to run more than once: only vendors with bank data AND no `paymentInfo.mode`
 * yet are touched, so re-running after some vendors already have `paymentInfo` set (either by this
 * script or by editing them in the new UI) simply finds fewer (or zero) candidates each time.
 *
 * Usage:
 *   node server/scripts/migrateVendorPaymentInfo.js --dry-run   # report only, no writes
 *   node server/scripts/migrateVendorPaymentInfo.js --yes       # perform the migration
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

async function migrateVendorPaymentInfo() {
  const dryRun = !process.argv.includes('--yes');

  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const mongooseConn = await mongoose.connect(process.env.DB_URI);
  const connection = mongooseConn.connection;
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);

  await assertNotLeopardDatabase(connection);

  const vendors = connection.collection('vendors');

  const candidateFilter = {
    'paymentInfo.mode': { $in: [null, undefined] },
    $or: [
      { 'bankInfo.bankName': { $exists: true, $ne: null } },
      { 'bankInfo.accountNumber': { $exists: true, $ne: null } },
      { 'bankInfo.iban': { $exists: true, $ne: null } },
    ],
  };

  const candidates = await vendors.find(candidateFilter, { projection: { name: 1, bankInfo: 1 } }).toArray();
  console.log(`\nFound ${candidates.length} vendor(s) with bankInfo data and no paymentInfo.mode set yet.`);
  for (const v of candidates) {
    console.log(`  - [${v._id}] ${v.name || '(no name)'}`);
  }

  if (dryRun) {
    console.log('\n--dry-run (default): no changes made. Re-run with --yes to apply.');
    return { dryRun: true, candidates: candidates.length };
  }

  if (candidates.length === 0) {
    console.log('\nNothing to migrate.');
    return { dryRun: false, candidates: 0, modifiedCount: 0 };
  }

  let modifiedCount = 0;
  for (const v of candidates) {
    const bank = v.bankInfo || {};
    await vendors.updateOne(
      { _id: v._id },
      {
        $set: {
          'paymentInfo.mode': 'bank',
          'paymentInfo.bank.bankName': bank.bankName || null,
          'paymentInfo.bank.accountNumber': bank.accountNumber || null,
          'paymentInfo.bank.iban': bank.iban || null,
          'paymentInfo.bank.swiftCode': bank.swiftCode || null,
        },
      }
    );
    modifiedCount += 1;
  }

  console.log(`\nMigrated ${modifiedCount} of ${candidates.length} candidate(s). bankInfo left untouched on every document.`);
  return { dryRun: false, candidates: candidates.length, modifiedCount };
}

migrateVendorPaymentInfo()
  .then(async () => {
    await mongoose.disconnect();
    console.log('Disconnected. Done.');
    process.exit(0);
  })
  .catch(async err => {
    console.error('\nmigrateVendorPaymentInfo failed:');
    if (err instanceof SafetyError) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    try {
      await mongoose.disconnect();
    } catch {
      // already disconnected / never connected - nothing to clean up
    }
    process.exit(1);
  });
