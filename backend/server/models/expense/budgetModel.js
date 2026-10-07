const {model, Schema} = require('mongoose');

const budgetSchema = new Schema({
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },  // Reference to expense category
    department: { type: String, required: true },                  // Department the budget applies to
    allocatedAmount: { type: Number, required: true },             // Total budget allocated
    usedAmount: { type: Number, default: 0 },                      // Amount used from the budget
    period: {                                                      // Budget period (e.g., yearly, monthly)
      startDate: { type: Date, required: true },
      endDate: { type: Date, required: true }
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // User who created the budget
    isActive: { type: Boolean, default: true }                     // Whether the budget is still in effect
  });

  module.exports = model('Budget', budgetSchema);
  