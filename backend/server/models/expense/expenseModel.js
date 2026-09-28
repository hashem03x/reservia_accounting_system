const { Schema, model } = require('mongoose');
const { expensesCategories } = require('../../utils/appConstant');

const expenseSchema = new Schema({
    description: { type: String, required: true },
    expenseCategory: { type: String, enum: expensesCategories, required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },  // Payment associated with the expense
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },  // User who created the expense
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Index for better query performance
expenseSchema.index({ expenseCategory: 1 });
expenseSchema.index({ paymentId: 1 });

// Virtual to rename paymentId to payment in the response
expenseSchema.virtual('payment').get(function () {
    return this.paymentId;
});

// Hide paymentId in the response
expenseSchema.set('toJSON', {
    transform: function (doc, ret) {
        ret.payment = ret.paymentId;
        delete ret.paymentId;
        return ret;
    }
});

// Populate references on find operations
expenseSchema.pre(/^find/, function () {
    this.populate({
        path: 'paymentId',
    }).populate({
        path: 'createdBy',
        select: 'name'
    });
});

module.exports = model('Expense', expenseSchema);