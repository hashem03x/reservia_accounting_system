const { Schema, model } = require('mongoose');
const { BOQ_LINE_SOURCES, APPROVAL_STATUSES } = require('../../utils/commercial/constants');

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
    notes: { type: String, default: '' },
  },
  { _id: false }
);

const approvalStageSchema = new Schema(
  {
    status: { type: String, enum: APPROVAL_STATUSES, default: 'Pending' },
    approver: { type: Schema.Types.ObjectId, ref: 'User', default: null },
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
      grossProfit: { type: Number, default: null },
      grossProfitPct: { type: Number, default: null },
    },

    feasibility: { type: Schema.Types.Mixed, default: null },
    // Off-Grid only - services/commercial/offGridFeasibility.js. Absent for every other category.
    dieselComparison: { type: Schema.Types.Mixed, default: null },

    stage1: { type: approvalStageSchema, default: () => ({}) },
    stage2: { type: approvalStageSchema, default: () => ({}) },
    md: { type: approvalStageSchema, default: () => ({}) },
    mdRequired: { type: Boolean, default: false },
    releaseStatus: { type: String, enum: ['NOT RELEASED', 'APPROVED FOR ISSUE'], default: 'NOT RELEASED' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

commercialRevisionSchema.index({ project: 1, revisionNumber: -1 });
commercialRevisionSchema.index({ project: 1, isCurrent: 1 });

module.exports = model('CommercialRevision', commercialRevisionSchema);
