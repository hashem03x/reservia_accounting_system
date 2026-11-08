const { test } = require('node:test');
const assert = require('node:assert/strict');
const feas = require('../../services/commercial/offGridFeasibility');

// Fixtures: Off_Grid.xlsx `Feasibility Study`'s own live example, chained from the `BOQ` sheet's
// own live totals (battery line 210,000; grand total incl. VAT 549,389.16252 - see
// offGridEngine.test.js for where those come from).
function referenceScenario() {
  return feas.runOffGridDieselFeasibility({
    dailyWh: 39520,
    generatorPurchasePrice: 70000,
    dieselPriceEgpPerL: 20,
    dieselTransportEgpPerL: 2,
    dieselAnnualEscalation: 0.025,
    generatorSpecificFuelUseLPerKwh: 0.3,
    generatorMaintenancePct: 0.1,
    generatorReplacementIntervalYears: 10,
    solarAnnualOmPct: 0.025,
    batteryReplacementIntervalYears: 10,
    batteryReplacementCost: 210000,
    solarInitialCapex: 549389.16252,
    analysisPeriodYears: 25,
    discountRate: 0.1,
  });
}

test('Generator sizing (Feasibility Study!B8/B9)', () => {
  const r = feas.sizeGenerator({ connectedW: 2240, generatorPowerFactor: 0.8, generatorSizingMargin: 0.25 });
  assert.equal(r.requiredKva, 3.5);
  assert.equal(r.selectedKva, 5);
});

test('Year 1 fuel cost and year-0 cumulative (Feasibility Study!B29/G28)', () => {
  const { years } = referenceScenario();
  assert.equal(round(years[1].fuelCost, 2), 95203.68);
  assert.equal(round(years[0].cumulative, 2), -479389.16);
});

test('Headline IRR = 19.774% on the discrete cashflow series (Feasibility Study!B58)', () => {
  const { headline } = referenceScenario();
  assert.equal(round(headline.irr, 6), round(0.19774172271391866, 6));
});

test('Headline ROI = 5.103 (Feasibility Study!B59)', () => {
  const { headline } = referenceScenario();
  assert.equal(round(headline.roi, 6), round(5.103079550290507, 6));
});

test('25-year net savings = 2,324,187.44 (Feasibility Study!B60)', () => {
  const { headline } = referenceScenario();
  assert.equal(round(headline.twentyFiveYearNetSavings, 2), 2324187.44);
});

test('NPV at 10% discount = 436,869.58 (Feasibility Study!B61)', () => {
  const { headline } = referenceScenario();
  assert.equal(round(headline.npv, 2), 436869.58);
});

test('Written payback = "5 Years 2 Months" (Feasibility Study!B63)', () => {
  const { headline } = referenceScenario();
  assert.equal(headline.written, '5 Years 2 Months');
});

// Feasibility Study!B21 is a genuine editable input cell (analysis horizon), not a fixed
// constant - confirms a shorter/longer horizon actually changes the comparison instead of being
// silently pinned to 25 regardless of what's supplied.
test('a shorter analysis period changes the 25-year-net-savings headline (Feasibility Study!B21)', () => {
  const shortened = feas.runOffGridDieselFeasibility({
    dailyWh: 39520, generatorPurchasePrice: 70000, dieselPriceEgpPerL: 20, dieselTransportEgpPerL: 2,
    dieselAnnualEscalation: 0.025, generatorSpecificFuelUseLPerKwh: 0.3, generatorMaintenancePct: 0.1,
    generatorReplacementIntervalYears: 10, solarAnnualOmPct: 0.025, batteryReplacementIntervalYears: 10,
    batteryReplacementCost: 210000, solarInitialCapex: 549389.16252, analysisPeriodYears: 10, discountRate: 0.1,
  });
  const full = referenceScenario();
  assert.equal(shortened.years.length, 11);
  assert.notEqual(shortened.headline.twentyFiveYearNetSavings, full.headline.twentyFiveYearNetSavings);
});

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
