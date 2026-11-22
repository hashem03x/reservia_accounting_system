const { Schema, model } = require('mongoose');
const { BOQ_LINE_SOURCES, APPROVAL_STATUSES } = require('../../utils/commercial/constants');
// Explicit require (not just the string `ref:` name) - so any caller that populates
// boqLines.vendor never hits Mongoose's MissingSchemaError, regardless of what else it loaded
// first. This model does NOT auto-populate it (unlike materialItemModel.js's erpProduct) - it is
// read in far more places, several of them performance-sensitive, so each caller that actually
// needs the supplier's details populates it explicitly.
require('./supplierModel');

// Reservia Commercial - the versioned "deal" (mirrors models/crm/quotationModel.js's versioning:
// `revisionNumber` increments on every re-quote, never overwrites a previous one). Only the
// CURRENT revision (`isCurrent: true`) is live-recomputed as engineering inputs change; creating a
// new revision flips the previous one's `isCurrent` to false and it is never written to again -
// its stored boqLines/pricing/feasibility stay exactly as they were, a frozen historical snapshot,
// same guarantee CRM's quotation versions give.
//
// `engineeringInput`/`engineeringResult` are intentionally Mixed: the actual shape differs
// completely per project category (On-Grid's area/bills/module/inverter/structure inputs vs.
// Off-Grid's appliance list vs. Agriculture Pumping's irrigation/tree rows) - each
// services/commercial/*Engine.js function defines and validates its own input/output shape; this
// schema does not re-describe it.
const boqLineSchema = new Schema(
  {
    lineNo: { type: Schema.Types.Mixed, required: true }, // number, or "15.1" style for Utility-Scale adders
    component: { type: String, required: true },
    description: { type: String, default: '' },
    materialItemKey: { type: String, default: null },
    // Feature 2 (BOQ vendor display/selection) - the approved supplier (CommercialSupplier, Deal
    // Engine's own vendor master - never the ERP Vendor directly) selected for THIS line. Carried
    // forward across recalculation and new revisions by component (services/commercial/
    // revisionService.js#carryForwardVendors) - never lost just because boqLines itself is a full
    // rebuild every time pricing recalculates. Set via PATCH .../boq-lines/:lineId/vendor, a
    // narrow mutation that never touches pricing/engineering, so selecting a vendor can never
    // itself trigger a recalculation or reset a signed approval stage.
    vendor: { type: Schema.Types.ObjectId, ref: 'CommercialSupplier' },
    // Feature 3/B4 - cumulative quantity already placed on a (non-cancelled) real ERP Purchase
    // Order via "Create PR" (createPrService.js). The SOURCE OF TRUTH for the "never exceed the
    // BOQ quantity" guard, updated by exactly ONE atomic findOneAndUpdate per create/cancel (the
    // SAME "guarded atomic increment" pattern requisitionModel.js#invoicedAmount already uses one
    // level down the chain) - never derived by re-summing linked Purchase Orders at guard time,
    // which cannot be made race-safe against two concurrent requests without a real multi-
    // document transaction (and even then, two concurrent inserts of two DIFFERENT new documents
    // do not conflict under MongoDB's transaction isolation - only a single counter field on one
    // document, incremented atomically, actually prevents the race).
    orderedQty: { type: Number, default: 0, min: 0 },
    unit: { type: String, required: true },
    qty: { type: Number, default: null },
    unitPrice: { type: Number, default: null },
    total: { type: Number, default: null },
    costGroup: { type: String, default: 'Equipment' },
    source: { type: String, enum: BOQ_LINE_SOURCES, default: 'auto' },
    // When a manual override replaces an auto-calculated value, the ORIGINAL calculated value is
    // kept here rather than discarded - required by the project brief's "clearly identify
    // overridden values" rule.
    autoQty: { type: Number, default: null },
    autoUnitPrice: { type: Number, default: null },
    flag: { type: String, default: null }, // e.g. "REFERENCE TABLE SELECTION - VERIFY ENGINEERING"
    // Deal Engine C19/C23: where a Price Book line's price came from (supplierPricing.linePriceFields).
    priceSource: { type: String, enum: ['supplier', 'reference', null], default: null },
    supplierCode: { type: String, default: null },
    supplierStatus: { type: String, default: null },
    priceFlags: { type: [String], default: undefined },
    foreignPrice: { type: Number, default: null },
    priceCurrency: { type: String, default: null },
    fxRate: { type: Number, default: null },
    priceCheckedAt: { type: Date, default: null },
    priceValidUntil: { type: Date, default: null },
    priceStaleReason: { type: String, default: null },
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const approvalStageSchema = new Schema(
  {
    status: { type: String, enum: APPROVAL_STATUSES, default: 'Pending' },
    approver: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Denormalized name of the user who signed (QA U4) - the log (CommercialApproval) keeps the id.
    approverName: { type: String, default: null },
    approverRole: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    note: { type: String, default: '' },
  },
  { _id: false }
);

const commercialRevisionSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'CommercialProject', required: true },
    revisionNumber: { type: Number, required: true },
    isCurrent: { type: Boolean, default: true },

    engineeringInput: { type: Schema.Types.Mixed, default: {} },
    // Deal Engine C11: the rule set this revision was calculated with (dealEngineSettings.RULE_VERSION)
    // and the settings it used. Revisions calculated before 12 Nov 2026 have none - their per-kWp
    // figure is on INSTALLED kWp and is labelled so.
    ruleVersion: { type: String, default: null },
    engineSettingsApplied: { type: Schema.Types.Mixed, default: null },
    // Deal Engine C24: set when a confirmed supplier price upload changed an item this revision uses.
    priceChangedSinceCalculation: { type: Boolean, default: false },
    priceChangedItems: { type: [String], default: [] },
    engineeringResult: { type: Schema.Types.Mixed, default: {} },

    boqLines: { type: [boqLineSchema], default: [] },
    boqTotal: { type: Number, default: null },

    // Generic commercial markup layer (services/commercial/commercialPricingService.js) - no
    // field here is an Excel-sourced constant; defaults are applied per category by that service.
    pricing: {
      cogs: { type: Number, default: null },
      overheadPct: { type: Number, default: 0 },
      overheadAmt: { type: Number, default: 0 },
      contingencyPct: { type: Number, default: 0 },
      contingencyAmt: { type: Number, default: 0 },
      profitPct: { type: Number, default: 0 },
      profitAmt: { type: Number, default: 0 },
      poolAmt: { type: Number, default: null },
      basePrice: { type: Number, default: null },
      salesBonusPct: { type: Number, default: 0 },
      salesBonusAmt: { type: Number, default: 0 },
      engineeringIncentivePct: { type: Number, default: 0 },
      engineeringIncentiveAmt: { type: Number, default: 0 },
      categoryAdditionPct: { type: Number, default: 0 },
      categoryAdditionAmt: { type: Number, default: 0 },
      discountPct: { type: Number, default: 0 },
      discountAmt: { type: Number, default: 0 },
      netExclVat: { type: Number, default: null },
      vatPct: { type: Number, default: 14 },
      vatAmt: { type: Number, default: null },
      grossInclVat: { type: Number, default: null },
      perKwpExclVat: { type: Number, default: null },
      perKwpInclVat: { type: Number, default: null },
      // The kWp the per-kWp figures divide by - the DESIGN capacity (QA finding section 4).
      designKwp: { type: Number, default: null },
      grossProfit: { type: Number, default: null },
      grossProfitPct: { type: Number, default: null },
      operatingProfit: { type: Number, default: null },
      operatingProfitPct: { type: Number, default: null },
      discountAboveAuthority: { type: Boolean, default: false },
    },

    // The pricing configuration this revision was priced with (QA finding B3: "show the rate used
    // on each revision"). Snapshotted when the revision is created; a later Finance change to the
    // configuration never rewrites it. `source`: 'config' (configuration defaults at creation),
    // 'revision' (levers edited on this revision since), 'legacy' (priced before configuration
    // existed - levers as stored).
    pricingConfigApplied: {
      configVersion: { type: Number, default: null },
      appliedAt: { type: Date, default: null },
      source: { type: String, enum: ['config', 'revision', 'legacy', null], default: null },
      levers: { type: Schema.Types.Mixed, default: null },
      vatPct: { type: Number, default: null },
      discountAuthorityPct: { type: Number, default: null },
    },

    // 'Calculated' - figures are current. 'Draft' - an input the figures depend on changed outside
    // the engineering form (e.g. the project's region - QA finding B1) and the revision must be
    // recalculated before it can be approved or issued. Stored figures stay visible, flagged stale.
    status: { type: String, enum: ['Calculated', 'Draft'], default: 'Calculated' },
    invalidatedAt: { type: Date, default: null },
    invalidationReason: { type: String, default: null },

    feasibility: { type: Schema.Types.Mixed, default: null },
    // Off-Grid only - services/commercial/offGridFeasibility.js. Absent for every other category.
    dieselComparison: { type: Schema.Types.Mixed, default: null },

    stage1: { type: approvalStageSchema, default: () => ({}) },
    stage2: { type: approvalStageSchema, default: () => ({}) },
    md: { type: approvalStageSchema, default: () => ({}) },
    mdRequired: { type: Boolean, default: false },
    releaseStatus: { type: String, enum: ['NOT RELEASED', 'APPROVED FOR ISSUE'], default: 'NOT RELEASED' },
    // R11: a deal-specific override of a policy lever by the S&C Director or MD (section 5.2's
    // "Override of policy vN" tab state) - logged with the reason and visible on Approvals so the
    // MD notices it. Set by revisionController.js whenever one of the five policy levers is sent
    // on THIS deal's Pricing tab (controller/commercial/revisionController.js#recomputeRevision);
    // never set from the Pricing Policy page itself (that is a configuration change, not a deal
    // override - see pricingConfigModel.js's own versioning instead).
    policyOverride: {
      active: { type: Boolean, default: false },
      reason: { type: String, trim: true, maxlength: 500, default: null },
      by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      byName: { type: String, default: null },
      at: { type: Date, default: null },
      policyVersion: { type: Number, default: null },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

commercialRevisionSchema.index({ project: 1, revisionNumber: -1 });
commercialRevisionSchema.index({ project: 1, isCurrent: 1 });

module.exports = model('CommercialRevision', commercialRevisionSchema);
