const { Schema, model } = require('mongoose');
const mongooseI18n = require('mongoose-i18n-localize');

const transferSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['product', 'variant', 'variants'],
      required: true,
    },

    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    // variantId: {
    //   type: Schema.Types.ObjectId,
    //   ref: 'Variant',
    //   required: function () {
    //     return this.type === 'variant';
    //   },
    // },
    details: [
      {
        variant: {
          type: Schema.Types.ObjectId,
          ref: 'Variant',
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

// virtual populate variantId to variant
// transferSchema.virtual('variant').get(function () {
//   return this.details.map((detail) => detail.variantId);
// });

// // virtual populate productId to product
// transferSchema.virtual('product').get(function () {
//   return this.productId;
// });

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
  // variants are not required to be populated
  this.populate({
    path: 'product',
    select: 'title',
    options: { populateVariants: false },
  });

  this.populate({
    path: 'details.variant',
    select: 'sku color size stockStatus stockLevel',
    options: { populateProduct: false },
  });

  this.populate({
    path: 'transferredBy',
    select: 'name email',
  });

  next();
});

// afeter save transfer
// transferSchema.post('save', async function (doc, next) {
// await this
//     .populate({
//       path: 'product',
//       select: 'title', // Populate only the title field from Product
//     })
//     .populate({
//       path: 'details.variant',
//       select: 'size color sku', // Populate size, color, and SKU from Variant
//     })
//     .execPopulate();

//   next();
// });

transferSchema.plugin(mongooseI18n, { locales: ['en', 'ar'], defaultLocale: process.env.DEFAULT_LANGUAGE });
module.exports = model('Transfer', transferSchema);
