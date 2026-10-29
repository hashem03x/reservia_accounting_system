const { Schema, model } = require('mongoose');
const { SEGMENTS } = require('../../utils/crm/constants');

// Reservia CRM - Phase 2 "Products / Price list" (Developer Brief section 4E, due 2026-12-10).
// A sellable solar package/line item quoted to a lead (e.g. "5kWp Villa Package", "Farm Package")
// - deliberately its OWN model, not the ERP's inventory Product (models/inventory/productModel.js):
// that model is warehouse/stock/SKU-tracked physical inventory for Purchase/Sales Orders, a
// different domain with different fields and a different owning team; a CRM quotation line is a
// commercial price-list entry, not a stock-tracked item, and conflating the two would mean every
// future inventory field also has to make sense for a sales package, and vice versa.
const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    segment: { type: String, enum: SEGMENTS, default: 'unknown' },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    unit: { type: String, trim: true, default: 'package' },
    unitPriceEgp: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = model('CrmProduct', productSchema);
