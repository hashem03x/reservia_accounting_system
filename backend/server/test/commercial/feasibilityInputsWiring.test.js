const { test } = require('node:test');
const assert = require('node:assert/strict');
const boqService = require('../../services/commercial/boqService');

// Regression suite for: "the Feasibility tab shows 'Enter the feasibility inputs on the
// Engineering Input tab' but the Engineering Input tab has no feasibility fields." The gap was
// that `boqService.js#runOffGrid`/`runOnGridOrUtility` either never read certain `engineeringInput`
// keys at all, or read them but the frontend forms never sent them. This file exercises the
// Off-Grid path end-to-end through `boqService.buildBoq` - Off-Grid's engine and feasibility model
// are both pure (no Price Book/DB lookups), so this runs with no database connection, the same
// DB-free strategy used by boqService.test.js.
//
// The On-Grid/Utility path needs a live Price Book (DB) to resolve the PV module, so its new
// `tariffEgpPerKwh`/`maintenancePctOfCapex`/`escalationScenario2`/`escalationScenario3` wiring in
// `runOnGridOrUtility` is covered at the calculation level by
// test/commercial/onGridFeasibility.test.js's override test instead - the boqService.js change
// itself is a one-line `engineeringInput.X ?? excelDefault` pass-through, the same pattern proven
// here for Off-Grid.

const OFF_GRID_INPUT_BASE = {
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
};

test('Off-Grid: dieselComparison is null when generatorPurchasePrice is omitted (no regression from the new fields)', async () => {
  const result = await boqService.buildBoq({ category: 'Off-Grid', engineeringInput: OFF_GRID_INPUT_BASE, country: 'Egypt', region: 'Cairo' });
  assert.equal(result.dieselComparison, null);
});

test('Off-Grid: previously-missing analysisPeriodYears now flows from engineeringInput into the diesel comparison (Feasibility Study!B21)', async () => {
  const input25 = { ...OFF_GRID_INPUT_BASE, generatorPurchasePrice: 70000, dieselPriceEgpPerL: 20 };
  const input10 = { ...input25, analysisPeriodYears: 10 };

  const result25 = await boqService.buildBoq({ category: 'Off-Grid', engineeringInput: input25, country: 'Egypt', region: 'Cairo' });
  const result10 = await boqService.buildBoq({ category: 'Off-Grid', engineeringInput: input10, country: 'Egypt', region: 'Cairo' });

  assert.equal(result25.dieselComparison.years.length, 26); // year 0 + 25
  assert.equal(result10.dieselComparison.years.length, 11); // year 0 + 10
  assert.notEqual(result25.dieselComparison.headline.twentyFiveYearNetSavings, result10.dieselComparison.headline.twentyFiveYearNetSavings);
});

test('Off-Grid: every diesel/feasibility input field is honored when supplied, not silently defaulted', async () => {
  const defaulted = await boqService.buildBoq({
    category: 'Off-Grid',
    engineeringInput: { ...OFF_GRID_INPUT_BASE, generatorPurchasePrice: 70000, dieselPriceEgpPerL: 20 },
    country: 'Egypt', region: 'Cairo',
  });
  const overridden = await boqService.buildBoq({
    category: 'Off-Grid',
    engineeringInput: {
      ...OFF_GRID_INPUT_BASE,
      generatorPurchasePrice: 70000, dieselPriceEgpPerL: 20,
      dieselTransportEgpPerL: 5, dieselAnnualEscalation: 0.05, generatorSpecificFuelUseLPerKwh: 0.4,
      generatorMaintenancePct: 0.15, generatorReplacementIntervalYears: 5, solarAnnualOmPct: 0.04,
      batteryReplacementIntervalYears: 5, analysisPeriodYears: 25, discountRate: 0.15,
    },
    country: 'Egypt', region: 'Cairo',
  });

  assert.notEqual(defaulted.dieselComparison.headline.npv, overridden.dieselComparison.headline.npv);
  assert.notEqual(defaulted.dieselComparison.headline.twentyFiveYearNetSavings, overridden.dieselComparison.headline.twentyFiveYearNetSavings);
  // Engineering design/BOQ (unrelated to feasibility inputs) must stay identical - these fields
  // only feed the Feasibility Study model, never the Load Assessment/Design/BOQ chain.
  assert.equal(defaulted.boqTotal, overridden.boqTotal);
  assert.equal(defaulted.kWp, overridden.kWp);
  assert.deepEqual(defaulted.lines.map(l => l.total), overridden.lines.map(l => l.total));
});
