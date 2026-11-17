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

test('On-Grid Design: AC cable sizing (On-Grid Design!C44/D44/E44/G44/H44) - the length-table pick alone (no breaker coordination) stays the faithful workbook figure', () => {
  const { design } = referenceScenario();
  assert.equal(round(design.acCable.inverterCurrentA, 5), 147.28323);
  assert.equal(round(design.acCable.designCurrentA, 5), 184.10404);
  // sizeAcCable called directly, with no breakerRatingA, reproduces the un-coordinated workbook pick.
  const uncoordinated = engine.sizeAcCable({ inverterRatedKw: 100, acLengthM: 20, catalog });
  assert.equal(uncoordinated.cableSize, '3x50');
  assert.equal(uncoordinated.pricePerM, 1195);
  assert.equal(uncoordinated.totalCost, 23900);
  assert.equal(uncoordinated.flag, 'REFERENCE TABLE SELECTION - VERIFY ENGINEERING');
});

// 2026 engineering review finding: the length-table pick alone says nothing about whether the
// selected cable can safely carry the current of the breaker that protects it (IEC 60364-433,
// In <= Iz). `runOnGridDesign` now resolves the breaker FIRST and passes its rating into
// sizeAcCable so it can verify (and, when needed, correct) this. For this 100 kW reference
// scenario the required breaker is 200 A, but even the largest cable in the Price Book's AC cable
// table (3x95, 179 A indicative ampacity x 0.8 derating = 143.2 A) cannot protect it - a real gap
// in the Price Book (no single-run cable above 95mm2 is priced), not something this engine may
// invent a number for. The correct, validated behavior is an explicit, blocking flag instead of
// silently shipping the old 3x50mm2/200A mismatch (94 A-class cable behind a 200 A breaker, an
// even worse version of the exact defect reported for the 60 kW/125 A worked example below).
test('On-Grid Design: AC cable sizing is coordinated with the selected breaker (IEC 60364-433 In <= Iz) - this reference scenario has no cable in the Price Book that can protect its 200 A breaker', () => {
  const { design } = referenceScenario();
  assert.equal(design.breaker.ratingA, 200);
  assert.equal(design.acCable.breakerRatingA, 200);
  assert.equal(design.acCable.protectionOk, false);
  assert.equal(design.acCable.cableSize, null);
  assert.equal(design.acCable.totalCost, null);
  assert.match(design.acCable.flag, /NO CABLE IN THE PRICE BOOK PROTECTS A 200 A BREAKER/);
});

// The task's own worked example: a 60 kW inverter's design current (110.46 A) selects a 125 A
// breaker; the length-table alone would pick 3x35mm2 (94 A x 0.8 derating = ~75 A - inadequate,
// exactly the reported defect). The coordination check steps up to the smallest cable in the
// table whose derated ampacity actually clears 125 A.
test('On-Grid Design: AC cable sizing steps up from the length-table pick when it cannot protect the breaker (the exact reported 60 kW / 125 A / 3x35mm2 defect)', () => {
  const breaker = engine.selectAcBreaker({ inverterRatedKw: 60, inverterQty: 1, breakers: catalog.AC_BREAKERS });
  assert.equal(breaker.ratingA, 125);

  const uncoordinated = engine.sizeAcCable({ inverterRatedKw: 60, acLengthM: 20, catalog });
  assert.equal(uncoordinated.cableSize, '3x35', 'the length table alone still picks the undersized cable - confirms this reproduces the reported defect');

  const coordinated = engine.sizeAcCable({ inverterRatedKw: 60, acLengthM: 20, catalog, breakerRatingA: breaker.ratingA });
  assert.equal(coordinated.cableSize, '3x95');
  assert.equal(coordinated.ampacityA, 179);
  assert.equal(coordinated.deratedAmpacityA, 143.2);
  assert.equal(coordinated.protectionOk, true);
  assert.match(coordinated.flag, /CABLE SIZE INCREASED FROM 3x35 TO 3x95 FOR BREAKER PROTECTION/);
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
  // AC Cable: no cable in the Price Book's table can protect this scenario's 200 A breaker after
  // derating (see the cable-breaker coordination test above) - the line is correctly null/flagged,
  // not a priced figure, until the Price Book gets a larger cable size.
  assert.equal(byComponent['AC Cable'], null);
  assert.match(boq.lines.find(l => l.component === 'AC Cable').flag, /NO CABLE IN THE PRICE BOOK PROTECTS A 200 A BREAKER/);
  assert.equal(byComponent['Cable Tray'], 2965);
  assert.equal(byComponent['AC Circuit Breaker'], 3100);
  assert.equal(byComponent['MC4 Connectors'], 1200);
  assert.equal(byComponent['AC Distribution Board'], 4880);
  assert.equal(byComponent['Earthing'], 8000);
  assert.equal(byComponent['Accessories'], 6800); // R74's 85 EGP/kWp unless the Rates matrix says otherwise
  assert.equal(byComponent['Installation'], 28800);
  assert.equal(byComponent['Transportation'], 2500);
  // 1,179,007.5 less the no-longer-priced AC Cable line (23,900) - see the comment above.
  assert.equal(boq.total, 1155107.5);
  assert.equal(boq.designKwp, 80);
  assert.equal(round(boq.perKwp, 6), 14438.84375);
});

test('Installation rate band collapses band 2 into band 1 (BOQ On-Grid Design!F21 quirk, preserved)', () => {
  assert.equal(engine.installationBand(30), 1);
  assert.equal(engine.installationBand(31), 3); // jumps straight from band 1 to band 3
  assert.equal(engine.transportBand(30), 2); // transport correctly uses band 2 here
});

// 2026 review finding: "outside-target" (the yellow, non-hard-flagged status) has two genuinely
// different causes that used to be indistinguishable to the frontend - a real Price Book coverage
// gap (no inverter rated 60-100 kW exists) vs. an estimator deliberately forcing a specific
// inverter. `dcAcCheck`'s new `reason` field lets the UI tell them apart instead of hardcoding
// "no Price Book inverter fits it" for every "outside-target" result.
const DC_AC_RATIO = { min: 1.1, max: 1.3, flagBelow: 1.0, flagAbove: 1.35 };

test('DC/AC check reason: auto-selection with no 60-100kW inverter in the Price Book reports "no-candidate-in-band"', () => {
  const { design } = engine.runOnGridDesign(
    { kWp: 80, module: JINKO_475, inverterCandidates: HUAWEI_INVERTERS, structureType: 'Hangar Roof', modulesPerStringOverride: 14, acLengthM: 20, country: 'Egypt', region: 'Cairo - 10th of Ramadan', engineSettings: { dcAcRatio: DC_AC_RATIO } },
    catalog
  );
  assert.equal(design.inverter.model, 'SUN2000-60KTL-M0', 'nearest available below the gap');
  assert.equal(design.dcAc.status, 'outside-target');
  assert.equal(design.dcAc.forced, false);
  assert.equal(design.dcAc.reason, 'no-candidate-in-band');
});

test('DC/AC check reason: an estimator-forced inverter outside the band reports "forced", never "no-candidate-in-band"', () => {
  const { design } = engine.runOnGridDesign(
    {
      kWp: 80, module: JINKO_475, inverterCandidates: HUAWEI_INVERTERS, structureType: 'Hangar Roof', modulesPerStringOverride: 14, acLengthM: 20,
      country: 'Egypt', region: 'Cairo - 10th of Ramadan', engineSettings: { dcAcRatio: DC_AC_RATIO }, inverterModel: 'SUN2000-60KTL-M0',
    },
    catalog
  );
  assert.equal(design.inverter.model, 'SUN2000-60KTL-M0');
  assert.equal(design.dcAc.status, 'outside-target');
  assert.equal(design.dcAc.forced, true);
  assert.equal(design.dcAc.reason, 'forced', 'a deliberate operator choice, not a Price Book gap - even though no candidate is in-band either');
});

test('DC/AC check reason: an in-range result always reports a null reason', () => {
  // 75 kWp DC / 60 kW inverter = 1.25, inside [1.1, 1.3].
  const { design } = engine.runOnGridDesign(
    { kWp: 75, module: JINKO_475, inverterCandidates: HUAWEI_INVERTERS, structureType: 'Hangar Roof', modulesPerStringOverride: 1, acLengthM: 20, country: 'Egypt', region: 'Cairo - 10th of Ramadan', engineSettings: { dcAcRatio: DC_AC_RATIO } },
    catalog
  );
  assert.equal(design.inverter.model, 'SUN2000-60KTL-M0');
  assert.equal(design.dcAc.status, 'in-range');
  assert.equal(design.dcAc.reason, null);
});

test('hasInverterInLoadingBand: true when a candidate exists, false across the 60-100kW gap', () => {
  assert.equal(engine.hasInverterInLoadingBand({ dcKwp: 75, inverters: HUAWEI_INVERTERS, ratio: DC_AC_RATIO }), true);
  assert.equal(engine.hasInverterInLoadingBand({ dcKwp: 80, inverters: HUAWEI_INVERTERS, ratio: DC_AC_RATIO }), false);
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
