const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../../services/commercial/utilityEngine');
const catalog = require('../../services/commercial/catalogData/onGridCatalog');

const JINKO_475 = catalog.PV_MODULES.find(m => m.model === 'JKM475M-7RL3');

test('Utility-Scale reuses the On-Grid equipment chain and adds 11 manual adder lines, all unpriced by default', () => {
  const result = engine.runUtilityScaleDesign(
    {
      kWp: 80, module: JINKO_475, inverterCandidates: catalog.GRID_INVERTERS, structureType: 'Hangar Roof',
      modulesPerStringOverride: 14, acLengthM: 20, country: 'Egypt', region: 'Cairo - 10th of Ramadan',
    },
    catalog
  );
  const adders = result.boq.lines.filter(l => l.source === 'manual');
  assert.equal(adders.length, 11);
  assert.ok(adders.every(l => l.total === null));
  // Equipment total is unaffected by the (unentered) manual adders.
  assert.equal(result.boq.total, 1179007.5);
});

test('Manually entered adder amounts DO flow into the BOQ total (not silently dropped)', () => {
  const result = engine.runUtilityScaleDesign(
    {
      kWp: 80, module: JINKO_475, inverterCandidates: catalog.GRID_INVERTERS, structureType: 'Hangar Roof',
      modulesPerStringOverride: 14, acLengthM: 20, country: 'Egypt', region: 'Cairo - 10th of Ramadan',
    },
    catalog,
    { 16: { qty: 1, unitPrice: 50000 } } // SCADA system quoted manually
  );
  assert.equal(result.boq.total, 1179007.5 + 50000);
});
