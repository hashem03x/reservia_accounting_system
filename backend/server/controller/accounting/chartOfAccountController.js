const asyncHandler = require('express-async-handler');
const factory = require('../handlersFactory');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const Project = require('../../models/project/projectModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { getAccountBalance, getTrialBalance } = require('../../services/accounting/generalLedgerService');
const { getNextSortOrder } = require('../../services/accounting/chartOfAccountOrderingService');

const createAccount = asyncHandler(async (req, res, next) => {
  try {
    // sortOrder is always server-computed (bottom of the account's type/parent group) - never
    // accepted from the client, see chartOfAccountOrderingService.js.
    const { sortOrder, ...body } = req.body;
    const nextSortOrder = await getNextSortOrder({ type: body.type, parentAccount: body.parentAccount || null });
    const account = await ChartOfAccount.create({ ...body, sortOrder: nextSortOrder, createdBy: req.user._id });
    // Model.create() is not a find-family operation, so the schema's pre(/^find/) hook (which
    // populates `parentAccount`) never runs for it - without this, the response here would carry
    // a raw ObjectId string instead of {_id, code, name, type}, and the frontend table would render
    // "undefined - undefined" for any account created with a parent selected. The underlying
    // reference itself was always saved correctly; only this response was ever unpopulated.
    await account.populate({ path: 'parentAccount', select: 'code name nameAr type' });
    res.status(201).json(apiResponse('Account created successfully', true, account));
  } catch (err) {
    // Belt-and-suspenders: the validator already checks for a duplicate code, but a race between
    // two concurrent requests can still hit the unique index - translate that into the same clean
    // message instead of a raw MongoServerError leaking to the client.
    if (err.code === 11000) return next(new ApiError('An account with this code already exists.', 400));
    throw err;
  }
});

const getAccounts = factory.getAll(ChartOfAccount, 'ChartOfAccount');

// Not factory.getOne() - also reports whether this account is referenced by any Project's Average
// Cost lines (see projectModel.js#averageCostLines), so the UI can warn before an admin deactivates
// an account a project is actively using for cost tracking (see docs section "Project / Account
// relationship").
const getAccount = asyncHandler(async (req, res, next) => {
  const account = await ChartOfAccount.findById(req.params.id);
  if (!account) return next(new ApiError('No account found with that id', 404));

  const usedInProjectsCount = await Project.countDocuments({ 'averageCostLines.account': account._id });

  res.status(200).json(apiResponse('Account retrieved successfully', true, { ...account.toObject(), usedInProjectsCount }));
});

// Accounts selectable for a Project's Average Cost lines - restricted to the `cogs` account type
// (a structural classification carried over directly from the CSV source's own "Costs" vs
// "Expenses" distinction, see accountingConstants.js#AccountTypes), never a name/label match
// against "COGS" - see docs section "COGS account eligibility". The frontend's Average Cost editor
// calls this instead of implementing its own eligibility logic, so frontend and backend can never
// disagree about which accounts qualify.
const getCogsEligibleAccounts = asyncHandler(async (req, res) => {
  const accounts = await ChartOfAccount.find({ type: 'cogs', isActive: true }).sort({ sortOrder: 1, code: 1 });
  res.status(200).json(apiResponse('Eligible average-cost accounts retrieved successfully', true, accounts));
});

const updateAccount = asyncHandler(async (req, res, next) => {
  try {
    // sortOrder is never editable through this endpoint - see chartOfAccountOrderingService.js.
    const { sortOrder, ...body } = req.body;
    const account = await ChartOfAccount.findByIdAndUpdate(req.params.id, { $set: body }, { new: true, runValidators: true });
    if (!account) return next(new ApiError('No account found with that id', 404));
    res.status(200).json(apiResponse('Account updated successfully', true, account));
  } catch (err) {
    if (err.code === 11000) return next(new ApiError('An account with this code already exists.', 400));
    throw err;
  }
});

// Chart of Accounts entries are referenced by Journal Entry lines and must never disappear from
// under posted accounting history - "delete" deactivates the account (isActive: false) instead of
// removing the document, mirroring this codebase's existing soft-delete convention for
// financially-relevant records (Customer/Vendor/Product all use a boolean flag rather than a real
// deleteOne - see reversia-roadmap.md's architectural principles).
const deactivateAccount = asyncHandler(async (req, res, next) => {
  const account = await ChartOfAccount.findById(req.params.id);
  if (!account) return next(new ApiError('No account found with that id', 404));

  if (account.isSystemDefault) {
    return next(new ApiError('This account is used by automatic accounting entries and cannot be deactivated.', 400));
  }

  account.isActive = false;
  await account.save();
  res.status(200).json(apiResponse('Account deactivated successfully', true, account));
});

const getAccountBalanceHandler = asyncHandler(async (req, res, next) => {
  const balance = await getAccountBalance(req.params.id);
  if (!balance) return next(new ApiError('No account found with that id', 404));
  res.status(200).json(apiResponse('Account balance retrieved successfully', true, balance));
});

const getTrialBalanceHandler = asyncHandler(async (req, res) => {
  const rows = await getTrialBalance();
  res.status(200).json(apiResponse('Trial balance retrieved successfully', true, rows));
});

module.exports = {
  createAccount,
  getAccounts,
  getAccount,
  updateAccount,
  deactivateAccount,
  getAccountBalanceHandler,
  getTrialBalanceHandler,
  getCogsEligibleAccounts,
};
