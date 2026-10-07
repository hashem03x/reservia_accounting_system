const mongoose = require('mongoose');
const mongooseI18n = require('mongoose-i18n-localize');
const generateBarcode = require('../../utils/generateBarcode');
<<<<<<< HEAD
// Explicit require (not just the string `ref:` name) - `pucAccount` is populated/validated below.
require('../accounting/chartOfAccountModel');
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628

const productSchema = mongoose.Schema(
  {
    // Distinguishes a physical/stock-tracked item ("product") from a non-inventory offering
    // ("service") - see docs/entities/products.md for the full event/behavior split this drives
    // (inventory logic, variant creation, and several reports all branch on this field).
    type: { type: String, enum: ['product', 'service'], default: 'product', required: true },

    title: { type: String, required: true, trim: true, i18n: true, unique: true },
    description: { type: String, required: [true, 'Product description is required'], i18n: true },
    // Cost/category/subcategory are inventory/merchandising concepts that only make sense for a
    // physical product - conditionally required so a service isn't forced to fabricate values for
    // fields it has no real answer for.
    cost: {
      type: Number,
      required: [function () { return this.type !== 'service'; }, 'Product cost is required'],
    },
    price: { type: Number, required: [true, 'Product price is rquired'], max: 250000 }, // Also doubles as the service's selling price when type === 'service'.
    priceAfterDiscount: { type: Number, default: null },
    totalSold: { type: Number, default: 0 },
    isAvailable: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [function () { return this.type !== 'service'; }, 'Category is required'],
    },
    subcategory: {
      type: mongoose.Schema.ObjectId,
      ref: 'SubCategory',
      required: [function () { return this.type !== 'service'; }, 'Subcategory is required'],
    },
    // Integrated Energy spec (e.g. "100 kW") - optional so existing products created before this
    // field existed keep loading/saving fine.
    capacity: {
      value: { type: Number },
      unit: { type: String, trim: true },
    },
    // Service-only fields. Deliberately flat (not nested under a `service: {}` object) to match
    // this schema's existing flat style (price/cost/etc. all live at the top level).
    durationValue: {
      type: Number,
      min: 1,
      required: [function () { return this.type === 'service'; }, 'Service duration is required'],
    },
    durationUnit: {
      type: String,
      enum: ['month'], // Only unit needed today; add more here (not a rewrite) if a future phase needs them.
      default: function () { return this.type === 'service' ? 'month' : undefined; },
    },
<<<<<<< HEAD
    // Service-only: the PUC (Projects Under Construction / WIP) Chart of Accounts account a
    // purchase of this service is posted to - Purchase Orders debit THIS account for a service
    // line instead of Materials Inventory (see accountingEventService.js#
    // postPurchaseOrderJournalEntries, PO_SERVICE_TO_WIP). A real ChartOfAccount reference, never a
    // name/code string. Required for every new service by the request validators
    // (productValidator.js); not a schema-level `required` so services created before this field
    // existed still load/save - the accounting engine refuses to post a purchase for such a
    // service until a PUC account is set on it (never a fallback account).
    pucAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null },
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
    // Replaces the old Variant model (removed - see docs/entities/products.md) - a Product is now
    // itself the sellable/stock-tracked item instead of requiring a separate Variant. `sku` is
    // plain/optional (the old Variant.sku had no real uniqueness enforcement either - its compound
    // index included `_id`, which made it a no-op constraint - so nothing is weakened here).
    // `barcode` replaces `Variant.variantCode` (same generator, same role). `stock` replaces
    // `Variant.stock` (identical per-warehouse shape).
    sku: { type: String, trim: true },
    barcode: { type: String, default: () => generateBarcode().toString(), unique: true, sparse: true },
    stock: [
      {
        warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
        quantity: { type: Number, required: true },
        starterQuantity: { type: Number, default: 0 },
      },
    ],
    createdBy: { type: mongoose.Schema.ObjectId, ref: 'User' },

    ratingsQuantity: { type: Number, default: 0 },
    ratingsAverage: { type: Number },

    // Not used
    imageCover: { url: { type: String }, sortOrder: { type: Number, default: 0 }, publicId: { type: String } },
    brand: { type: mongoose.Schema.ObjectId, ref: 'Brand' },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// =============================================================

// Virtual populate
productSchema.virtual('reviews', {
  ref: 'Review',
  foreignField: 'product',
  localField: '_id',
});

productSchema.pre(/^find/, function (next) {
  this.populate({
    path: 'createdBy',
    select: 'name',
  });
<<<<<<< HEAD
  this.populate({
    path: 'pucAccount',
    select: 'code name nameAr type',
  });
=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
  next();
});

// =============================================================

// Defense-in-depth: a service has no physical stock to track (see docs/entities/products.md) -
// guards the invariant at the model layer (e.g. against a future/internal script pushing straight
// into `stock`), mirroring the pre-existing "service cannot have variants" guard this replaces.
productSchema.pre('save', function (next) {
  if (this.type === 'service' && Array.isArray(this.stock) && this.stock.length > 0) {
    return next(new Error('A service cannot have inventory stock.'));
  }
  next();
});

<<<<<<< HEAD
// Backstop for Product.pucAccount (the request validator is only the fast pre-check): a PUC
// account belongs to services only, and must be a real, eligible account (see
// accountingConstants.js#isPucAccountEligible). Only runs when the field actually changed, so a
// legacy document being re-saved for an unrelated reason is never re-validated against it.
productSchema.pre('save', async function (next) {
  try {
    if (!this.isModified('pucAccount') || !this.pucAccount) return next();
    if (this.type !== 'service') throw new Error('Only a service can have a PUC account.');

    const { isPucAccountEligible } = require('../../utils/accountingConstants'); // eslint-disable-line global-require
    const account = await mongoose.model('ChartOfAccount').findById(this.pucAccount?._id || this.pucAccount).session(this.$session());
    if (!account) throw new Error('The selected PUC account does not exist.');
    if (!isPucAccountEligible(account)) {
      throw new Error(`Account "${account.code} - ${account.name}" is not eligible as a PUC account (must be an active, non-cash asset account).`);
    }
    next();
  } catch (error) {
    next(error);
  }
});

=======
>>>>>>> 368811657e0eba1f2e8b46ee732d01745194d628
productSchema.plugin(mongooseI18n, { locales: ['en', 'ar'], defaultLocale: process.env.DEFAULT_LANGUAGE });

module.exports = mongoose.model('Product', productSchema);
