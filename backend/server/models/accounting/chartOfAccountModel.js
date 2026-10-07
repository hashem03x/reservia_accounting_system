const { Schema, model } = require('mongoose');
const { AccountTypes, AccountStates, isPucAccountEligible } = require('../../utils/accountingConstants');

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
    // Optional Arabic display name - added for the CSV-based Chart of Accounts import (source data
    // carries both an Arabic and an English name per account); `name` remains the single
    // English/primary field every existing selector/report already reads.
    nameAr: {
      type: String,
      trim: true,
      default: null,
    },
    // Verbatim copy of the CSV import's "Parent" column (EN/AR) - a descriptive group label from
    // the source data, NOT a reference to another ChartOfAccount document. The source never
    // provides a coded parent account, only this text label, so representing it as a real
    // `parentAccount` link would mean fabricating an account code that doesn't exist in the data.
    // `parentAccount` below remains the real hierarchy link for accounts that do have one (e.g.
    // manually created sub-accounts).
    parentGroupNameEn: {
      type: String,
      trim: true,
      default: null,
    },
    parentGroupNameAr: {
      type: String,
      trim: true,
      default: null,
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
    // Secondary classification on top of `type` (Current/Non-Current for an asset, Operating/
    // Non-Operating or Direct/Indirect for an expense, etc.) - see accountingConstants.js#AccountStates.
    // Never auto-assigned to imported CSV accounts (the source has no such column); only ever set
    // when a user explicitly assigns one via create/edit.
    state: {
      type: String,
      enum: { values: [...AccountStates, null], message: '{VALUE} is not a valid account state' },
      default: null,
    },
    // Display/insertion order within the account's type group - see
    // services/accounting/chartOfAccountOrderingService.js. Always server-computed (createAccount
    // ignores any client-supplied value); never reordered by the CSV import, which assigns these
    // sequentially in source-file row order so the imported hierarchy's original ordering is
    // preserved exactly.
    sortOrder: {
      type: Number,
      default: 0,
    },
    // COGS accounts only: the Projects-Under-Construction (WIP) asset account this cost category's
    // project costs accumulate in. PROJECT_COST_RECOGNITION (triggered by Sales Orders, see
    // accountingEventService.js#postProjectCostRecognitionJE) posts Dr this COGS / Cr this WIP
    // account. A real ChartOfAccount reference chosen by an admin - never a guessed code. When unset,
    // the built-in code map (accountingConstants.js#CogsToWipAccountCodeMap) is used.
    wipAccount: {
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
chartOfAccountSchema.index({ sortOrder: 1 });
chartOfAccountSchema.index({ state: 1 });

chartOfAccountSchema.pre('validate', function (next) {
  if (this.parentAccount && this.parentAccount.equals?.(this._id)) {
    return next(new Error('An account cannot be its own parent.'));
  }
  next();
});

// Backstop for `wipAccount` (the request validators are the fast pre-check): only a COGS account
// can have one, and it must be an active PUC (asset, non-cash) account.
chartOfAccountSchema.pre('validate', async function (next) {
  try {
    const wipId = this.wipAccount?._id || this.wipAccount;
    if (!wipId) return next();
    if (this.type !== 'cogs') throw new Error('Only a COGS account can have a WIP (PUC) account.');
    const wip = await this.constructor.findById(wipId).session(this.$session() || null).lean();
    if (!isPucAccountEligible(wip)) throw new Error('The WIP (PUC) account must be an active asset account that is not a cash/bank account.');
    next();
  } catch (error) {
    next(error);
  }
});

chartOfAccountSchema.pre(/^find/, function (next) {
  this.populate({ path: 'parentAccount', select: 'code name type' }).populate({ path: 'wipAccount', select: 'code name type' });
  next();
});

module.exports = model('ChartOfAccount', chartOfAccountSchema);
