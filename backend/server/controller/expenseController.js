const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const Expense = require('../models/expense/expenseModel');
const factory = require('./handlersFactory');
const ApiError = require('../utils/apiError');
const apiResponse = require('../utils/apiResponse');
const { createExpense, addExpensePayment, updateExpense, getExpenseAccountOptions } = require('../services/expenses/expenseService');

// Runs `work(session)` in one MongoDB transaction - the expense/payment records and their journal
// entries commit together or not at all.
async function inTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}

exports.createExpense = asyncHandler(async (req, res) => {
  const expense = await inTransaction(session => createExpense(req.body, req.user._id, session));
  res.status(201).json(apiResponse('Expense created successfully', true, await Expense.findById(expense._id)));
});

exports.addExpensePayment = asyncHandler(async (req, res) => {
  await inTransaction(session => addExpensePayment(req.params.id, req.body, req.user._id, session));
  res.status(201).json(apiResponse('Payment added successfully', true, await Expense.findById(req.params.id)));
});

exports.updateExpense = asyncHandler(async (req, res) => {
  const expense = await inTransaction(session => updateExpense(req.params.id, req.body, session));
  res.status(200).json(apiResponse('Expense updated successfully', true, await Expense.findById(expense._id)));
});

exports.getExpenseAccountOptions = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Expense accounts retrieved successfully', true, await getExpenseAccountOptions()));
});

// Get all expenses
exports.getExpenses = factory.getAll(Expense);

// Get single expense
exports.getExpenseById = asyncHandler(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return next(new ApiError('Invalid expense id', 400));
  const expense = await Expense.findById(req.params.id).populate({ path: 'journalEntry payments.journalEntry', select: 'entryNumber' });
  if (!expense) return next(new ApiError('Expense not found', 404));
  res.status(200).json({ data: expense });
});
