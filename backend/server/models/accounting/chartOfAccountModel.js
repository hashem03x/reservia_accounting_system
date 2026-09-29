const { Schema, model } = require('mongoose');
const { AccountTypes } = require('../../utils/accountingConstants');

// Chart of Accounts - the accounting classification hierarchy that Journal Entry lines post
// against. Nothing equivalent exists in the codebase today (see reversia-roadmap.md's Phase-2
// accounting-foundation notes): `Vendor.type: 'current'|'equity'` was being reused as a
// stand-in category by the balance-sheet/income-statement report controllers, but that's a
// two-value enum on an unrelated model, not a real account registry - this model replaces that
// role going forward without touching Vendor itself.
const chartOfAccountSchema = new Schema(
  {
    code: {
      type: String,
      required: [true, 'Account code is required'],
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'Account name is required'],
      trim: true,
    },
    type: {
      type: String,
      enum: { values: AccountTypes, message: '{VALUE} is not a valid account type' },
      required: [true, 'Account type is required'],
    },
    // Self-referencing parent enables both "hierarchical account groups" (e.g. 1000 Assets ->
    // 1100 Current Assets -> 1110 Cash) and the "Sub Account under a General Account" relationship
    // the Journal Entry lines need - a journal line's subAccount is just another ChartOfAccount
    // document whose parentAccount points at the line's main account. No separate SubAccount
    // model, so the hierarchy is extensible to any depth rather than hardcoding two levels.
    parentAccount: {
      type: Schema.Types.ObjectId,
      ref: 'ChartOfAccount',
      default: null,
    },
    description: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Marks accounts created by scripts/seedChartOfAccounts.js (or looked up by
    // utils/accountingConstants.js's DefaultAccountCodes) that automatic journal entries depend
    // on - surfaced in the UI so an admin doesn't casually deactivate/delete an account the
    // automatic project/fixed-asset accounting relies on.
    isSystemDefault: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

chartOfAccountSchema.index({ type: 1 });
chartOfAccountSchema.index({ parentAccount: 1 });

chartOfAccountSchema.pre('validate', function (next) {
  if (this.parentAccount && this.parentAccount.equals?.(this._id)) {
    return next(new Error('An account cannot be its own parent.'));
  }
  next();
});

chartOfAccountSchema.pre(/^find/, function (next) {
  this.populate({ path: 'parentAccount', select: 'code name type' });
  next();
});

module.exports = model('ChartOfAccount', chartOfAccountSchema);
