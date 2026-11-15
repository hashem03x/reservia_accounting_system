const { Schema, model } = require('mongoose');
const { VAT_TREATMENTS, DEFAULT_VAT_TREATMENT } = require('../../utils/vatTreatment');

// ERP company-level controls (ERP Developer Modification Request, 12 Nov 2026). One document,
// _id 'company'. Read through services/config/companySettingsService.js, which supplies the defaults
// when the document does not exist yet, so a fresh database behaves exactly as documented below.
// Every change is appended to `history` (who, when, before/after) - the audit trail.
const companySettingSchema = new Schema(
  {
    _id: { type: String, default: 'company' },
    // CHG-06: the VAT rate a new sales or purchase invoice starts with. 0% is still possible, but
    // only as an explicit choice with a reason.
    vatDefaultPct: { type: Number, min: 0, max: 100, default: 14 },
    // VAT Accounting Treatment (utils/vatTreatment.js): the treatment a new Purchase Invoice,
    // Expense or Fixed Asset form starts with. UI pre-fill only - mirrors vatDefaultPct's own role
    // exactly; the real, posted-from value always lives on the document's own `vatTreatment` field.
    vatTreatmentDefault: { type: String, enum: VAT_TREATMENTS, default: DEFAULT_VAT_TREATMENT },
    // CHG-07: warn when a PO line's unit price differs from the product's last or average PO price
    // by more than this percentage. Only a warning - the PO still saves.
    priceVarianceWarnPct: { type: Number, min: 1, max: 1000, default: 20 },
    // CHG-03: refuse a sales invoice line above the stock the project holds. Products can opt out
    // one by one (Product.allowNegativeProjectStock).
    preventNegativeProjectStock: { type: Boolean, default: true },
    history: [
      {
        _id: false,
        at: { type: Date, default: Date.now },
        by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        byName: { type: String, default: null },
        changes: { type: Schema.Types.Mixed },
      },
    ],
  },
  { timestamps: true }
);

module.exports = model('CompanySetting', companySettingSchema);
