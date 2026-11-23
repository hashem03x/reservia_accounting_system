/**
 * Read-only audit: lists every existing `Payment` with `paymentCategory: 'transfer'` (made through
 * the old Transfer Money flow, before it posted any journal entry - see
 * services/accounting/moneyTransferService.js) that has no linked MONEY_TRANSFER journal entry.
 *
 * Never writes anything - no journal entry is fabricated or backfilled for a historical transfer.
 * The old flow recorded only the two Payment documents and never an amount/account breakdown
 * sufficient to safely reconstruct a correct, balanced entry after the fact (the free-text legacy
 * `paymentMethod` doesn't resolve to a real Chart of Accounts account), so any accounting catch-up
 * for the transfers listed here must be entered by an accountant through the normal Journal Entries
 * screen, using their own judgement of the correct accounts and date - never guessed by this script.
 *
 * Usage:
 *   node server/scripts/auditMoneyTransfers.js
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

async function auditMoneyTransfers() {
  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const { connection } = await mongoose.connect(process.env.DB_URI);
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);
  await assertNotLeopardDatabase(connection);

  // Raw collection reads (not the Mongoose models) - a read-only report never needs populate/hooks,
  // and this avoids any risk of a model's own save/validation hooks firing on a read.
  const payments = connection.collection('payments');
  const journalEntries = connection.collection('journalentries');
  const warehouses = connection.collection('warehouses');

  const transferPayments = await payments
    .find({ paymentCategory: 'transfer' }, { projection: { type: 1, amountPaid: 1, paymentMethod: 1, paymentAccount: 1, warehouseId: 1, createdAt: 1, notes: 1 } })
    .sort({ createdAt: 1 })
    .toArray();

  const linkedSourceIds = new Set(
    (await journalEntries.find({ accountingAction: 'MONEY_TRANSFER' }, { projection: { sourceId: 1 } }).toArray()).map(e => String(e.sourceId))
  );

  const warehouseNames = new Map((await warehouses.find({}, { projection: { name: 1 } }).toArray()).map(w => [String(w._id), w.name]));

  const missing = transferPayments.filter(p => !linkedSourceIds.has(String(p._id)));

  console.log(`\nExisting Transfer Money payments checked: ${transferPayments.length}.`);
  console.log(`Missing a linked MONEY_TRANSFER journal entry: ${missing.length}.`);
  if (missing.length) {
    console.table(
      missing.map(p => ({
        _id: String(p._id),
        type: p.type,
        warehouse: warehouseNames.get(String(p.warehouseId)) || String(p.warehouseId),
        amount: p.amountPaid,
        method: p.paymentMethod || (p.paymentAccount ? `account:${p.paymentAccount}` : '(none)'),
        date: p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : '-',
      }))
    );
    console.log(
      '\nThese were created by the old Transfer Money flow (legacy paymentMethod strings, no journal entry ever posted). ' +
        'Nothing has been changed. If Finance wants these reflected in the ledger retroactively, enter them by hand ' +
        'through the Journal Entries screen, one per transfer, with the correct accounts and date - never auto-backfilled ' +
        'here, since the account each leg actually moved is not reliably recoverable from the old free-text paymentMethod.'
    );
  } else {
    console.log('\nEvery Transfer Money payment already has a linked journal entry.');
  }

  return { checked: transferPayments.length, missing: missing.length };
}

if (require.main === module) {
  auditMoneyTransfers()
    .then(async () => {
      await mongoose.disconnect();
      console.log('\nDisconnected. Done.');
      process.exit(0);
    })
    .catch(async err => {
      console.error('\nauditMoneyTransfers failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      try {
        await mongoose.disconnect();
      } catch {
        // already disconnected / never connected - nothing to clean up
      }
      process.exit(1);
    });
}

module.exports = { auditMoneyTransfers };
