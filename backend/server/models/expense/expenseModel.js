const { Schema, model } = require('mongoose');
const { expensesCategories } = require('../../utils/appConstant');
require('./expenseCategoryModel');

// An Expense is either:
//   - a vendor expense (the Expenses module - services/expenses/expenseService.js): a vendor, a
//     Chart of Accounts expense account, amount + VAT, posted Dr expense / Cr Suppliers (vendor),
//     and paid later (or at once) through the existing Payment model; or
//   - a legacy expense (no `vendor`): a category paid in cash immediately via `paymentId` - still
//     created by paymentModel.js's finance-charges flow and kept for existing documents/reports.
const isLegacy = function () {
  return !this.vendor;
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

    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    expenseAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount' },
    // Analysis grouping (Expense Categories - models/expense/expenseCategoryModel.js). Optional:
    // expenses created before categories existed have none. Separate from the legacy
    // `expenseCategory` string above, which only legacy cash expenses use.
    category: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', default: null },
    amount: { type: Number, min: 0 }, // before VAT
    vatPercentage: { type: Number, default: 0, min: 0 },
    vatAmount: { type: Number, default: 0, min: 0 },
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
    .populate({ path: 'category', select: 'name nameAr isActive' })
    .populate({ path: 'payments.paymentAccount', select: 'code name nameAr' });
});

module.exports = model('Expense', expenseSchema);
