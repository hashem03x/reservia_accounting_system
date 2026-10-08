const { Schema, model } = require('mongoose');
const { getNextShareholderNumber } = require('../../services/equity/shareholderNumberService');
// Explicit require (not just the string `ref:` name) - the hooks below look it up.
require('../accounting/chartOfAccountModel');

// One capital contribution - Dr the payment account / Cr the equity account
// (services/equity/shareholderService.js, SHAREHOLDER_CONTRIBUTION).
const contributionSchema = new Schema(
  {
    amount: { type: Number, required: true, min: 0.01 },
    date: { type: Date, required: true },
    paymentAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: true },
    equityAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: true },
    journalEntry: { type: Schema.Types.ObjectId, ref: 'JournalEntry', required: true },
    reference: { type: String, trim: true },
    notes: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const shareholderSchema = new Schema(
  {
    name: { type: String, required: [true, 'Shareholder name is required'], trim: true },
    // Sub Account of the shareholder's equity entries - assigned on creation, never changed.
    shareholderNumber: { type: Number, unique: true, sparse: true, immutable: true },
    ownershipPercentage: {
      type: Number,
      required: [true, 'Ownership percentage is required'],
      min: [0, 'Ownership percentage cannot be negative'],
      max: [100, 'Ownership percentage cannot exceed 100'],
    },
    // The Chart of Accounts equity account (type 'equity') this shareholder's capital is credited to.
    equityAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: [true, 'Equity account is required'] },
    // Total contributed capital - the sum of `contributions`, maintained by the contribution flow.
    shareCapital: { type: Number, default: 0, min: [0, 'Share capital cannot be negative'] },
    contributions: { type: [contributionSchema], default: [] },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    nationalId: { type: String, trim: true },
    notes: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shareholderSchema.index({ status: 1 });

// Active shareholders can never own more than 100% together.
shareholderSchema.pre('validate', async function (next) {
  try {
    if (this.status === 'active' && (this.isNew || this.isModified('ownershipPercentage') || this.isModified('status'))) {
      const [others] = await this.constructor
        .aggregate([{ $match: { _id: { $ne: this._id }, status: 'active' } }, { $group: { _id: null, total: { $sum: '$ownershipPercentage' } } }])
        .session(this.$session());
      const total = Math.round(((others?.total || 0) + (this.ownershipPercentage || 0)) * 10000) / 10000;
      if (total > 100) {
        return next(new Error(`Active shareholders' ownership would total ${total}% - it cannot exceed 100%.`));
      }
    }
    if (this.isModified('equityAccount') && this.equityAccount) {
      const account = await this.model('ChartOfAccount').findById(this.equityAccount).session(this.$session());
      if (!account || account.isActive === false || account.type !== 'equity') {
        return next(new Error('The equity account must be an active Chart of Accounts equity account.'));
      }
    }
    next();
  } catch (err) {
    next(err);
  }
});

shareholderSchema.pre('save', async function (next) {
  if (!this.isNew) return next();
  this.shareholderNumber = await getNextShareholderNumber();
  next();
});

shareholderSchema.pre(/^find/, function (next) {
  this.populate({ path: 'equityAccount', select: 'code name nameAr type' })
    .populate({ path: 'contributions.paymentAccount', select: 'code name nameAr' })
    .populate({ path: 'contributions.equityAccount', select: 'code name nameAr' });
  next();
});

module.exports = model('Shareholder', shareholderSchema);
