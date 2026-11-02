const { Schema, model } = require('mongoose');
const { getNextShareholderNumber } = require('../../services/equity/shareholderNumberService');
const { isValidEgyptianNationalId } = require('../../utils/egyptianNationalId');
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
    // The "Add Payment" dialog generates one key per open (not per click) - a retried/double-click
    // submission carries the SAME key, which services/equity/shareholderService.js#addContribution
    // checks against this shareholder's own contributions before creating anything new, so a
    // network retry or a double-click can never post the same payment twice. Optional (legacy
    // contributions, and any created without a client-supplied key, simply aren't deduped this way).
    idempotencyKey: { type: String, trim: true, maxlength: 100, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const shareholderSchema = new Schema(
  {
    // The shareholder's English/primary name - already used as-is throughout the app (journal
    // entry descriptions, the shareholders list/detail pages) long before an Arabic name existed,
    // so it stays the one required name field rather than being renamed. `nameAr` below is
    // additive, OPTIONAL at the schema level (existing shareholders predate it) - new creations
    // are required to send it by the API validator layer (utils/validators/shareholderValidators.js),
    // which is where "required going forward, without invalidating history" belongs.
    name: { type: String, required: [true, 'Shareholder name is required'], trim: true },
    nameAr: { type: String, trim: true, maxlength: 200, default: null },
    address: { type: String, trim: true, maxlength: 500, default: null },
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
    // Optional at the schema level (legacy records), format-checked and unique whenever present -
    // see the pre('validate') hook below for both. No `default` on purpose: the sparse unique
    // index below only excludes documents where the field is genuinely ABSENT, not ones explicitly
    // set to `null` - a `default: null` would make every shareholder without a National ID
    // collide on that same stored null (see activityModel.js's whatsappMessageId for the same
    // gotcha, and userModel.js's own partialFilterExpression comment for the general pattern).
    // utils/egyptianNationalId.js's own header comment explains exactly what "valid" does and does
    // not check here.
    nationalId: { type: String, trim: true },
    notes: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shareholderSchema.index({ status: 1 });
// A real National ID identifies one person - never two shareholder rows. Sparse: many legacy rows
// (and any shareholder who simply hasn't supplied one yet) have no nationalId at all, and those
// must never collide with each other on this index.
shareholderSchema.index({ nationalId: 1 }, { unique: true, sparse: true });

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
    if (this.nationalId && this.isModified('nationalId') && !isValidEgyptianNationalId(this.nationalId)) {
      return next(new Error('National ID must be a valid 14-digit Egyptian National ID.'));
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
