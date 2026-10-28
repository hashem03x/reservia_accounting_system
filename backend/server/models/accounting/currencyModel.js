const { Schema, model } = require('mongoose');
<<<<<<< HEAD

// Currency master data (Currency Management). EGP is the company's base currency and is the
// implicit currency of every Journal Entry line that carries no `currency` - see
// journalEntryModel.js's `currency`/`exchangeRate` fields and utils/exchangeRate.js, which this
// model's `rate` feeds into.
//
// Exchange-rate convention (docs section "Exchange-Rate Convention", chosen deliberately - see
// utils/exchangeRate.js's header comment for the full reasoning): `rate` here is the CANONICAL,
// user-facing representation - units of this currency per 1 EGP (e.g. USD 0.02, i.e. "1 EGP =
// 0.02 USD"). This is intentionally the INVERSE of JournalEntry.lines.exchangeRate (EGP per 1 unit
// of foreign currency, e.g. USD 50), which already existed before this model and which every
// existing General Ledger/report calculation already assumes - utils/exchangeRate.js#toLineRate
// converts between the two at the one boundary where a Journal Entry is created from a selected
// Currency, so neither existing field's meaning is ever silently changed.
const currencySchema = new Schema(
  {
    code: {
      type: String,
      required: [true, 'Currency code is required'],
      unique: true,
      trim: true,
      uppercase: true,
      minlength: [3, 'Currency code must be a 3-letter ISO 4217 code'],
      maxlength: [3, 'Currency code must be a 3-letter ISO 4217 code'],
      match: [/^[A-Z]{3}$/, 'Currency code must be 3 uppercase letters (ISO 4217), e.g. EGP, USD, EUR'],
    },
    name: {
      type: String,
      required: [true, 'Currency name is required'],
      trim: true,
      maxlength: 100,
    },
    symbol: {
      type: String,
      trim: true,
      maxlength: 10,
      default: null,
    },
    isBaseCurrency: {
      type: Boolean,
      default: false,
    },
    // Units of this currency per 1 EGP - always exactly 1 for the base currency (EGP itself).
    // Never 0, negative, or non-finite - see the validator below and currencyValidators.js.
    rate: {
      type: Number,
      required: [true, 'Exchange rate is required'],
      validate: {
        validator: Number.isFinite,
        message: 'Exchange rate must be a finite number',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// At most one base currency ever exists at a time (partial index - documents with
// isBaseCurrency: false never participate in this uniqueness check).
currencySchema.index({ isBaseCurrency: 1 }, { unique: true, partialFilterExpression: { isBaseCurrency: true } });

currencySchema.pre('validate', async function (next) {
  if (this.isBaseCurrency && this.rate !== 1) {
    return next(new Error('The base currency (EGP) must always have an exchange rate of exactly 1.'));
  }
  if (!this.isBaseCurrency && this.rate <= 0) {
    return next(new Error('Exchange rate must be greater than zero.'));
  }

  // The base currency's identity and rate can never change once created - the one immutability
  // rule this task requires ("Users must not be able to change EGP's base-currency status or
  // assign it a different exchange rate"). Checked here too (not only in the controller) so no
  // other write path can bypass it - the same "no validation is bypassed by a different endpoint"
  // principle already applied to Sub Account validation elsewhere in this codebase.
  if (!this.isNew) {
    const original = await this.constructor.collection.findOne({ _id: this._id }, { projection: { isBaseCurrency: 1, code: 1, rate: 1 } });
    if (original?.isBaseCurrency) {
      if (this.isModified('isBaseCurrency') && !this.isBaseCurrency) return next(new Error('The base currency cannot be unset. Make another currency the base currency instead, if this is truly required.'));
      if (this.isModified('code') && this.code !== original.code) return next(new Error('The base currency code cannot be changed.'));
      if (this.isModified('rate') && this.rate !== 1) return next(new Error('The base currency (EGP) must always have an exchange rate of exactly 1.'));
    } else if (this.isModified('isBaseCurrency') && this.isBaseCurrency) {
      return next(new Error('Only EGP may be the base currency.'));
    }
  } else if (this.isBaseCurrency && this.code !== 'EGP') {
    return next(new Error('Only EGP may be the base currency.'));
  }

=======
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
>>>>>>> origin/main
  next();
});

module.exports = model('Currency', currencySchema);
