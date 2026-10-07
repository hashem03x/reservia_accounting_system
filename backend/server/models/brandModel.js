const mongoose = require('mongoose');
const mongooseI18n = require('mongoose-i18n-localize');

const brandSchema = mongoose.Schema(
  {
    name: {
      type: String,
      unique: [true, 'brand must be unique'],
      require: [true, 'brand name is required'],
      trim: true,
      i18n: true,
      // minlenght: [2, 'brand name is too short'],
      // maxlenght: [32, 'brand name is too long'],
    },
    slug: {
      type: String,
      lowercase: true,
    },
    image: String,
  },
  { timestamps: true }
);

const setImageUrl = doc => {
  if (doc.image) {
    const imageUrl = `${process.env.BASE_URL}/brands/${doc.image}`;
    doc.image = imageUrl;
  }
};

// findOne, findAll, update
brandSchema.post('init', doc => {
  setImageUrl(doc);
});

// create
brandSchema.post('save', doc => {
  setImageUrl(doc);
});

brandSchema.plugin(mongooseI18n, { locales: ['en', 'ar'], defaultLocale: process.env.DEFAULT_LANGUAGE });

module.exports = mongoose.model('Brand', brandSchema);
