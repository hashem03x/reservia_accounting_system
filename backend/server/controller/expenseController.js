const Expense = require('../models/expense/expenseModel');
const Payment = require('../models/vendor/paymentModel');
const asyncHandler = require('express-async-handler');
const factory = require('./handlersFactory');
const apiError = require('../utils/apiError');
const apiResponse = require('../utils/apiResponse');

// Here is the point
exports.createExpense = asyncHandler(async (req, res, next) => {
  const session = await Expense.startSession();
  session.startTransaction();

  const { warehouseId, amountPaid, paymentMethod, description, expenseCategory } = req.body;

  try {
    // Create payment first
    const [payment] = await Payment.create([{
      warehouseId,
      type: 'out',
      amountPaid,
      paymentMethod,
      paymentCategory: 'expense',
      notes: description,
      createdBy: req.user._id
    }], { session });

    // Create expense with payment reference
    const [expense] = await Expense.create([{
      description,
      expenseCategory,
      paymentId: payment._id,
      createdBy: req.user._id
    }], { session });

    await session.commitTransaction();
    session.endSession();

    // Fetch the expense with populated data
    const populatedExpense = await Expense.findById(expense._id);

    res.status(201).json({
      status: 'success',
      message: 'Expense created and payment made successfully',
      data: populatedExpense
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
});

// Get all expenses
exports.getExpenses = factory.getAll(Expense);

// Get single expense
exports.getExpenseById = factory.getOne(Expense);
