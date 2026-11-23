/**
 * One-time, additive migration (CMS page localized URLs): every existing WebsitePage's single,
 * shared `path` (e.g. "/about", used for both /en/about and /ar/about) is split into `pathEn` and
 * `pathAr`. Both start out equal to the OLD shared path - every existing URL in both languages
 * keeps working exactly as it did before this ships; nothing becomes inaccessible. An editor can
 * then give either language its own real localized path through the page editor's new English
 * Path / Arabic Path inputs, at their own pace, page by page.
 *
 * The legacy `path` field is removed once copied (the model no longer declares it - see
 * websitePageModel.js) so nothing can accidentally keep reading the shared value.
 *
 * Idempotent and safe to run more than once: only documents that still have the legacy `path`
 * field (and no `pathEn`/`pathAr` yet) are touched.
 *
 * Usage:
 *   node server/scripts/migrateWebsitePageLocalizedPaths.js --dry-run   # report only, no writes
 *   node server/scripts/migrateWebsitePageLocalizedPaths.js --yes       # perform the migration
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

async function migrateWebsitePageLocalizedPaths() {
  const dryRun = !process.argv.includes('--yes');

  loadEnv();
  assertDbUriConfigured();

  console.log('Connecting to database...');
  const { connection } = await mongoose.connect(process.env.DB_URI);
  const dbName = assertSafeDatabaseName(connection);
  console.log(`Connected (host: ${connection.host}, db: ${dbName}).`);
  await assertNotLeopardDatabase(connection);

  const pages = connection.collection('websitepages');
  const candidates = await pages.find({ path: { $exists: true } }).project({ slug: 1, path: 1, pathEn: 1, pathAr: 1 }).toArray();

  console.log(`\nWebsitePage documents with a legacy shared "path": ${candidates.length}.`);
  if (candidates.length) {
    console.table(candidates.map(p => ({ _id: String(p._id), slug: p.slug, 'old path': p.path, 'new pathEn': p.path, 'new pathAr': p.path })));
  }

  if (dryRun) {
    console.log('\nDry run: no changes made. Re-run with --yes to apply.');
    return { dryRun: true, candidates: candidates.length };
  }

  let migrated = 0;
  for (const p of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const res = await pages.updateOne({ _id: p._id, path: { $exists: true } }, { $set: { pathEn: p.path, pathAr: p.path }, $unset: { path: '' } });
    if (res.modifiedCount === 1) migrated += 1;
  }
  console.log(`\nMigrated ${migrated} page(s).`);
  return { dryRun: false, migrated };
}

if (require.main === module) {
  migrateWebsitePageLocalizedPaths()
    .then(async () => {
      await mongoose.disconnect();
      console.log('\nDisconnected. Done.');
      process.exit(0);
    })
    .catch(async err => {
      console.error('\nmigrateWebsitePageLocalizedPaths failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      try {
        await mongoose.disconnect();
      } catch {
        // already disconnected / never connected - nothing to clean up
      }
      process.exit(1);
    });
}

module.exports = { migrateWebsitePageLocalizedPaths };
