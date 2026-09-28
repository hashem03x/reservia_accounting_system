const mongoose = require('mongoose');
const mongooseI18n = require('mongoose-i18n-localize');

const subCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'SubCategory name is required'],
      trim: true,
      i18n: true,
    },
    slug: {
      type: String,
      lowercase: true,
    },
    display: {
      type: Boolean,
      default: true,
    },
    image: String,
    tags: [String], // slim, baggy, linen, cotton, plain, new, hot, etc.
    mainCategory: {
      type: mongoose.Schema.ObjectId,
      ref: 'Category',
      required: [true, 'SubCategory must belong to main category'],
    },
  },
  { timestamps: true }
);

// Add i18n plugin
subCategorySchema.plugin(mongooseI18n, {
  locales: ['en', 'ar'],
  defaultLocale: process.env.DEFAULT_LANGUAGE,
});

const setImageUrl = doc => {
  if (doc.image) {
    const imageUrl = `${process.env.BASE_URL}/subcategories/${doc.image}`;
    doc.image = imageUrl;
  }
};

// findOne, findAll, update
subCategorySchema.post('init', doc => {
  setImageUrl(doc);
});

// create
subCategorySchema.post('save', doc => {
  setImageUrl(doc);
});

subCategorySchema.pre(/^find/, function (next) {
  this.populate({ path: 'mainCategory', select: 'name' });
  next();
});

subCategorySchema.pre('findOneAndUpdate', function (next) {
  const doc = this.getUpdate();
  if (doc.image && doc.image.startsWith('http')) {
    const image = doc.image.split('/').pop();
    doc.image = image;
  }

  this.setUpdate(doc);
  next();
});

subCategorySchema.plugin(mongooseI18n, { locales: ['en', 'ar'], defaultLocale: process.env.DEFAULT_LANGUAGE });

module.exports = mongoose.model('SubCategory', subCategorySchema);
