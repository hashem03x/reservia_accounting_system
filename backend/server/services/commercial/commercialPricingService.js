// Reservia Commercial - the COMMERCIAL PRICING layer, kept deliberately separate from the
// engineering BOQ services (onGridEngine.js etc).
//
// The pricing stack is the Developer Brief section 3.3 contract (Deal Engine Rev03 workbook and the
// browser reference build reservia_deal_engine.html, which reproduces the workbook to the EGP):
//
//   Direct COGS            = materials + installation + transport + travel + personnel (the BOQ)
//   Markup pool            = overhead (% of COGS) + contingency (% of COGS) + profit (% of COGS)
//   Sales bonus            = pool x sales bonus %
//   Engineering incentive  = pool x engineering incentive %
//   Base price             = COGS + pool + sales bonus + engineering incentive
//   Category addition      = base x category addition %
//   Net price excl VAT     = (base + category addition) less discount
//   Final price incl VAT   = net x (1 + VAT)
//   Price per kWp          = net / DESIGN kWp (excl VAT); also reported incl VAT
//   Gross profit           = net - COGS - sales bonus - engineering incentive
//   Operating profit       = gross profit - overhead - contingency
//
// QA finding (section 4): profit used to be compounded on (COGS + overhead + contingency); the
// contract takes it on COGS alone. On the QA reference COGS 1,189,886.37 that moved the net price
// from 1,778,961.51 to 1,760,185.82, and on the reference workbook COGS 1,191,565 it gives
// 1,762,669 (see test/commercial/commercialPricingService.test.js).
//
// Lever DEFAULTS are no longer hardcoded here: they come from the Finance-managed configuration
// record (models/commercial/pricingConfigModel.js via services/commercial/pricingConfigService.js)
// and are snapshotted onto each revision when it is created.
'use strict';

/** Section 3.3 default levers - the seed for the Finance configuration record, NOT applied directly. */
const BRIEF_DEFAULT_LEVERS = Object.freeze({
  overheadPct: 0.1,
  contingencyPct: 0.02,
  profitPct: 0.1,
  salesBonusPct: 0.055,
  engineeringIncentivePct: 0.05,
  categoryAdditionPct: 0.19,
  discountPct: 0,
});

const LEVER_KEYS = Object.keys(BRIEF_DEFAULT_LEVERS);

/**
 * @param {object} input
 * @param {number} input.cogs - materials + install + transport + travel/personnel (from the BOQ)
 * @param {number} [input.kWp] - DESIGN kWp, for the per-kWp figures; null-safe if not applicable
 * @param {number} input.vatPct - required; the caller resolves it for the project's country
 */
function priceCommercialRevision({
  cogs, kWp = null,
  overheadPct = 0, contingencyPct = 0, profitPct = 0,
  salesBonusPct = 0, engineeringIncentivePct = 0, categoryAdditionPct = 0,
  discountPct = 0, vatPct,
}) {
  if (!(vatPct >= 0)) throw new Error('vatPct is required');
  const overheadAmt = cogs * overheadPct;
  const contingencyAmt = cogs * contingencyPct;
  const profitAmt = cogs * profitPct; // brief 3.3: profit is taken on COGS, never on COGS + overhead + contingency
  const poolAmt = overheadAmt + contingencyAmt + profitAmt;
  const salesBonusAmt = poolAmt * salesBonusPct;
  const engineeringIncentiveAmt = poolAmt * engineeringIncentivePct;
  const basePrice = cogs + poolAmt + salesBonusAmt + engineeringIncentiveAmt;
  const categoryAdditionAmt = basePrice * categoryAdditionPct;
  const preDiscount = basePrice + categoryAdditionAmt;
  const discountAmt = preDiscount * discountPct;
  const netExclVat = preDiscount - discountAmt;
  const vatAmt = netExclVat * vatPct;
  const grossInclVat = netExclVat + vatAmt;
  const grossProfit = netExclVat - cogs - salesBonusAmt - engineeringIncentiveAmt;
  const grossProfitPct = netExclVat ? grossProfit / netExclVat : null;
  const operatingProfit = grossProfit - overheadAmt - contingencyAmt;
  const operatingProfitPct = netExclVat ? operatingProfit / netExclVat : null;
  const perKwpExclVat = kWp ? netExclVat / kWp : null;
  const perKwpInclVat = kWp ? grossInclVat / kWp : null;

  return {
    cogs, overheadPct, overheadAmt, contingencyPct, contingencyAmt, profitPct, profitAmt, poolAmt,
    salesBonusPct, salesBonusAmt, engineeringIncentivePct, engineeringIncentiveAmt, basePrice,
    categoryAdditionPct, categoryAdditionAmt, discountPct, discountAmt,
    netExclVat, vatPct, vatAmt, grossInclVat, perKwpExclVat, perKwpInclVat, designKwp: kWp,
    grossProfit, grossProfitPct, operatingProfit, operatingProfitPct,
  };
}

/** Picks just the lever percentages out of an object (pricing doc, config, request body). */
function pickLevers(obj = {}) {
  const out = {};
  for (const k of LEVER_KEYS) if (obj[k] !== undefined && obj[k] !== null) out[k] = Number(obj[k]);
  return out;
}

module.exports = { BRIEF_DEFAULT_LEVERS, LEVER_KEYS, priceCommercialRevision, pickLevers };
