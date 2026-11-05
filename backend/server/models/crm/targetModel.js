const { Schema, model } = require('mongoose');
const { TARGET_SEGMENTS } = require('../../utils/crm/constants');

// Reservia CRM - sales targets, one document per (segment, month) (Change Request 1, Feature 5A:
// "MD configures targets by Month, Segment"). Previously keyed by (owner, month) - the client's
// own spec never discusses a per-salesperson target, only a company-wide or per-segment one
// ("All segments: Enquiries 24..."), so the dimension changed from owner to segment rather than
// bolting a segment field onto the old per-owner shape.
//
// Funnel fields (acceptance report section 4: "Targets to 28 Jan - Enquiries 102, qualified 26,
// surveys 14, proposals 9, signed 3") feed the Dashboard's Targets block
// (services/crm/reportService.js). These are deliberately real, MD-entered numbers
// (routes/crm/targetRoute.js, MD only) - the dashboard has NEVER hardcoded the report's own
// example figures; a segment/month with no target set simply shows "no target set" rather than a
// fabricated number.
const targetSchema = new Schema(
  {
    segment: { type: String, enum: TARGET_SEGMENTS, required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    targetValueEgp: { type: Number, min: 0, default: null },
    targetDealCount: { type: Number, min: 0, default: null },
    // Funnel targets - each optional/independent (a target might only be set at the top and
    // bottom of the funnel, for instance). December 2026's own seed data leaves enquiries/qualified
    // genuinely null ("to be entered after week 1") while surveys/proposals/signed are already set.
    targetEnquiries: { type: Number, min: 0, default: null },
    targetQualified: { type: Number, min: 0, default: null },
    targetSurveys: { type: Number, min: 0, default: null },
    targetProposals: { type: Number, min: 0, default: null },
    targetSigned: { type: Number, min: 0, default: null },
    setBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

targetSchema.index({ segment: 1, year: 1, month: 1 }, { unique: true });

module.exports = model('CrmTarget', targetSchema);
