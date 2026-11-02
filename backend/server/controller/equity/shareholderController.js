const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const Shareholder = require('../../models/equity/shareholderModel');
const factory = require('../handlersFactory');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { createShareholder, updateShareholder, addContribution, getEquityAccountOptions, allocatedCapital, setupCapitalStructure } = require('../../services/equity/shareholderService');
const { getCompanyCapital, setIssuedCapital } = require('../../services/equity/companyCapitalService');
const { round2 } = require('../../utils/orderTotals');

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

// Adds the derived, always-read-only capital figures (brief: "automatically calculated ... must
// be READ-ONLY") to a shareholder document for the API response - never stored, always computed
// from the current Issued Capital, so they can never silently drift out of sync with it.
function withCapitalFigures(shareholder, issuedCapital) {
  const obj = typeof shareholder.toObject === 'function' ? shareholder.toObject() : shareholder;
  if (issuedCapital === null || issuedCapital === undefined) {
    return { ...obj, allocatedCapital: null, remainingUnpaid: null };
  }
  const allocated = allocatedCapital(obj, issuedCapital);
  return { ...obj, allocatedCapital: allocated, remainingUnpaid: round2(allocated - (obj.shareCapital || 0)) };
}

const getShareholders = factory.getAll(Shareholder, 'Shareholder', ' ', false, async docs => {
  const capital = await getCompanyCapital();
  return docs.map(d => withCapitalFigures(d, capital?.issuedCapital ?? null));
});

const getShareholder = asyncHandler(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return next(new ApiError('Invalid shareholder id', 400));
  const shareholder = await Shareholder.findById(req.params.id).populate({ path: 'contributions.journalEntry', select: 'entryNumber' });
  if (!shareholder) return next(new ApiError('Shareholder not found', 404));
  const capital = await getCompanyCapital();
  res.status(200).json(apiResponse('Shareholder retrieved successfully', true, withCapitalFigures(shareholder, capital?.issuedCapital ?? null)));
});

const createShareholderHandler = asyncHandler(async (req, res) => {
  const shareholder = await inTransaction(session => createShareholder(req.body, req.user._id, session));
  const capital = await getCompanyCapital();
  res.status(201).json(apiResponse('Shareholder created successfully', true, withCapitalFigures(await Shareholder.findById(shareholder._id), capital?.issuedCapital ?? null)));
});

const updateShareholderHandler = asyncHandler(async (req, res) => {
  const shareholder = await inTransaction(session => updateShareholder(req.params.id, req.body, session));
  const capital = await getCompanyCapital();
  res.status(200).json(apiResponse('Shareholder updated successfully', true, withCapitalFigures(await Shareholder.findById(shareholder._id), capital?.issuedCapital ?? null)));
});

const addContributionHandler = asyncHandler(async (req, res) => {
  await inTransaction(session => addContribution(req.params.id, req.body, req.user._id, session));
  const capital = await getCompanyCapital();
  res.status(201).json(apiResponse('Contribution recorded successfully', true, withCapitalFigures(await Shareholder.findById(req.params.id), capital?.issuedCapital ?? null)));
});

const getEquityAccountOptionsHandler = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Equity accounts retrieved successfully', true, await getEquityAccountOptions()));
});

const getCompanyCapitalHandler = asyncHandler(async (req, res) => {
  const capital = await getCompanyCapital();
  res.status(200).json(apiResponse('Company capital retrieved successfully', true, capital));
});

const setIssuedCapitalHandler = asyncHandler(async (req, res) => {
  const capital = await inTransaction(session => setIssuedCapital(req.body.issuedCapital, req.user._id, session));
  res.status(200).json(apiResponse('Issued capital saved successfully', true, capital));
});

// Scenario 1 (brief): Issued Capital + every initial shareholder created together, in one
// transaction - see services/equity/shareholderService.js#setupCapitalStructure's own comment on
// why this is a dedicated endpoint rather than a client-side loop of separate requests.
const setupCapitalStructureHandler = asyncHandler(async (req, res) => {
  await inTransaction(session => setupCapitalStructure(req.body, req.user._id, session));
  const capital = await getCompanyCapital();
  const shareholders = await Shareholder.find({}).sort({ shareholderNumber: 1 });
  res.status(201).json(apiResponse('Capital structure created successfully', true, { capital, shareholders: shareholders.map(s => withCapitalFigures(s, capital?.issuedCapital ?? null)) }));
});

module.exports = {
  getShareholders,
  getShareholder,
  createShareholder: createShareholderHandler,
  updateShareholder: updateShareholderHandler,
  addContribution: addContributionHandler,
  getEquityAccountOptions: getEquityAccountOptionsHandler,
  getCompanyCapital: getCompanyCapitalHandler,
  setIssuedCapital: setIssuedCapitalHandler,
  setupCapitalStructure: setupCapitalStructureHandler,
};
