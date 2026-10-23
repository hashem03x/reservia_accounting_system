const mongoose = require('mongoose');
const mongooseI18n = require('mongoose-i18n-localize');
const generateBarcode = require('../../utils/generateBarcode');
// Explicit require (not just the string `ref:` name) - `pucAccount` is populated/validated below.
require('../accounting/chartOfAccountModel');

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
    // Neither cost nor price is required to DEFINE a product or service (client requirement
    // "Products - Cost and Price are not required to define a product"): both are known only once
    // it is bought / quoted. A product without a cost never produces a zero-value accounting entry -
    // the PUC transfer refuses it (pucTransferService.js) and a purchase sets it from the purchase
    // price (purchaseOrderController.js); every document line carries its own price.
    cost: {
      type: Number,
      min: [0, 'Product cost cannot be negative'],
    },
    price: { type: Number, min: [0, 'Product price cannot be negative'], max: 250000 }, // Also doubles as the service's selling price when type === 'service'. Optional - see cost above.
    priceAfterDiscount: { type: Number, default: null },
    totalSold: { type: Number, default: 0 },
    isAvailable: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [function () { return this.type !== 'service'; }, 'Category is required'],
    },
    // Second level of the catalog hierarchy: Main Category -> Subcategory -> Brand -> Model/Item ->
    // Technical Specifications (client requirement "Products - Category, Brand, Model/Item,
    // Specifications"). Optional (products created before it was restored to the hierarchy have
    // none), but when set it must belong to `category` - checked by productValidator.js and the
    // product CSV import. Services are unchanged (their classification is pending client confirmation).
    subcategory: {
      type: mongoose.Schema.ObjectId,
      ref: 'SubCategory',
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
    // Service-only: the PUC (Projects Under Construction / WIP) Chart of Accounts account a
    // purchase of this service is posted to - Purchase Orders debit THIS account for a service
    // line instead of Materials Inventory (see accountingEventService.js#
    // postPurchaseOrderJournalEntries, PO_SERVICE_TO_WIP). A real ChartOfAccount reference, never a
    // name/code string. Required for every new service by the request validators
    // (productValidator.js); not a schema-level `required` so services created before this field
    // existed still load/save - the accounting engine refuses to post a purchase for such a
    // service until a PUC account is set on it (never a fallback account).
    pucAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null },
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
    // Primary identification field under Category in the catalog hierarchy (Category -> Brand ->
    // Model/Item Number/Specifications) - replaces `subcategory` above as the field the request
    // validator (productValidator.js/productTypeValidation.js) requires for a NEW product created
    // through the API. Deliberately NOT required at the schema level (unlike `category`/`cost`
    // above) - the same reasoning as `pucAccount` below: a huge amount of existing/internal
    // Product creation (migration scripts, CSV import fixtures, accounting/PO/reversal test
    // suites, and any legacy document already in the database) sets `category`/`subcategory` but
    // has no `brand` yet, and a hard schema requirement would break every one of those existing
    // call sites instead of just the one real create-a-new-product-via-the-UI path that actually
    // needs enforcing.
    brand: {
      type: mongoose.Schema.ObjectId,
      ref: 'Brand',
      default: null,
    },
    // Freeform model/specs identifier, part of the Category -> Brand -> Model/Item Number
    // hierarchy. `itemNumber` is distinct from `sku`/`barcode` (which already exist and keep
    // their existing uniqueness policy) - this is purely a descriptive manufacturer model
    // reference, not a new identity/uniqueness key.
    model: { type: String, trim: true },
    specifications: { type: String, trim: true },
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
  this.populate({
    path: 'pucAccount',
    select: 'code name nameAr type',
  });
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

productSchema.plugin(mongooseI18n, { locales: ['en', 'ar'], defaultLocale: process.env.DEFAULT_LANGUAGE });

module.exports = mongoose.model('Product', productSchema);
