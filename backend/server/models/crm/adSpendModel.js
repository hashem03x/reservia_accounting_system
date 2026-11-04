const { Schema, model } = require('mongoose');
const { SOURCES } = require('../../utils/crm/constants');

// Reservia CRM - monthly marketing spend per source (acceptance report section 4 "Source
// quality": "cost per qualified lead vs EGP 3,500 limit, monthly spend entry"). This is real,
// MD-entered data (routes/crm/adSpendRoute.js, MD only) - there is no ad-platform integration to
// pull spend from automatically, so "cost per qualified lead" is only ever computed for a
// source/month this was actually entered for; everything else shows an explicit "no spend
// entered" state rather than a fabricated cost (see services/crm/reportService.js).
const adSpendSchema = new Schema(
  {
    source: { type: String, enum: SOURCES, required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    amountEgp: { type: Number, required: true, min: 0 },
    setBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

adSpendSchema.index({ source: 1, year: 1, month: 1 }, { unique: true });

module.exports = model('CrmAdSpend', adSpendSchema);
