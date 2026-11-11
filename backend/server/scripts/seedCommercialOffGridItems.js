/**
 * Adds the Off-Grid Price Book items (Lithium Batteries + Off-Grid Inverter) the Off-Grid engine
 * now prices from (QA finding U7). Source: services/commercial/catalogData/offGridCatalog.js.
 *
 * INSERT-ONLY: an item whose key already exists is left exactly as it is (a price someone edited in
 * the Price Book screen is never overwritten). Safe to re-run.
 *
 * Usage:
 *   npm run db:seed-commercial-offgrid -- --dry-run
 *   npm run db:seed-commercial-offgrid
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

function buildItems(catalog) {
  const items = [];
  const effectiveDate = new Date(catalog.SOURCE.effectiveDate);
  const push = (category, it, attrs) => {
    const key = `${it.brand} | ${it.model} | ${it.spec}`;
    items.push({
      category, brand: it.brand, model: it.model, spec: it.spec, unit: it.unit, unitPrice: it.price, currency: 'EGP',
      n1: it.n1 ?? null, n2: it.n2 ?? null, attrs, key, sourceWorkbook: catalog.SOURCE.sourceWorkbook, sourceSheet: 'Price Book',
      effectiveDate, priceHistory: [{ price: it.price, currency: 'EGP', effectiveDate }],
    });
  };
  catalog.LITHIUM_BATTERIES.forEach(b => push('Lithium Batteries', b, { voltageV: b.n1, capacityAh: b.n2 }));
  catalog.OFF_GRID_INVERTERS.forEach(i => push('Off-Grid Inverter', i, { ratedKw: i.n1 }));
  return items;
}

async function seedCommercialOffGridItems({ dryRun = process.argv.includes('--dry-run'), connect = true } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    await mongoose.connect(process.env.DB_URI);
    const dbName = assertSafeDatabaseName(mongoose.connection);
    console.log(`Connected (db: ${dbName}).`);
    await assertNotLeopardDatabase(mongoose.connection);
  }
  // eslint-disable-next-line global-require
  const MaterialItem = require('../models/commercial/materialItemModel');
  // eslint-disable-next-line global-require
  const catalog = require('../services/commercial/catalogData/offGridCatalog');
  const items = buildItems(catalog);
  const existing = new Set((await MaterialItem.find({ key: { $in: items.map(i => i.key) } }).select('key').lean()).map(i => i.key));
  const toInsert = items.filter(i => !existing.has(i.key));
  console.log(`${items.length} off-grid items in the catalog; ${existing.size} already present (left untouched); ${toInsert.length} to insert.`);
  if (!dryRun && toInsert.length) await MaterialItem.insertMany(toInsert, { ordered: false });
  if (dryRun) console.log('--dry-run: no changes made.');
  return { inserted: dryRun ? 0 : toInsert.length, skipped: existing.size };
}

if (require.main === module) {
  seedCommercialOffGridItems()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('db:seed-commercial-offgrid failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { seedCommercialOffGridItems, buildItems };
