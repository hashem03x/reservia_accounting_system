/**
<<<<<<< HEAD
 * Safe initialization of the Currency master (Currency Management): creates EGP as the base
 * currency (rate 1, isBaseCurrency true, isActive true) if it does not already exist. Additive and
 * idempotent, like db:seed-sectors - never edits, deactivates or deletes an existing currency, and
 * never touches EGP if it already exists (its immutability is also enforced at the model layer -
 * see currencyModel.js - this script is just the one-time bootstrap).
 *
 * Usage:
 *   npm run db:seed-currencies            # create EGP if missing
=======
 * Creates the EGP base currency of the Currency Manager (Accounting -> Currencies) if it does not
 * exist yet. Additive and idempotent: an existing EGP record is never edited, and no foreign
 * currency or exchange rate is invented - foreign currencies and their rates are entered by an
 * administrator. (The API also creates EGP on first use, so running this is optional; it makes the
 * base currency exist before anyone opens the page.)
 *
 * Existing journal entries need no migration: an entry without a currency reads as EGP @ 1.
 *
 * Usage:
 *   npm run db:seed-currencies
>>>>>>> origin/main
 *   npm run db:seed-currencies -- --dry-run   # report only
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

async function seedCurrencies({ dryRun = process.argv.includes('--dry-run'), connect = true } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    console.log('Connecting to database...');
    await mongoose.connect(process.env.DB_URI);
<<<<<<< HEAD
  }
  const { connection } = mongoose;
  if (connect) {
    const dbName = assertSafeDatabaseName(connection);
    console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);
    await assertNotLeopardDatabase(connection);
  }

  const Currency = require('../models/accounting/currencyModel'); // eslint-disable-line global-require
  await Currency.init(); // unique indexes (code, partial base-currency) must exist before inserting

  const existing = await Currency.findOne({ code: 'EGP' }).lean();
  if (existing) {
    console.log('EGP already exists - nothing to do.');
    return { created: false };
  }

  console.log(dryRun ? 'Would create EGP as the base currency (rate 1).' : 'Creating EGP as the base currency (rate 1)...');
  if (!dryRun) {
    await Currency.create({ code: 'EGP', name: 'Egyptian Pound', symbol: 'ج.م', isBaseCurrency: true, rate: 1, isActive: true });
  }
  if (dryRun) console.log('\n--dry-run: no changes made.');
  return { created: !dryRun };
=======
    const dbName = assertSafeDatabaseName(mongoose.connection);
    console.log(`Connected (host: ${mongoose.connection.host}, db: ${dbName}).`);
    await assertNotLeopardDatabase(mongoose.connection);
  }

  // eslint-disable-next-line global-require
  const Currency = require('../models/accounting/currencyModel');
  await Currency.init(); // unique code / single-base indexes must exist before inserting

  const existing = await Currency.findOne({ code: 'EGP' }).lean();
  if (existing) {
    console.log('EGP base currency already exists - nothing to do.');
    return { created: false };
  }
  if (dryRun) {
    console.log('Would create the EGP base currency (rate 1).\n--dry-run: no changes made.');
    return { created: false };
  }
  // eslint-disable-next-line global-require
  await require('../services/accounting/currencyService').ensureBaseCurrency();
  console.log('Created the EGP base currency (rate 1).');
  return { created: true };
>>>>>>> origin/main
}

if (require.main === module) {
  seedCurrencies()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:seed-currencies failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { seedCurrencies };
