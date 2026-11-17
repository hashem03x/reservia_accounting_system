/**
 * Commercial Price Book migration (2026 QA fix: price-list matching created duplicate entries
 * when suppliers described the same product with different whitespace/capitalization/unit
 * formatting). Backfills `CommercialMaterialItem.keyNorm` - the canonical matching key
 * (utils/commercial/materialKey.js) - for every item saved before the field existed. Going
 * forward the model's own pre-save hook keeps it correct automatically; this script only ever
 * needs to run once per environment.
 *
 * Non-destructive: only ever $set's `keyNorm` - never touches `key`, price, or any other field.
 * Idempotent: an item that already has `keyNorm` is left untouched, so re-running (or running
 * against a partially-migrated database) is always safe.
 *
 * Two existing items that normalize to the SAME canonical key (a real pre-existing duplicate the
 * unique `keyNorm` index would otherwise reject) are reported, not silently merged or skipped -
 * only the FIRST is backfilled; the rest are listed under `collisions` for a human to review and
 * merge/archive deliberately.
 *
 * Usage:
 *   npm run db:migrate-commercial-material-key-norm
 *   npm run db:migrate-commercial-material-key-norm -- --dry-run
 */
const mongoose = require('mongoose');
const { loadEnv, SafetyError, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase } = require('./lib/dbSafety');

async function migrateCommercialMaterialKeyNorm({ dryRun = process.argv.includes('--dry-run'), connect = true } = {}) {
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
  const MaterialItem = require('../models/commercial/materialItemModel');
  // eslint-disable-next-line global-require
  const { canonicalMaterialKey } = require('../utils/commercial/materialKey');

  const candidates = await MaterialItem.find({ keyNorm: null }).select('_id brand model spec key').lean();
  console.log(`\nFound ${candidates.length} Price Book item(s) with no keyNorm yet.`);

  const seenInThisRun = new Map(); // keyNorm -> first _id backfilled
  const migrated = [];
  const collisions = [];

  for (const item of candidates) {
    const keyNorm = canonicalMaterialKey({ brand: item.brand, model: item.model, spec: item.spec });
    const already = seenInThisRun.get(keyNorm);
    if (already) {
      collisions.push({ keptId: already, duplicateId: item._id.toString(), brand: item.brand, model: item.model, spec: item.spec });
      continue; // eslint-disable-line no-continue
    }
    // eslint-disable-next-line no-await-in-loop
    if (!dryRun) await MaterialItem.updateOne({ _id: item._id }, { $set: { keyNorm } });
    seenInThisRun.set(keyNorm, item._id.toString());
    migrated.push({ id: item._id.toString(), brand: item.brand, model: item.model, spec: item.spec, keyNorm });
  }

  console.log(dryRun ? '--dry-run passed - no changes written.' : `Backfilled keyNorm on ${migrated.length} item(s).`);
  if (collisions.length) {
    console.log(`\n${collisions.length} pre-existing duplicate(s) found - NOT auto-merged, review and merge/archive manually:`);
    collisions.forEach(c => console.log(`  kept ${c.keptId}, duplicate ${c.duplicateId}: ${c.brand} ${c.model} (${c.spec || 'no spec'})`));
  }
  return { found: candidates.length, migrated, collisions };
}

if (require.main === module) {
  migrateCommercialMaterialKeyNorm()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\ndb:migrate-commercial-material-key-norm failed:');
      console.error(err instanceof SafetyError ? err.message : `${err.name}: ${err.message}`);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { migrateCommercialMaterialKeyNorm };
