'use strict';

const ApiError = require('../apiError');
const { priceCommercialRevision } = require('../../services/commercial/commercialPricingService');

// Reservia Deal Engine - Changes Required Rev 02 (19 Nov 2026), R1-R4 + R12-R13: the ONE place the
// tab/field visibility matrix (section 4) and the pricing-authority split (section 5) are defined.
// Every controller that reads or writes a Commercial project/revision must go through this module,
// never re-decide a role's access inline - that is exactly how the tab matrix and the API would
// drift apart again (T1/T2/T7 in the same document: today nothing ties a tab to a role at all, and
// the few places that DO check a role use three different spellings of it).
//
// R13: "a user with no Deal Engine role sees no Deal Engine data; a user with two roles gets the
// wider right for each field." Every function below takes an ARRAY of roles (req.commercialRoles,
// middleware/commercialAccess.js) and resolves the WIDEST access across all of them - correct for
// today's near-universal single-role case (the array just has one element) and for the day a user
// is ever granted a second Commercial membership, with no second migration needed.

// R1: one label everywhere. The CODE (systemsRegistry.js, User Management, approval checks) never
// changes; this is the single place a human-readable label is attached to it.
const ROLE_LABELS = {
  md: 'Managing Director',
  commercial_director: 'Sales and Commercial Director',
  sales: 'Sales Engineer',
  technical: 'Technical Engineer',
  procurement: 'Procurement',
  member: 'Member',
  // Go-live Developer Pack section 5.2/5.4 - the two Deal Engine roles that did not exist before.
  bdm: 'Business Development Manager',
  marketing: 'Marketing Coordinator',
};
function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

// Access levels, ordered low to high - "widest" picks the highest-ranked level across a user's roles.
const LEVEL_RANK = { hidden: 0, view: 1, limited: 2, edit: 3 };
const ALL_ROLES = ['md', 'commercial_director', 'sales', 'technical', 'procurement', 'member', 'bdm', 'marketing'];

/**
 * One matrix row: { md, commercial_director, sales, technical, procurement, member } -> access level.
 * Source: Deal Engine Changes Required Rev 02, section 4.1 (project tabs) and 4.2 (engine pages),
 * cross-checked against the acceptance tests A1-A14 in section 7 wherever the PDF's own table
 * layout was ambiguous (its multi-line cells did not survive text extraction cleanly) - A1-A14 are
 * unambiguous "as X, action Y, expected Z" statements and are treated as the ground truth whenever
 * they conflict with a garbled table cell. Every such judgment call is called out below so the MD
 * can correct it directly against the PDF rather than it staying a silent guess.
 */
// Go-live Developer Pack, section 5.4 (23 Nov 2026, MD-approved - supersedes the Rev 02 judgment
// calls below wherever the two actually conflict): adds `bdm` and `marketing`, and reconciles
// `sales`/`commercial_director` against the new, authoritative access matrix. Reconciliation
// notes (every deviation from the OLD Rev02 values is deliberate, not an oversight):
//   - `sales` (the real Sales Engineer's Deal Engine role) moves from edit/limited down to VIEW
//     on Overview, Engineering Input, BOQ items and Pricing - section 5.4's table gives Sales
//     Engineer "View" across all of these; only Stage 1 approval (on deals they own - see
//     services/commercial/approvalService.js) and Proposal issuance stay theirs to act on.
//   - `commercial_director` (S&C Director) GAINS BOQ items/costs access (edit) - this is the
//     explicit F6 fix ("today the commercial_director role has no BOQ tab and cannot raise POs"),
//     and gains Materials edit access.
//   - The table has ONE "Engineering Input" row where Rev 02 had two (design vs. customer-facing
//     sub-sections) - both engineeringInputDesign/Customer below take the SAME value per role for
//     md/commercial_director/sales/technical/bdm/marketing, since the new table does not draw that
//     finer distinction; procurement/member (not part of the new matrix) keep their Rev 02 values.
//   - `marketing` gets Feasibility + Proposal preview as VIEW ONLY (explicit in the matrix) - never
//     edit, never issue, never Pricing.
//   - `bdm` never gets Pricing Config (pricingPolicy) - explicit "BDM: full Deal Engine admin
//     EXCEPT Pricing Config" in the task brief.
const PROJECT_TAB_MATRIX = {
  // Section 4.1. "Hidden" here means the API omits the field/section entirely (R12) - not just an
  // empty value.
  overview: { md: 'edit', commercial_director: 'edit', sales: 'view', technical: 'view', procurement: 'view', member: 'view', bdm: 'edit', marketing: 'view' },
  // Price, GP, release status sub-section of Overview - derived from each role's Pricing-tab level
  // below (view-or-higher on Pricing => view here; hidden on Pricing => hidden here), since the
  // go-live matrix does not split this out as its own row.
  overviewPricing: { md: 'edit', commercial_director: 'edit', sales: 'view', technical: 'hidden', procurement: 'hidden', member: 'hidden', bdm: 'view', marketing: 'hidden' },
  // R3: design inputs (module, kWp, inverter, structure, area...) - go-live section 5.4's single
  // "Engineering Input" row, applied uniformly (see header note above).
  engineeringInputDesign: { md: 'edit', commercial_director: 'edit', sales: 'view', technical: 'edit', procurement: 'hidden', member: 'hidden', bdm: 'edit', marketing: 'hidden' },
  engineeringInputCustomer: { md: 'edit', commercial_director: 'edit', sales: 'view', technical: 'edit', procurement: 'hidden', member: 'hidden', bdm: 'edit', marketing: 'hidden' },
  // Judgment call (table cell garbled, no direct acceptance test): a pass/fail engineering QA
  // checklist, not needed by Sales/S&C for their commercial work. MD keeps full access everywhere.
  designChecks: { md: 'edit', commercial_director: 'hidden', sales: 'hidden', technical: 'edit', procurement: 'hidden', member: 'hidden', bdm: 'hidden', marketing: 'hidden' },
  // Go-live F6: commercial_director GAINS BOQ access (edit) - was hidden under Rev 02.
  boqLines: { md: 'edit', commercial_director: 'edit', sales: 'view', technical: 'edit', procurement: 'view', member: 'hidden', bdm: 'edit', marketing: 'hidden' },
  boqCosts: { md: 'edit', commercial_director: 'edit', sales: 'view', technical: 'view', procurement: 'hidden', member: 'hidden', bdm: 'edit', marketing: 'hidden' },
  // The Pricing tab itself (five levers + category addition + discount + price corridor). "limited"
  // for bdm = category addition + discount only, same enforcement as the old Sales row (section
  // 5.2's "BDM Pricing 'Limited'" note) - `sales` moves to plain VIEW per the new matrix (Sales
  // Engineer no longer touches pricing levers at all, only sees the numbers).
  pricing: { md: 'edit', commercial_director: 'edit', sales: 'view', technical: 'hidden', procurement: 'hidden', member: 'hidden', bdm: 'limited', marketing: 'hidden' },
  // Go-live: Sales Engineer moves to View (was edit); Marketing gets explicit View (new).
  feasibility: { md: 'edit', commercial_director: 'edit', sales: 'view', technical: 'hidden', procurement: 'hidden', member: 'hidden', bdm: 'edit', marketing: 'view' },
  // Stage 1 (sales/technical/bdm may sign - approvalService.js STAGE1 role list; a Sales Engineer
  // may only sign a deal they OWN - see commercialProjectModel.js#owner and approvalService.js's
  // own ownership check, not this tab-visibility matrix). S&C/MD view only until it's their stage.
  approvalsStage1: { md: 'edit', commercial_director: 'view', sales: 'edit', technical: 'edit', procurement: 'hidden', member: 'view', bdm: 'edit', marketing: 'hidden' },
  // Stage 2 (commercial_director only, per approvalService.js STAGE2) + MD final sign-off view.
  approvalsStage2: { md: 'edit', commercial_director: 'edit', sales: 'view', technical: 'hidden', procurement: 'hidden', member: 'view', bdm: 'view', marketing: 'hidden' },
  // Go-live: Marketing gets explicit View (preview/download only, never issue - see
  // assertCanIssueProposal below); Sales Engineer keeps edit (may issue on deals they own).
  proposal: { md: 'edit', commercial_director: 'edit', sales: 'edit', technical: 'hidden', procurement: 'hidden', member: 'hidden', bdm: 'edit', marketing: 'view' },
};

const ENGINE_PAGE_MATRIX = {
  // A12: procurement "can open Materials and Suppliers"; role definitions section 3: "procurement
  // owns Materials, Suppliers and price list uploads." READS stay open to every Commercial-access
  // role for both pages - deliberate, pre-existing, documented behaviour this matrix must NOT
  // regress: BOQ lines reference both a materialItemKey and a supplierCode
  // (commercialRevisionModel.js#boqLineSchema), so even Technical reading a BOQ needs to resolve
  // what they mean (supplierRoute.js's own comment: "Every Deal Engine user can read the supplier
  // list - the BOQ shows supplier codes"). Only WRITE access is role-restricted below. Go-live:
  // commercial_director gains edit (Materials/Price Book = Edit); bdm gets view.
  materials: { md: 'edit', commercial_director: 'edit', sales: 'view', technical: 'view', procurement: 'edit', member: 'view', bdm: 'view', marketing: 'hidden' },
  // Suppliers' write gate already exists and is correct (services/commercial/supplierService.js
  // EDIT_ROLES = md/commercial_director/procurement/bdm - go-live adds bdm, "Propose suppliers:
  // Edit") - this row is for reference/the frontend's tab visibility only; the API gate is NOT
  // re-applied here to avoid a second, possibly-diverging source of truth for a route that already
  // enforces this correctly.
  suppliers: { md: 'edit', commercial_director: 'edit', sales: 'view', technical: 'view', procurement: 'edit', member: 'view', bdm: 'edit', marketing: 'hidden' },
  // Pricing Policy / Engineering Settings / Exchange Rates / Proposal Text do not exist as separate
  // pages yet (R5 - today's single combined Pricing Config page; see Phase 3). Listed here for the
  // page split's own future reference; pricingConfigController.js already enforces exactly this
  // read/write split today via canManagePricingConfig (md/commercial_director), independently of
  // this matrix. Go-live: BDM and every other non-md/commercial_director role is explicitly NEVER
  // given Pricing Config - "BDM: full Deal Engine admin EXCEPT Pricing Config."
  pricingPolicy: { md: 'edit', commercial_director: 'edit', sales: 'hidden', technical: 'hidden', procurement: 'hidden', member: 'hidden', bdm: 'hidden', marketing: 'hidden' },
};

/** Highest access level across all the user's Commercial roles for one matrix row. R13. */
function widestLevel(matrixRow, roles) {
  let best = 'hidden';
  for (const role of roles || []) {
    const level = matrixRow[role];
    if (level && LEVEL_RANK[level] > LEVEL_RANK[best]) best = level;
  }
  return best;
}

function projectTabAccess(roles, tab) {
  const row = PROJECT_TAB_MATRIX[tab];
  if (!row) throw new Error(`Unknown Deal Engine tab "${tab}".`);
  return widestLevel(row, roles);
}

function enginePageAccess(roles, page) {
  const row = ENGINE_PAGE_MATRIX[page];
  if (!row) throw new Error(`Unknown Deal Engine page "${page}".`);
  return widestLevel(row, roles);
}

const canView = level => level !== 'hidden';
const canEdit = level => level === 'edit' || level === 'limited';
const canEditFully = level => level === 'edit';

// R3 - which engineeringInput keys are the CUSTOMER-FACING feasibility inputs Sales may edit
// (section 1/R3 wording: "bills, consumption, tariff, escalation scenarios, discount rate"). Real
// key names confirmed against services/commercial/boqService.js#computeFeasibility, the one place
// that actually reads them. Every other engineeringInput key (module/kWp/inverter/area/structure/
// yield/irradiation/replacement-year and every category-specific design field) is Technical's.
const CUSTOMER_INPUT_KEYS = [
  'annualBillEgp', 'annualConsumptionKwh', 'tariffEgpPerKwh', 'tariffNote',
  'headlineEscalation', 'sensitivityEscalations', 'escalationScenario2', 'escalationScenario3',
  'discountRate', 'maintenancePctOfCapex', 'degradationPct',
];

// Section 5.2 - the five policy levers (read-only to Sales; a deal override, reason required, for
// S&C/MD) vs. the two fields Sales may move within limits (category addition, discount - Phase 2
// allows Sales to send these two with NO range check yet; the Sales-limits range/ceiling/floor
// validation is R9, which needs R6-R8's new Pricing Policy fields - Phase 3, tracked separately,
// not invented here).
const POLICY_LEVER_KEYS = ['overheadPct', 'contingencyPct', 'profitPct', 'salesBonusPct', 'engineeringIncentivePct'];
const SALES_LIMITED_PRICING_KEYS = ['categoryAdditionPct', 'discountPct'];

/**
 * R12/R9(partial): checks a revision recompute/create request against the Pricing-tab field split.
 * Throws a 403 naming the exact field and limit, matching the PDF's own example message style
 * ("Discount 7% is above the 5% allowed for Sales. Ask the Sales and Commercial Director." - the
 * RANGE check itself is R9/Phase 3; this enforces WHO may touch the field at all).
 */
function assertPricingWriteAllowed(roles, pricingOverrides) {
  if (!pricingOverrides || typeof pricingOverrides !== 'object') return;
  const level = widestLevel(PROJECT_TAB_MATRIX.pricing, roles);
  if (!canView(level)) {
    throw new ApiError('You do not have access to Pricing on this deal.', 403);
  }
  if (level === 'edit') return; // S&C / MD: no restriction here (R5.2 "editable without limit").
  // Go-live section 5.4: plain VIEW (the real Sales Engineer's role today) means read-only - not
  // even the two Sales-owned fields below, which is 'limited' specifically (BDM: category
  // addition + discount within Sales limits).
  if (level === 'view') {
    throw new ApiError('Pricing is read-only for this role - ask the Sales and Commercial Director or BDM to change it.', 403);
  }
  // level === 'limited' (BDM) - only the two Sales-limits-owned fields.
  const keys = Object.keys(pricingOverrides);
  const disallowed = keys.filter(k => !SALES_LIMITED_PRICING_KEYS.includes(k));
  if (disallowed.length) {
    const policyField = disallowed.find(k => POLICY_LEVER_KEYS.includes(k)) || disallowed[0];
    throw new ApiError(
      `${policyField} is a pricing policy lever - read-only for this role. Ask the Sales and Commercial Director to change it.`,
      403
    );
  }
}

/** R12/R3: checks a revision recompute/create request against the design/customer input-key split. */
function assertEngineeringInputWriteAllowed(roles, engineeringInput) {
  if (!engineeringInput || typeof engineeringInput !== 'object') return;
  const designLevel = widestLevel(PROJECT_TAB_MATRIX.engineeringInputDesign, roles);
  const customerLevel = widestLevel(PROJECT_TAB_MATRIX.engineeringInputCustomer, roles);
  for (const key of Object.keys(engineeringInput)) {
    const isCustomerKey = CUSTOMER_INPUT_KEYS.includes(key);
    const level = isCustomerKey ? customerLevel : designLevel;
    if (!canEdit(level)) {
      throw new ApiError(
        isCustomerKey
          ? `"${key}" is a customer feasibility input - Technical cannot edit it. Ask Sales.`
          : `"${key}" is a design engineering input - only Technical (or the MD) can edit it.`,
        403
      );
    }
  }
}

/** R12: a blanket gate for the whole Pricing tab (used by read-side endpoints, not the recompute write path above). */
function assertCanViewPricing(roles) {
  if (!canView(widestLevel(PROJECT_TAB_MATRIX.pricing, roles))) {
    throw new ApiError('You do not have access to Pricing on this deal.', 403);
  }
}

/** R12: the whole Proposal tab is Hidden to Technical/Procurement/Member (A1/A12/A13). */
function assertCanAccessProposal(roles) {
  if (!canView(widestLevel(PROJECT_TAB_MATRIX.proposal, roles))) {
    throw new ApiError('You do not have access to the Proposal for this deal.', 403);
  }
}

/**
 * Go-live Developer Pack section 5.4: issuing a proposal needs EDIT-level Proposal access, not
 * just view - Marketing Coordinator (and anyone else at 'view' on this row) can preview/download
 * but never issue. Stricter than assertCanAccessProposal on purpose; always check this before
 * actually issuing, never the view-level check alone.
 */
function assertCanIssueProposal(roles) {
  if (!canEditFully(widestLevel(PROJECT_TAB_MATRIX.proposal, roles))) {
    throw new ApiError('You do not have access to issue a proposal for this deal.', 403);
  }
}

/** R12: Approvals are Hidden to Procurement (A12 does not list Approvals among what procurement may open). */
function assertCanAccessApprovals(roles) {
  const level = widestLevel(PROJECT_TAB_MATRIX.approvalsStage1, roles) === 'hidden' && widestLevel(PROJECT_TAB_MATRIX.approvalsStage2, roles) === 'hidden' ? 'hidden' : 'view';
  if (level === 'hidden') {
    throw new ApiError('You do not have access to Approvals for this deal.', 403);
  }
}

function assertCanAccessEnginePage(roles, page, action = 'view') {
  const level = enginePageAccess(roles, page);
  if (action === 'view' && !canView(level)) {
    throw new ApiError(`You do not have access to ${page === 'materials' ? 'Materials' : 'Suppliers'} in the Deal Engine.`, 403);
  }
  if (action === 'edit' && !canEditFully(level)) {
    throw new ApiError(`You are not allowed to change ${page === 'materials' ? 'Materials' : 'Suppliers'} in the Deal Engine.`, 403);
  }
}

/**
 * R12: redacts a plain CommercialProject object for the given roles - price/GP/release-status
 * fields disappear entirely (not just zeroed) for roles the Overview-pricing row hides them from
 * (A1/A12/A13). `currentRevision`, if populated, is redacted too via shapeRevisionForRole.
 */
function shapeProjectForRole(projectObj, roles) {
  if (!projectObj) return projectObj;
  const out = { ...projectObj };
  if (!canView(widestLevel(PROJECT_TAB_MATRIX.overviewPricing, roles))) {
    delete out.estimatedValueEgp;
    delete out.wonValueEgp;
    delete out.erpBudget;
  }
  if (out.currentRevision && typeof out.currentRevision === 'object') {
    out.currentRevision = shapeRevisionForRole(out.currentRevision, roles);
  }
  return out;
}

/** R12: redacts a plain CommercialRevision object - pricing/feasibility/BOQ-cost fields per the matrix. */
function shapeRevisionForRole(revisionObj, roles) {
  if (!revisionObj) return revisionObj;
  const out = { ...revisionObj };
  // Go-live audit: designChecks is 'hidden' for sales/commercial_director/procurement/member/bdm/
  // marketing in the matrix above, but engineeringResult (inverter pick, DC/AC ratio) was never
  // actually stripped for them - the Design Checks card relies entirely on the matrix's
  // tab-visibility gate, which it does not share a row with. Caught by re-reading this function
  // against every PROJECT_TAB_MATRIX row, not by a failing test.
  if (!canView(widestLevel(PROJECT_TAB_MATRIX.designChecks, roles))) delete out.engineeringResult;
  if (!canView(widestLevel(PROJECT_TAB_MATRIX.pricing, roles))) delete out.pricing;
  if (!canView(widestLevel(PROJECT_TAB_MATRIX.feasibility, roles))) {
    delete out.feasibility;
    delete out.dieselComparison;
  }
  const boqCostLevel = widestLevel(PROJECT_TAB_MATRIX.boqCosts, roles);
  if (!canView(widestLevel(PROJECT_TAB_MATRIX.boqLines, roles))) {
    delete out.boqLines;
    delete out.boqTotal;
  } else if (!canView(boqCostLevel) && Array.isArray(out.boqLines)) {
    out.boqLines = out.boqLines.map(l => {
      const { unitPrice, total, autoUnitPrice, foreignPrice, ...rest } = l;
      return rest;
    });
    delete out.boqTotal;
  }
  return out;
}

/**
 * R9: server-side validation of a COMPUTED revision's pricing against the policy version's Sales
 * limits - run only when the acting roles are Sales-limited on Pricing (S&C/MD are "editable
 * without limit", section 5.2). `pricing` is the real priceCommercialRevision() result the
 * revision was just computed with (not a guess); `salesLimits` is pricingConfigService's resolved
 * per-category row (section 5.1/R7). Every check is skipped (not approximated) when its limit is
 * still unset (null) - "do not invent missing approved business limits".
 *
 * Concession % = (policy net price - this net price) / policy net price, where the policy net
 * price is the SAME cogs/levers/VAT priced at the policy's own default category addition and zero
 * discount - verified byte-for-byte against the PDF's worked example (294.8 kWp factory, COGS EGP
 * 4,467,599): category 15%/discount 3% -> 6.26% (A6), category 10%/discount 5% -> 12.18% (A7).
 */
function assertSalesPricingWithinLimits(roles, pricing, salesLimits) {
  const level = widestLevel(PROJECT_TAB_MATRIX.pricing, roles);
  if (level !== 'limited') return; // S&C/MD: "editable without limit" - nothing to check.
  if (!salesLimits) return;

  const { categoryAdditionMinPct, categoryAdditionMaxPct, discountMaxPct, concessionCeilingPct, gpFloorPct, categoryAdditionDefaultPct } = salesLimits;

  if (categoryAdditionMinPct != null && pricing.categoryAdditionPct < categoryAdditionMinPct) {
    throw new ApiError(`Category addition ${pct(pricing.categoryAdditionPct)} is below the ${pct(categoryAdditionMinPct)} minimum allowed for Sales. Ask the Sales and Commercial Director.`, 400);
  }
  if (categoryAdditionMaxPct != null && pricing.categoryAdditionPct > categoryAdditionMaxPct) {
    throw new ApiError(`Category addition ${pct(pricing.categoryAdditionPct)} is above the ${pct(categoryAdditionMaxPct)} maximum allowed for Sales. Ask the Sales and Commercial Director.`, 400);
  }
  if (discountMaxPct != null && pricing.discountPct > discountMaxPct) {
    throw new ApiError(`Discount ${pct(pricing.discountPct)} is above the ${pct(discountMaxPct)} allowed for Sales. Ask the Sales and Commercial Director.`, 400);
  }
  if (gpFloorPct != null && pricing.grossProfitPct != null && pricing.grossProfitPct < gpFloorPct) {
    throw new ApiError(`Gross profit ${pct(pricing.grossProfitPct)} is below the ${pct(gpFloorPct)} floor. Ask the Sales and Commercial Director.`, 400);
  }
  if (concessionCeilingPct != null && categoryAdditionDefaultPct != null) {
    const policy = priceCommercialRevision({
      cogs: pricing.cogs, kWp: pricing.designKwp, vatPct: pricing.vatPct,
      overheadPct: pricing.overheadPct, contingencyPct: pricing.contingencyPct, profitPct: pricing.profitPct,
      salesBonusPct: pricing.salesBonusPct, engineeringIncentivePct: pricing.engineeringIncentivePct,
      categoryAdditionPct: categoryAdditionDefaultPct, discountPct: 0,
    });
    const concessionPct = policy.netExclVat ? (policy.netExclVat - pricing.netExclVat) / policy.netExclVat : 0;
    if (concessionPct > concessionCeilingPct) {
      throw new ApiError(
        `Concession ${pct(concessionPct)} (category addition and discount together) is above the ${pct(concessionCeilingPct)} ceiling, even though each value is inside its own range. Ask the Sales and Commercial Director.`,
        400
      );
    }
  }
}
function pct(fraction) {
  return `${Math.round(fraction * 1000) / 10}%`;
}

/**
 * R11: touching any of the five policy levers on a SPECIFIC deal's Pricing tab (as opposed to the
 * Pricing Policy page itself) is a deal override by definition - the normal, no-override state is
 * simply never sending these keys here at all (computeAndSave inherits them silently from the
 * active policy). Only meaningful for roles whose Pricing access is 'edit' (S&C/MD) - Sales is
 * already blocked from these keys entirely by assertPricingWriteAllowed.
 */
function isPolicyLeverOverride(roles, pricingOverrides) {
  if (!pricingOverrides || typeof pricingOverrides !== 'object') return false;
  if (widestLevel(PROJECT_TAB_MATRIX.pricing, roles) !== 'edit') return false;
  return Object.keys(pricingOverrides).some(k => POLICY_LEVER_KEYS.includes(k));
}

/** R11: a deal override must carry a reason - checked server-side, never just required by the form. */
function assertOverrideReasonGiven(overrideReason) {
  if (!String(overrideReason || '').trim()) {
    throw new ApiError('A reason is required to override a pricing policy lever on this deal.', 400);
  }
}

module.exports = {
  ALL_ROLES,
  ROLE_LABELS,
  roleLabel,
  PROJECT_TAB_MATRIX,
  ENGINE_PAGE_MATRIX,
  CUSTOMER_INPUT_KEYS,
  POLICY_LEVER_KEYS,
  SALES_LIMITED_PRICING_KEYS,
  widestLevel,
  projectTabAccess,
  enginePageAccess,
  canView,
  canEdit,
  canEditFully,
  assertPricingWriteAllowed,
  assertEngineeringInputWriteAllowed,
  assertSalesPricingWithinLimits,
  isPolicyLeverOverride,
  assertOverrideReasonGiven,
  assertCanViewPricing,
  assertCanAccessEnginePage,
  assertCanAccessProposal,
  assertCanIssueProposal,
  assertCanAccessApprovals,
  shapeProjectForRole,
  shapeRevisionForRole,
};
