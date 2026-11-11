/**
 * QA finding B2 - region data report / tidy-up.
 *
 * Reports every Egyptian Commercial project whose region is not one of the eight Rates matrix
 * regions (those projects cannot calculate until someone edits them and picks a region - never
 * guessed here), and the Rates matrix rows stored under a long alias label.
 *
 * With --apply it ONLY renames Rates matrix row labels to their canonical key (e.g. "Damanhour - Kafr
 * El Sheikh - Mansoura - Wadi El Natrun - Alexandria" -> "Damanhour - Kafr El Sheikh - Mansoura");
 * the rates themselves are untouched. This is optional: the engine already resolves the alias.
 * Project regions are never changed by this script.
 *
 *   npm run db:normalize-commercial-regions            # report only
 *   npm run db:normalize-commercial-regions -- --apply # also rename alias labels in the Rates matrix
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');
const { EGYPT_REGIONS, canonicalRegion } = require('../utils/commercial/regions');

async function run({ apply = process.argv.includes('--apply'), connect = true, log = console.log } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    await mongoose.connect(process.env.DB_URI);
    log(`Connected (db: ${assertSafeDatabaseName(mongoose.connection)}).`);
    await assertNotLeopardDatabase(mongoose.connection);
  }
  const db = mongoose.connection.db;
  const bad = await db.collection('commercialprojects').find({ country: 'Egypt', archived: { $ne: true }, region: { $nin: EGYPT_REGIONS } }, { projection: { projectCode: 1, name: 1, region: 1 } }).toArray();
  log(`\nEgyptian projects without a Rates matrix region (edit each one and choose its region): ${bad.length}`);
  bad.forEach(p => log(`  - ${p.projectCode} "${p.name}" region=${JSON.stringify(p.region)}`));

  const rates = await db.collection('commercialratesconfigs').find({}).toArray();
  let renamed = 0;
  for (const r of rates) {
    const fixed = r.regions.map(x => canonicalRegion(x) || x);
    const changes = r.regions.filter((x, i) => x !== fixed[i]);
    if (!changes.length) continue;
    log(`\nRates matrix (${r.country}) alias labels: ${changes.join('; ')}`);
    if (apply) {
      await db.collection('commercialratesconfigs').updateOne({ _id: r._id }, { $set: { regions: fixed } });
      renamed += changes.length;
      log('  -> renamed to the canonical keys (rates unchanged).');
    }
  }
  if (!apply) log('\nReport only - nothing changed.');
  return { projectsWithoutRegion: bad.length, renamed };
}

if (require.main === module) {
  run()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { run };
