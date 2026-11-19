const { Schema, model } = require('mongoose');

// Reservia Commercial - the ONE pricing configuration record Finance maintains without a deploy
// (QA finding B3: "Keep them in one configuration record that Finance can change without a deploy").
// A single document, key 'default'. Every change increments `version` and appends an immutable row
// to CommercialPricingConfigAudit. New revisions snapshot the levers + version they were priced with
// (CommercialRevision.pricingConfigApplied); a later change here NEVER alters an existing revision
// (the MD's stated view: "new ones only, and show the rate used on each revision").
const leversSchema = new Schema(
  {
    overheadPct: { type: Number, min: 0, max: 1, required: true },
    contingencyPct: { type: Number, min: 0, max: 1, required: true },
    profitPct: { type: Number, min: 0, max: 1, required: true },
    salesBonusPct: { type: Number, min: 0, max: 1, required: true },
    engineeringIncentivePct: { type: Number, min: 0, max: 1, required: true },
    categoryAdditionPct: { type: Number, min: 0, max: 1, required: true },
    discountPct: { type: Number, min: 0, max: 1, required: true },
  },
  { _id: false }
);

// Deal Engine Changes Required Rev 02, R6: the Sales limits block of the new Pricing Policy page
// (section 5.1). Only the fields with a REAL, already-agreed value get a real default:
//   - discountMaxPct defaults to the EXISTING discountAuthorityPct (0.05) - today's real number,
//     not invented. It is a stricter, separate concept (a hard cap Sales may never exceed) from
//     discountAuthorityPct (a soft "Stage 2 must review above this" trigger) - both are kept.
//   - gpFloorPct defaults to the EXISTING approvalService.js#GP_FLOOR_DEFAULT (0.15), "already in
//     the brief" per the PDF - made configurable here instead of a second hardcoded constant.
//   - categoryAdditionMinPct/MaxPct/concessionCeilingPct are left UNSET (null) - the PDF's own
//     table marks them "to be set (example ...)"; R9's validation skips a null limit entirely
//     rather than enforcing a guessed number (per the brief's own "do not invent missing approved
//     business limits"). Sales may move these freely until the MD sets a real limit.
const salesLimitsSchema = new Schema(
  {
    categoryAdditionDefaultPct: { type: Number, min: 0, max: 1, default: 0.19 }, // today's real default (section 5.1)
    categoryAdditionMinPct: { type: Number, min: 0, max: 1, default: null },
    categoryAdditionMaxPct: { type: Number, min: 0, max: 1, default: null },
    discountMaxPct: { type: Number, min: 0, max: 1, default: 0.05 },
    concessionCeilingPct: { type: Number, min: 0, max: 1, default: null },
    gpFloorPct: { type: Number, min: 0, max: 1, default: 0.15 },
  },
  { _id: false }
);

const pricingConfigSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    version: { type: Number, required: true, default: 1 },
    levers: { type: leversSchema, required: true },
    // VAT by country (fraction). Egypt 14% is the brief's figure; Saudi Arabia 15% is the R74
    // workbook's (Master Project!B15). A country absent here must have VAT entered per revision.
    vatPctByCountry: { type: Map, of: Number, default: () => new Map([['Egypt', 0.14], ['Saudi Arabia', 0.15]]) },
    // Optional per-category lever overrides, e.g. { 'Off-Grid': { profitPct: 0.12 } } - empty by
    // default, so every category uses the standard stack above.
    categoryOverrides: { type: Schema.Types.Mixed, default: {} },
    // Stage 2 must review a discount above this (brief section 4 / 9: "approves any discount above 5%").
    discountAuthorityPct: { type: Number, min: 0, max: 1, default: 0.05 },
    // R6/R7: the default Sales-limits row, plus optional per-sector overrides (same shape as
    // categoryOverrides above) - a sector with no row of its own uses this default row.
    salesLimits: { type: salesLimitsSchema, default: () => ({}) },
    salesLimitsBySector: { type: Schema.Types.Mixed, default: {} },
    // R8: "MD approval of a policy change is optional; build it as a setting (off by default)."
    // No separate policy-change-approval queue exists in this codebase to extend, so this is
    // implemented as the minimal real version of "requires the MD": OFF (default) keeps today's
    // rule (MD or the Commercial Director may save a policy change); ON restricts it to the MD only.
    requireMdApprovalForPolicyChange: { type: Boolean, default: false },
    // Deal Engine settings (services/commercial/dealEngineSettings.js): engine rules (MC4, accessories,
    // DC/AC, yield table, discount rate, inverter replacement, two-phase tariff) and the proposal's
    // text blocks. Stored sparse; defaults are merged on read.
    engine: { type: Schema.Types.Mixed, default: {} },
    proposal: { type: Schema.Types.Mixed, default: {} },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedByName: { type: String, default: null },
  },
  { timestamps: true }
);

const pricingConfigAuditSchema = new Schema(
  {
    configKey: { type: String, required: true, default: 'default' },
    version: { type: Number, required: true },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, required: true },
    note: { type: String, default: '' },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    changedByName: { type: String, default: null },
  },
  { timestamps: true }
);
pricingConfigAuditSchema.index({ configKey: 1, version: -1 });

module.exports = model('CommercialPricingConfig', pricingConfigSchema);
module.exports.Audit = model('CommercialPricingConfigAudit', pricingConfigAuditSchema);
