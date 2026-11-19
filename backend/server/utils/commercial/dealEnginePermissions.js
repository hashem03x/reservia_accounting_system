'use strict';

const ApiError = require('../apiError');

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
  sales: 'Sales / BDM',
  technical: 'Technical',
  procurement: 'Procurement',
  member: 'Member',
};
function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

// Access levels, ordered low to high - "widest" picks the highest-ranked level across a user's roles.
const LEVEL_RANK = { hidden: 0, view: 1, limited: 2, edit: 3 };
const ALL_ROLES = ['md', 'commercial_director', 'sales', 'technical', 'procurement', 'member'];

/**
 * One matrix row: { md, commercial_director, sales, technical, procurement, member } -> access level.
 * Source: Deal Engine Changes Required Rev 02, section 4.1 (project tabs) and 4.2 (engine pages),
 * cross-checked against the acceptance tests A1-A14 in section 7 wherever the PDF's own table
 * layout was ambiguous (its multi-line cells did not survive text extraction cleanly) - A1-A14 are
 * unambiguous "as X, action Y, expected Z" statements and are treated as the ground truth whenever
 * they conflict with a garbled table cell. Every such judgment call is called out below so the MD
 * can correct it directly against the PDF rather than it staying a silent guess.
 */
const PROJECT_TAB_MATRIX = {
  // Section 4.1. "Hidden" here means the API omits the field/section entirely (R12) - not just an
  // empty value.
  overview: { md: 'edit', commercial_director: 'edit', sales: 'edit', technical: 'view', procurement: 'view', member: 'view' },
  // Price, GP, release status sub-section of Overview (A1/A12/A13: technical/procurement/member see
  // Overview "without prices").
  overviewPricing: { md: 'edit', commercial_director: 'edit', sales: 'edit', technical: 'hidden', procurement: 'hidden', member: 'hidden' },
  // R3: design inputs (module, kWp, inverter, structure, area...) stay Technical's. MD keeps full
  // edit access everywhere (A14) - only S&C/sales are view-only here, not MD.
  engineeringInputDesign: { md: 'edit', commercial_director: 'view', sales: 'view', technical: 'edit', procurement: 'hidden', member: 'hidden' },
  // R3: customer-facing inputs (bills, consumption, tariff, escalation, discount rate) move into
  // their own section Sales can edit (A9: "sales edit bills and consumption... design inputs stay
  // read-only"). Technical keeps VIEW (needs them for context, never edits them); MD full access.
  engineeringInputCustomer: { md: 'edit', commercial_director: 'view', sales: 'edit', technical: 'view', procurement: 'hidden', member: 'hidden' },
  // Judgment call (table cell garbled, no direct acceptance test): a pass/fail engineering QA
  // checklist, not needed by Sales/S&C for their commercial work. MD keeps full access everywhere.
  designChecks: { md: 'edit', commercial_director: 'hidden', sales: 'hidden', technical: 'edit', procurement: 'hidden', member: 'hidden' },
  // A12: procurement "can see... BOQ without prices on the Overview" - read as BOQ quantities/
  // components visible, costs hidden (boqCosts row below). Sales/S&C work the Pricing tab's
  // COGS-derived totals instead, not raw BOQ lines (role definitions, section 3) - judgment call.
  boqLines: { md: 'edit', commercial_director: 'hidden', sales: 'hidden', technical: 'edit', procurement: 'view', member: 'hidden' },
  boqCosts: { md: 'edit', commercial_director: 'hidden', sales: 'hidden', technical: 'view', procurement: 'hidden', member: 'hidden' },
  // The Pricing tab itself (five levers + category addition + discount + price corridor).
  // "limited" for Sales = category addition + discount only (section 5.2), enforced field-by-field
  // below, not a blanket edit. A4/A8: Sales sees it Limited; a direct API overhead change is 403.
  pricing: { md: 'edit', commercial_director: 'edit', sales: 'limited', technical: 'hidden', procurement: 'hidden', member: 'hidden' },
  // A1/A9/A13: Hidden to technical/procurement/member; A14: full (Sign) for MD.
  feasibility: { md: 'edit', commercial_director: 'view', sales: 'edit', technical: 'hidden', procurement: 'hidden', member: 'hidden' },
  // Stage 1 (today: EITHER sales or technical may sign - approvalService.js STAGE1 role list; R4's
  // split into two separate signatures is explicitly NOT built here, pending MD confirmation - see
  // the implementation report). Both see it; S&C/MD view only until it's their stage.
  approvalsStage1: { md: 'edit', commercial_director: 'view', sales: 'edit', technical: 'edit', procurement: 'hidden', member: 'view' },
  // Stage 2 (commercial_director only, per approvalService.js STAGE2) + MD final sign-off.
  approvalsStage2: { md: 'edit', commercial_director: 'edit', sales: 'view', technical: 'hidden', procurement: 'hidden', member: 'view' },
  // A1/A12: Hidden to technical/procurement. Sales/S&C/MD can preview and issue.
  proposal: { md: 'edit', commercial_director: 'edit', sales: 'edit', technical: 'hidden', procurement: 'hidden', member: 'hidden' },
};

const ENGINE_PAGE_MATRIX = {
  // A12: procurement "can open Materials and Suppliers"; role definitions section 3: "procurement
  // owns Materials, Suppliers and price list uploads." READS stay open to every Commercial-access
  // role for both pages - deliberate, pre-existing, documented behaviour this matrix must NOT
  // regress: BOQ lines reference both a materialItemKey and a supplierCode
  // (commercialRevisionModel.js#boqLineSchema), so even Technical reading a BOQ needs to resolve
  // what they mean (supplierRoute.js's own comment: "Every Deal Engine user can read the supplier
  // list - the BOQ shows supplier codes"). Only WRITE access is role-restricted below.
  materials: { md: 'edit', commercial_director: 'view', sales: 'view', technical: 'view', procurement: 'edit', member: 'view' },
  // Suppliers' write gate already exists and is correct (services/commercial/supplierService.js
  // EDIT_ROLES = md/commercial_director/procurement, plus a narrow sales 'add a note' exception
  // that pre-dates this matrix and is deliberately left untouched) - this row is for reference/the
  // frontend's tab visibility only; the API gate is NOT re-applied here to avoid a second,
  // possibly-diverging source of truth for a route that already enforces this correctly.
  suppliers: { md: 'edit', commercial_director: 'edit', sales: 'view', technical: 'view', procurement: 'edit', member: 'view' },
  // Pricing Policy / Engineering Settings / Exchange Rates / Proposal Text do not exist as separate
  // pages yet (R5 - today's single combined Pricing Config page; see Phase 3). Listed here for the
  // page split's own future reference; pricingConfigController.js already enforces exactly this
  // read/write split today via canManagePricingConfig (md/commercial_director), independently of
  // this matrix.
  pricingPolicy: { md: 'edit', commercial_director: 'edit', sales: 'view', technical: 'hidden', procurement: 'hidden', member: 'hidden' },
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
  const keys = Object.keys(pricingOverrides);
  if (level === 'edit') return; // S&C / MD: no restriction here (R5.2 "editable without limit").
  // level === 'limited' (Sales) - only the two Sales-owned fields.
  const disallowed = keys.filter(k => !SALES_LIMITED_PRICING_KEYS.includes(k));
  if (disallowed.length) {
    const policyField = disallowed.find(k => POLICY_LEVER_KEYS.includes(k)) || disallowed[0];
    throw new ApiError(
      `${policyField} is a pricing policy lever - read-only for Sales. Ask the Sales and Commercial Director to change it.`,
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
  assertCanViewPricing,
  assertCanAccessEnginePage,
  assertCanAccessProposal,
  assertCanAccessApprovals,
  shapeProjectForRole,
  shapeRevisionForRole,
};
