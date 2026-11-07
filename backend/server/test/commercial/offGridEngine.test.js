const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../../services/commercial/offGridEngine');

// Fixtures: Off_Grid.xlsx's own live example (Load Assessment + Design + BOQ, all 3 sheets).
const APPLIANCES = [
  { qty: 12, watts: 20, hoursPerDay: 18, daytimeHours: 6 }, // Lighting
  { qty: 2, watts: 800, hoursPerDay: 16, daytimeHours: 6 }, // Air Conditioner
  { qty: 1, watts: 400, hoursPerDay: 24, daytimeHours: 6 }, // Refrigerator
];

function referenceScenario() {
  return engine.runOffGridDesign({
    appliances: APPLIANCES,
    peakSunHours: 5.5,
    performanceFactor: 0.8,
    moduleWattage: 625,
    moduleUnitPrice: 5375,
    autonomyNights: 1,
    depthOfDischarge: 1,
    systemEfficiency: 0.9,
    batteryUnitVoltage: 51.2,
    batteryUnitAh: 314,
    batteryUnitPrice: 105000,
    simultaneityFactor: 1,
    safetyMargin: 0.25,
    inverterAcRatingW: 10000,
    maxPvInputW: 12000,
    inverterUnitPrice: 92000,
    dcCablePricePerM: 51,
    acLengthM: 20,
    acCablePricePerM: 110,
    mc4Pairs: 4,
    mc4PricePerPair: 90,
    dcProtectionPrice: 2500,
    mountingStructureRatePerKwp: 2200,
    earthingRatePerKwp: 100,
    miscRatePerKwp: { cableTrayPerM: 70, accessoriesPerKwp: 150 },
    installationRatePerKwp: 650,
    transportationRatePerKwp: 500,
    contingencyRate: 0.02,
    profitMarginRate: 0.1,
    vatRate: 0.14,
  });
}

test('Load Assessment totals (Load Assessment!F19/I19/J19)', () => {
  const { load } = referenceScenario();
  assert.equal(load.dailyWh, 39520);
  assert.equal(load.nightWh, 26080);
  assert.equal(load.connectedW, 2240);
});

test('Design: PV sizing (Design!C7/C9/C10)', () => {
  const { pv } = referenceScenario();
  assert.equal(round(pv.requiredW, 6), 8981.818182);
  assert.equal(pv.modulesRequired, 15);
  assert.equal(pv.installedW, 9375);
});

test('Design: battery sizing (Design!C21/C24/C25/C26)', () => {
  const { battery } = referenceScenario();
  assert.equal(round(battery.requiredWh, 6), 28977.777778);
  assert.equal(battery.unitWh, 16076.800000000001); // matches Design!C24's own cached float noise
  assert.equal(battery.unitsRequired, 2);
  assert.equal(battery.installedWh, 32153.600000000002); // matches Design!C26's own cached float noise
});

test('Design: inverter count (Design!C34/C38/C39/C42)', () => {
  const { inverter } = referenceScenario();
  assert.equal(inverter.requiredAcW, 2800);
  assert.equal(inverter.unitsRequired, 1);
  assert.equal(inverter.pass, true);
});

test('DC cable length rule: <=15 kWp uses 10 m/kWp (BOQ!F9)', () => {
  assert.equal(engine.dcCableLengthM(9.375), 94);
  assert.equal(engine.dcCableLengthM(15), 150);
});
test('DC cable length rule: >15 kWp uses 8 m/kWp', () => {
  assert.equal(engine.dcCableLengthM(20), 160);
});

test('BOQ line items match the workbook exactly (BOQ!H5:H17)', () => {
  const { lineItems, installedKwp } = referenceScenario();
  assert.equal(installedKwp, 9.375);
  const byComponent = Object.fromEntries(lineItems.map(l => [l.component, l.total]));
  assert.equal(byComponent['Solar PV Modules'], 80625);
  assert.equal(byComponent['Battery Bank'], 210000);
  assert.equal(byComponent['Off-Grid Inverter'], 92000);
  assert.equal(byComponent['Mounting Structure'], 20625);
  assert.equal(byComponent['DC Cables'], 4794);
  assert.equal(byComponent['AC Cables'], 2200);
  assert.equal(byComponent['MC4 Connectors'], 360);
  assert.equal(byComponent['DC Protection / Combiner'], 2500);
  assert.equal(byComponent['Earthing System'], 937.5);
  assert.equal(byComponent['Cable Trays'], 3290);
  assert.equal(byComponent['Miscellaneous'], 1406.25);
  assert.equal(byComponent['Installation & Testing'], 6093.75);
  assert.equal(byComponent.Transportation, 4687.5);
});

test('Internal costing: base cost, contingency, profit, VAT, grand total (BOQ!H27:H33)', () => {
  const { pricing, pricePerKwpExclVat } = referenceScenario();
  assert.equal(pricing.baseCost, 429519);
  assert.equal(pricing.contingency, 8590.380000000001);
  assert.equal(pricing.profit, 43810.938);
  assert.equal(pricing.quotedPriceExclVat, 481920.318);
  assert.equal(pricing.vat, 67468.84452000001);
  assert.equal(pricing.grandTotalInclVat, 549389.16252);
  assert.equal(pricePerKwpExclVat, 51404.833920000005);
});

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
