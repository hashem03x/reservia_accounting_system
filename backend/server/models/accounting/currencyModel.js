const { Schema, model } = require('mongoose');
const { BASE_CURRENCY_CODE, isValidRate } = require('../../utils/currencyMath');

// A currency managed in the Currency Manager (Accounting -> Currencies). All business rules live in
// services/accounting/currencyService.js; this schema is the backstop for the invariants that must
// hold whatever code path writes a currency.
//
// Exchange-rate convention (see utils/currencyMath.js):  1 EGP = `unitsPerBase` units of this currency.
// EGP is the base currency: exactly one currency is the base, it is always EGP, its rate is always
// 1, and it can never be deactivated or deleted.
//
// Changing a currency's rate never touches a journal entry: each entry stores the rate it was
// created with (JournalEntry.currencyUnitsPerBase), so historical entries and reports never move.

const rateHistorySchema = new Schema(
  {
    unitsPerBase: { type: Number, required: true },
    // The date from which this rate applies to transactions (the rate a journal entry dated D gets
    // by default is the latest entry here with effectiveDate <= D).
    effectiveDate: { type: Date, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const currencySchema = new Schema(
  {
    // ISO 4217-style alphabetic code (EGP, USD, EUR...). Stored upper-case; never renamed once
    // created, because journal entries reference currencies by code.
    code: {
      type: String,
      required: [true, 'Currency code is required'],
      trim: true,
      uppercase: true,
      match: [/^[A-Z]{3}$/, 'Currency code must be exactly 3 letters (e.g. USD)'],
      immutable: true,
    },
    name: { type: String, required: [true, 'Currency name is required'], trim: true, maxlength: [60, 'Currency name cannot exceed 60 characters'] },
    nameAr: { type: String, trim: true, maxlength: [60, 'Arabic name cannot exceed 60 characters'], default: '' },
    symbol: { type: String, trim: true, maxlength: [8, 'Currency symbol cannot exceed 8 characters'], default: '' },
    // 1 EGP = unitsPerBase units of this currency. Full precision is stored; never a rounded value.
    unitsPerBase: {
      type: Number,
      required: [true, 'Exchange rate is required'],
      validate: { validator: isValidRate, message: 'Exchange rate must be a finite number greater than zero' },
    },
    // The date the CURRENT rate became effective (mirrors the last rateHistory item).
    rateEffectiveDate: { type: Date, default: Date.now },
    isBase: { type: Boolean, default: false, immutable: true },
    isActive: { type: Boolean, default: true },
    rateHistory: { type: [rateHistorySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    // Two admins saving the same currency at once: the second save fails with a VersionError
    // instead of silently overwriting the first one's rate (handled as a 409 by the service).
    optimisticConcurrency: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

currencySchema.index({ code: 1 }, { unique: true });
// At most one base currency, enforced by the database itself.
currencySchema.index({ isBase: 1 }, { unique: true, partialFilterExpression: { isBase: true } });
currencySchema.index({ isActive: 1 });

// Inverse rate, for display: 1 unit of this currency = basePerUnit EGP.
currencySchema.virtual('basePerUnit').get(function () {
  return isValidRate(this.unitsPerBase) ? 1 / this.unitsPerBase : null;
});

currencySchema.pre('validate', function (next) {
  const isBaseCode = this.code === BASE_CURRENCY_CODE;
  if (this.isBase && !isBaseCode) return next(new Error(`Only ${BASE_CURRENCY_CODE} can be the base currency.`));
  if (isBaseCode && !this.isBase) return next(new Error(`${BASE_CURRENCY_CODE} is the base currency and must be marked as such.`));
  if (this.isBase) {
    if (this.unitsPerBase !== 1) return next(new Error(`The base currency's exchange rate is always 1 (1 ${BASE_CURRENCY_CODE} = 1 ${BASE_CURRENCY_CODE}).`));
    if (!this.isActive) return next(new Error('The base currency cannot be deactivated.'));
  }
  next();
});

module.exports = model('Currency', currencySchema);
