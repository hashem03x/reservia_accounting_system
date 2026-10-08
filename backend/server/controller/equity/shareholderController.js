const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const Shareholder = require('../../models/equity/shareholderModel');
const factory = require('../handlersFactory');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { createShareholder, updateShareholder, addContribution, getEquityAccountOptions } = require('../../services/equity/shareholderService');

// Runs `work(session)` in one MongoDB transaction - the shareholder/contribution records and their
// journal entries commit together or not at all.
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

const getShareholders = factory.getAll(Shareholder, 'Shareholder');

const getShareholder = asyncHandler(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return next(new ApiError('Invalid shareholder id', 400));
  const shareholder = await Shareholder.findById(req.params.id).populate({ path: 'contributions.journalEntry', select: 'entryNumber' });
  if (!shareholder) return next(new ApiError('Shareholder not found', 404));
  res.status(200).json(apiResponse('Shareholder retrieved successfully', true, shareholder));
});

const createShareholderHandler = asyncHandler(async (req, res) => {
  const shareholder = await inTransaction(session => createShareholder(req.body, req.user._id, session));
  res.status(201).json(apiResponse('Shareholder created successfully', true, await Shareholder.findById(shareholder._id)));
});

const updateShareholderHandler = asyncHandler(async (req, res) => {
  const shareholder = await inTransaction(session => updateShareholder(req.params.id, req.body, session));
  res.status(200).json(apiResponse('Shareholder updated successfully', true, await Shareholder.findById(shareholder._id)));
});

const addContributionHandler = asyncHandler(async (req, res) => {
  await inTransaction(session => addContribution(req.params.id, req.body, req.user._id, session));
  res.status(201).json(apiResponse('Contribution recorded successfully', true, await Shareholder.findById(req.params.id)));
});

const getEquityAccountOptionsHandler = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Equity accounts retrieved successfully', true, await getEquityAccountOptions()));
});

module.exports = {
  getShareholders,
  getShareholder,
  createShareholder: createShareholderHandler,
  updateShareholder: updateShareholderHandler,
  addContribution: addContributionHandler,
  getEquityAccountOptions: getEquityAccountOptionsHandler,
};
