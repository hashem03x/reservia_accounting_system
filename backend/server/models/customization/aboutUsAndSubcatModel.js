const mongoose = require('mongoose');
const mongooseI18n = require('mongoose-i18n-localize');

const aboutUsAndSubcategoriesSchema = new mongoose.Schema(
  {
    logo: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      i18n: true,
      required: true,
    },
    content: {
      type: String,
      i18n: true,
      required: true,
    },
    socialLinks: {
      facebook: {
        type: String,
      },
      twitter: {
        type: String,
      },
      instagram: {
        type: String,
      },
      tiktok: {
        type: String,
      },
      telegram: {
        type: String,
      },
      whatsapp: {
        type: String,
      },
      youtube: {
        type: String,
      },
    },
    homeSubcategories: [
      {
        type: mongoose.Schema.ObjectId,
        ref: 'Subcategory',
      },
    ],
    barcodeSittings: {
      subcategory: { type: Boolean, default: false },
      color: { type: Boolean, default: false },
      size: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

const setImageUrl = doc => {
  if (doc.logo) {
    const imageUrl = `${process.env.BASE_URL}/customization/${doc.logo}`;
    doc.logo = imageUrl;
  }
};

aboutUsAndSubcategoriesSchema.post('init', doc => {
  setImageUrl(doc);
});

// create
aboutUsAndSubcategoriesSchema.post('save', doc => {
  setImageUrl(doc);
});

aboutUsAndSubcategoriesSchema.plugin(mongooseI18n, { locales: ['en', 'ar'], defaultLocale: process.env.DEFAULT_LANGUAGE });

const AboutUsAndSubcategories = mongoose.model('AboutUsAndSubcategories', aboutUsAndSubcategoriesSchema);

module.exports = AboutUsAndSubcategories;
