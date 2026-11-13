const { Schema, model } = require('mongoose');

// ERP CHG-09 - year-end close of one calendar year (services/accounting/yearEndCloseService.js).
// The closing entries move the year's revenue and expense balances to Profit of the year and on to
// Retained Earnings; the year's twelve months are then locked. A reopen reverses both entries and
// unlocks the months. Every close and reopen is kept in `history` (who, when, why, the figures).
const yearEventSchema = new Schema(
  {
    action: { type: String, enum: ['closed', 'reopened'], required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: null },
    at: { type: Date, required: true },
    note: { type: String, trim: true, maxlength: 500 },
    profit: { type: Number, default: null },
    entries: [{ type: Schema.Types.ObjectId, ref: 'JournalEntry' }],
  },
  { _id: false }
);

const fiscalYearCloseSchema = new Schema(
  {
    year: { type: Number, required: true, unique: true, min: 2000, max: 2100 },
    status: { type: String, enum: ['closed', 'open'], default: 'open', required: true },
    profit: { type: Number, default: null },
    closingEntries: [{ type: Schema.Types.ObjectId, ref: 'JournalEntry' }],
    history: { type: [yearEventSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = model('FiscalYearClose', fiscalYearCloseSchema);
