const { Schema, model } = require('mongoose');

// A monthly accounting period ('YYYY-MM', UTC calendar month - the reports' day boundary). A month
// with no document is open; only an administrator closes or reopens one, and every change is kept
// in `history`. While a month is closed no journal entry dated in it can be created, edited,
// posted or reversed into it (services/accounting/accountingPeriodService.js, enforced by
// journalEntryModel.js's pre('save') hook for every write path).
const periodEventSchema = new Schema(
  {
    action: { type: String, enum: ['closed', 'reopened'], required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    at: { type: Date, required: true },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const accountingPeriodSchema = new Schema(
  {
    period: { type: String, required: true, unique: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    status: { type: String, enum: ['open', 'closed'], default: 'open', required: true },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    closedAt: { type: Date, default: null },
    reopenedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reopenedAt: { type: Date, default: null },
    history: { type: [periodEventSchema], default: [] },
  },
  { timestamps: true }
);

accountingPeriodSchema.index({ status: 1 });

module.exports = model('AccountingPeriod', accountingPeriodSchema);
