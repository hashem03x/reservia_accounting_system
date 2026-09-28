const mongoose = require('mongoose');
const mongooseI18n = require('mongoose-i18n-localize');
const { getColorCode, isValidColor } = require('../../utils/colorMapping');
const { normalizeTags } = require('../../utils/helper');

const productImageSchema = new mongoose.Schema({
  url: { type: String },
  alt: { type: String },
  filename: { type: String },
  sortOrder: { type: Number, default: 0 },
  imageType: { type: String, enum: ['main', 'thumbnail', 'detail', 'lifestyle'], default: 'detail' },
});

const colorSchema = new mongoose.Schema({
  name: {
    type: String,
    lowercase: true,
    validate: {
      validator: function (value) {
        return isValidColor(value);
      },
      message: props => `${props.value} is not a valid color!`,
    },
  },
  code: { type: String },
  images: { type: [productImageSchema], default: [] },
  isDefault: { type: Boolean, default: false },
});

colorSchema.pre('save', function (next) {
  if (this.name && !this.code) {
    this.code = getColorCode(this.name);
  }
  next();
});

const productSchema = mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, i18n: true, unique: true },
    description: { type: String, required: [true, 'Product description is required'], i18n: true },
    cost: { type: Number, required: [true, 'Product cost is required'] }, // Cost price
    price: { type: Number, required: [true, 'Product price is rquired'], max: 250000 },
    priceAfterDiscount: { type: Number, default: null },
    totalSold: { type: Number, default: 0 },
    isAvailable: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    season: { type: String, default: 'all', enum: ['summer', 'winter', 'spring', 'autumn', 'all'] },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    subcategory: { type: mongoose.Schema.ObjectId, ref: 'SubCategory', required: true },
    colors: [colorSchema],
    variants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Variant' }],
    createdBy: { type: mongoose.Schema.ObjectId, ref: 'User' },

    ratingsQuantity: { type: Number, default: 0 },
    ratingsAverage: { type: Number },

    // Not used
    imageCover: { url: { type: String }, sortOrder: { type: Number, default: 0 }, publicId: { type: String } },
    tags: [String], // slim, baggy, linen, cotton, plain, new, hot, etc.
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

// Populate variants
productSchema.pre(/^find/, function (next) {
  // Check if the Variant model exists to avoid errors if not registered
  // if middleware cancle populate varinat cancel it
  // if(this.getOptions().populateVariants ) return next();
  if (this.getOptions().populateVariants !== false && mongoose.models.Variant) {
    this.populate({
      path: 'variants',
    });
  }

  next();
});

productSchema.pre(/^find/, function (next) {
  this.populate({
    path: 'createdBy',
    select: 'name',
  });
  next();
});

// =============================================================

productSchema.index({ 'colors.name': 1, _id: 1 }, { unique: true });

// =============================================================
// Tag corruption repair (see utils/helper.js's normalizeTags/unwrapCorruptedTag doc comments for
// the exact corrupted shapes this recovers from - legacy data can have a tag stored as a
// JSON-encoded array, a JSON-quoted string, or a Python-style list literal instead of a plain
// string). Two hooks, not one, so both directions are covered:
//   - post('init') repairs the in-memory representation the MOMENT a corrupted document is
//     loaded (find/findOne/findById etc.) - every API response is clean even before anything
//     re-saves the document, satisfying "when existing corrupted data is loaded, clean it
//     automatically" without needing a getter/toJSON transform.
//   - pre('save') guarantees any future save (including ones that don't go through
//     productValidator.js's HTTP-only validateAndNormalizeTags, e.g. an internal script) also
//     stores clean data, so corruption can't be reintroduced from a path this hook doesn't know
//     about.
// Neither hook writes to the database by itself (post('init') only mutates the in-memory doc) -
// storage is only actually fixed the next time something saves that document, same as any other
// edit. See server/scripts/cleanCorruptedTags.js for a one-time sweep that fixes storage directly.
productSchema.post('init', function (doc) {
  if (Array.isArray(doc.tags)) {
    const cleaned = normalizeTags(doc.tags);
    if (cleaned.length !== doc.tags.length || cleaned.some((tag, i) => tag !== doc.tags[i])) {
      doc.tags = cleaned;
    }
  }
});

productSchema.pre('save', function (next) {
  if (Array.isArray(this.tags)) {
    this.tags = normalizeTags(this.tags);
  }
  next();
});

productSchema.plugin(mongooseI18n, { locales: ['en', 'ar'], defaultLocale: process.env.DEFAULT_LANGUAGE });

module.exports = mongoose.model('Product', productSchema);

// =============================================================

// Set image URL for each color object
const setImageUrl = doc => {
  // Add base URL to imageCover if it exists
  if (doc.imageCover) {
    doc.imageCover = `${process.env.BASE_URL}/products/${doc.imageCover}`;
  }

  // Loop over each color object and update image URLs
  if (Array.isArray(doc.colors)) {
    doc.colors.forEach(color => {
      // Check if color is an object and not null before accessing its image property
      if (color && Array.isArray(color.images)) {
        color.images = color.images.map(img => `${process.env.BASE_URL}/products/${img}`);
      }
    });
  }
};

// findOne, findAll, udate
// productSchema.post('init', doc => {
//   setImageUrl(doc);
// });
// // create
// productSchema.post('save', doc => {
//   setImageUrl(doc);
// });

// productSchema.pre('findOneAndUpdate', function (next) {
//   const doc = this.getUpdate();
//   if (doc.imageCover && doc.imageCover.startsWith('http')) {
//     const imageCover = doc.imageCover.split('/').pop();
//     doc.imageCover = imageCover;
//   }

//   if (doc.$addToSet && doc.$addToSet.image) {
//     if (typeof doc.$addToSet.image === 'string') doc.$addToSet.image = [doc.$addToSet.image];
//     for (let i = 0; i < doc.$addToSet.image.length; i++) {
//       if (doc.$addToSet.image[i].startsWith('http')) {
//         const image = doc.$addToSet.image[i].split('/').pop();
//         doc.$addToSet.image[i] = image;
//       }
//     }
//   }
//   this.setUpdate(doc);
//   next();
// });
