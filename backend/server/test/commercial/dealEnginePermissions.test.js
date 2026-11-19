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
  shapeProjectForRole,
  shapeRevisionForRole,
  PROJECT_TAB_MATRIX,
} = require('../../utils/commercial/dealEnginePermissions');

// Deal Engine Changes Required Rev 02 (19 Nov 2026), R1-R4 + R12-R13. Every function here is pure
// (no DB, no transaction) - unlike the CRM/Commercial integration suites, these tests run for
// real in every environment, including this one.

// ---------------------------------------------------------------- R1: role labels

test('R1: every role has one canonical label, matching the PDF\'s own wording', () => {
  assert.equal(roleLabel('md'), 'Managing Director');
  assert.equal(roleLabel('commercial_director'), 'Sales and Commercial Director');
  assert.equal(roleLabel('technical'), 'Technical');
  assert.equal(roleLabel('procurement'), 'Procurement');
  assert.equal(roleLabel('member'), 'Member');
});

// ---------------------------------------------------------------- R13: widest access across roles

test('R13: a user with no Commercial role gets "hidden" on every row - sees no Deal Engine data', () => {
  assert.equal(widestLevel(PROJECT_TAB_MATRIX.pricing, []), 'hidden');
  assert.equal(widestLevel(PROJECT_TAB_MATRIX.overview, undefined), 'hidden');
});

test('R13: a single-role user gets exactly that role\'s level', () => {
  assert.equal(projectTabAccess(['technical'], 'pricing'), 'hidden');
  assert.equal(projectTabAccess(['sales'], 'pricing'), 'limited');
  assert.equal(projectTabAccess(['md'], 'pricing'), 'edit');
});

test('R13: a user holding BOTH technical (hidden on Pricing) and sales (limited on Pricing) gets the WIDER right - limited, not hidden', () => {
  assert.equal(projectTabAccess(['technical', 'sales'], 'pricing'), 'limited');
});

test('R13: a user holding both sales (limited) and commercial_director (edit) gets edit - the widest of the two', () => {
  assert.equal(projectTabAccess(['sales', 'commercial_director'], 'pricing'), 'edit');
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

test('A4: sales gets Pricing as "limited" (five levers read-only, category addition/discount editable)', () => {
  assert.equal(projectTabAccess(['sales'], 'pricing'), 'limited');
});

test('A9: sales can edit customer feasibility inputs; design inputs stay read-only for sales', () => {
  assert.equal(projectTabAccess(['sales'], 'engineeringInputCustomer'), 'edit');
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

test('A8: sales sending a policy lever (overhead) through the API is refused, naming the field', () => {
  assert.throws(() => assertPricingWriteAllowed(['sales'], { overheadPct: 0.12 }), /overheadPct.*read-only for Sales/);
});

test('A6-equivalent: sales sending ONLY category addition + discount is accepted (the two Sales-owned fields)', () => {
  assert.doesNotThrow(() => assertPricingWriteAllowed(['sales'], { categoryAdditionPct: 0.15, discountPct: 0.03 }));
});

test('sales sending category addition bundled with ANY policy lever in the same request is still refused (no smuggling a disallowed field alongside an allowed one)', () => {
  assert.throws(() => assertPricingWriteAllowed(['sales'], { categoryAdditionPct: 0.15, salesBonusPct: 0.06 }), /salesBonusPct/);
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

test('A9: technical sending a CUSTOMER feasibility key (e.g. annualBillEgp) through the API is refused, naming the field', () => {
  assert.throws(() => assertEngineeringInputWriteAllowed(['technical'], { annualBillEgp: 50000 }), /annualBillEgp.*customer feasibility input/);
});

test('sales sending a DESIGN key (not one of the customer-facing ones) is refused, naming the field', () => {
  assert.throws(() => assertEngineeringInputWriteAllowed(['sales'], { inverterModel: 'SUN2000-150KTL' }), /inverterModel.*design engineering input/);
});

test('sales sending its own customer feasibility keys (bills, consumption, tariff, escalation, discount rate) is allowed', () => {
  assert.doesNotThrow(() =>
    assertEngineeringInputWriteAllowed(['sales'], {
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

test('shapeRevisionForRole keeps pricing/feasibility for sales (Pricing=limited, Feasibility=edit for sales), strips BOQ entirely (sales has no BOQ access)', () => {
  const revision = { pricing: { netExclVat: 999 }, feasibility: { paybackYears: 5 }, boqLines: [{ component: 'Pump', total: 50 }], boqTotal: 50 };
  const shaped = shapeRevisionForRole(revision, ['sales']);
  assert.equal(shaped.pricing.netExclVat, 999);
  assert.equal(shaped.feasibility.paybackYears, 5);
  assert.equal(shaped.boqLines, undefined);
  assert.equal(shaped.boqTotal, undefined);
});

test('shapeRevisionForRole gives md everything untouched', () => {
  const revision = { pricing: { netExclVat: 999 }, feasibility: { paybackYears: 5 }, boqLines: [{ component: 'Pump', unitPrice: 50 }], boqTotal: 50 };
  const shaped = shapeRevisionForRole(revision, ['md']);
  assert.deepEqual(shaped, revision);
});
