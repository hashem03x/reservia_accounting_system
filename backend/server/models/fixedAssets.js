const { Schema, model } = require('mongoose');

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
  });
  next();
});

fixedAssetSchema.virtual('loseValue').get(function () {
  return this.bookValue - this.fairValue;
});

const FixedAsset = model('FixedAsset', fixedAssetSchema);
module.exports = FixedAsset;
