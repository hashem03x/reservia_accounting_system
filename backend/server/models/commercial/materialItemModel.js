const { Schema, model } = require('mongoose');

// Reservia Commercial - the Price Book / material catalog. Stores each of the three source
// workbooks' own price-list sheets (On_Grid.xlsx's Material Price List, Off_Grid.xlsx's inline
// BOQ prices, Solar_Pumping3.xlsx's five separate price-list sheets) under one shape so the
// calculation services (services/commercial/*Engine.js) can all read from one collection via
// priceBookLookup.js, never a hardcoded number. `sourceWorkbook`/`sourceSheet` keep each item
// traceable back to exactly where it was extracted from (see services/commercial/materialSeed.js).
//
// Price edits APPEND to `priceHistory` rather than overwriting it - a later price change must
// never alter a Commercial revision/proposal that already captured the price it used at the time
// (the same "history is kept, one row per change" rule CRM's quotationModel.js already follows
// for a different reason).
const priceHistoryEntrySchema = new Schema(
  { price: { type: Number, required: true, min: 0 }, currency: { type: String, required: true }, effectiveDate: { type: Date, required: true }, changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null } },
  { _id: false }
);

// Deal Engine C19/C21/C23: a price quoted by a supplier on the approved supplier list. The item's own
// unitPrice stays as the "Reference" price (from the masters, no supplier). The BOQ uses the lowest
// Available price of an Approved supplier; Conditional only when no Approved price exists (flagged);
// Suspended and Removed suppliers never price (services/commercial/supplierPricing.js).
const supplierPriceSchema = new Schema(
  {
    supplier: { type: Schema.Types.ObjectId, ref: 'CommercialSupplier', required: true },
    supplierCode: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 }, // EGP, as used by the BOQ
    foreignPrice: { type: Number, default: null }, // the quoted price when not in EGP
    currency: { type: String, enum: ['EGP', 'USD', 'EUR', 'CNY'], default: 'EGP' },
    fxRate: { type: Number, default: null }, // Pricing Config rate on the upload date
    availability: { type: String, enum: ['In stock', 'Lead time'], default: 'In stock' },
    leadTimeDays: { type: Number, default: null },
    minQuantity: { type: Number, default: null },
    checkedAt: { type: Date, required: true }, // check date = upload date
    validUntil: { type: Date, default: null },
    sourceFile: { type: String, default: null },
    upload: { type: Schema.Types.ObjectId, ref: 'CommercialPriceListUpload', default: null },
  },
  { _id: false }
);

const materialItemSchema = new Schema(
  {
    category: { type: String, required: true, trim: true },
    brand: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    spec: { type: String, trim: true, default: '' },
    unit: { type: String, required: true, trim: true },
    // Numeric attributes used by the calculation engines (rated W/kW/V, Ah, etc.) - kept generic
    // rather than one column per possible attribute, since each category uses different ones.
    n1: { type: Number, default: null },
    n2: { type: Number, default: null },
    // Full category-specific technical datasheet (PV module Vmp/Imp/Voc/Isc/temp-coeff, inverter
    // MPPT window/DC-input count, etc.) - kept here too (not only in n1/n2) so the ENTIRE Price
    // Book, specs included, is centralized and admin-editable in one place, per the project's own
    // "calculations must reference the centralized material database" rule. Shape differs per
    // category; services/commercial/priceBookLookup.js#toEngineShape documents each one it reads.
    attrs: { type: Schema.Types.Mixed, default: {} },
    unitPrice: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'EGP' },
    countryStock: { type: String, default: 'Egypt' },
    status: { type: String, enum: ['Available', 'PLACEHOLDER', 'Discontinued'], default: 'Available' },
    supplier: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    sourceWorkbook: { type: String, required: true },
    sourceSheet: { type: String, required: true },
    effectiveDate: { type: Date, required: true, default: Date.now },
    priceHistory: { type: [priceHistoryEntrySchema], default: [] },
    supplierPrices: { type: [supplierPriceSchema], default: [] },
    // When the Reference price was last checked (null = its effectiveDate) and until when it holds.
    referenceCheckedAt: { type: Date, default: null },
    referenceValidUntil: { type: Date, default: null },
    // Unique composite key (brand | model | spec) - mirrors the Price Book's own `key` convention
    // in the Developer Brief, used by priceBookLookup.js to resolve an engineering selection.
    key: { type: String, required: true, unique: true, trim: true },
    archived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

materialItemSchema.index({ category: 1, archived: 1 });
materialItemSchema.index({ brand: 'text', model: 'text', spec: 'text' });

module.exports = model('CommercialMaterialItem', materialItemSchema);
