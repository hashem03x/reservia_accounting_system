const { Schema, model } = require('mongoose');

// Reservia CRM - Phase 2 "Targets / Forecast" (Developer Brief section 4F, due 2026-12-17).
// MODEL SHAPE ONLY - no service/controller/route wired yet (Phase 2 scope). One document per
// (owner, month) sales target; the actual forecast computation (targets vs. won-deal totals in
// the pipeline, per utils/crm/quotationCalc.js totals) is deliberately not built yet, so this is
// not claimed as a working feature ahead of its 2026-12-17 milestone.
const targetSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    targetValueEgp: { type: Number, required: true, min: 0 },
    targetDealCount: { type: Number, min: 0, default: null },
    setBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

targetSchema.index({ owner: 1, year: 1, month: 1 }, { unique: true });

module.exports = model('CrmTarget', targetSchema);
