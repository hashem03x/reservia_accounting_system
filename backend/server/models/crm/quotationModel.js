const { Schema, model } = require('mongoose');
const { QUOTATION_STATUSES } = require('../../utils/crm/constants');

// Reservia CRM - Phase 2 "Quotations" (Developer Brief section 4E, due 2026-12-10). A versioned
// price quote against a lead - `version` increments on every re-quote rather than overwriting the
// previous one, so a sales engineer can always show what was actually offered at each point (the
// brief's farm-package acceptance test implies a single snapshot of totals at quote time, not a
// live recomputation that could silently change after the fact if a price-list item's price
// later changes).
//
// Totals (subtotal/discountAmount/vatAmount/total) are STORED, computed once at creation by
// services/crm/quotationService.js via the already-tested utils/crm/quotationCalc.js - never
// recomputed on read, so a later price-list change can never retroactively alter a quotation a
// customer has already seen or accepted.
const quotationItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'CrmProduct', default: null },
    description: { type: String, required: true, trim: true, maxlength: 300 },
    unitPriceEgp: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    discountPercent: { type: Number, min: 0, max: 100, default: 0 },
  },
  { _id: false }
);

const quotationSchema = new Schema(
  {
    lead: { type: Schema.Types.ObjectId, ref: 'CrmLead', required: true },
    version: { type: Number, required: true, default: 1 },
    status: { type: String, enum: QUOTATION_STATUSES, default: 'draft' },
    items: { type: [quotationItemSchema], required: true, validate: v => Array.isArray(v) && v.length > 0 },
    vatPercent: { type: Number, min: 0, max: 100, default: 14 },
    subtotal: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, required: true, min: 0 },
    vatAmount: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    validUntil: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    respondedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

quotationSchema.index({ lead: 1, version: -1 });

module.exports = model('CrmQuotation', quotationSchema);
