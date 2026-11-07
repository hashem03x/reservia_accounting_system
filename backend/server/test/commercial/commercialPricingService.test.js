const { test } = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../../services/commercial/commercialPricingService');

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

test('Off-Grid defaults reproduce Off_Grid.xlsx BOQ!H27:H33 exactly', () => {
  const d = pricing.defaultsForCategory('Off-Grid');
  const r = pricing.priceCommercialRevision({ cogs: 429519, kWp: 9.375, ...d, vatPct: 0.14 });
  assert.equal(r.contingencyAmt, 8590.380000000001);
  assert.equal(r.profitAmt, 43810.938);
  assert.equal(round2(r.netExclVat), 481920.32);
  assert.equal(round2(r.vatAmt), 67468.84);
  assert.equal(round2(r.grossInclVat), 549389.16);
});

test('On-Grid defaults apply ZERO markup - net price equals COGS until the commercial team sets a margin', () => {
  const d = pricing.defaultsForCategory('On-Grid C&I');
  const r = pricing.priceCommercialRevision({ cogs: 1248204.75, kWp: 86.45, ...d, vatPct: 0.14 });
  assert.equal(r.netExclVat, 1248204.75);
  assert.equal(r.grossProfit, 0);
});

test('Optional levers (overhead/sales bonus/engineering incentive/category addition) compose correctly when a commercial team sets them', () => {
  const r = pricing.priceCommercialRevision({
    cogs: 1000000, kWp: 100, overheadPct: 0.1, contingencyPct: 0.02, profitPct: 0.1,
    salesBonusPct: 0.055, engineeringIncentivePct: 0.05, categoryAdditionPct: 0.19, discountPct: 0, vatPct: 0.14,
  });
  assert.equal(r.overheadAmt, 100000);
  assert.equal(r.contingencyAmt, 20000);
  assert.ok(r.profitAmt > 0);
  assert.ok(r.netExclVat > r.cogs);
  assert.ok(r.grossProfitPct > 0 && r.grossProfitPct < 1);
});
