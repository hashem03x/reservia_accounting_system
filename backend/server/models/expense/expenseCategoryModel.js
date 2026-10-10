const { Schema, model } = require('mongoose');

// An Expense Category - an analysis grouping for vendor expenses (Expense.category), managed by
// administrators (services/expenses/expenseCategoryService.js). It never changes how an expense is
// posted: the expense account, VAT and payments are unaffected. An inactive category stays on the
// expenses that already use it but cannot be chosen for a new one; a category in use is never
// deleted.
const expenseCategorySchema = new Schema(
  {
    name: { type: String, required: [true, 'Category name is required'], trim: true, maxlength: 100 },
    nameAr: { type: String, trim: true, maxlength: 100, default: null },
    description: { type: String, trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Case-insensitive unique name.
expenseCategorySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = model('ExpenseCategory', expenseCategorySchema);
