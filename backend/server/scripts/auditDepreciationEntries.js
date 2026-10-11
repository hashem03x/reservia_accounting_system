/**
 * Audits existing depreciation / amortization postings against the fixed assets (see
 * services/fixedAssets/depreciationAuditService.js) and, with --yes, re-dates the posted
 * depreciation entries dated in the future (a month-end date given to a month still in progress,
 * which kept them out of the Trial Balance and every report up to today) to the date they were
 * posted. Nothing else is ever changed: every other finding is printed for manual review. The
 * original date is kept on each re-dated entry (`dateCorrection`). Idempotent.
 *
 * Usage:
 *   npm run db:audit-depreciation            # report only
 *   npm run db:audit-depreciation -- --yes   # apply the re-dating
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

async function auditDepreciationEntries() {
  const apply = process.argv.includes('--yes');

  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const { connection } = await mongoose.connect(process.env.DB_URI);
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);
  await assertNotLeopardDatabase(connection);

  const { auditDepreciation, repairFutureDatedDepreciation } = require('../services/fixedAssets/depreciationAuditService'); // eslint-disable-line global-require
  const now = new Date();
  const { checked, futureDated, issues } = await auditDepreciation({ now });

  console.log(`\nChecked ${checked.assets} fixed asset(s) with depreciation and ${checked.entries} depreciation entr${checked.entries === 1 ? 'y' : 'ies'}.`);
  console.log(`Posted depreciation entries dated in the future: ${futureDated.length}`);
  if (futureDated.length) console.table(futureDated.map(f => ({ entry: f.entryNumber, asset: f.asset.name, month: f.period, amount: f.amount, date: f.date, 'new date': f.newDate })));
  if (issues.length) {
    console.log(`\nLeft for manual accounting review (never changed by this script): ${issues.length}`);
    console.table(issues.map(i => ({ kind: i.kind, asset: i.asset?.name || '-', month: i.period || '-', entry: i.entryNumber ?? '-', detail: i.detail })));
  } else console.log('No other depreciation issues found.');

  if (!apply) {
    console.log('\nReport only: no changes made. Re-run with --yes to re-date the entries listed above.');
    return { applied: false, futureDated: futureDated.length, issues: issues.length };
  }

  const session = await mongoose.startSession();
  let changed = [];
  try {
    await session.withTransaction(async () => {
      changed = await repairFutureDatedDepreciation({ now, session });
    });
  } finally {
    session.endSession();
  }
  console.log(`\nRe-dated ${changed.length} entr${changed.length === 1 ? 'y' : 'ies'}.`);
  changed.forEach(c => console.log(`  #${c.entryNumber}: ${c.from} -> ${c.to}`));
  return { applied: true, changed: changed.length, issues: issues.length };
}

if (require.main === module) {
  auditDepreciationEntries()
    .then(() => mongoose.disconnect())
    .catch(async err => {
      console.error(err instanceof SafetyError ? `Refused: ${err.message}` : `Depreciation audit failed: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { auditDepreciationEntries };
