const { Schema, model } = require('mongoose');

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

  next();
});

module.exports = model('Currency', currencySchema);
