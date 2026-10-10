const asyncHandler = require('express-async-handler');
const apiResponse = require('../utils/apiResponse');
const { listCategories, createCategory, updateCategory, deleteCategory } = require('../services/expenses/expenseCategoryService');

// GET /expense-categories?active=true - with how many expenses use each category.
exports.getExpenseCategories = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Expense categories retrieved successfully', true, await listCategories({ activeOnly: req.query.active === 'true' })));
});

exports.createExpenseCategory = asyncHandler(async (req, res) => {
  res.status(201).json(apiResponse('Expense category created successfully', true, await createCategory(req.body, req.user._id)));
});

exports.updateExpenseCategory = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Expense category updated successfully', true, await updateCategory(req.params.id, req.body, req.user._id)));
});

exports.deleteExpenseCategory = asyncHandler(async (req, res) => {
  await deleteCategory(req.params.id);
  res.status(204).send();
});
