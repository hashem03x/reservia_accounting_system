const { Schema, model } = require('mongoose');
const mongooseI18n = require('mongoose-i18n-localize');
const Payment = require('../vendor/paymentModel');

const warehouseSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    location: { type: String, required: true, unique: true },
    image: { type: String, default: null },
    balance: { type: Number, default: 0 },
    totalBalanceEGP: { type: Number, default: 0 },
    // Currencies configuration
    usd: {
      balance: { type: Number, default: 0 },
      exchangeRate: { type: Number, default: 1 },
    },
    eur: {
      balance: { type: Number, default: 0 },
      exchangeRate: { type: Number, default: 1 },
    },
    try: {
      balance: { type: Number, default: 0 },
      exchangeRate: { type: Number, default: 1 },
    },
    cny: {
      balance: { type: Number, default: 0 },
      exchangeRate: { type: Number, default: 1 },
    },
    capacity: Number,
    isDefault: { type: Boolean, default: false },
    onlineProfit: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

warehouseSchema.plugin(mongooseI18n, { locales: ['en', 'ar'], defaultLocale: process.env.DEFAULT_LANGUAGE });

// Pre middleware to calculate totalBalanceEGP before save
warehouseSchema.pre('save', async function (next) {
  try {
    let total = this.balance || 0;

    // Get currency transfer payments
    const currencyTransfers = await Payment.find({
      paymentCategory: 'currency-transfer',
      type: 'out',
      warehouseId: this._id,
    });
    const currencyTransferAmountIn = await Payment.find({
      paymentCategory: 'currency-transfer',
      type: 'in',
      warehouseId: this._id,
    });

    const totalCurrencyTransfersIn = currencyTransferAmountIn.reduce((sum, payment) => sum + payment.amountPaid, 0);
    const totalCurrencyTransfers = currencyTransfers.reduce((sum, payment) => sum + payment.amountPaid, 0) - totalCurrencyTransfersIn;
    this.totalBalanceEGP = total + totalCurrencyTransfers;
    next();
  } catch (error) {
    next(error);
  }
});

// Middleware to format balance numbers to 2 decimal places
warehouseSchema.pre('save', function (next) {
  // Format main balance
  if (this.balance) {
    this.balance = Number(this.balance.toFixed(2));
  }

  // Format currency balances
  const currencies = ['usd', 'eur', 'try', 'cny'];
  currencies.forEach(currency => {
    if (this[currency] && this[currency].balance) {
      this[currency].balance = Number(this[currency].balance.toFixed(2));
    }
  });

  next();
});

// Middleware to format balance numbers after finding documents
warehouseSchema.post(/^find/, function (docs, next) {
  // Handle both single doc and array of docs
  const documents = Array.isArray(docs) ? docs : [docs];

  documents.forEach(doc => {
    if (!doc) return;

    // Format main balance
    if (doc.balance) {
      doc.balance = Number(doc.balance.toFixed(2));
    }

    // Format currency balances
    const currencies = ['usd', 'eur', 'try', 'cny'];
    currencies.forEach(currency => {
      if (doc[currency] && doc[currency].balance) {
        doc[currency].balance = Number(doc[currency].balance.toFixed(2));
      }
    });
  });

  next();
});

// Transform the image field to include the full URL whenever the document is converted to JSON. This process happens when sending the response i. e. using `res.status(200).json({ ... })`.
warehouseSchema.methods.toJSON = function () {
  const obj = this.toObject();
  if (obj.image) obj.image = `${process.env.BASE_URL}/warehouses/${obj.image}`;
  return obj;
};

module.exports = model('Warehouse', warehouseSchema);
