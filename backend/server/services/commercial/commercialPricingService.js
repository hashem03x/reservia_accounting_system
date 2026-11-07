// Reservia Commercial - the configurable COMMERCIAL PRICING layer (original brief section 9),
// kept deliberately separate from the engineering BOQ services (onGridEngine.js etc).
//
// IMPORTANT: unlike the engineering BOQ, NONE of the markup levers below are Excel-sourced
// defaults for On-Grid, Agriculture Pumping or Utility Scale - none of those three workbooks
// define an overhead/sales-bonus/engineering-incentive/category-addition stack anywhere (see the
// implementation plan's source-mapping table). Only Off-Grid has a real Excel pricing stack
// (`Off_Grid.xlsx BOQ!H27:H33`: contingency 2% of COGS, then profit 10% of COGS+contingency, then
// VAT) - its defaults below reproduce that exactly; every other category defaults every lever to
// 0%, so net price == COGS until the commercial team actually sets a margin. The cascade is
// written generically enough that Off-Grid's exact formula falls out of it when overhead/sales
// bonus/engineering incentive/category addition are all left at 0 (see this file's own test).
'use strict';

const DEFAULTS_BY_CATEGORY = {
  'On-Grid C&I': { overheadPct: 0, contingencyPct: 0, profitPct: 0, salesBonusPct: 0, engineeringIncentivePct: 0, categoryAdditionPct: 0 },
  'Off-Grid': { overheadPct: 0, contingencyPct: 0.02, profitPct: 0.1, salesBonusPct: 0, engineeringIncentivePct: 0, categoryAdditionPct: 0 },
  'Agriculture Pumping': { overheadPct: 0, contingencyPct: 0, profitPct: 0, salesBonusPct: 0, engineeringIncentivePct: 0, categoryAdditionPct: 0 },
  'Utility Scale': { overheadPct: 0, contingencyPct: 0, profitPct: 0, salesBonusPct: 0, engineeringIncentivePct: 0, categoryAdditionPct: 0 },
  'Street Lighting': { overheadPct: 0, contingencyPct: 0, profitPct: 0, salesBonusPct: 0, engineeringIncentivePct: 0, categoryAdditionPct: 0 },
  'Solar Water Heating': { overheadPct: 0, contingencyPct: 0, profitPct: 0, salesBonusPct: 0, engineeringIncentivePct: 0, categoryAdditionPct: 0 },
};

function defaultsForCategory(category) {
  return DEFAULTS_BY_CATEGORY[category] || DEFAULTS_BY_CATEGORY['On-Grid C&I'];
}

/**
 * @param {object} input
 * @param {number} input.cogs - materials + install + transport + travel/personnel (from the BOQ)
 * @param {number} [input.kWp] - for the EGP/kWp figure; null-safe if not applicable
 * @param {number} input.vatPct - NOT defaulted here; the caller supplies the country's VAT rate
 *   (On_Grid.xlsx Master Project!B15: 14% Egypt / 15% Saudi Arabia - the one VAT figure that IS
 *   Excel-sourced).
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
  const profitAmt = (cogs + contingencyAmt + overheadAmt) * profitPct;
  const pool = overheadAmt + contingencyAmt + profitAmt;
  const salesBonusAmt = pool * salesBonusPct;
  const engineeringIncentiveAmt = pool * engineeringIncentivePct;
  const base = cogs + pool + salesBonusAmt + engineeringIncentiveAmt;
  const categoryAdditionAmt = base * categoryAdditionPct;
  const preDiscount = base + categoryAdditionAmt;
  const discountAmt = preDiscount * discountPct;
  const netExclVat = preDiscount - discountAmt;
  const vatAmt = netExclVat * vatPct;
  const grossInclVat = netExclVat + vatAmt;
  const grossProfit = netExclVat - cogs - salesBonusAmt - engineeringIncentiveAmt;
  const grossProfitPct = netExclVat ? grossProfit / netExclVat : null;
  const perKwpExclVat = kWp ? netExclVat / kWp : null;

  return {
    cogs, overheadPct, overheadAmt, contingencyPct, contingencyAmt, profitPct, profitAmt,
    salesBonusPct, salesBonusAmt, engineeringIncentivePct, engineeringIncentiveAmt,
    categoryAdditionPct, categoryAdditionAmt, discountPct, discountAmt,
    netExclVat, vatPct, vatAmt, grossInclVat, perKwpExclVat, grossProfit, grossProfitPct,
  };
}

module.exports = { DEFAULTS_BY_CATEGORY, defaultsForCategory, priceCommercialRevision };
