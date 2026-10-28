const asyncHandler = require('express-async-handler');
<<<<<<< HEAD
const Currency = require('../../models/accounting/currencyModel');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const ApiFeatures = require('../../utils/apiFeatures');
const { inverseRate } = require('../../utils/exchangeRate');

// Currency Management (docs section "Exchange-Rate Convention"). Mirrors
// chartOfAccountController.js's CRUD/deactivate conventions exactly - same soft-deactivate-instead-
// of-delete rule, same duplicate-code translation, same shape of response.

/** Adds the derived inverse rate (1 unit of this currency = X EGP) - never stored, always computed. */
function withInverseRate(currency) {
  const plain = typeof currency.toObject === 'function' ? currency.toObject() : currency;
  return { ...plain, inverseRate: inverseRate(plain.rate) };
}

const createCurrency = asyncHandler(async (req, res, next) => {
  const { code, name, symbol, rate, isActive } = req.body;
  try {
    // isBaseCurrency is never accepted from the client on create - EGP is seeded once by
    // scripts/seedCurrencies.js, and no other currency may ever become the base currency (enforced
    // again, independently, at the model layer - see currencyModel.js).
    const currency = await Currency.create({ code, name, symbol, rate, isActive, createdBy: req.user._id });
    res.status(201).json(apiResponse('Currency created successfully', true, withInverseRate(currency)));
  } catch (err) {
    if (err.code === 11000) return next(new ApiError('A currency with this code already exists.', 400));
    throw err;
  }
});

const getCurrencies = asyncHandler(async (req, res) => {
  const countDocuments = await Currency.countDocuments(req.filterObject);
  const features = new ApiFeatures(Currency.find(req.filterObject), req.query).paginate(countDocuments).filter(req.filterObject).limitFields();
  const currencies = await features.mongooseQuery.sort({ isBaseCurrency: -1, code: 1 });
  res.status(200).json({ results: currencies.length, paginationResult: features.paginationResult, data: currencies.map(withInverseRate) });
});

const getCurrency = asyncHandler(async (req, res, next) => {
  const currency = await Currency.findById(req.params.id);
  if (!currency) return next(new ApiError('No currency found with that id', 404));
  res.status(200).json(apiResponse('Currency retrieved successfully', true, withInverseRate(currency)));
});

const updateCurrency = asyncHandler(async (req, res, next) => {
  const currency = await Currency.findById(req.params.id);
  if (!currency) return next(new ApiError('No currency found with that id', 404));

  // The base currency (EGP)'s code, base-currency status and rate are all immutable - see
  // currencyModel.js's own pre('validate') backstop for the same rule enforced independently.
  // Name/symbol/isActive may still be edited on EGP (cosmetic only).
  if (currency.isBaseCurrency) {
    const { code, rate, isBaseCurrency, ...editable } = req.body;
    if ((code && code !== currency.code) || (rate != null && rate !== 1) || isBaseCurrency === false) {
      return next(new ApiError('The base currency (EGP) cannot have its code, exchange rate or base-currency status changed.', 400));
    }
    Object.assign(currency, editable);
  } else {
    const { isBaseCurrency, ...editable } = req.body;
    if (isBaseCurrency === true) return next(new ApiError('Only EGP may be the base currency.', 400));
    Object.assign(currency, editable);
  }

  try {
    await currency.save();
  } catch (err) {
    if (err.code === 11000) return next(new ApiError('A currency with this code already exists.', 400));
    throw err;
  }
  res.status(200).json(apiResponse('Currency updated successfully', true, withInverseRate(currency)));
});

// Currencies are referenced by Journal Entry lines and must never disappear from under posted
// accounting history - "delete" deactivates instead, mirroring chartOfAccountController.js's
// deactivateAccount exactly. The base currency (EGP) can never be deactivated - every Journal
// Entry defaults to it, and deactivating it would make the default itself unusable.
const deactivateCurrency = asyncHandler(async (req, res, next) => {
  const currency = await Currency.findById(req.params.id);
  if (!currency) return next(new ApiError('No currency found with that id', 404));
  if (currency.isBaseCurrency) return next(new ApiError('The base currency (EGP) cannot be deactivated.', 400));

  currency.isActive = false;
  await currency.save();
  res.status(200).json(apiResponse('Currency deactivated successfully', true, withInverseRate(currency)));
});

const activateCurrency = asyncHandler(async (req, res, next) => {
  const currency = await Currency.findById(req.params.id);
  if (!currency) return next(new ApiError('No currency found with that id', 404));
  currency.isActive = true;
  await currency.save();
  res.status(200).json(apiResponse('Currency activated successfully', true, withInverseRate(currency)));
});

// Whether this currency is referenced by any existing Journal Entry line - surfaced so the UI can
// warn before deactivating one that's still in historical use (deactivating is still always safe -
// see the model's own "inactive currencies remain readable" guarantee - this is informational only,
// never a block).
const getCurrencyUsage = asyncHandler(async (req, res, next) => {
  const currency = await Currency.findById(req.params.id);
  if (!currency) return next(new ApiError('No currency found with that id', 404));
  const usedInJournalEntriesCount = await JournalEntry.countDocuments({ 'lines.currency': currency.code });
  res.status(200).json(apiResponse('Currency usage retrieved successfully', true, { usedInJournalEntriesCount }));
});

module.exports = { createCurrency, getCurrencies, getCurrency, updateCurrency, deactivateCurrency, activateCurrency, getCurrencyUsage };
=======
const apiResponse = require('../../utils/apiResponse');
const currencyService = require('../../services/accounting/currencyService');

// Currency Manager (Accounting -> Currencies). All rules live in services/accounting/currencyService.js.
// Rate convention: 1 EGP = unitsPerBase units of the currency (utils/currencyMath.js).

// GET /currencies?keyword=&status=active|inactive|all&sort=code|-name|...&page=&limit=
exports.getCurrencies = asyncHandler(async (req, res) => {
  const { keyword, status, sort, page, limit } = req.query;
  res.status(200).json(await currencyService.listCurrencies({ keyword, status, sort, page, limit }));
});

// GET /currencies/:id - :id may be the Mongo id or the currency code.
exports.getCurrency = asyncHandler(async (req, res) => {
  res.status(200).json({ data: await currencyService.getCurrency(req.params.id) });
});

// GET /currencies/:id/rate?date=YYYY-MM-DD - the rate a transaction on that date gets by default.
exports.getCurrencyRate = asyncHandler(async (req, res) => {
  res.status(200).json({ data: await currencyService.getRateForDate(req.params.id, req.query.date ? new Date(req.query.date) : new Date()) });
});

const pickInput = body => ({
  code: body.code,
  name: body.name,
  nameAr: body.nameAr,
  symbol: body.symbol,
  unitsPerBase: body.unitsPerBase,
  rateEffectiveDate: body.rateEffectiveDate,
  isActive: body.isActive,
  expectedVersion: body.expectedVersion,
});

exports.createCurrency = asyncHandler(async (req, res) => {
  const currency = await currencyService.createCurrency(pickInput(req.body), req.user?._id);
  res.status(201).json(apiResponse('Currency created successfully', true, currency));
});

exports.updateCurrency = asyncHandler(async (req, res) => {
  const { code, ...input } = pickInput(req.body);
  const currency = await currencyService.updateCurrency(req.params.id, input, req.user?._id);
  res.status(200).json(apiResponse('Currency updated successfully', true, currency));
});

exports.deleteCurrency = asyncHandler(async (req, res) => {
  await currencyService.deleteCurrency(req.params.id);
  res.status(200).json(apiResponse('Currency deleted successfully', true, null));
});
>>>>>>> origin/main
