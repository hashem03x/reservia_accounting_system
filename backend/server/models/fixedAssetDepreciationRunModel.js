const { Schema, model } = require('mongoose');

// The auditable result of one depreciation / amortization run for a month
// (services/fixedAssets/fixedAssetService.js#runDepreciation), saved in the same transaction as its
// journal entries: which assets were depreciated (amount, entry), which were not and why, and the
// earlier months each asset still has not been depreciated for. A run that changed nothing (every
// asset already done) is recorded too, so every run can be traced.
const depreciationRunSchema = new Schema(
  {
    period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    date: { type: Date, required: true },
    processed: [
      {
        _id: false,
        asset: { type: Schema.Types.ObjectId, ref: 'FixedAsset' },
        name: String,
        assetClass: String,
        amount: Number,
        bookValue: Number,
        accumulatedDepreciation: Number,
        journalEntry: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
        entryNumber: Number,
      },
    ],
    skipped: [{ _id: false, asset: { type: Schema.Types.ObjectId, ref: 'FixedAsset' }, name: String, reason: String }],
    // Assets with months before this one that were never depreciated (each month is run separately).
    missingEarlierMonths: [{ _id: false, asset: { type: Schema.Types.ObjectId, ref: 'FixedAsset' }, name: String, periods: [String] }],
    totalAmount: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

depreciationRunSchema.index({ period: 1, createdAt: -1 });

module.exports = model('FixedAssetDepreciationRun', depreciationRunSchema);
