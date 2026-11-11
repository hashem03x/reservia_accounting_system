const { test } = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../../services/commercial/commercialPricingService');
const offGrid = require('../../services/commercial/offGridEngine');

// Developer Brief 3.3 pricing stack (QA finding section 4). Expected figures come from the Deal
// Engine reference (brief section 8 "On-grid default": COGS 1,191,565 -> net 1,762,669, EGP 22,033
// per kWp, GP 30.8%, operating margin 22.7%; tolerance EGP 1 / 0.0001) and from the QA report
// (COGS 1,189,886.37 -> contract net 1,760,185.82; the old compounding bug gave 1,778,961.51).

const STANDARD = { ...pricing.BRIEF_DEFAULT_LEVERS, vatPct: 0.14 };

test('brief 3.3 defaults: overhead 10%, contingency 2%, profit 10%, sales bonus 5.5% of pool, incentive 5% of pool, category 19%, discount 0%', () => {
  assert.deepEqual({ ...pricing.BRIEF_DEFAULT_LEVERS }, {
    overheadPct: 0.1, contingencyPct: 0.02, profitPct: 0.1, salesBonusPct: 0.055, engineeringIncentivePct: 0.05, categoryAdditionPct: 0.19, discountPct: 0,
  });
});

test('reference workbook: COGS 1,191,565 -> net 1,762,669, final 2,009,443, 22,033/kWp on 80 design kWp, GP 30.8%, operating 22.7%', () => {
  const r = pricing.priceCommercialRevision({ cogs: 1191565, kWp: 80, ...STANDARD });
  assert.ok(Math.abs(r.netExclVat - 1762669) <= 1, `net ${r.netExclVat}`);
  assert.ok(Math.abs(r.grossInclVat - 2009443) <= 1, `gross ${r.grossInclVat}`);
  assert.ok(Math.abs(r.perKwpExclVat - 22033) <= 1, `per kWp ${r.perKwpExclVat}`);
  assert.equal(r.designKwp, 80);
  assert.ok(Math.abs(r.grossProfitPct - 0.3084) < 0.0001, `GP ${r.grossProfitPct}`);
  assert.ok(Math.abs(r.operatingProfitPct - 0.2273) < 0.0001, `OP ${r.operatingProfitPct}`);
});

test('QA finding: profit is taken on COGS (118,989), not on COGS + overhead + contingency (133,267); net 1,760,185.82 on the QA COGS', () => {
  const cogs = 1189886.37;
  const r = pricing.priceCommercialRevision({ cogs, kWp: 80, ...STANDARD });
  assert.equal(Math.round(r.profitAmt), 118989);
  assert.notEqual(Math.round(r.profitAmt), 133267);
  assert.ok(Math.abs(r.netExclVat - 1760185.82) < 0.01, `net ${r.netExclVat}`);
  assert.ok(Math.abs(r.netExclVat - 1778961.51) > 18000, 'the old compounded figure must not come back');
  assert.ok(Math.abs(r.grossProfitPct - 0.308) < 0.001);
});

test('every step of the stack, in order (pool -> bonus/incentive -> base -> category -> discount -> VAT)', () => {
  const r = pricing.priceCommercialRevision({ cogs: 1000000, kWp: 100, ...STANDARD, discountPct: 0.05 });
  assert.equal(r.overheadAmt, 100000);
  assert.equal(r.contingencyAmt, 20000);
  assert.equal(r.profitAmt, 100000);
  assert.equal(r.poolAmt, 220000);
  assert.ok(Math.abs(r.salesBonusAmt - 12100) < 1e-9);
  assert.ok(Math.abs(r.engineeringIncentiveAmt - 11000) < 1e-9);
  assert.ok(Math.abs(r.basePrice - 1243100) < 1e-6);
  assert.ok(Math.abs(r.categoryAdditionAmt - 236189) < 1e-6);
  assert.ok(Math.abs(r.discountAmt - (1243100 + 236189) * 0.05) < 1e-6);
  assert.ok(Math.abs(r.netExclVat - (1243100 + 236189) * 0.95) < 1e-6);
  assert.ok(Math.abs(r.vatAmt - r.netExclVat * 0.14) < 1e-6);
  assert.ok(Math.abs(r.grossProfit - (r.netExclVat - 1000000 - r.salesBonusAmt - r.engineeringIncentiveAmt)) < 1e-6);
  assert.ok(Math.abs(r.perKwpInclVat - r.grossInclVat / 100) < 1e-9);
});

test('levers not supplied are 0 - no hidden defaults inside the pricing function', () => {
  const r = pricing.priceCommercialRevision({ cogs: 500000, kWp: 10, vatPct: 0.14 });
  assert.equal(r.netExclVat, 500000);
  assert.equal(r.grossProfit, 0);
});

test('pickLevers keeps only lever percentages', () => {
  assert.deepEqual(pricing.pickLevers({ overheadPct: 0.1, cogs: 5, profitPct: '0.1', foo: 1 }), { overheadPct: 0.1, profitPct: 0.1 });
});

test('Off_Grid.xlsx BOQ!H27:H33 internal costing is still reproduced by the Off-Grid engine (Rev05 method preserved)', () => {
  const r = offGrid.priceWithInternalCosting({ lineItems: [{ total: 429519 }], contingencyRate: 0.02, profitMarginRate: 0.1, vatRate: 0.14 });
  assert.equal(r.contingency, 8590.380000000001);
  assert.equal(r.profit, 43810.938);
  assert.equal(Math.round(r.quotedPriceExclVat * 100) / 100, 481920.32);
});
