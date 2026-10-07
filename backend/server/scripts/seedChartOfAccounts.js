/**
 * Seeds a minimal starter Chart of Accounts (Cash, Accounts Receivable, Unearned Revenue, Project
 * Revenue, Fixed Assets, Accounts Payable, Capital) so the new Projects/Journal Entries/Fixed
 * Assets modules are usable immediately - confirmed as wanted for this phase rather than shipping
 * with an empty Chart of Accounts (see docs/entities/accounting.md).
 *
 * Additive and idempotent by design, unlike db:init/db:reset:
 *  - Safe to run against a database that already has real data (does NOT require/assert an empty
 *    database - the whole point is to run this against the live Reversia database).
 *  - Upserts by `code` using $setOnInsert only, so re-running never overwrites an account an
 *    admin has already edited (name/type/isActive) - it only creates accounts that don't exist yet.
 *
 * Usage: npm run db:seed-accounts
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');
const { DefaultAccountCodes } = require('../utils/accountingConstants');

const STARTER_ACCOUNTS = [
  { code: DefaultAccountCodes.cash, name: 'Cash', type: 'asset' },
  { code: DefaultAccountCodes.accountsReceivable, name: 'Accounts Receivable', type: 'asset' },
  { code: DefaultAccountCodes.fixedAssets, name: 'Fixed Assets', type: 'asset' },
  { code: DefaultAccountCodes.accountsPayable, name: 'Accounts Payable', type: 'liability' },
  { code: DefaultAccountCodes.unearnedRevenue, name: 'Unearned Revenue', type: 'liability' },
  { code: DefaultAccountCodes.capital, name: 'Capital', type: 'equity' },
  { code: DefaultAccountCodes.projectRevenue, name: 'Project Revenue', type: 'revenue' },
];

async function seedChartOfAccounts() {
  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const mongooseConn = await mongoose.connect(process.env.DB_URI);
  const connection = mongooseConn.connection;
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);

  await assertNotLeopardDatabase(connection);

  const ChartOfAccount = require('../models/accounting/chartOfAccountModel');

  const results = [];
  for (const account of STARTER_ACCOUNTS) {
    const result = await ChartOfAccount.findOneAndUpdate(
      { code: account.code },
      { $setOnInsert: { ...account, isActive: true, isSystemDefault: true } },
      { upsert: true, new: true, rawResult: true }
    );
    const created = !result.lastErrorObject?.updatedExisting;
    results.push({ code: account.code, name: account.name, created });
    console.log(`  - ${account.code} ${account.name}: ${created ? 'created' : 'already exists, left untouched'}`);
  }

  const createdCount = results.filter(r => r.created).length;
  console.log(`\nSeed complete: ${createdCount} account(s) created, ${results.length - createdCount} already existed.`);
  return results;
}

seedChartOfAccounts()
  .then(async () => {
    await mongoose.disconnect();
    console.log('Disconnected. Done.');
    process.exit(0);
  })
  .catch(async err => {
    console.error('\ndb:seed-accounts failed:');
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
