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

// Get all expenses - `category` (an id, or "none") and `from`/`to` (YYYY-MM-DD, by expense date)
// are validated here and applied to both the page and its count.
const listExpenses = factory.getAll(Expense);
exports.getExpenses = (req, res, next) => {
  const filter = { ...(req.filterObject || {}) };
  const { category, from, to } = req.query;
  if (category !== undefined && category !== '') {
    if (category === 'none') filter.category = null;
    else if (mongoose.Types.ObjectId.isValid(String(category))) filter.category = new mongoose.Types.ObjectId(String(category));
    else return next(new ApiError('Invalid expense category id', 400));
  }
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !day.test(from)) || (to && !day.test(to))) return next(new ApiError('Dates must be in YYYY-MM-DD format.', 400));
  if (from || to) filter.date = { ...(from ? { $gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(to ? { $lte: new Date(`${to}T23:59:59.999Z`) } : {}) };
  ['category', 'from', 'to'].forEach(k => delete req.query[k]);
  req.filterObject = filter;
  return listExpenses(req, res, next);
};

// Get single expense
exports.getExpenseById = asyncHandler(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return next(new ApiError('Invalid expense id', 400));
  const expense = await Expense.findById(req.params.id).populate({ path: 'journalEntry payments.journalEntry', select: 'entryNumber' });
  if (!expense) return next(new ApiError('Expense not found', 404));
  res.status(200).json({ data: expense });
});
