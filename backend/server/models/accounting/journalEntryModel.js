const { Schema, model } = require('mongoose');
const { JournalEntryStatus, JournalEntrySources } = require('../../utils/accountingConstants');

// Explicit requires (not just string `ref:` names) for every model this schema's pre(/^find/)
// hook populates - mirrors paymentModel.js's existing convention of requiring its ref'd models at
// the top. Without this, any code path that touches JournalEntry without having separately
// required ChartOfAccount/Project/User first would hit Mongoose's "Schema hasn't been registered
// for model" error the moment a query tried to populate one of those paths.
require('./chartOfAccountModel');
require('../project/projectModel');
require('../userModel');

// A single debit-or-credit line. Embedded (not a separate collection) - matches this codebase's
// existing convention for line items (PurchaseOrder.items, SalesOrder.items) rather than
// introducing the only normalized line-item collection in the app.
const journalLineSchema = new Schema(
  {
    // "GA" (General Account) in the business terminology this spec was written against maps
    // directly onto a Chart of Accounts entry - see docs/entities/accounting.md.
    account: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: [true, 'Account (GA) is required for every journal line'] },
    // Optional child of `account` (e.g. account 1100 Accounts Receivable -> sub-account "Project
    // #123 receivable"). Not a separate SubAccount model - see chartOfAccountModel.js.
    subAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null },
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    // Denormalized so the Journal Entries UI table can render "Project Number" per line without a
    // populate - the project reference above remains the source of truth/relational key.
    projectNumber: { type: String, trim: true, default: null },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    description: { type: String, trim: true },
    // Populated only for lines that represent unearned/deferred revenue (e.g. the Cr line of the
    // automatic project-creation entry) - see projectAccountingService.js.
    unearnedRevenue: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

journalLineSchema.pre('validate', function (next) {
  const hasDebit = this.debit > 0;
  const hasCredit = this.credit > 0;
  if (hasDebit === hasCredit) {
    return next(new Error('Each journal line must have either a debit or a credit amount, not both and not neither.'));
  }
  next();
});

const journalEntrySchema = new Schema(
  {
    entryNumber: {
      type: Number,
      required: true,
      unique: true,
      immutable: true,
    },
    date: { type: Date, required: true, default: Date.now },
    description: { type: String, trim: true },
    source: {
      type: String,
      enum: { values: JournalEntrySources, message: '{VALUE} is not a valid journal entry source' },
      default: 'manual',
    },
    // Together with sourceId, this is the idempotency key for system-generated entries (e.g.
    // PROJECT_CREATION + a project's _id) - see the partial unique index below. Free-text/manual
    // entries never set these.
    sourceType: { type: String, trim: true, default: null },
    sourceId: { type: Schema.Types.ObjectId, default: null },
    reference: { type: String, trim: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    status: {
      type: String,
      enum: { values: JournalEntryStatus, message: '{VALUE} is not a valid journal entry status' },
      default: 'draft',
    },
    lines: {
      type: [journalLineSchema],
      default: [],
    },
    totalDebit: { type: Number, default: 0, min: 0 },
    totalCredit: { type: Number, default: 0, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    postedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    postedAt: { type: Date, default: null },
    reversedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reversedAt: { type: Date, default: null },
    // Set on the reversal entry, pointing back at the entry it reverses.
    reversalOfEntry: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    // Set on the original entry once a reversal has been posted against it, so the UI can
    // navigate either direction without a query.
    reversedByEntry: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
  },
  { timestamps: true }
);

journalEntrySchema.index({ date: 1 });
journalEntrySchema.index({ project: 1 });
journalEntrySchema.index({ status: 1 });
journalEntrySchema.index({ source: 1 });
// Idempotency: at most one journal entry per (sourceType, sourceId) pair - e.g. only one
// PROJECT_CREATION entry can ever exist for a given project, even under a duplicate/retried
// request. Partial so manual entries (sourceId: null) never collide with each other.
journalEntrySchema.index({ sourceType: 1, sourceId: 1 }, { unique: true, partialFilterExpression: { sourceId: { $type: 'objectId' } } });

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

journalEntrySchema.methods.isBalanced = function () {
  return round2(this.totalDebit) === round2(this.totalCredit);
};

journalEntrySchema.pre('save', async function (next) {
  try {
    // Defense-in-depth: a posted entry's lines must never change in place. The controller is the
    // primary gate (a PATCH is rejected once status !== 'draft'), this catches any other code
    // path that might call .save() directly.
    if (!this.isNew && this.isModified('lines')) {
      // Raw collection access (not this.constructor.findById) - bypasses the pre(/^find/) hook's
      // populate() calls entirely, which is both unnecessary overhead for a single status check
      // and avoids a hard dependency on every populated model (e.g. Project) being registered on
      // this connection at the time this hook runs.
      const original = await this.constructor.collection.findOne({ _id: this._id }, { projection: { status: 1 } });
      if (original && original.status === 'posted') {
        throw new Error('Posted journal entries cannot have their lines modified. Post a reversal entry instead.');
      }
    }

    this.totalDebit = round2(this.lines.reduce((sum, line) => sum + (line.debit || 0), 0));
    this.totalCredit = round2(this.lines.reduce((sum, line) => sum + (line.credit || 0), 0));

    if (this.status === 'posted') {
      if (this.lines.length < 2) {
        throw new Error('A journal entry must have at least two lines to be posted.');
      }
      if (!this.isBalanced()) {
        throw new Error('Journal entry cannot be posted because total debit does not equal total credit.');
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

journalEntrySchema.pre(/^find/, function (next) {
  this.populate({ path: 'lines.account', select: 'code name type' })
    .populate({ path: 'lines.subAccount', select: 'code name type' })
    .populate({ path: 'project', select: 'projectNumber name' })
    .populate({ path: 'createdBy', select: 'name' })
    .populate({ path: 'postedBy', select: 'name' });
  next();
});

module.exports = model('JournalEntry', journalEntrySchema);
