const { Schema, model } = require('mongoose');
const { FixedAssetStatuses } = require('../utils/accountingConstants');

// One processed depreciation/amortization month of an asset - the record that prevents the same
// month from being depreciated twice (services/fixedAssets/fixedAssetService.js).
const depreciationSchema = new Schema(
  {
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ }, // 'YYYY-MM'
    amount: { type: Number, required: true, min: 0.01 },
    date: { type: Date, required: true },
    journalEntry: { type: Schema.Types.ObjectId, ref: 'JournalEntry', required: true },
    // The depreciation run that posted it (models/fixedAssetDepreciationRunModel.js).
    run: { type: Schema.Types.ObjectId, ref: 'FixedAssetDepreciationRun', default: null },
    // Set when its journal entry is reversed: the month no longer counts and can be run again.
    reversed: { type: Boolean, default: false },
    reversedByEntry: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } }
);

// One payment to the asset's vendor against the acquisition payable
// (services/fixedAssets/fixedAssetPaymentService.js). Kept for audit even when its entry is later
// reversed - only payments whose journal entry is still posted count as paid.
const assetPaymentSchema = new Schema(
  {
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    amount: { type: Number, required: true, min: 0.01 },
    paymentAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: true },
    date: { type: Date, required: true },
    reference: { type: String, trim: true },
    notes: { type: String, trim: true },
    journalEntry: { type: Schema.Types.ObjectId, ref: 'JournalEntry', required: true },
    // The client's submission key - a repeated request with the same key records nothing new.
    requestKey: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const fixedAssetSchema = Schema(
  {
    // FA-0001, FA-0002, ... (services/fixedAssets/fixedAssetNumberService.js) - assigned on creation,
    // never changed. Assets created before numbering existed get one from
    // scripts/backfillFixedAssetNumbers.js and show "-" until then.
    assetNumber: { type: Number, unique: true, sparse: true, immutable: true },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // The supplier the asset was acquired from - its Vendor Number is the Sub Account of the
    // acquisition entry. Optional at the schema level only so assets created before the Fixed
    // Assets module remain valid; every new asset requires one (fixedAssetValidators.js).
    vendor: {
      type: Schema.Types.ObjectId,
      ref: 'Vendor',
    },
    // Acquisition cost (excluding VAT) - the amount depreciated/amortized.
    price: {
      type: Number,
      min: 0,
    },
    // Cost - accumulated depreciation/amortization; never negative.
    bookValue: {
      type: Number,
      required: true,
      min: 0,
    },
    accumulatedDepreciation: {
      type: Number,
      default: 0,
      min: 0,
    },
    // العمر الإنتاجي بالشهور
    usefulLifeMonths: {
      type: Number,
      min: [1, 'Useful life must be at least 1 month'],
    },
    vatPercentage: { type: Number, default: 0, min: 0 },
    vatAmount: { type: Number, default: 0, min: 0 },
    // cost + VAT - what is owed to the vendor.
    totalAmount: { type: Number, min: 0 },
    // Chart of Accounts accounts - see services/fixedAssets/fixedAssetAccounts.js for which groups
    // each one must belong to.
    assetAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'ChartOfAccount',
    },
    accumulatedAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'ChartOfAccount',
    },
    depreciationAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'ChartOfAccount',
    },
    // Derived from the asset account's group: depreciation (tangible) or amortization (intangible).
    assetClass: {
      type: String,
      enum: ['tangible', 'intangible', null],
      default: null,
    },
    // Asset Date - depreciation starts with this date's month.
    acquisitionDate: {
      type: Date,
    },
    acquisitionJournalEntry: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    depreciations: { type: [depreciationSchema], default: [] },
    payments: { type: [assetPaymentSchema], default: [] },
    // Incremented by every payment - a payment is only saved if no other one was saved since the
    // outstanding amount was read, so concurrent payments can never exceed what is owed.
    paymentRevision: { type: Number, default: 0 },
    status: {
      type: String,
      enum: { values: FixedAssetStatuses, message: '{VALUE} is not a valid fixed asset status' },
      default: 'active',
    },
    // Only on assets created before the Fixed Assets module (they were tied to a warehouse).
    warehouseId: {
      type: Schema.Types.ObjectId,
      ref: 'Warehouse',
    },
    notes: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

fixedAssetSchema.index({ status: 1 });
fixedAssetSchema.index({ vendor: 1 });

fixedAssetSchema.pre(/^find/, function (next) {
  this.populate({ path: 'warehouseId', select: 'name' })
    .populate({ path: 'vendor', select: 'name vendorNumber' })
    .populate({ path: 'assetAccountId', select: 'code name nameAr type' })
    .populate({ path: 'accumulatedAccountId', select: 'code name nameAr type' })
    .populate({ path: 'depreciationAccountId', select: 'code name nameAr type' });
  next();
});

fixedAssetSchema.virtual('assetCode').get(function () {
  return this.assetNumber ? `FA-${String(this.assetNumber).padStart(4, '0')}` : null;
});

// Monthly depreciation/amortization: cost / useful life in months.
fixedAssetSchema.virtual('monthlyDepreciation').get(function () {
  if (!this.price || !this.usefulLifeMonths) return 0;
  return Math.round((this.price / this.usefulLifeMonths + Number.EPSILON) * 100) / 100;
});

const FixedAsset = model('FixedAsset', fixedAssetSchema);
module.exports = FixedAsset;
