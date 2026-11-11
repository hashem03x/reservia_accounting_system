const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../../services/commercial/onGridEngine');
const catalog = require('../../services/commercial/catalogData/onGridCatalog');
const { applyManualOverrides, priceBoq, computeFeasibility } = require('../../services/commercial/boqService');
const { BRIEF_DEFAULT_LEVERS } = require('../../services/commercial/commercialPricingService');

// QA report section 8 acceptance, run through the REAL engine -> pricing -> feasibility chain.
// Inputs (ONG-000003): 80 kWp, Jinko JKM475M-7RL3, Huawei inverter auto-selected, hangar roof, 20 m AC
// cable at the 1,195 EGP/m reference override, Cairo - 10th of Ramadan, standard levers.
//
// Two scenarios:
//  1. Live Price Book data (R74 prices) - what a fresh project calculates today.
//  2. The reference workbook's BOQ lines (Deal Engine reference / brief section 8: materials
//     1,154,265, COGS 1,191,565) - reproduced by feeding the engine the reference's own price data
//     and the three lines whose RULE differs between R74 and the reference (tray, MC4, distribution
//     board - see the reconciliation table in the implementation report). The QA: "exactly 1,762,669
//     once the module and cable lines match the reference".

const JINKO = catalog.PV_MODULES.find(m => m.model === 'JKM475M-7RL3');
const BASE = { kWp: 80, inverterCandidates: catalog.GRID_INVERTERS, structureType: 'Hangar Roof', acLengthM: 20, acPricePerMOverride: 1195, country: 'Egypt', region: 'Cairo - 10th of Ramadan' };

function run(input, cat = catalog, overrides = {}) {
  const { boq, design } = engine.runOnGridDesign(input, cat);
  const lines = applyManualOverrides(boq.lines, overrides);
  const boqTotal = lines.reduce((s, l) => s + (l.total || 0), 0);
  const pricing = priceBoq({ boqTotal, kWp: boq.designKwp, vatPct: 0.14, levers: BRIEF_DEFAULT_LEVERS });
  const { feasibility } = computeFeasibility({ category: 'On-Grid C&I', engineeringInput: {}, pricing, boqTotal, kWp: boq.designKwp });
  return { lines, boqTotal, pricing, feasibility, design };
}

test('acceptance (live R74 prices): 169 modules, price per kWp = net / 80, GP 30.8%, feasibility capex = final price incl VAT', () => {
  const r = run({ ...BASE, module: JINKO });
  const pv = r.lines.find(l => l.component === 'PV Modules');
  assert.equal(pv.qty, 169);
  assert.equal(r.pricing.designKwp, 80);
  assert.ok(Math.abs(r.pricing.perKwpExclVat - r.pricing.netExclVat / 80) < 1e-9);
  assert.ok(Math.abs(r.pricing.grossProfitPct - 0.3084) < 0.0005, `GP ${r.pricing.grossProfitPct}`);
  assert.equal(r.feasibility.priceBasis.capex, r.pricing.grossInclVat);
  // Net = COGS x 1.479290... (the stack's fixed multiplier at standard levers)
  assert.ok(Math.abs(r.pricing.netExclVat / r.boqTotal - 1762668.9972850003 / 1191565) < 1e-12);
});

test('acceptance (reference BOQ lines): materials 1,154,265, COGS 1,191,565 -> net 1,762,669, GP 30.8%, 22,033/kWp, payback 4.2775 y at 10%', () => {
  const refModule = { ...JINKO, pricePerWatt: 4085 / 475 }; // reference Price Book: 4,085 EGP per module
  const refCatalog = { ...catalog, ACCESSORIES_RATE_EGP_PER_KWP: 150 }; // brief 3.1 / reference Rates: 150 EGP/kWp
  const r = run(
    { ...BASE, module: refModule, dcCableBrand: 'HIS', siteCosts: { crew: 4, days: 5 } }, // reference: HIS 4 mm2 at 51; crew 4 x 5 days personnel allowance
    refCatalog,
    {
      // Lines whose RULE differs between the R74 sheet and the reference build (not prices):
      'Cable Tray': { qty: 8, unitPrice: 397.5, notes: 'reference: ceil(kWp/10) rolls' },
      'MC4 Connectors': { qty: 85, unitPrice: 90, notes: 'reference: ceil(modules/2) pairs' },
      'AC Distribution Board': { qty: 1, unitPrice: 4400, notes: 'reference: board up to 80 kWp' },
    }
  );
  const materials = r.lines.filter(l => !['Installation', 'Transportation', 'Travel & Accommodation', 'Site Personnel Allowance'].includes(l.component)).reduce((s, l) => s + l.total, 0);
  assert.equal(Math.round(materials), 1154265);
  assert.equal(Math.round(r.boqTotal), 1191565);
  assert.ok(Math.abs(r.pricing.netExclVat - 1762669) <= 1, `net ${r.pricing.netExclVat}`);
  assert.ok(Math.abs(r.pricing.perKwpExclVat - 22033) <= 1);
  assert.ok(Math.abs(r.pricing.grossProfitPct - 0.3084) < 0.0001);
  assert.ok(Math.abs(r.feasibility.headline.paybackYears - 4.2775) < 0.0001, `payback ${r.feasibility.headline.paybackYears}`);
  assert.equal(r.lines.find(l => l.component === 'DC Solar Cable').total, 32640); // 640 m x 51
  assert.equal(r.lines.find(l => l.component === 'Site Personnel Allowance').total, 6000);
  assert.equal(r.lines.find(l => l.component === 'Travel & Accommodation'), undefined, 'Greater Cairo has no travel, hotel or per diem (brief 3.2)');
});

test('site costs outside Greater Cairo: fares + ceil(crew/2) x days hotel nights + per diem, plus personnel (brief 3.2)', () => {
  const s = engine.computeSiteCosts({ region: 'Minya - Sohag - Assiut', crew: 4, days: 5 });
  assert.equal(s.fares, 4800);
  assert.equal(s.roomNights, 10);
  assert.equal(s.hotels, 18000);
  assert.equal(s.perDiem, 5000);
  assert.equal(s.travel, 27800);
  assert.equal(s.personnel, 6000);
  assert.equal(engine.computeSiteCosts({ region: 'Minya - Sohag - Assiut' }).travel, 0, 'no crew/days entered -> no site-cost lines (unchanged pricing)');
});

test('a region outside the Rates matrix is refused, never priced at zero', () => {
  assert.throws(() => run({ ...BASE, module: JINKO, region: 'Cairo' }), /not in the installation Rates matrix/);
});
