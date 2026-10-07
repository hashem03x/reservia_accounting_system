const mongoose = require('mongoose');
const mongooseI18n = require('mongoose-i18n-localize');

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      unique: [true, 'Category must be unique'],
      trim: true,
      index: true,
      i18n: true,
    },
    slug: {
      type: String,
      lowercase: true,
    },
    image: String,
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },

  { timestamps: true }
);

const setImageUrl = doc => {
  if (doc.image) {
    const imageUrl = `${process.env.BASE_URL}/categories/${doc.image}`;
    doc.image = imageUrl;
  }
};

// findOne, findAll, update
categorySchema.post('init', doc => {
  setImageUrl(doc);
});

// create
categorySchema.post('save', doc => {
  setImageUrl(doc);
});

categorySchema.pre('findOneAndUpdate', function (next) {
  const doc = this.getUpdate();
  if (doc.image && doc.image.startsWith('http')) {
    const image = doc.image.split('/').pop();
    doc.image = image;
  }

  this.setUpdate(doc);
  next();
});

categorySchema.plugin(mongooseI18n, { locales: ['en', 'ar'], defaultLocale: process.env.DEFAULT_LANGUAGE });

module.exports = mongoose.model('Category', categorySchema);
