const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  roleLabel,
  widestLevel,
  projectTabAccess,
  enginePageAccess,
  assertPricingWriteAllowed,
  assertEngineeringInputWriteAllowed,
  assertCanViewPricing,
  assertCanAccessEnginePage,
  assertCanAccessProposal,
  assertCanAccessApprovals,
  assertSalesPricingWithinLimits,
  isPolicyLeverOverride,
  assertOverrideReasonGiven,
  shapeProjectForRole,
  shapeRevisionForRole,
  PROJECT_TAB_MATRIX,
} = require('../../utils/commercial/dealEnginePermissions');
const { priceCommercialRevision } = require('../../services/commercial/commercialPricingService');

// Deal Engine Changes Required Rev 02 (19 Nov 2026), R1-R4 + R12-R13. Every function here is pure
// (no DB, no transaction) - unlike the CRM/Commercial integration suites, these tests run for
// real in every environment, including this one.

// ---------------------------------------------------------------- R1: role labels

test('R1: every role has one canonical label, matching the PDF\'s own wording', () => {
  assert.equal(roleLabel('md'), 'Managing Director');
  assert.equal(roleLabel('commercial_director'), 'Sales and Commercial Director');
  assert.equal(roleLabel('technical'), 'Technical Engineer');
  assert.equal(roleLabel('procurement'), 'Procurement');
  assert.equal(roleLabel('member'), 'Member');
  // Go-live Developer Pack section 5.2/5.4 - the two new Deal Engine roles.
  assert.equal(roleLabel('bdm'), 'Business Development Manager');
  assert.equal(roleLabel('marketing'), 'Marketing Coordinator');
});

// ---------------------------------------------------------------- R13: widest access across roles

test('R13: a user with no Commercial role gets "hidden" on every row - sees no Deal Engine data', () => {
  assert.equal(widestLevel(PROJECT_TAB_MATRIX.pricing, []), 'hidden');
  assert.equal(widestLevel(PROJECT_TAB_MATRIX.overview, undefined), 'hidden');
});

test('R13: a single-role user gets exactly that role\'s level', () => {
  assert.equal(projectTabAccess(['technical'], 'pricing'), 'hidden');
  // Go-live section 5.4: Sales Engineer's Pricing access is plain View - only BDM gets "Limited".
  assert.equal(projectTabAccess(['sales'], 'pricing'), 'view');
  assert.equal(projectTabAccess(['bdm'], 'pricing'), 'limited');
  assert.equal(projectTabAccess(['md'], 'pricing'), 'edit');
});

test('R13: a user holding BOTH technical (hidden on Pricing) and bdm (limited on Pricing) gets the WIDER right - limited, not hidden', () => {
  assert.equal(projectTabAccess(['technical', 'bdm'], 'pricing'), 'limited');
});

test('R13: a user holding both bdm (limited) and commercial_director (edit) gets edit - the widest of the two', () => {
  assert.equal(projectTabAccess(['bdm', 'commercial_director'], 'pricing'), 'edit');
});

test('R13: widest-access resolution works identically for engine pages (Materials/Suppliers), not just project tabs', () => {
  assert.equal(enginePageAccess(['technical'], 'materials'), 'view');
  assert.equal(enginePageAccess(['technical', 'procurement'], 'materials'), 'edit');
});

// ---------------------------------------------------------------- A1/A4/A12/A13: tab visibility ground truth

test('A1: technical gets Overview without prices, Engineering Input (design), Design checks, BOQ - and NOT Pricing/Feasibility/Proposal', () => {
  assert.equal(projectTabAccess(['technical'], 'overview'), 'view');
  assert.equal(projectTabAccess(['technical'], 'overviewPricing'), 'hidden');
  assert.equal(projectTabAccess(['technical'], 'engineeringInputDesign'), 'edit');
  assert.equal(projectTabAccess(['technical'], 'designChecks'), 'edit');
  assert.equal(projectTabAccess(['technical'], 'boqLines'), 'edit');
  assert.equal(projectTabAccess(['technical'], 'pricing'), 'hidden');
  assert.equal(projectTabAccess(['technical'], 'feasibility'), 'hidden');
  assert.equal(projectTabAccess(['technical'], 'proposal'), 'hidden');
});

test('Go-live section 5.4: BDM gets Pricing as "limited" (five levers read-only, category addition/discount editable); Sales Engineer gets plain View', () => {
  assert.equal(projectTabAccess(['bdm'], 'pricing'), 'limited');
  assert.equal(projectTabAccess(['sales'], 'pricing'), 'view');
});

test('Go-live section 5.4: Sales Engineer is VIEW ONLY on Engineering Input, both design and customer-facing sub-sections - never edit', () => {
  assert.equal(projectTabAccess(['sales'], 'engineeringInputCustomer'), 'view');
  assert.equal(projectTabAccess(['sales'], 'engineeringInputDesign'), 'view');
});

test('A12: procurement sees Overview and BOQ without prices, can open Materials/Suppliers, has no Pricing', () => {
  assert.equal(projectTabAccess(['procurement'], 'overview'), 'view');
  assert.equal(projectTabAccess(['procurement'], 'overviewPricing'), 'hidden');
  assert.equal(projectTabAccess(['procurement'], 'boqLines'), 'view');
  assert.equal(projectTabAccess(['procurement'], 'boqCosts'), 'hidden');
  assert.equal(projectTabAccess(['procurement'], 'pricing'), 'hidden');
  assert.equal(enginePageAccess(['procurement'], 'materials'), 'edit');
});

test('A13: member sees Overview only, with no prices, nothing else', () => {
  assert.equal(projectTabAccess(['member'], 'overview'), 'view');
  assert.equal(projectTabAccess(['member'], 'overviewPricing'), 'hidden');
  assert.equal(projectTabAccess(['member'], 'feasibility'), 'hidden');
  assert.equal(projectTabAccess(['member'], 'pricing'), 'hidden');
  assert.equal(projectTabAccess(['member'], 'proposal'), 'hidden');
});

test('A14: md has full edit access everywhere, including Materials and Suppliers', () => {
  for (const tab of Object.keys(PROJECT_TAB_MATRIX)) {
    assert.equal(projectTabAccess(['md'], tab), 'edit', `md must have edit on "${tab}"`);
  }
  assert.equal(enginePageAccess(['md'], 'materials'), 'edit');
  assert.equal(enginePageAccess(['md'], 'suppliers'), 'edit');
});

// ---------------------------------------------------------------- A3/A8: API write enforcement

test('A3-equivalent: a role with Pricing hidden cannot touch pricingOverrides at all, even an empty-looking patch', () => {
  assert.throws(() => assertPricingWriteAllowed(['technical'], { categoryAdditionPct: 0.15 }), /do not have access to Pricing/);
  assert.throws(() => assertPricingWriteAllowed(['procurement'], { discountPct: 0.02 }), /do not have access to Pricing/);
  assert.throws(() => assertPricingWriteAllowed(['member'], { overheadPct: 0.1 }), /do not have access to Pricing/);
});

test('Go-live: sales (plain View on Pricing) sending ANY pricing field at all is refused, including the category/discount fields BDM may touch', () => {
  assert.throws(() => assertPricingWriteAllowed(['sales'], { overheadPct: 0.12 }), /read-only for this role/);
  assert.throws(() => assertPricingWriteAllowed(['sales'], { categoryAdditionPct: 0.15, discountPct: 0.03 }), /read-only for this role/);
});

test('A8: bdm sending a policy lever (overhead) through the API is refused, naming the field', () => {
  assert.throws(() => assertPricingWriteAllowed(['bdm'], { overheadPct: 0.12 }), /overheadPct.*read-only/);
});

test('A6-equivalent: bdm sending ONLY category addition + discount is accepted (the two Sales-limits-owned fields)', () => {
  assert.doesNotThrow(() => assertPricingWriteAllowed(['bdm'], { categoryAdditionPct: 0.15, discountPct: 0.03 }));
});

test('bdm sending category addition bundled with ANY policy lever in the same request is still refused (no smuggling a disallowed field alongside an allowed one)', () => {
  assert.throws(() => assertPricingWriteAllowed(['bdm'], { categoryAdditionPct: 0.15, salesBonusPct: 0.06 }), /salesBonusPct/);
});

test('A10/A11-equivalent: commercial_director and md may send any pricing field without restriction', () => {
  assert.doesNotThrow(() => assertPricingWriteAllowed(['commercial_director'], { overheadPct: 0.12 }));
  assert.doesNotThrow(() => assertPricingWriteAllowed(['md'], { overheadPct: 0.12, discountPct: 0.2 }));
});

test('no pricingOverrides in the request is always a no-op, regardless of role (recomputing engineering-only changes must not require Pricing access)', () => {
  assert.doesNotThrow(() => assertPricingWriteAllowed(['technical'], undefined));
  assert.doesNotThrow(() => assertPricingWriteAllowed(['technical'], null));
});

test('A3: technical sending a design engineeringInput key is allowed (it is their own tab)', () => {
  assert.doesNotThrow(() => assertEngineeringInputWriteAllowed(['technical'], { moduleWatt: 670, kWp: 100 }));
});

// Go-live section 5.4's single "Engineering Input" row gives Technical Engineer Edit across the
// WHOLE tab (no design-vs-customer split, unlike the old Rev 02 matrix) - a customer-facing key
// is now allowed too, not refused.
test('Go-live: technical sending a CUSTOMER feasibility key (e.g. annualBillEgp) is now allowed - Technical Engineer edits the whole Engineering Input tab', () => {
  assert.doesNotThrow(() => assertEngineeringInputWriteAllowed(['technical'], { annualBillEgp: 50000 }));
});

// Go-live section 5.4: Sales Engineer moves to View-only on Engineering Input (both design and
// customer-facing) - they can no longer edit either sub-section, unlike the old Rev 02 matrix.
test('Go-live: sales sending ANY engineeringInput key (design or customer-facing) is refused - Sales Engineer is view-only on Engineering Input now', () => {
  assert.throws(() => assertEngineeringInputWriteAllowed(['sales'], { inverterModel: 'SUN2000-150KTL' }), /inverterModel.*design engineering input/);
  assert.throws(() => assertEngineeringInputWriteAllowed(['sales'], { annualBillEgp: 50000 }), /annualBillEgp.*customer feasibility input/);
});

test('bdm (full Deal Engine admin except Pricing Config) can send both design and customer-facing engineeringInput keys', () => {
  assert.doesNotThrow(() => assertEngineeringInputWriteAllowed(['bdm'], { inverterModel: 'SUN2000-150KTL' }));
  assert.doesNotThrow(() =>
    assertEngineeringInputWriteAllowed(['bdm'], {
      annualBillEgp: 50000, annualConsumptionKwh: 18000, tariffEgpPerKwh: 2.8, headlineEscalation: 0.1, discountRate: 0.12,
    })
  );
});

test('procurement/member cannot send ANY engineeringInput key - both design and customer keys are refused', () => {
  assert.throws(() => assertEngineeringInputWriteAllowed(['procurement'], { kWp: 50 }), /design engineering input/);
  assert.throws(() => assertEngineeringInputWriteAllowed(['member'], { annualBillEgp: 1000 }), /customer feasibility input/);
});

// ---------------------------------------------------------------- Proposal / Approvals gates

test('A1/A12: technical and procurement are refused access to the Proposal endpoints', () => {
  assert.throws(() => assertCanAccessProposal(['technical']), /Proposal/);
  assert.throws(() => assertCanAccessProposal(['procurement']), /Proposal/);
});

test('sales/commercial_director/md can access Proposal endpoints', () => {
  assert.doesNotThrow(() => assertCanAccessProposal(['sales']));
  assert.doesNotThrow(() => assertCanAccessProposal(['commercial_director']));
  assert.doesNotThrow(() => assertCanAccessProposal(['md']));
});

test('procurement is refused access to Approvals; every other role can at least view it', () => {
  assert.throws(() => assertCanAccessApprovals(['procurement']), /Approvals/);
  assert.doesNotThrow(() => assertCanAccessApprovals(['member']));
  assert.doesNotThrow(() => assertCanAccessApprovals(['technical']));
});

test('assertCanViewPricing throws for every role Pricing is hidden from, and passes for the rest', () => {
  for (const role of ['technical', 'procurement', 'member']) {
    assert.throws(() => assertCanViewPricing([role]), /Pricing/);
  }
  for (const role of ['sales', 'commercial_director', 'md']) {
    assert.doesNotThrow(() => assertCanViewPricing([role]));
  }
});

test('assertCanAccessEnginePage: sales/technical can VIEW Materials (read stays open) but cannot EDIT it', () => {
  assert.doesNotThrow(() => assertCanAccessEnginePage(['sales'], 'materials', 'view'));
  assert.throws(() => assertCanAccessEnginePage(['sales'], 'materials', 'edit'), /Materials/);
  assert.doesNotThrow(() => assertCanAccessEnginePage(['procurement'], 'materials', 'edit'));
});

// ---------------------------------------------------------------- R12: response redaction

test('shapeProjectForRole strips estimatedValueEgp/wonValueEgp/erpBudget for technical, keeps them for sales', () => {
  const project = { name: 'X', estimatedValueEgp: 100, wonValueEgp: 200, erpBudget: { totalBudgetEgp: 300 } };
  const forTechnical = shapeProjectForRole(project, ['technical']);
  assert.equal(forTechnical.estimatedValueEgp, undefined);
  assert.equal(forTechnical.wonValueEgp, undefined);
  assert.equal(forTechnical.erpBudget, undefined);
  assert.equal(forTechnical.name, 'X', 'non-price fields must be untouched');

  const forSales = shapeProjectForRole(project, ['sales']);
  assert.equal(forSales.estimatedValueEgp, 100);
  assert.equal(forSales.wonValueEgp, 200);
});

test('shapeProjectForRole also redacts an embedded currentRevision (the same object a getProject response nests it in)', () => {
  const project = { estimatedValueEgp: 100, currentRevision: { pricing: { netExclVat: 999 }, boqLines: [{ component: 'Pump', unitPrice: 50, total: 50 }] } };
  const shaped = shapeProjectForRole(project, ['procurement']);
  assert.equal(shaped.currentRevision.pricing, undefined);
  assert.equal(shaped.currentRevision.boqLines[0].unitPrice, undefined, 'procurement sees BOQ lines without cost fields');
  assert.equal(shaped.currentRevision.boqLines[0].component, 'Pump', 'component/qty must stay visible to procurement');
});

test('shapeRevisionForRole strips pricing and feasibility for technical, keeps BOQ lines+costs (technical owns BOQ)', () => {
  const revision = { pricing: { netExclVat: 999 }, feasibility: { paybackYears: 5 }, boqLines: [{ component: 'Pump', unitPrice: 50, total: 50 }], boqTotal: 50 };
  const shaped = shapeRevisionForRole(revision, ['technical']);
  assert.equal(shaped.pricing, undefined);
  assert.equal(shaped.feasibility, undefined);
  assert.equal(shaped.boqLines[0].unitPrice, 50, 'technical keeps full BOQ including costs (boqCosts=view for technical)');
});

// Go-live section 5.4: Sales Engineer gains BOQ view access (items AND costs) - was fully hidden
// under the old Rev 02 matrix. Pricing/Feasibility stay visible too (both 'view').
test('shapeRevisionForRole keeps pricing/feasibility/BOQ (incl. costs) for sales - all view-level, nothing hidden', () => {
  const revision = { pricing: { netExclVat: 999 }, feasibility: { paybackYears: 5 }, boqLines: [{ component: 'Pump', total: 50, unitPrice: 25 }], boqTotal: 50 };
  const shaped = shapeRevisionForRole(revision, ['sales']);
  assert.equal(shaped.pricing.netExclVat, 999);
  assert.equal(shaped.feasibility.paybackYears, 5);
  assert.equal(shaped.boqLines[0].unitPrice, 25);
  assert.equal(shaped.boqTotal, 50);
});

// Marketing gets Feasibility/Proposal view but Pricing/BOQ/Engineering Input stay hidden entirely.
test('shapeRevisionForRole strips pricing and BOQ for marketing, keeps feasibility', () => {
  const revision = { pricing: { netExclVat: 999 }, feasibility: { paybackYears: 5 }, boqLines: [{ component: 'Pump', total: 50 }], boqTotal: 50 };
  const shaped = shapeRevisionForRole(revision, ['marketing']);
  assert.equal(shaped.pricing, undefined);
  assert.equal(shaped.feasibility.paybackYears, 5);
  assert.equal(shaped.boqLines, undefined);
  assert.equal(shaped.boqTotal, undefined);
});

test('shapeRevisionForRole gives md everything untouched', () => {
  const revision = { pricing: { netExclVat: 999 }, feasibility: { paybackYears: 5 }, boqLines: [{ component: 'Pump', unitPrice: 50 }], boqTotal: 50 };
  const shaped = shapeRevisionForRole(revision, ['md']);
  assert.deepEqual(shaped, revision);
});

// ---------------------------------------------------------------- R9: Sales-limits validation
// Every scenario below uses the PDF's own worked example (294.8 kWp factory, COGS EGP 4,467,599,
// policy v1: overhead 10%, contingency 2%, profit 10%, sales bonus 5.5%, engineering incentive 5%,
// policy default category addition 19%) - the pricing object is the REAL priceCommercialRevision()
// output for each scenario, not a hand-built fixture, so this is exercising the actual formula.

const WORKED_EXAMPLE_LEVERS = { cogs: 4467599, overheadPct: 0.1, contingencyPct: 0.02, profitPct: 0.1, salesBonusPct: 0.055, engineeringIncentivePct: 0.05, vatPct: 0.14 };
const EXAMPLE_LIMITS = { categoryAdditionDefaultPct: 0.19, categoryAdditionMinPct: 0.1, categoryAdditionMaxPct: 0.19, discountMaxPct: 0.05, concessionCeilingPct: 0.08, gpFloorPct: 0.15 };

function priced(categoryAdditionPct, discountPct) {
  return priceCommercialRevision({ ...WORKED_EXAMPLE_LEVERS, categoryAdditionPct, discountPct });
}

test('A6: category 15%/discount 3% -> concession 6.26%, inside the 8% ceiling -> accepted', () => {
  const pricing = priced(0.15, 0.03);
  assert.equal(Math.round(pricing.netExclVat), 6195121); // matches the PDF's own figure exactly
  assert.doesNotThrow(() => assertSalesPricingWithinLimits(['bdm'], pricing, EXAMPLE_LIMITS));
});

test('A7: category 10%/discount 5% -> each value is within its own range, but the COMBINED concession (12.18%) breaks the 8% ceiling -> refused', () => {
  const pricing = priced(0.1, 0.05);
  assert.equal(Math.round(pricing.netExclVat), 5803588); // matches the PDF's own figure exactly
  assert.throws(() => assertSalesPricingWithinLimits(['bdm'], pricing, EXAMPLE_LIMITS), err => {
    assert.match(err.message, /Concession 12\.2% .* above the 8% ceiling/);
    assert.equal(err.statusCode, 400);
    return true;
  });
});

test('A5: discount 7% (policy max 5%) is refused on the discount check alone, naming the field - never gets as far as computing a concession', () => {
  const pricing = priced(0.19, 0.07); // category still at the policy default - only discount is out of range
  assert.throws(() => assertSalesPricingWithinLimits(['bdm'], pricing, EXAMPLE_LIMITS), /Discount 7% is above the 5% allowed for Sales/);
});

test('category addition below the minimum is refused, naming the field', () => {
  const pricing = priced(0.05, 0);
  assert.throws(() => assertSalesPricingWithinLimits(['bdm'], pricing, EXAMPLE_LIMITS), /Category addition 5% is below the 10% minimum/);
});

test('category addition above the maximum is refused, naming the field', () => {
  const pricing = priced(0.25, 0);
  assert.throws(() => assertSalesPricingWithinLimits(['bdm'], pricing, EXAMPLE_LIMITS), /Category addition 25% is above the 19% maximum/);
});

test('gross profit below the floor is refused, independent of the concession check', () => {
  // Deliberately tiny profit lever to drag GP% below a 40% floor - isolates the GP-floor branch.
  const pricing = priced(0.19, 0);
  assert.throws(() => assertSalesPricingWithinLimits(['bdm'], pricing, { ...EXAMPLE_LIMITS, gpFloorPct: 0.4 }), /Gross profit .* is below the 40% floor/);
});

test('every Sales-limits check is SKIPPED (not approximated) when its limit is unset (null) - "do not invent missing business limits"', () => {
  const pricing = priced(0.05, 0.2); // would violate every bound above if any were enforced
  const unset = { categoryAdditionDefaultPct: 0.19, categoryAdditionMinPct: null, categoryAdditionMaxPct: null, discountMaxPct: null, concessionCeilingPct: null, gpFloorPct: null };
  assert.doesNotThrow(() => assertSalesPricingWithinLimits(['bdm'], pricing, unset));
});

test('S&C Director and MD are "editable without limit" - the Sales-limits check never applies to them, no matter the values', () => {
  const pricing = priced(0.05, 0.3);
  assert.doesNotThrow(() => assertSalesPricingWithinLimits(['commercial_director'], pricing, EXAMPLE_LIMITS));
  assert.doesNotThrow(() => assertSalesPricingWithinLimits(['md'], pricing, EXAMPLE_LIMITS));
});

test('a mixed technical+bdm user still gets the Sales-limits check (widest Pricing access is "limited", not "edit")', () => {
  const pricing = priced(0.1, 0.05);
  assert.throws(() => assertSalesPricingWithinLimits(['technical', 'bdm'], pricing, EXAMPLE_LIMITS), /ceiling/);
});

// ---------------------------------------------------------------- R11: deal override + reason

test('isPolicyLeverOverride: S&C/MD touching a policy lever on a deal IS an override; touching only category/discount is NOT', () => {
  assert.equal(isPolicyLeverOverride(['commercial_director'], { overheadPct: 0.12 }), true);
  assert.equal(isPolicyLeverOverride(['md'], { profitPct: 0.08 }), true);
  assert.equal(isPolicyLeverOverride(['commercial_director'], { categoryAdditionPct: 0.15, discountPct: 0.03 }), false);
  assert.equal(isPolicyLeverOverride(['bdm'], { categoryAdditionPct: 0.15 }), false, 'bdm has "limited" access, never "edit" - never an override by this definition');
  assert.equal(isPolicyLeverOverride(['technical'], { overheadPct: 0.12 }), false, 'technical has no Pricing access at all - assertPricingWriteAllowed would already have refused this');
  assert.equal(isPolicyLeverOverride(['md'], undefined), false);
});

test('assertOverrideReasonGiven throws on empty/whitespace-only/missing reasons, passes on a real one', () => {
  assert.throws(() => assertOverrideReasonGiven(undefined), /A reason is required/);
  assert.throws(() => assertOverrideReasonGiven(''), /A reason is required/);
  assert.throws(() => assertOverrideReasonGiven('   '), /A reason is required/);
  assert.doesNotThrow(() => assertOverrideReasonGiven('Customer matched a competitor quote - approved by the MD on the call.'));
});
