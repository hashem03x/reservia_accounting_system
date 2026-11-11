const { test } = require('node:test');
const assert = require('node:assert/strict');
const boqService = require('../../services/commercial/boqService');

// Regression suite for the feasibility inputs reaching the models (originally: "the Feasibility tab
// says enter inputs, but the Engineering Input tab has none"), updated for QA findings B4/U7/U8:
//   - feasibility now runs AFTER pricing (boqService.computeFeasibility), because its capex is the
//     revision's FINAL PRICE incl VAT - never the raw BOQ cost;
//   - Off-Grid installation comes from the Rates matrix in Egypt; outside Egypt (no Rates matrix) the
//     typed rate is used, which is what lets this file run with no database.

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

const PRICING = { netExclVat: 600000, vatPct: 0.14, vatAmt: 84000, grossInclVat: 684000 };

async function offGrid(input) {
  const built = await boqService.buildBoq({ category: 'Off-Grid', engineeringInput: input, country: 'Other Country', region: null });
  const f = boqService.computeFeasibility({ category: 'Off-Grid', engineeringInput: input, pricing: PRICING, boqTotal: built.boqTotal, kWp: built.kWp, engineeringResult: built.engineeringResult });
  return { built, ...f };
}

test('Off-Grid: dieselComparison is null when generatorPurchasePrice is omitted', async () => {
  const { dieselComparison } = await offGrid(OFF_GRID_INPUT_BASE);
  assert.equal(dieselComparison, null);
});

test('Off-Grid: the diesel comparison uses the revision FINAL PRICE incl VAT as the solar capex (QA B4)', async () => {
  const { dieselComparison } = await offGrid({ ...OFF_GRID_INPUT_BASE, generatorPurchasePrice: 70000 });
  // year 0 net = -solar capex + generator purchase (Feasibility Study!G28)
  assert.equal(dieselComparison.years[0].netSavings, -684000 + 70000);
});

test('Off-Grid: analysisPeriodYears flows from engineeringInput into the diesel comparison (Feasibility Study!B21)', async () => {
  const r25 = await offGrid({ ...OFF_GRID_INPUT_BASE, generatorPurchasePrice: 70000, dieselPriceEgpPerL: 20 });
  const r10 = await offGrid({ ...OFF_GRID_INPUT_BASE, generatorPurchasePrice: 70000, dieselPriceEgpPerL: 20, analysisPeriodYears: 10 });
  assert.equal(r25.dieselComparison.years.length, 26);
  assert.equal(r10.dieselComparison.years.length, 11);
});

test('Off-Grid: every diesel/feasibility input is honored, and none of them changes the BOQ', async () => {
  const defaulted = await offGrid({ ...OFF_GRID_INPUT_BASE, generatorPurchasePrice: 70000, dieselPriceEgpPerL: 20 });
  const overridden = await offGrid({
    ...OFF_GRID_INPUT_BASE, generatorPurchasePrice: 70000, dieselPriceEgpPerL: 20,
    dieselTransportEgpPerL: 5, dieselAnnualEscalation: 0.05, generatorSpecificFuelUseLPerKwh: 0.4,
    generatorMaintenancePct: 0.15, generatorReplacementIntervalYears: 5, solarAnnualOmPct: 0.04,
    batteryReplacementIntervalYears: 5, analysisPeriodYears: 25, discountRate: 0.15,
  });
  assert.notEqual(defaulted.dieselComparison.headline.npv, overridden.dieselComparison.headline.npv);
  assert.equal(defaulted.built.boqTotal, overridden.built.boqTotal);
  assert.deepEqual(defaulted.built.lines.map(l => l.total), overridden.built.lines.map(l => l.total));
});

test('Off-Grid without Price Book keys: typed prices still calculate but are FLAGGED as manual (QA U7)', async () => {
  const { built } = await offGrid(OFF_GRID_INPUT_BASE);
  for (const component of ['Solar PV Modules', 'Battery Bank', 'Off-Grid Inverter']) {
    const line = built.lines.find(l => l.component === component);
    assert.match(line.flag || '', /MANUAL PRICE/);
  }
});

test('On-Grid feasibility (brief 3.4): capex = final price incl VAT; 10% headline with 3% and flat sensitivities; no O&M deducted by default', () => {
  const pricing = { netExclVat: 1762669, vatPct: 0.14, vatAmt: 246774, grossInclVat: 2009443 };
  const { feasibility } = boqService.computeFeasibility({ category: 'On-Grid C&I', engineeringInput: {}, pricing, boqTotal: 1191565, kWp: 80 });
  assert.equal(feasibility.priceBasis.capex, 2009443);
  assert.equal(feasibility.priceBasis.capexBasis, 'Final price incl VAT (year 0)');
  assert.equal(feasibility.headline.escalation, 0.1);
  assert.deepEqual(feasibility.sensitivities.map(s => s.escalation), [0.03, 0]);
  assert.equal(feasibility.assumptions.maintenancePctOfCapex, 0);
  assert.ok(feasibility.headline.years.every(y => y.maintenance === 0));
  assert.ok(feasibility.internalCostView.paybackYears < feasibility.headline.paybackYears, 'the cost-side view is a separate, labelled line - never the headline');
});

test('On-Grid feasibility: legacy R74 escalation inputs (3% / 10%) still produce the 10% headline', () => {
  const pricing = { netExclVat: 1762669, vatPct: 0.14, vatAmt: 246774, grossInclVat: 2009443 };
  const { feasibility } = boqService.computeFeasibility({ category: 'On-Grid C&I', engineeringInput: { escalationScenario2: 0.03, escalationScenario3: 0.1 }, pricing, boqTotal: 1191565, kWp: 80 });
  assert.equal(feasibility.headline.escalation, 0.1);
});

test('Agriculture Pumping: no feasibility model (none in Solar_Pumping3.xlsx)', () => {
  const r = boqService.computeFeasibility({ category: 'Agriculture Pumping', engineeringInput: {}, pricing: PRICING, boqTotal: 1, kWp: 1 });
  assert.equal(r.feasibility, null);
  assert.equal(r.dieselComparison, null);
});
