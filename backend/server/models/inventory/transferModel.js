const { Schema, model } = require('mongoose');
const mongooseI18n = require('mongoose-i18n-localize');

const transferSchema = new Schema(
  {
    // 'product' = move all available stock of the one `product` field below from source to
    // target warehouse. 'products' = move specific quantities of one or more products, listed in
    // `details`. (Previously three types - 'product'/'variant'/'variants' - distinguished by
    // variant granularity; with Variant removed, 'variant' and 'variants' collapsed into this one
    // 'products' type, since a single-entry `details` array already covers the old singular case.)
    type: {
      type: String,
      enum: ['product', 'products'],
      required: true,
    },

    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    details: [
      {
        product: {
          type: Schema.Types.ObjectId,
          ref: 'Product',
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
        },
      },
    ],
    sourceWarehouse: {
      type: Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: true,
    },
    targetWarehouse: {
      type: Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: true,
    },
    totalQuantity: {
      type: Number,
      default: 0,
    },
    transferredBy: {
      type: Schema.Types.ObjectId,
      ref: 'User', // Reference to the user who initiated the transfer
      // required: true,
    },
    transferredAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['initiated', 'completed', 'failed'],
      default: 'initiated',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

const totalQuantity = details => {
  return details.reduce((sum, item) => sum + item.quantity, 0);
};

// Calculate total quantity
transferSchema.pre('save', function (next) {
  this.totalQuantity = totalQuantity(this.details);

  this.status = this.totalQuantity > 0 ? 'completed' : 'failed';
  next();
});

transferSchema.pre(/^find/, function (next) {
  this.populate({
    path: 'product',
    select: 'title barcode sku',
  });

  this.populate({
    path: 'details.product',
    select: 'title barcode sku',
  });

  this.populate({
    path: 'transferredBy',
    select: 'name email',
  });

  next();
});

transferSchema.plugin(mongooseI18n, { locales: ['en', 'ar'], defaultLocale: process.env.DEFAULT_LANGUAGE });
module.exports = model('Transfer', transferSchema);
