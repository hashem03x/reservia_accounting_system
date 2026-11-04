const { Schema, model } = require('mongoose');

// Reservia CRM - sales targets, one document per (owner, month).
//
// Funnel fields (acceptance report section 4: "Targets to 28 Jan - Enquiries 102, qualified 26,
// surveys 14, proposals 9, signed 3") were added for the Dashboard's Targets block
// (services/crm/reportService.js). These are deliberately real, MD-entered numbers
// (routes/crm/targetRoute.js, MD only) - the dashboard has NEVER hardcoded the report's own
// example figures; an owner/month with no target set simply shows "no target set" rather than a
// fabricated number.
const targetSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    targetValueEgp: { type: Number, min: 0, default: null },
    targetDealCount: { type: Number, min: 0, default: null },
    // Funnel targets - each optional/independent (a target might only be set at the top and
    // bottom of the funnel, for instance).
    targetEnquiries: { type: Number, min: 0, default: null },
    targetQualified: { type: Number, min: 0, default: null },
    targetSurveys: { type: Number, min: 0, default: null },
    targetProposals: { type: Number, min: 0, default: null },
    targetSigned: { type: Number, min: 0, default: null },
    setBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

targetSchema.index({ owner: 1, year: 1, month: 1 }, { unique: true });

module.exports = model('CrmTarget', targetSchema);
