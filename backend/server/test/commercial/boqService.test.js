const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const boqService = require('../../services/commercial/boqService');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const CommercialProposal = require('../../models/commercial/commercialProposalModel');
const onGridEngine = require('../../services/commercial/onGridEngine');
const offGridEngine = require('../../services/commercial/offGridEngine');
const utilityEngine = require('../../services/commercial/utilityEngine');
const onGridCatalog = require('../../services/commercial/catalogData/onGridCatalog');
const pumpingCatalog = require('../../services/commercial/catalogData/pumpingCatalog');
const pumpingExtras = require('../../services/commercial/catalogData/pumpingExtras');
const pumpingEngine = require('../../services/commercial/pumpingEngine');

// Regression suite for: "CommercialRevision validation failed: boqLines.N.lineNo: Path `lineNo`
// is required." - every *Engine.js module numbers its own BOQ lines with `no` (the ORIGINAL item
// number from that line's source Excel BOQ sheet), but CommercialRevision's schema
// (models/commercial/commercialRevisionModel.js) persists that number under the REQUIRED field
// `lineNo`. Nothing renamed `no` -> `lineNo` before `revisionService.js` handed the lines to
// Mongoose, so every revision creation failed. The fix lives in `boqService.js#applyManualOverrides`
// - the one place every category's lines flow through before reaching revisionService.js.
//
// `.validateSync()` reproduces Mongoose's schema validation (the exact error from the bug report)
// without needing a live database connection - only `.save()` needs one, validation is pure and
// synchronous. This lets the core of this regression run in any environment.

const JINKO_475 = onGridCatalog.PV_MODULES.find(m => m.model === 'JKM475M-7RL3');
const ON_GRID_SCENARIO = {
  kWp: 80, module: JINKO_475, inverterCandidates: onGridCatalog.GRID_INVERTERS, structureType: 'Hangar Roof',
  modulesPerStringOverride: 14, acLengthM: 20, country: 'Egypt', region: 'Cairo - 10th of Ramadan',
};

function fakeRevisionDoc(boqLines) {
  return new CommercialRevision({ project: new mongoose.Types.ObjectId(), revisionNumber: 1, boqLines });
}

test('reproduces the exact reported bug: raw engine lines (no `lineNo`) fail CommercialRevision validation', () => {
  const { boq } = onGridEngine.runOnGridDesign(ON_GRID_SCENARIO, onGridCatalog);
  assert.equal(boq.lines.length, 13); // matches the bug report's "boqLines.0" through "boqLines.12"
  const err = fakeRevisionDoc(boq.lines).validateSync();
  assert.ok(err, 'expected validation to fail on raw, unmapped engine lines');
  assert.match(err.message, /boqLines\.0\.lineNo: Path `lineNo` is required/);
});

test('fix: On-Grid lines passed through applyManualOverrides validate cleanly and keep the Excel BOQ item numbers (1-9, 11-14; "10" intentionally skipped)', () => {
  const { boq } = onGridEngine.runOnGridDesign(ON_GRID_SCENARIO, onGridCatalog);
  const lines = boqService.applyManualOverrides(boq.lines);
  assert.equal(lines.length, 13);

  const err = fakeRevisionDoc(lines).validateSync();
  assert.equal(err, undefined);

  const lineNos = lines.map(l => l.lineNo);
  assert.deepEqual(lineNos, [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14]);
  assert.equal(new Set(lineNos).size, lineNos.length, 'no duplicate line numbers');
  assert.ok(lines.every(l => l.no === undefined), 'the plain-object `no` convenience field must not leak into the persisted shape');
});

test('fix preserves every original BOQ value (component/description/unit/qty/unitPrice/total) unchanged', () => {
  const { boq } = onGridEngine.runOnGridDesign(ON_GRID_SCENARIO, onGridCatalog);
  const lines = boqService.applyManualOverrides(boq.lines);
  boq.lines.forEach((raw, i) => {
    const fixed = lines[i];
    assert.equal(fixed.lineNo, raw.no);
    assert.equal(fixed.component, raw.component);
    assert.equal(fixed.description, raw.description);
    assert.equal(fixed.unit, raw.unit);
    assert.equal(fixed.qty, raw.qty);
    assert.equal(fixed.unitPrice, raw.unitPrice);
    assert.equal(fixed.total, raw.total);
  });
  const byComponent = Object.fromEntries(lines.map(l => [l.component, l.total]));
  assert.equal(byComponent['PV Modules'], 698392.5); // 169 modules (QA: ceil of design kWp / module W)
  assert.equal(lines.reduce((s, l) => s + (l.total || 0), 0), 1179007.5);
});

test('fix applies equally to Off-Grid (13 lines, numbered 1-13, no gaps)', () => {
  const result = offGridEngine.runOffGridDesign({
    appliances: [
      { qty: 12, watts: 20, hoursPerDay: 18, daytimeHours: 6 },
      { qty: 2, watts: 800, hoursPerDay: 16, daytimeHours: 6 },
      { qty: 1, watts: 400, hoursPerDay: 24, daytimeHours: 6 },
    ],
    peakSunHours: 5.5, performanceFactor: 0.8, moduleWattage: 625, moduleUnitPrice: 5375,
    autonomyNights: 1, depthOfDischarge: 1, systemEfficiency: 0.9, batteryUnitVoltage: 51.2, batteryUnitAh: 314, batteryUnitPrice: 105000,
    simultaneityFactor: 1, safetyMargin: 0.25, inverterAcRatingW: 10000, maxPvInputW: 12000, inverterUnitPrice: 92000,
    dcCablePricePerM: 51, acLengthM: 20, acCablePricePerM: 110, mc4Pairs: 4, mc4PricePerPair: 90, dcProtectionPrice: 2500,
    mountingStructureRatePerKwp: 2200, earthingRatePerKwp: 100, miscRatePerKwp: { cableTrayPerM: 70, accessoriesPerKwp: 150 },
    installationRatePerKwp: 650, transportationRatePerKwp: 500, contingencyRate: 0.02, profitMarginRate: 0.1, vatRate: 0.14,
  });
  const lines = boqService.applyManualOverrides(result.lineItems);
  assert.equal(lines.length, 13);
  assert.deepEqual(lines.map(l => l.lineNo), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.equal(fakeRevisionDoc(lines).validateSync(), undefined);
});

test('fix handles Mixed-type (string) line numbers: Utility-Scale manual adder lines like "15.1" validate too', () => {
  const result = utilityEngine.runUtilityScaleDesign(ON_GRID_SCENARIO, onGridCatalog, { 16: { qty: 1, unitPrice: 50000 } });
  const lines = boqService.applyManualOverrides(result.boq.lines);
  assert.equal(lines.length, 13 + 11);
  const scadaLine = lines.find(l => l.component === 'SCADA System');
  const walkwaysLine = lines.find(l => l.component === 'Maintenance Walkways');
  assert.equal(scadaLine.lineNo, 16);
  assert.equal(walkwaysLine.lineNo, '15.1'); // Mixed type: a string line number must survive untouched
  assert.equal(scadaLine.total, 50000); // the manually-entered adder amount still flows through
  assert.equal(fakeRevisionDoc(lines).validateSync(), undefined);
});

test('fix covers Agriculture Pumping, whose raw lines previously had NO numbering at all - now carry the real Solar_Pumping3.xlsx BOQ item numbers', () => {
  const demand = pumpingEngine.computeWaterDemand(
    { fieldCropRows: [{ areaFeddan: 20, irrigationCode: 1, intervalDays: 2, sunHours: 5 }], treeRows: [{ areaFeddan: 30, treeCode: 7, intervalDays: 2 }], waterLevelM: 60, safetyAllowanceM: 5 },
    { irrigationMethods: pumpingExtras.IRRIGATION_METHODS, treeTypes: pumpingExtras.TREE_TYPES }
  );
  const pump = pumpingEngine.selectPump({ requiredFlowM3h: demand.totalFlowM3h, requiredHeadM: demand.totalHeadM, pumps: pumpingCatalog.PUMPS });
  const motor = pumpingEngine.selectMotor({ pump, motors: pumpingCatalog.MOTORS });
  const module_ = onGridCatalog.PV_MODULES.find(m => m.model === 'JKM670N-66QL6-BDV');
  const pv = pumpingEngine.sizePvForMotor({ motorKw: motor.kw, module: module_ });
  const strings = pumpingEngine.sizeStrings({ modulesRequired: pv.modulesRequired, modulesPerString: 13, module: module_ });
  const submersible = pumpingEngine.sizeSubmersibleCable({ motorHp: motor.hp, wellDepthM: 60, catalog: pumpingExtras });
  const dcCable = pumpingEngine.sizeDcCable({ installedKwp: strings.installedKwp, strings: strings.strings, module: module_, stringVmpStc: 13 * module_.vmp, dcCables: pumpingExtras.PUMPING_DC_CABLES });

  const rawLines = boqService.buildPumpingBoqLines({ pump, motor, module_, strings, dcCable, submersible, demand, pumpQty: 1 });
  assert.ok(rawLines.every(l => l.lineNo === undefined), 'raw engine output uses `no`, matching every other category');

  const lines = boqService.applyManualOverrides(rawLines);
  const byComponent = Object.fromEntries(lines.map(l => [l.component, l.lineNo]));
  assert.deepEqual(byComponent, {
    'Submersible Water Pump': 1,
    'Pump Motor': 2,
    'Solar PV Modules': 7,
    'DC Cables': 10,
    'Submersible Drop Cable': 4,
    'Rising Main Pipe': 3,
    'Pump Inverter / VFD': 8,
  });
  assert.equal(fakeRevisionDoc(lines).validateSync(), undefined);
});

test('manual overrides still apply correctly alongside the lineNo fix (qty/price override, auto values preserved, source flagged)', () => {
  const { boq } = onGridEngine.runOnGridDesign(ON_GRID_SCENARIO, onGridCatalog);
  const lines = boqService.applyManualOverrides(boq.lines, { 'PV Modules': { qty: 200, unitPrice: 5000, notes: 'Supplier quote' } });
  const pvLine = lines.find(l => l.component === 'PV Modules');
  assert.equal(pvLine.lineNo, 1);
  assert.equal(pvLine.qty, 200);
  assert.equal(pvLine.unitPrice, 5000);
  assert.equal(pvLine.total, 1000000);
  assert.equal(pvLine.source, 'override');
  assert.equal(pvLine.autoQty, 169); // the original auto-calculated quantity (ceil(80 kWp / 475 W)) is retained, not discarded
  assert.equal(pvLine.autoUnitPrice, pv182UnitPrice(boq.lines));
  assert.equal(fakeRevisionDoc(lines).validateSync(), undefined);

  function pv182UnitPrice(rawLines) {
    return rawLines.find(l => l.component === 'PV Modules').unitPrice;
  }
});

test('creating a second revision from fresh engine output does not duplicate or corrupt line numbering (applyManualOverrides is pure/stateless)', () => {
  const { boq: boq1 } = onGridEngine.runOnGridDesign(ON_GRID_SCENARIO, onGridCatalog);
  const revision1Lines = boqService.applyManualOverrides(boq1.lines);

  const { boq: boq2 } = onGridEngine.runOnGridDesign({ ...ON_GRID_SCENARIO, kWp: 120 }, onGridCatalog);
  const revision2Lines = boqService.applyManualOverrides(boq2.lines);

  assert.deepEqual(revision1Lines.map(l => l.lineNo), [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14]);
  assert.deepEqual(revision2Lines.map(l => l.lineNo), [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14]);
  // Revision 1's own lines are untouched by building revision 2 (no shared mutable state).
  assert.deepEqual(revision1Lines.map(l => l.lineNo), [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14]);
  assert.notEqual(revision1Lines[0].total, revision2Lines[0].total); // genuinely different revisions, not a stale/duplicated copy
  assert.equal(fakeRevisionDoc(revision1Lines).validateSync(), undefined);
  assert.equal(fakeRevisionDoc(revision2Lines).validateSync(), undefined);
});

test('empty BOQ still behaves as before (no crash, no validation error) - a revision can be created with zero lines', () => {
  const lines = boqService.applyManualOverrides([]);
  assert.deepEqual(lines, []);
  assert.equal(fakeRevisionDoc(lines).validateSync(), undefined);
});

test('proposal generation: boqLinesSnapshot is a direct passthrough of the (now-valid) revision.boqLines, so the fix covers it with no separate change needed', () => {
  const { boq } = onGridEngine.runOnGridDesign(ON_GRID_SCENARIO, onGridCatalog);
  const lines = boqService.applyManualOverrides(boq.lines);
  const revision = fakeRevisionDoc(lines);
  assert.equal(revision.validateSync(), undefined);

  // services/commercial/proposalService.js#issueProposal does
  // `boqLinesSnapshot: revision.boqLines` verbatim - no DB needed to prove the snapshot assignment
  // itself validates against CommercialProposal's own schema once the revision's lines are valid.
  const proposal = new CommercialProposal({
    revision: revision._id, project: revision.project, version: 1,
    validUntil: new Date(Date.now() + 86400000),
    boqLinesSnapshot: revision.boqLines,
    pricingSnapshot: revision.pricing,
    issuedBy: new mongoose.Types.ObjectId(),
  });
  assert.equal(proposal.validateSync(), undefined);
  assert.equal(proposal.boqLinesSnapshot.length, 13);
  assert.equal(proposal.boqLinesSnapshot[0].lineNo, 1);
});
