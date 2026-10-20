/**
 * Diagnoses and (with --yes) repairs historical journal entry lines on a customer/vendor control
 * account (Accounts Receivable - Projects, Advances from Customers, Suppliers, Advances to
 * Suppliers) whose Sub Account is missing, the wrong kind, or names a party that no longer exists -
 * see services/accounting/subAccountRepairService.js for the full resolution rules. Only a line
 * whose Sub Account is entirely MISSING, and only when exactly one real party is named by either
 * the entry's own source document or a paired control-account line in the same entry, is ever
 * auto-fixed. A wrong-kind or unknown-number value is never touched - it is always left for manual
 * review, because it is an existing value, not an absence. No journal entry is re-created,
 * re-posted or duplicated; only lines.<i>.partyNumber/partyType are ever written.
 *
 * Report-only by default. Writes only with --yes.
 *
 * Usage:
 *   npm run db:repair-sub-accounts            # report only
 *   npm run db:repair-sub-accounts -- --yes   # apply the auto-fixable repairs
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

async function repairUnassignedSubAccounts() {
  const apply = process.argv.includes('--yes');

  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const { connection } = await mongoose.connect(process.env.DB_URI);
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);
  await assertNotLeopardDatabase(connection);

  const { diagnoseUnassignedSubAccounts, applySubAccountRepairs } = require('../services/accounting/subAccountRepairService'); // eslint-disable-line global-require
  const { checked, autoFixable, review } = await diagnoseUnassignedSubAccounts();

  const totalBy = (list, kind) => list.filter(r => r.kind === kind).reduce((s, r) => s + r.amount, 0);
  console.log(`\nChecked ${checked} journal entr${checked === 1 ? 'y' : 'ies'} touching a customer/vendor control account.`);
  console.log(`Auto-fixable (missing Sub Account, exactly one real party named by evidence): ${autoFixable.length} line(s), ${totalBy(autoFixable, 'missing').toFixed(2)} total.`);
  if (autoFixable.length)
    console.table(autoFixable.map(f => ({ entry: f.entryNumber, line: f.lineIndex + 1, type: f.requiredType, amount: f.amount, 'resolved to': f.resolvedNumber, evidence: f.evidence })));

  const reviewByKind = {};
  for (const r of review) {
    reviewByKind[r.kind] = reviewByKind[r.kind] || { count: 0, amount: 0 };
    reviewByKind[r.kind].count += 1;
    reviewByKind[r.kind].amount += r.amount;
  }
  console.log(`\nLeft for manual review (never changed by this script): ${review.length} line(s).`);
  if (review.length) {
    console.table(reviewByKind);
    console.table(review.map(r => ({ entry: r.entryNumber, line: r.lineIndex + 1, type: r.requiredType, kind: r.kind, amount: r.amount, existing: r.existingPartyNumber ?? '-', reason: r.reason || '-' })));
  }

  if (!apply) {
    console.log('\nReport only: no changes made. Re-run with --yes to apply the auto-fixable repairs listed above.');
    return { applied: false, autoFixable: autoFixable.length, review: review.length };
  }

  const results = await applySubAccountRepairs(autoFixable);
  const applied = results.filter(r => r.applied);
  const skipped = results.filter(r => !r.applied);
  console.log(`\nApplied ${applied.length} of ${autoFixable.length} repair(s).`);
  if (skipped.length) console.log(`Skipped ${skipped.length} (already had a Sub Account by the time this ran - not clobbered).`);
  return { applied: true, repaired: applied.length, skipped: skipped.length, review: review.length };
}

if (require.main === module) {
  repairUnassignedSubAccounts()
    .then(() => mongoose.disconnect())
    .catch(async err => {
      console.error(err instanceof SafetyError ? `Refused: ${err.message}` : `Sub Account repair failed: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { repairUnassignedSubAccounts };
