const { test } = require('node:test');
const assert = require('node:assert/strict');
const feas = require('../../services/commercial/onGridFeasibility');

// Fixtures: On_Grid.xlsx `Feasibility Table`'s own live example (80 kWp, Cairo). CapEx (A4) in the
// live sheet is a direct reference to `BOQ On-Grid Design!G23` - which this project's own
// regression suite (onGridEngine.test.js) found to be a STALE cached total. This test targets the
// feasibility FORMULAS themselves, so it feeds in the sheet's own cached capex (1,279,326.75)
// exactly as the sheet last computed it - proving the formulas reproduce the sheet bit-for-bit
// given the same capex, independent of the separate BOQ-total staleness finding. Downstream
// integration (boqService.js) feeds this module the freshly-recomputed, correct BOQ total instead.
const CAPEX_AS_CACHED_IN_SHEET = 1279326.75;
const ANNUAL_PRODUCTION_YEAR1 = 143889; // Estimator Input!D24
const ANNUAL_CONSUMPTION = 155000; // Estimator Input!B24

function run() {
  return feas.runOnGridFeasibility({
    capex: CAPEX_AS_CACHED_IN_SHEET,
    annualProductionKwhYear1: ANNUAL_PRODUCTION_YEAR1,
    annualConsumptionKwh: ANNUAL_CONSUMPTION,
  });
}

test('degradation table matches the 25 literal values typed into Feasibility Table!C10:C34', () => {
  assert.equal(feas.DEGRADATION_TABLE_25YR.length, 25);
  assert.equal(feas.DEGRADATION_TABLE_25YR[0], 0.975);
  assert.equal(feas.DEGRADATION_TABLE_25YR[24], 0.807);
});

test('flat scenario year 1-4 cashflow/cumulative match Feasibility Table!I10:J13', () => {
  const { scenarios } = run();
  const [y1, y2, y3, y4] = scenarios.flat.years;
  assert.equal(round(y1.yearlyCashflow, 2), 392816.97);
  assert.equal(round(y1.cumulative, 2), -886509.78);
  assert.equal(round(y2.cumulative, 2), -509225.72);
  assert.equal(round(y3.cumulative, 2), -134681.31);
  assert.equal(round(y4.cumulative, 2), 237083.16);
});

test('headline simple payback "3 Years and 4 Months" (Feasibility Table!B38)', () => {
  const { headline } = run();
  assert.equal(headline.payback.label, '3 Years and 4 Months');
});

test('headline ROI = cumulative(year25)/capex = 5.782464175629877 (Feasibility Table!B39)', () => {
  const { headline } = run();
  assert.equal(round(headline.roi, 9), round(5.782464175629877, 9));
});

test('headline IRR on the CUMULATIVE series = 28.917% (Feasibility Table!B40)', () => {
  const { headline } = run();
  assert.equal(round(headline.irr, 6), round(0.2891710327475596, 6));
});

test('3% and 10% escalation scenarios diverge from the flat scenario after year 1', () => {
  const { scenarios } = run();
  assert.equal(scenarios.escalation3pct.years[1].tariff, 2.8 * 1.03);
  assert.equal(scenarios.escalation10pct.years[1].tariff, 2.8 * 1.1);
  assert.ok(scenarios.escalation10pct.finalCumulative > scenarios.flat.finalCumulative);
});

// Feasibility Table!G4/C4/M7/T7 are genuine editable input cells, not fixed constants - the
// commercial team must be able to override any of them per project (this is the fix for the bug
// where the UI had no way to supply these at all; previously only reachable via the hardcoded
// function defaults below).
test('baseTariffEgpPerKwh/maintenancePctOfCapex/escalation rates are honored when overridden', () => {
  const overridden = feas.runOnGridFeasibility({
    capex: CAPEX_AS_CACHED_IN_SHEET,
    annualProductionKwhYear1: ANNUAL_PRODUCTION_YEAR1,
    annualConsumptionKwh: ANNUAL_CONSUMPTION,
    baseTariffEgpPerKwh: 3.5,
    maintenancePctOfCapex: 0.02,
    escalationScenario2: 0.05,
    escalationScenario3: 0.2,
  });
  const defaulted = run();
  assert.equal(overridden.scenarios.flat.years[0].tariff, 3.5);
  assert.equal(overridden.scenarios.escalation3pct.years[1].tariff, 3.5 * 1.05);
  assert.equal(overridden.scenarios.escalation10pct.years[1].tariff, 3.5 * 1.2);
  assert.notEqual(overridden.headline.roi, defaulted.headline.roi);
});

test('defaults (2.80 tariff / 1% maintenance / 3% / 10% escalation) are unchanged from the sheet\'s own live values', () => {
  const { scenarios } = run();
  assert.equal(scenarios.flat.years[0].tariff, 2.8);
  assert.equal(scenarios.escalation3pct.years[1].tariff, 2.8 * 1.03);
  assert.equal(scenarios.escalation10pct.years[1].tariff, 2.8 * 1.1);
});

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
