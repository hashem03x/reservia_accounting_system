const asyncHandler = require('express-async-handler');
const factory = require('../handlersFactory');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { getAccountBalance, getTrialBalance } = require('../../services/accounting/generalLedgerService');

const createAccount = asyncHandler(async (req, res, next) => {
  try {
    const account = await ChartOfAccount.create({ ...req.body, createdBy: req.user._id });
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

const getAccount = factory.getOne(ChartOfAccount);

const updateAccount = asyncHandler(async (req, res, next) => {
  try {
    const account = await ChartOfAccount.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
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
};
