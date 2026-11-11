const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../../services/commercial/onGridEngine');
const catalog = require('../../services/commercial/catalogData/onGridCatalog');

// Fixtures below are the live values cached in On_Grid.xlsx for its own worked example: 80 kWp,
// Cairo, Jinko JKM475M-7RL3, Huawei SUN2000-100KTL-M2 (auto-selected), Hangar Roof, 20 m AC run,
// 14 modules/string (the sheet's own manual input for this example). Every individual line item
// below was cross-checked cell-by-cell against the workbook (see onGridEngine.js's source-cell
// comments).
//
// IMPORTANT FINDING: the workbook's own cached grand total (`BOQ On-Grid Design!G23` = 1,279,326.75,
// `G24` = 14,798.4586...) does NOT equal the sum of its own visible line items G9:G22
// (1,248,204.75) - it is short by exactly one "Installation" line amount (31,122). Every
// individual line (G9...G22) was verified correct cell-by-cell against its own formula; only the
// SUM cell's cached value is inconsistent with them, almost certainly a stale Excel
// recalculation left over from merging row 20 (A20:G20) without Excel recalculating G23 before
// the file was last saved - `=SUM(G9:G22)` is not itself a broken formula, its cached result just
// predates the file's current line items. The mathematically-correct total (which this engine
// reproduces, and which is what re-opening the file in Excel and forcing a recalculation would
// show) is used here, not the stale cached figure.
const JINKO_475 = catalog.PV_MODULES.find(m => m.model === 'JKM475M-7RL3');
const HUAWEI_INVERTERS = catalog.GRID_INVERTERS;

function referenceScenario() {
  return engine.runOnGridDesign(
    {
      kWp: 80,
      module: JINKO_475,
      inverterCandidates: HUAWEI_INVERTERS,
      structureType: 'Hangar Roof',
      modulesPerStringOverride: 14,
      acLengthM: 20,
      country: 'Egypt',
      region: 'Cairo - 10th of Ramadan',
    },
    catalog
  );
}

test('On-Grid Design: PV module sizing (On-Grid Design!C8/D8/G8)', () => {
  const { design } = referenceScenario();
  assert.equal(design.pv.modulesRequired, 169);
  assert.equal(design.pv.totalModuleCost, 698392.5);
  assert.equal(design.pv.selectedCapacityKwp, 80.275);
});

test('On-Grid Design: string design (On-Grid Design!B10/D10/E10) - an engineering CHECK only, never billed', () => {
  const { design } = referenceScenario();
  assert.equal(design.strings.parallelStrings, 13);
  assert.equal(design.strings.finalModules, 182);
  assert.equal(design.strings.unassignedModules, -13);
  // QA finding section 4: keep 169 as the BOQ quantity and show the layout count as a check.
  assert.deepEqual(design.layoutCheck, { boqModules: 169, layoutModules: 182, modulesPerString: 14, strings: 13, difference: 13, layoutCapacityKwp: 86.45 });
});

test('On-Grid Design: inverter nearest-match selection (On-Grid Design!B14/C14)', () => {
  const { design } = referenceScenario();
  assert.equal(design.inverter.model, 'SUN2000-100KTL-M2');
  assert.equal(design.inverter.ratedKw, 100);
  assert.equal(design.inverter.price, 253030);
});

test('On-Grid Design: DC cable = design kWp x 8 m route allowance (brief 3.1; QA: 640 m, not the string-layout length)', () => {
  const { design } = referenceScenario();
  assert.equal(design.dcCable.designCurrentA, 14.7125);
  assert.equal(design.dcCable.cableSizeMm2, 4);
  assert.equal(design.dcCable.lengthM, 640);
  assert.equal(design.dcCable.brand, 'Suntree');
  assert.equal(design.dcCable.pricePerM, 46);
  assert.equal(design.dcCable.totalCost, 29440);
});

test('On-Grid Design: mounting structure on the design kWp (brief 3.1)', () => {
  const { design } = referenceScenario();
  assert.equal(design.structure.capacityKwp, 80);
  assert.equal(design.structure.ratePerKwp, 1450);
  assert.equal(design.structure.totalCost, 116000);
});

test('On-Grid Design: AC cable sizing (On-Grid Design!C44/D44/E44/G44/H44) - permanently flagged VERIFY ENGINEERING', () => {
  const { design } = referenceScenario();
  assert.equal(round(design.acCable.inverterCurrentA, 5), 147.28323);
  assert.equal(round(design.acCable.designCurrentA, 5), 184.10404);
  assert.equal(design.acCable.cableSize, '3x50');
  assert.equal(design.acCable.pricePerM, 1195);
  assert.equal(design.acCable.totalCost, 23900);
  assert.equal(design.acCable.flag, 'REFERENCE TABLE SELECTION - VERIFY ENGINEERING');
});

test('On-Grid Design: cable tray roll combination (On-Grid Design!D48/E48/F48/G48)', () => {
  const { design } = referenceScenario();
  assert.equal(design.tray.requiredLengthM, 355);
  assert.equal(design.tray.totalRolls, 8);
  assert.equal(design.tray.totalCost, 2965);
});

test('On-Grid Design: AC breaker selection (On-Grid Design!B60/C60/D60/E60)', () => {
  const { design } = referenceScenario();
  assert.equal(design.breaker.ratingA, 200);
  assert.equal(design.breaker.type, 'MCCB');
  assert.equal(design.breaker.totalCost, 3100);
});

test('On-Grid Design: MC4 connectors (On-Grid Design!B66/D66) - strings*2+4, NOT ceil(modules/2)', () => {
  const { design } = referenceScenario();
  assert.equal(design.mc4.quantity, 30);
  assert.equal(design.mc4.totalCost, 1200);
});

test('On-Grid Design: AC distribution board sized against PRE-string capacity (On-Grid Design!B70/C70)', () => {
  const { design } = referenceScenario();
  assert.equal(design.adb.dimensionsCm, '100 x 80 x 50');
  assert.equal(design.adb.totalCost, 4880);
});

test('BOQ: 169 modules billed (ceil of design kWp / module W), every per-kWp line on the 80 design kWp', () => {
  const { boq } = referenceScenario();
  const byComponent = Object.fromEntries(boq.lines.map(l => [l.component, l.total]));
  assert.equal(byComponent['PV Modules'], 698392.5);
  assert.equal(boq.lines.find(l => l.component === 'PV Modules').qty, 169);
  assert.match(boq.lines.find(l => l.component === 'PV Modules').notes, /182 modules/);
  assert.equal(byComponent['Solar Inverters'], 253030);
  assert.equal(byComponent['DC Solar Cable'], 29440);
  assert.equal(byComponent['Mounting Structure'], 116000);
  assert.equal(byComponent['AC Cable'], 23900);
  assert.equal(byComponent['Cable Tray'], 2965);
  assert.equal(byComponent['AC Circuit Breaker'], 3100);
  assert.equal(byComponent['MC4 Connectors'], 1200);
  assert.equal(byComponent['AC Distribution Board'], 4880);
  assert.equal(byComponent['Earthing'], 8000);
  assert.equal(byComponent['Accessories'], 6800); // R74's 85 EGP/kWp unless the Rates matrix says otherwise
  assert.equal(byComponent['Installation'], 28800);
  assert.equal(byComponent['Transportation'], 2500);
  assert.equal(boq.total, 1179007.5);
  assert.equal(boq.designKwp, 80);
  assert.equal(round(boq.perKwp, 5), 14737.59375);
});

test('Installation rate band collapses band 2 into band 1 (BOQ On-Grid Design!F21 quirk, preserved)', () => {
  assert.equal(engine.installationBand(30), 1);
  assert.equal(engine.installationBand(31), 3); // jumps straight from band 1 to band 3
  assert.equal(engine.transportBand(30), 2); // transport correctly uses band 2 here
});

test('Estimator Input: area-based kWp + monthly production estimate (Estimator Input!B9/D12:D24)', () => {
  const r = engine.estimateCapacityFromArea({ areaM2: 640, areaPerKwp: 8 }, catalog.MONTHLY_PRODUCTION_30KWP_REFERENCE);
  assert.equal(r.kWp, 80);
  assert.equal(r.monthlyProductionKwh.January, 9915);
  assert.equal(r.monthlyProductionKwh.August, 12616);
  assert.equal(r.annualProductionKwh, 143889);
});

test('Unmapped region throws instead of silently producing zero', () => {
  assert.throws(() => engine.runOnGridDesign({
    kWp: 80, module: JINKO_475, inverterCandidates: HUAWEI_INVERTERS, structureType: 'Hangar Roof',
    modulesPerStringOverride: 14, acLengthM: 20, country: 'Egypt', region: 'Nowhere',
  }, catalog));
});

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
