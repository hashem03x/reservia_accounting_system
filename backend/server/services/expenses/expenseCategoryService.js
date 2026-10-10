const mongoose = require('mongoose');
const ExpenseCategory = require('../../models/expense/expenseCategoryModel');
const Expense = require('../../models/expense/expenseModel');
const ApiError = require('../../utils/apiError');

// Expense Categories: create / edit / activate-deactivate, and delete only while no expense uses the
// category (otherwise it is deactivated instead, so historical expenses keep their category).

const pick = body => {
  const out = {};
  ['name', 'nameAr', 'description', 'isActive'].forEach(k => {
    if (body[k] !== undefined) out[k] = body[k];
  });
  return out;
};

const duplicate = err => err?.code === 11000;

async function listCategories({ activeOnly = false } = {}) {
  const categories = await ExpenseCategory.find(activeOnly ? { isActive: true } : {}).sort({ name: 1 }).lean();
  const usage = await Expense.aggregate([{ $match: { category: { $in: categories.map(c => c._id) } } }, { $group: { _id: '$category', count: { $sum: 1 } } }]);
  const countBy = new Map(usage.map(u => [String(u._id), u.count]));
  return categories.map(c => ({ ...c, expenseCount: countBy.get(String(c._id)) || 0 }));
}

async function createCategory(body, userId) {
  try {
    return await ExpenseCategory.create({ ...pick(body), createdBy: userId });
  } catch (err) {
    if (duplicate(err)) throw new ApiError('An expense category with this name already exists.', 400);
    throw err;
  }
}

async function updateCategory(id, body, userId) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError('Invalid expense category id', 400);
  try {
    const category = await ExpenseCategory.findByIdAndUpdate(id, { $set: { ...pick(body), updatedBy: userId } }, { new: true, runValidators: true });
    if (!category) throw new ApiError('Expense category not found', 404);
    return category;
  } catch (err) {
    if (duplicate(err)) throw new ApiError('An expense category with this name already exists.', 400);
    throw err;
  }
}

async function deleteCategory(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError('Invalid expense category id', 400);
  const used = await Expense.countDocuments({ category: id });
  if (used > 0) throw new ApiError(`This category is used by ${used} expense(s) and cannot be deleted. Deactivate it instead.`, 409);
  const deleted = await ExpenseCategory.findByIdAndDelete(id);
  if (!deleted) throw new ApiError('Expense category not found', 404);
}

/**
 * The category id an expense may be saved with: null (none), or an existing category - active,
 * unless the expense already had this very category (an inactive category stays on its expenses).
 */
async function resolveExpenseCategory(categoryId, { currentCategoryId = null, session } = {}) {
  if (categoryId === undefined || categoryId === null || categoryId === '') return null;
  if (!mongoose.Types.ObjectId.isValid(String(categoryId))) throw new ApiError('Invalid expense category id', 400);
  const category = await ExpenseCategory.findById(categoryId).session(session || null).lean();
  if (!category) throw new ApiError('The selected expense category does not exist.', 400);
  if (!category.isActive && String(currentCategoryId) !== String(category._id)) throw new ApiError(`The expense category "${category.name}" is inactive and cannot be used for new expenses.`, 400);
  return category._id;
}

module.exports = { listCategories, createCategory, updateCategory, deleteCategory, resolveExpenseCategory };
