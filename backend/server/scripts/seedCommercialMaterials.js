/**
 * Seeds the Commercial Price Book (CommercialMaterialItem) and the Egypt Rates Matrix
 * (CommercialRatesConfig) from the literal Excel extractions in
 * services/commercial/catalogData/*.js. Additive and idempotent - an existing item (matched by
 * its unique `key`) is never overwritten; re-running this script only inserts what's missing.
 *
 * Scope note: the Solar Pumping pump/motor catalogs (pumpingCatalog.js, 513 + 24 rows) are NOT
 * seeded into CommercialMaterialItem here. That catalog's flow/head/HP columns are engineering
 * selection data pumpingEngine.js matches against directly (see its own tests), not a simple
 * brand/model/price shape - forcing it into the generic Price Book schema would drop the
 * flow/head columns the nearest-match algorithm needs. Each UNIQUE pump/motor model's PRICE is
 * still seeded (deduplicated by model) so the Material Price List admin screen can list and edit
 * those prices; the flow/head/HP performance table itself stays versioned with the engine code.
 *
 * Usage:
 *   node server/scripts/seedCommercialMaterials.js
 *   node server/scripts/seedCommercialMaterials.js --dry-run
 */
const mongoose = require('mongoose');
const { loadEnv, assertDbUriConfigured, assertSafeDatabaseName, assertNotLeopardDatabase, SafetyError } = require('./lib/dbSafety');

async function seedCommercialMaterials({ dryRun = process.argv.includes('--dry-run'), connect = true } = {}) {
  if (connect) {
    loadEnv();
    assertDbUriConfigured();
    console.log('Connecting to database...');
    await mongoose.connect(process.env.DB_URI);
    const dbName = assertSafeDatabaseName(mongoose.connection);
    console.log(`Connected (host: ${mongoose.connection.host}, db: ${dbName}).`);
    await assertNotLeopardDatabase(mongoose.connection);
  }

  // eslint-disable-next-line global-require
  const MaterialItem = require('../models/commercial/materialItemModel');
  // eslint-disable-next-line global-require
  const RatesConfig = require('../models/commercial/ratesConfigModel');
  // eslint-disable-next-line global-require
  const onGrid = require('../services/commercial/catalogData/onGridCatalog');
  // eslint-disable-next-line global-require
  const pumping = require('../services/commercial/catalogData/pumpingCatalog');
  // eslint-disable-next-line global-require
  const pumpingExtras = require('../services/commercial/catalogData/pumpingExtras');

  await MaterialItem.init();
  await RatesConfig.init();

  const items = [];
  const EFFECTIVE_DATE = new Date('2026-11-04'); // the reference date stamped on the source Price Book items

  const push = (category, brand, modelName, spec, unit, price, n1, n2, sheet, attrs = {}) => {
    const key = `${brand} | ${modelName} | ${spec}`;
    items.push({ category, brand, model: modelName, spec, unit, unitPrice: price, n1: n1 ?? null, n2: n2 ?? null, attrs, sourceWorkbook: 'On_Grid.xlsx', sourceSheet: sheet, key, effectiveDate: EFFECTIVE_DATE });
  };

  // attrs carries the full datasheet so the Price Book stays the one editable source for BOTH
  // price and the technical specs the engines validate against (priceBookLookup.js#toEngineShape
  // reads these back out in the exact shape onGridEngine.js expects).
  onGrid.PV_MODULES.forEach(m => push('PV Modules', m.brand, m.model, `${m.pmaxW}W`, 'pcs', Math.round(m.pmaxW * m.pricePerWatt * 100) / 100, m.pmaxW, null, 'Material Price List', {
    pmaxW: m.pmaxW, vmp: m.vmp, imp: m.imp, voc: m.voc, isc: m.isc, vocTempCoeffPctPerC: m.vocTempCoeffPctPerC, maxDcV: m.maxDcV, pricePerWatt: m.pricePerWatt,
  }));
  onGrid.GRID_INVERTERS.forEach(i => push('On-Grid Inverter', i.brand, i.model, `${i.ratedKw} kW grid-tied`, 'pcs', i.price, i.ratedKw, null, 'Material Price List', {
    ratedKw: i.ratedKw, maxDcV: i.maxDcV, mpptMinV: i.mpptMinV, mpptMaxV: i.mpptMaxV, mpptCount: i.mpptCount, dcInputs: i.dcInputs, inputsPerMppt: i.inputsPerMppt, maxPvRecommendedKwp: i.maxPvRecommendedKwp,
  }));
  onGrid.DC_CABLES.forEach(c => push('DC Cable', c.brand, `${c.sizeMm2}mm2`, `${c.sizeMm2}mm2`, 'm', c.pricePerM, null, null, 'Material Price List', { sizeMm2: c.sizeMm2 }));
  onGrid.AC_BREAKERS.forEach(b => push('AC Breaker', 'Local', `${b.type} ${b.ratingA} A`, 'Reference price', 'pcs', b.price, b.ratingA, null, 'Material Price List', { ratingA: b.ratingA, type: b.type }));
  push('MC4 Connectors', 'Generic', 'MC4 PV connector', 'pcs', 'pcs', onGrid.MC4_CONNECTOR_PRICE_PER_PIECE, null, null, 'Material Price List');
  onGrid.AC_DISTRIBUTION_BOARDS.forEach(b => push('AC Distribution Board', 'Local', `ADB up to ${b.maxPvKwp} kWp`, b.dimensionsCm, 'pcs', b.price, b.maxPvKwp, null, 'Material Price List', { maxPvKwp: b.maxPvKwp, dimensionsCm: b.dimensionsCm }));
  Object.entries(onGrid.MOUNTING_STRUCTURE_RATES).forEach(([type, rate]) => push('Mounting Structure', 'Local', type, 'Rate per installed PV kWp', 'kWp', rate, null, null, 'Material Price List'));

  // Pump/motor prices only (deduplicated by model) - see the header note on why the full flow/
  // head/HP performance table is not forced into this schema.
  const seenPumpModels = new Set();
  for (const p of pumping.PUMPS) {
    if (seenPumpModels.has(p.model)) continue;
    seenPumpModels.add(p.model);
    items.push({
      category: 'Solar Pump Drive', brand: 'Generic', model: p.model, spec: `${p.casing} casing, ${p.hp} HP, ${p.outlet} outlet`,
      unit: 'pcs', unitPrice: p.price, n1: p.hp, n2: null, sourceWorkbook: 'Solar_Pumping3.xlsx', sourceSheet: 'Pump Price List',
      key: `Generic | ${p.model} | ${p.casing} casing`, effectiveDate: EFFECTIVE_DATE,
    });
  }
  pumping.MOTORS.forEach(m => items.push({
    category: 'Pump Motor', brand: 'Ferat/PMTech', model: m.model, spec: `${m.hp} HP, ${m.casing}" casing, cast iron`,
    unit: 'pcs', unitPrice: m.castIronPrice, n1: m.hp, n2: m.kw, sourceWorkbook: 'Solar_Pumping3.xlsx', sourceSheet: 'Motor Price List',
    key: `Ferat/PMTech | ${m.model} | ${m.casing}in cast iron`, effectiveDate: EFFECTIVE_DATE,
  }));
  pumpingExtras.PUMPING_DC_CABLES.forEach(c => items.push({
    category: 'DC Cable', brand: c.brand, model: `${c.sizeMm2}mm2`, spec: `${c.sizeMm2}mm2`, unit: 'm', unitPrice: c.pricePerM,
    sourceWorkbook: 'Solar_Pumping3.xlsx', sourceSheet: 'DC Cable Price List', key: `${c.brand} | Pumping ${c.sizeMm2}mm2 | ${c.sizeMm2}mm2`, effectiveDate: EFFECTIVE_DATE,
  }));

  let created = 0;
  let skipped = 0;
  for (const item of items) {
    if (dryRun) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await MaterialItem.exists({ key: item.key });
      if (exists) skipped += 1; else created += 1;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const res = await MaterialItem.updateOne({ key: item.key }, { $setOnInsert: item }, { upsert: true });
    if (res.upsertedCount) created += 1; else skipped += 1;
  }
  console.log(`Material items: ${created} created, ${skipped} already present.`);

  const ratesDoc = {
    country: 'Egypt',
    regions: onGrid.EGYPT_REGIONS,
    installRatesEgpPerKwpByRegion: onGrid.EGYPT_REGIONS.map(r => onGrid.INSTALL_RATES_BY_REGION[r]),
    transportRatesEgpByRegion: onGrid.EGYPT_REGIONS.map(r => onGrid.TRANSPORT_RATES_BY_REGION[r]),
    mountingStructureRatesEgpPerKwp: onGrid.MOUNTING_STRUCTURE_RATES,
    earthingRateEgpPerKwp: 100,
    accessoriesRateEgpPerKwp: 85,
    dcCableRouteMPerKwp: 8, // On-Grid Design!D26's 8 m/kWp route allowance
    effectiveDate: EFFECTIVE_DATE,
  };
  if (dryRun) {
    const existingRates = await RatesConfig.exists({ country: 'Egypt' });
    console.log(existingRates ? 'Egypt Rates Matrix already present.' : 'Would create the Egypt Rates Matrix.');
  } else {
    const existingRates = await RatesConfig.findOne({ country: 'Egypt' });
    if (!existingRates) {
      await RatesConfig.create(ratesDoc);
      console.log('Created the Egypt Rates Matrix.');
    } else {
      console.log('Egypt Rates Matrix already present - left unchanged.');
    }
  }

  return { materialsCreated: created, materialsSkipped: skipped };
}

if (require.main === module) {
  seedCommercialMaterials()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async err => {
      console.error('\nseedCommercialMaterials failed:');
      console.error(err instanceof SafetyError ? err.message : err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = { seedCommercialMaterials };
