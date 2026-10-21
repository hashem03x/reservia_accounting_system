const mongoose = require('mongoose');
const Currency = require('../../models/accounting/currencyModel');
const ApiError = require('../../utils/apiError');
const { BASE_CURRENCY_CODE, isValidRate, parseRate } = require('../../utils/currencyMath');

// All Currency Manager rules live here (controller, Journal Entry controller, seed script), so "is
// this a valid currency / rate" is never decided two different ways.
//
// Rate convention: 1 EGP = unitsPerBase units of the currency (utils/currencyMath.js).

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeCode = code => (typeof code === 'string' ? code.trim().toUpperCase() : '');
const startOfDay = date => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};
const endOfDay = date => {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

const BASE_CURRENCY_DEFAULTS = { code: BASE_CURRENCY_CODE, name: 'Egyptian Pound', nameAr: 'جنيه مصري', symbol: 'E£' };

/**
 * Makes sure the EGP base currency exists (idempotent, safe under concurrency: the unique indexes
 * on code/isBase decide between two simultaneous callers). Called by the seed script and lazily by
 * every read, so a database that predates the Currency Manager works without a manual migration.
 */
async function ensureBaseCurrency(session) {
  const existing = await Currency.findOne({ code: BASE_CURRENCY_CODE }).session(session || null);
  if (existing) return existing;
  try {
    const epoch = new Date('2000-01-01T00:00:00.000Z');
    const [created] = await Currency.create(
      [{ ...BASE_CURRENCY_DEFAULTS, unitsPerBase: 1, isBase: true, isActive: true, rateEffectiveDate: epoch, rateHistory: [{ unitsPerBase: 1, effectiveDate: epoch }] }],
      { session: session || undefined }
    );
    return created;
  } catch (err) {
    if (err?.code === 11000) return Currency.findOne({ code: BASE_CURRENCY_CODE }).session(session || null);
    throw err;
  }
}

/**
 * How many records reference each currency code - journal entries (entry-level or any line,
 * including historical imported lines) and advanced payments. A referenced currency can never be
 * deleted (historical accounting data would point at nothing); it can be deactivated instead.
 */
async function countUsage(codes) {
  const usage = new Map(codes.map(c => [c, 0]));
  if (!codes.length) return usage;
  // Imported lines may carry the code in any letter case - match both forms.
  const variants = [...new Set(codes.flatMap(c => [c, c.toLowerCase()]))];
  const db = mongoose.connection;

  const [entryRows, lineRows, advanceRows] = await Promise.all([
    db
      .collection('journalentries')
      .aggregate([{ $match: { currency: { $in: variants } } }, { $group: { _id: { $toUpper: '$currency' }, n: { $sum: 1 } } }])
      .toArray(),
    db
      .collection('journalentries')
      .aggregate([
        { $match: { 'lines.currency': { $in: variants }, currency: { $nin: variants } } },
        { $project: { codes: { $setUnion: [{ $map: { input: '$lines', as: 'l', in: { $toUpper: { $ifNull: ['$$l.currency', ''] } } } }] } } },
        { $unwind: '$codes' },
        { $group: { _id: '$codes', n: { $sum: 1 } } },
      ])
      .toArray(),
    db
      .collection('advancedpayments')
      .aggregate([{ $match: { currency: { $in: variants } } }, { $group: { _id: { $toUpper: '$currency' }, n: { $sum: 1 } } }])
      .toArray(),
  ]);
  for (const row of [...entryRows, ...lineRows, ...advanceRows]) {
    if (usage.has(row._id)) usage.set(row._id, usage.get(row._id) + row.n);
  }
  return usage;
}

const toPlain = (doc, usageCount) => {
  const plain = typeof doc.toObject === 'function' ? doc.toObject({ virtuals: true }) : { ...doc, basePerUnit: isValidRate(doc.unitsPerBase) ? 1 / doc.unitsPerBase : null };
  delete plain.id;
  return usageCount === undefined ? plain : { ...plain, usageCount };
};

const SORTABLE = { code: 'code', name: 'name', unitsPerBase: 'unitsPerBase', updatedAt: 'updatedAt', createdAt: 'createdAt' };

/**
 * Lists currencies. `status`: 'active' | 'inactive' | anything else = all. `keyword` matches code
 * or name. `sort` is one whitelisted field, optionally prefixed with '-'. The base currency is
 * always listed first. Response shape mirrors handlersFactory.js#getAll (results /
 * paginationResult / data) so the existing pagination plumbing works.
 */
async function listCurrencies({ keyword = '', status = 'all', sort = 'code', page = 1, limit = 50 } = {}) {
  await ensureBaseCurrency();

  const filter = {};
  if (status === 'active') filter.isActive = true;
  if (status === 'inactive') filter.isActive = false;
  const trimmed = typeof keyword === 'string' ? keyword.trim() : '';
  if (trimmed) {
    const rx = { $regex: escapeRegExp(trimmed), $options: 'i' };
    filter.$or = [{ code: rx }, { name: rx }, { nameAr: rx }];
  }

  const rawSort = typeof sort === 'string' ? sort.trim() : '';
  const desc = rawSort.startsWith('-');
  const field = SORTABLE[desc ? rawSort.slice(1) : rawSort] || 'code';

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const [count, docs] = await Promise.all([
    Currency.countDocuments(filter),
    Currency.find(filter)
      .select('-rateHistory')
      .sort({ isBase: -1, [field]: desc ? -1 : 1, code: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
  ]);
  const usage = await countUsage(docs.map(d => d.code));

  return {
    results: docs.length,
    paginationResult: {
      currentPage: pageNum,
      limit: limitNum,
      numberOfPages: Math.max(1, Math.ceil(count / limitNum)),
      ...(skip + limitNum < count ? { next: pageNum + 1 } : {}),
      ...(skip > 0 ? { prev: pageNum - 1 } : {}),
    },
    totalCount: count,
    data: docs.map(d => toPlain(d, usage.get(d.code) || 0)),
  };
}

async function findCurrencyOrFail(idOrCode, { session, populate = false } = {}) {
  await ensureBaseCurrency(session);
  const query = mongoose.Types.ObjectId.isValid(idOrCode) && String(idOrCode).length === 24 ? { _id: idOrCode } : { code: normalizeCode(idOrCode) };
  const find = Currency.findOne(query).session(session || null);
  if (populate) find.populate({ path: 'rateHistory.changedBy', select: 'name' });
  const currency = await find;
  if (!currency) throw new ApiError(`No currency found for "${idOrCode}"`, 404);
  return currency;
}

/** One currency with its full rate history (newest first) and usage count. */
async function getCurrency(idOrCode) {
  const currency = await findCurrencyOrFail(idOrCode, { populate: true });
  const usage = await countUsage([currency.code]);
  const plain = toPlain(currency, usage.get(currency.code) || 0);
  plain.rateHistory = [...(plain.rateHistory || [])].sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate) || new Date(b.changedAt) - new Date(a.changedAt));
  return plain;
}

const duplicateError = err => (err?.code === 11000 ? new ApiError('A currency with this code already exists.', 400) : err);
const concurrencyError = err =>
  err?.name === 'VersionError' ? new ApiError('This currency was changed by someone else while you were editing it. Reload it and try again.', 409) : err;
const validationError = err =>
  err?.name === 'ValidationError' || (err instanceof Error && !(err instanceof ApiError) && !err.code && !err.statusCode) ? new ApiError(err.message, 400) : err;

function requireRate(value) {
  const rate = parseRate(value);
  if (rate === null) throw new ApiError('Exchange rate must be a finite number greater than zero.', 400);
  return rate;
}

async function createCurrency({ code, name, nameAr, symbol, unitsPerBase, rateEffectiveDate, isActive }, userId) {
  await ensureBaseCurrency();
  const normalized = normalizeCode(code);
  if (!/^[A-Z]{3}$/.test(normalized)) throw new ApiError('Currency code must be exactly 3 letters (e.g. USD).', 400);
  if (normalized === BASE_CURRENCY_CODE) throw new ApiError(`${BASE_CURRENCY_CODE} is the base currency and already exists.`, 400);
  if (await Currency.exists({ code: normalized })) throw new ApiError(`A currency with the code ${normalized} already exists.`, 400);

  const rate = requireRate(unitsPerBase);
  const effectiveDate = rateEffectiveDate ? startOfDay(rateEffectiveDate) : startOfDay(new Date());
  try {
    const currency = await Currency.create({
      code: normalized,
      name,
      nameAr: nameAr || '',
      symbol: symbol || '',
      unitsPerBase: rate,
      rateEffectiveDate: effectiveDate,
      isActive: isActive ?? true,
      rateHistory: [{ unitsPerBase: rate, effectiveDate, changedBy: userId || null }],
      createdBy: userId || null,
      updatedBy: userId || null,
    });
    return toPlain(currency, 0);
  } catch (err) {
    throw validationError(duplicateError(err));
  }
}

/**
 * Updates a currency's details, status and/or rate. A rate change is appended to the rate history
 * with its effective date - it never rewrites any journal entry (each entry keeps the rate it was
 * created with). The base currency's rate and status are fixed. `expectedVersion` (the `__v` the
 * client loaded) turns a concurrent edit into a clean 409 instead of a silent overwrite.
 */
async function updateCurrency(id, { name, nameAr, symbol, unitsPerBase, rateEffectiveDate, isActive, expectedVersion }, userId) {
  const currency = await findCurrencyOrFail(id);
  if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== currency.__v) {
    throw new ApiError('This currency was changed by someone else while you were editing it. Reload it and try again.', 409);
  }

  if (name !== undefined) currency.name = name;
  if (nameAr !== undefined) currency.nameAr = nameAr || '';
  if (symbol !== undefined) currency.symbol = symbol || '';

  if (isActive !== undefined) {
    if (currency.isBase && isActive === false) throw new ApiError('The base currency (EGP) cannot be deactivated.', 400);
    currency.isActive = isActive;
  }

  if (unitsPerBase !== undefined && unitsPerBase !== null && unitsPerBase !== '') {
    const rate = requireRate(unitsPerBase);
    if (currency.isBase && rate !== 1) throw new ApiError('The base currency (EGP) always has an exchange rate of 1.', 400);
    const effectiveDate = rateEffectiveDate ? startOfDay(rateEffectiveDate) : startOfDay(new Date());
    const rateChanged = rate !== currency.unitsPerBase;
    const dateChanged = startOfDay(currency.rateEffectiveDate || 0).getTime() !== effectiveDate.getTime();
    if (!currency.isBase && (rateChanged || (rateEffectiveDate && dateChanged))) {
      // One rate per effective date: re-entering a rate for a date that already has one corrects it.
      const sameDay = currency.rateHistory.find(h => startOfDay(h.effectiveDate).getTime() === effectiveDate.getTime());
      if (sameDay) {
        sameDay.unitsPerBase = rate;
        sameDay.changedBy = userId || null;
        sameDay.changedAt = new Date();
      } else {
        currency.rateHistory.push({ unitsPerBase: rate, effectiveDate, changedBy: userId || null, changedAt: new Date() });
      }
      // The "current" rate is the one with the latest effective date (a back-dated correction
      // must not replace a newer rate as the current one).
      const latest = [...currency.rateHistory].sort((a, b) => new Date(b.effectiveDate) - new Date(a.effectiveDate))[0];
      currency.unitsPerBase = latest.unitsPerBase;
      currency.rateEffectiveDate = latest.effectiveDate;
    }
  }

  currency.updatedBy = userId || null;
  // A rate correction edits an existing history item in place, which optimisticConcurrency alone
  // would not version - always bump so a concurrent editor is detected.
  currency.increment();
  try {
    await currency.save();
  } catch (err) {
    throw validationError(concurrencyError(err));
  }
  return getCurrency(currency._id);
}

/**
 * Permanently deletes a currency - only a non-base currency that no journal entry or advanced
 * payment references. A referenced currency is refused with a clear message; deactivating it is
 * the way to retire it without breaking historical accounting data.
 */
async function deleteCurrency(id) {
  const currency = await findCurrencyOrFail(id);
  if (currency.isBase) throw new ApiError('The base currency (EGP) cannot be deleted.', 400);
  const used = (await countUsage([currency.code])).get(currency.code) || 0;
  if (used > 0) {
    throw new ApiError(
      `The currency ${currency.code} is used by ${used} accounting record${
        used === 1 ? '' : 's'
      } and cannot be deleted. Deactivate it instead - historical entries keep it, but it can no longer be selected.`,
      400
    );
  }
  await Currency.deleteOne({ _id: currency._id });
}

/**
 * The rate (1 EGP = X units) that applies to a transaction dated `date`: the history item with the
 * latest effectiveDate on or before that day. A date before the first recorded rate gets the
 * earliest recorded rate (there is nothing older to use) - flagged via `isFallback`.
 */
function rateForDate(currency, date) {
  if (currency.isBase) return { unitsPerBase: 1, effectiveDate: currency.rateEffectiveDate || null, isFallback: false };
  const target = endOfDay(date || new Date()).getTime();
  const history = [...(currency.rateHistory || [])].sort((a, b) => new Date(a.effectiveDate) - new Date(b.effectiveDate));
  if (!history.length) return { unitsPerBase: currency.unitsPerBase, effectiveDate: currency.rateEffectiveDate || null, isFallback: true };
  let match = null;
  for (const h of history) {
    if (new Date(h.effectiveDate).getTime() <= target) match = h;
  }
  if (!match) return { unitsPerBase: history[0].unitsPerBase, effectiveDate: history[0].effectiveDate, isFallback: true };
  return { unitsPerBase: match.unitsPerBase, effectiveDate: match.effectiveDate, isFallback: false };
}

/** GET /currencies/:id/rate?date= - the rate a journal entry on that date gets by default. */
async function getRateForDate(idOrCode, date) {
  const currency = await findCurrencyOrFail(idOrCode);
  const rate = rateForDate(currency, date);
  return { code: currency.code, ...rate, basePerUnit: 1 / rate.unitsPerBase };
}

/**
 * Resolves the currency and applied rate for a manual journal entry - server-side, never trusting
 * the client:
 *   - no currency (or EGP)            -> EGP @ 1 (any client rate for EGP other than 1 is rejected)
 *   - unknown code                    -> 400
 *   - inactive currency               -> 400, unless it is the entry's existing currency (editing an
 *                                        old draft never forces a currency change)
 *   - client rate given               -> must be finite and > 0; used as the entry's applied rate
 *   - no client rate                  -> the rate effective on the entry date (rateForDate)
 */
async function resolveEntryCurrency({ currency: code, exchangeRate, date, currentCode = null, session } = {}) {
  const normalized = normalizeCode(code) || BASE_CURRENCY_CODE;
  if (normalized === BASE_CURRENCY_CODE) {
    if (exchangeRate !== undefined && exchangeRate !== null && exchangeRate !== '' && Number(exchangeRate) !== 1) {
      throw new ApiError('The base currency (EGP) always has an exchange rate of 1.', 400);
    }
    return { code: BASE_CURRENCY_CODE, unitsPerBase: 1, isBase: true };
  }

  const currency = await Currency.findOne({ code: normalized }).session(session || null);
  if (!currency) throw new ApiError(`"${normalized}" is not a configured currency.`, 400);
  if (!currency.isActive && normalized !== normalizeCode(currentCode)) {
    throw new ApiError(`The currency ${normalized} is inactive and cannot be selected.`, 400);
  }

  let unitsPerBase;
  if (exchangeRate !== undefined && exchangeRate !== null && exchangeRate !== '') {
    unitsPerBase = parseRate(exchangeRate);
    if (unitsPerBase === null) throw new ApiError('Exchange rate must be a finite number greater than zero.', 400);
  } else {
    ({ unitsPerBase } = rateForDate(currency, date));
  }
  return { code: currency.code, unitsPerBase, isBase: false };
}

module.exports = {
  BASE_CURRENCY_CODE,
  ensureBaseCurrency,
  listCurrencies,
  getCurrency,
  createCurrency,
  updateCurrency,
  deleteCurrency,
  rateForDate,
  getRateForDate,
  resolveEntryCurrency,
  countUsage,
};
