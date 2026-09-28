const mongoose = require('mongoose');
const mongooseI18n = require('mongoose-i18n-localize');

const governorateSchema = mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Governorate must have a name'],
    i18n: true,
  },

  shippingCost: {
    type: Number,
    default: 0,
  },
  cities: [
    {
      name: {
        type: String,
        required: [true, 'City must have a name'],
        i18n: true,
      },
    },
  ],

  shippingCost: {
    type: Number,
    default: 0,
  },
});

governorateSchema.plugin(mongooseI18n, { locales: ['en', 'ar'], defaultLocale: process.env.DEFAULT_LANGUAGE });

module.exports = mongoose.model('Governorate', governorateSchema);
