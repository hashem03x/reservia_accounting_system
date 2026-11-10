const { Schema, model } = require('mongoose');
const { FORM_SEGMENTS } = require('../../utils/crm/constants');

// Reservia CRM - monthly marketing spend, one document per (channel, month) (Change Request 1,
// Feature 5B: "MD enters monthly spend by Month, Channel/Segment, Amount EGP"). Previously keyed
// by a fixed ad-platform `source` enum (Google Ads/Meta Ads/...) - the client's own real budget
// line items ("Farm test", "Farms", "Villas", "Compounds") are MD-authored, free-text channel/
// budget-line names that don't correspond to any ad-platform source at all, so `channel` is now
// free text rather than constrained to SOURCES. `segment` is an OPTIONAL tag used only to roll
// spend up into the per-segment "cost per qualified lead" figure (services/crm/reportService.js);
// a line item with no segment (e.g. "SEO", "Agency fees" - the client's own "must be entered
// separately, not silently included in ad channel budgets" instruction) still counts toward total
// marketing spend but is deliberately excluded from any one segment's cost-per-lead math.
const adSpendSchema = new Schema(
  {
    channel: { type: String, required: true, trim: true, maxlength: 60 },
    // Mongoose's enum validator checks the value actually SET on the document, including an
    // explicit default - `null` must be listed in the enum itself, or a brand-new document
    // created with no `segment` at all fails its own default's validation.
    segment: { type: String, enum: [...FORM_SEGMENTS, null], default: null },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    // The PLANNED budget for the line (Change Request 1, section 5's figures are planned spend).
    // Name kept for backward compatibility with existing records and API consumers.
    amountEgp: { type: Number, required: true, min: 0 },
    // Change Request 2, item 5: the ACTUAL amount spent, entered by the MD once known. null until
    // then - reports fall back to the planned figure and label it as planned
    // (services/crm/reportService.js#summarizeSpend), never present a plan as an actual.
    actualAmountEgp: { type: Number, min: 0, default: null },
    setBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

adSpendSchema.index({ channel: 1, year: 1, month: 1 }, { unique: true });

module.exports = model('CrmAdSpend', adSpendSchema);
