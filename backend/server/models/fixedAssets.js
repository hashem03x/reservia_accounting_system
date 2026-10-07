const { Schema, model } = require('mongoose');
const { FixedAssetStatuses } = require('../utils/accountingConstants');

const fixedAssetSchema = Schema(
  {
    name: {
      type: String,
      required: true,
    },
    bookValue: {
      type: Number,
      required: true,
      min: 0,
    },
    fairValue: {
      type: Number,
      required: true,
      min: 0,
    },
    warehouseId: {
      type: Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: true,
    },
    // --- Accounting-foundation fields (additive - see reversia master spec's "FIXED ASSETS"
    // section). Kept optional at the schema level (not `required: true`) so pre-existing
    // production documents that predate this phase remain valid; new-create requests are required
    // to supply them via fixedAssetValidators.js instead. `bookValue`/`fairValue` above are left
    // untouched - `sellFixedAsset` and the `loseValue` virtual still depend on them exactly as
    // before.
    price: {
      // Acquisition/purchase value, distinct from bookValue (which the pre-existing sell flow
      // uses as the amount of the outgoing Payment - kept separate rather than repurposed so nothing
      // about that flow changes).
      type: Number,
      min: 0,
    },
    assetAccountId: {
      // Prefer a real relationship over storing the code as a string (see master spec) - the
      // account's `code` is reachable through this reference (`assetAccountId.code`) without
      // duplicating it here.
      type: Schema.Types.ObjectId,
      ref: 'ChartOfAccount',
    },
    acquisitionDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: { values: FixedAssetStatuses, message: '{VALUE} is not a valid fixed asset status' },
      default: 'active',
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

// Add middleware to populate warehouse
fixedAssetSchema.pre(/^find/, function (next) {
  this.populate({
    path: 'warehouseId',
    select: 'name',
  }).populate({
    path: 'assetAccountId',
    select: 'code name type',
  });
  next();
});

fixedAssetSchema.virtual('loseValue').get(function () {
  return this.bookValue - this.fairValue;
});

const FixedAsset = model('FixedAsset', fixedAssetSchema);
module.exports = FixedAsset;
