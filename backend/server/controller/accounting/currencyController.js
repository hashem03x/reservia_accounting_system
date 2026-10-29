const asyncHandler = require('express-async-handler');
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
