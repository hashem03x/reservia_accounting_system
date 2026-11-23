const { Schema, model } = require('mongoose');
const { expensesCategories } = require('../../utils/appConstant');
const { VAT_TREATMENTS, DEFAULT_VAT_TREATMENT } = require('../../utils/vatTreatment');
require('./expenseCategoryModel');

// An Expense is either:
//   - a vendor expense (the Expenses module - services/expenses/expenseService.js): a vendor, a
//     Chart of Accounts expense account, amount + VAT, posted Dr expense / Cr Suppliers (vendor),
//     and paid later (or at once) through the existing Payment model; or
//   - a salary expense (`expenseType: 'salary'`, no `vendor`): an employee salary accrual, posted
//     Dr expense / Cr Salaries Payable (see utils/accountingConstants.js#SalariesPayableAccountName)
//     instead of Suppliers - salaries are not vendor purchases, so no vendor/vendor account is ever
//     involved; or
//   - a liability expense (`expenseType: 'liability'`, no `vendor`): an expense owed to something
//     OTHER than a vendor or payroll - Accrued Expenses, Tax Payable, VAT Payable, Other Current/
//     Long-Term Liabilities, etc. - posted Dr expense / Cr the chosen `liabilityAccount` (a real,
//     active, `type: 'liability'` Chart of Accounts account the user selects; never Suppliers or
//     Salaries Payable, which stay tied to their own expense types). Paying it down later still
//     goes through the existing Payment flow (addExpensePayment), crediting the SAME account - a
//     liability settlement (Dr liability / Cr cash), never a second expense recognition; or
//   - a legacy expense (no `vendor`): a category paid in cash immediately via `paymentId` - still
//     created by paymentModel.js's finance-charges flow and kept for existing documents/reports.
// A salary or liability expense also has no `vendor` (same as a legacy expense) - `expenseType` is
// what tells them apart, so neither is ever mistaken for a legacy one and wrongly forced to carry
// legacy-only fields (`expenseCategory`, `paymentId`) it was never given.
const isLegacy = function () {
  return !this.vendor && !['salary', 'liability'].includes(this.expenseType);
};

// One payment made against a vendor expense.
const expensePaymentSchema = new Schema(
  {
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    amount: { type: Number, required: true, min: 0.01 },
    paymentAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: true },
    date: { type: Date, required: true },
    journalEntry: { type: Schema.Types.ObjectId, ref: 'JournalEntry', required: true },
    // Set when the payment's journal entry is reversed - it no longer counts as paid.
    reversedByEntry: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const expenseSchema = new Schema(
  {
    description: { type: String, required: isLegacy, trim: true },
    expenseCategory: { type: String, enum: [...expensesCategories, null], required: isLegacy },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: isLegacy }, // Payment associated with a legacy expense

    // 'vendor' (default - every expense created before this field existed is one): requires
    // `vendor`, posts Dr expense / Cr Suppliers (the vendor's control account).
    // 'salary': no vendor - posts Dr expense / Cr Salaries Payable instead (see
    // services/expenses/expenseService.js and utils/accountingConstants.js#SalariesPayableAccountName).
    // 'liability': no vendor - posts Dr expense / Cr `liabilityAccount` (the user's own choice of
    // real liability account) instead of Suppliers/Salaries Payable.
    expenseType: { type: String, enum: ['vendor', 'salary', 'liability'], default: 'vendor' },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    expenseAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount' },
    // Only set (and only meaningful) when expenseType === 'liability' - see this schema's own
    // header comment. Fixed once posted, same as expenseAccount/vendor.
    liabilityAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null },
    // Analysis grouping (Expense Categories - models/expense/expenseCategoryModel.js). Optional:
    // expenses created before categories existed have none. Separate from the legacy
    // `expenseCategory` string above, which only legacy cash expenses use.
    category: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', default: null },
    amount: { type: Number, min: 0 }, // before VAT
    vatPercentage: { type: Number, default: 0, min: 0 },
    vatAmount: { type: Number, default: 0, min: 0 },
    // VAT Accounting Treatment (utils/vatTreatment.js): 'recoverable' (default - today's only
    // existing behavior) posts this expense's VAT to its own Input VAT ledger line, unchanged.
    // 'non_recoverable' instead folds VAT into the expense account debit - no separate VAT line
    // (see services/expenses/expenseService.js#createExpense). Fixed once posted, exactly like
    // every other amount/account field on this model (updateExpense only ever touches
    // reference/notes/category).
    vatTreatment: { type: String, enum: VAT_TREATMENTS, default: DEFAULT_VAT_TREATMENT },
    totalAmount: { type: Number, min: 0 }, // amount + VAT - owed to the vendor
    paidAmount: { type: Number, default: 0, min: 0 },
    paymentStatus: { type: String, enum: ['unpaid', 'partially_paid', 'paid', null], default: null },
    date: { type: Date },
    reference: { type: String, trim: true },
    notes: { type: String, trim: true },
    journalEntry: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    payments: { type: [expensePaymentSchema], default: undefined },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' }, // User who created the expense
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Index for better query performance
expenseSchema.index({ expenseCategory: 1 });
expenseSchema.index({ paymentId: 1 });
expenseSchema.index({ vendor: 1 });
expenseSchema.index({ category: 1, date: 1 });

expenseSchema.virtual('remainingAmount').get(function () {
  if (typeof this.totalAmount !== 'number') return undefined;
  return Math.round((this.totalAmount - (this.paidAmount || 0) + Number.EPSILON) * 100) / 100;
});

// Virtual to rename paymentId to payment in the response
expenseSchema.virtual('payment').get(function () {
  return this.paymentId;
});

// Hide paymentId in the response
expenseSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    ret.payment = ret.paymentId;
    delete ret.paymentId;
    return ret;
  },
});

// Populate references on find operations
expenseSchema.pre(/^find/, function () {
  this.populate({
    path: 'paymentId',
  })
    .populate({
      path: 'createdBy',
      select: 'name',
    })
    .populate({ path: 'vendor', select: 'name vendorNumber' })
    .populate({ path: 'expenseAccount', select: 'code name nameAr type' })
    .populate({ path: 'liabilityAccount', select: 'code name nameAr type' })
    .populate({ path: 'category', select: 'name nameAr isActive' })
    .populate({ path: 'payments.paymentAccount', select: 'code name nameAr' });
});

module.exports = model('Expense', expenseSchema);
