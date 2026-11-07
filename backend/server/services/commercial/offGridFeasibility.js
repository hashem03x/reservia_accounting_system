// Off-Grid-only solar-vs-diesel-generator feasibility - ported from Off_Grid.xlsx
// `Feasibility Study` (and its pure chart mirror `Payback Chart`, not re-implemented separately).
//
// This model has NO equivalent anywhere in the unified HTML/brief (which only models solar vs.
// grid-tariff savings - meaningless for a true off-grid site with no grid tariff at all). It is
// kept here as an Off-Grid-specific addition, sourced entirely from this workbook.

'use strict';

function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Feasibility Study!B8/B9 - required/selected generator size. */
function sizeGenerator({ connectedW, generatorPowerFactor, generatorSizingMargin, ceilingStepKva = 5 }) {
  const requiredKva = (connectedW / generatorPowerFactor) * (1 + generatorSizingMargin) / 1000; // B8
  const selectedKva = Math.ceil(requiredKva / ceilingStepKva) * ceilingStepKva; // B9 = CEILING(B8,5)
  return { requiredKva, selectedKva };
}

/**
 * Feasibility Study!28:53 - the 25-year, year-by-year diesel-vs-solar cashflow table.
 * `solarInitialCapex` here is BOQ!H20 (grand total INCL. VAT) in the source sheet - the customer's
 * full solar invoice, not the raw BOQ cost (unlike the On-Grid feasibility model, which uses the
 * raw BOQ cost - a genuine difference between the two workbooks, preserved as-is).
 */
function runDieselComparison({
  dailyWh, generatorPurchasePrice, dieselPriceEgpPerL, dieselTransportEgpPerL, dieselAnnualEscalation,
  generatorSpecificFuelUseLPerKwh, generatorMaintenancePct, generatorReplacementIntervalYears,
  solarAnnualOmPct, batteryReplacementIntervalYears, batteryReplacementCost, solarInitialCapex,
  analysisPeriodYears = 25,
}) {
  const years = [];
  const generatorInitialCost = generatorPurchasePrice; // B24 = B10
  let cumulative = -solarInitialCapex + generatorInitialCost; // G28/H28
  years.push({ n: 0, fuelCost: 0, generatorOm: 0, generatorReplacement: generatorInitialCost, solarOm: 0, batteryReplacement: 0, netSavings: cumulative, cumulative });

  for (let n = 1; n <= analysisPeriodYears; n++) {
    const fuelCost = (dailyWh / 1000) * 365 * generatorSpecificFuelUseLPerKwh * (dieselPriceEgpPerL + dieselTransportEgpPerL) * (1 + dieselAnnualEscalation) ** (n - 1); // B_n
    const generatorOm = generatorPurchasePrice * generatorMaintenancePct; // C_n
    const generatorReplacement = n % generatorReplacementIntervalYears === 0 ? generatorPurchasePrice : 0; // D_n
    const solarOm = solarInitialCapex * solarAnnualOmPct; // E_n
    const batteryReplacement = n % batteryReplacementIntervalYears === 0 ? batteryReplacementCost : 0; // F_n
    const netSavings = fuelCost + generatorOm + generatorReplacement - (solarOm + batteryReplacement); // G_n
    cumulative += netSavings; // H_n
    years.push({ n, fuelCost, generatorOm, generatorReplacement, solarOm, batteryReplacement, netSavings, cumulative });
  }
  return years;
}

/** Feasibility Study!B57 - INDEX/MATCH simple payback with fractional-year interpolation, reproduced literally. */
function simplePayback(years) {
  const year0 = years[0];
  if (year0.cumulative >= 0) return 0; // IF(H28>=0,0,...)
  const firstPositiveIdx = years.findIndex((y, i) => i > 0 && y.cumulative >= 0); // MATCH(TRUE,H29:H53>=0,0), 1-based within H29:H53
  if (firstPositiveIdx === -1) return 'Not recovered';
  const lastNegative = years[firstPositiveIdx - 1]; // INDEX(H28:H52, matchPos)
  const crossingYear = years[firstPositiveIdx]; // INDEX(G29:G53, matchPos)
  return (firstPositiveIdx - 1) + Math.abs(lastNegative.cumulative) / crossingYear.netSavings;
}

/** Feasibility Study!B63 - "N Years M Months" formatting of the numeric payback above. */
function writtenPayback(paybackYears) {
  if (typeof paybackYears !== 'number') return paybackYears;
  const wholeYears = Math.trunc(paybackYears);
  const months = Math.round((paybackYears % 1) * 12);
  return `${wholeYears === 0 ? '' : `${wholeYears} Years `}${months} Months`.trim();
}

function irrBisection(cashflows) {
  function npvAt(r) {
    let s = 0;
    for (let i = 0; i < cashflows.length; i++) s += cashflows[i] / (1 + r) ** i;
    return s;
  }
  let lo = -0.99;
  let hi = 5;
  let a = npvAt(lo);
  let b = npvAt(hi);
  if (a * b > 0) return null;
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    const fm = npvAt(m);
    if (a * fm <= 0) { hi = m; b = fm; } else { lo = m; a = fm; }
  }
  return (lo + hi) / 2;
}

/** Excel NPV() semantics: discounts cashflows[0..] starting at period 1 (NOT period 0). */
function excelNpv(rate, cashflowsFromYear1) {
  let s = 0;
  for (let i = 0; i < cashflowsFromYear1.length; i++) s += cashflowsFromYear1[i] / (1 + rate) ** (i + 1);
  return s;
}

function runOffGridDieselFeasibility(input) {
  const years = runDieselComparison(input);
  const netSavingsFromYear1 = years.slice(1).map(y => y.netSavings); // G29:G53
  const allNetSavings = years.map(y => y.netSavings); // G28:G53

  const payback = simplePayback(years); // B57
  const written = writtenPayback(payback); // B63
  const irr = irrBisection(allNetSavings); // B58 = IRR(G28:G53) - the discrete cashflows (unlike On-Grid's cumulative-series quirk)
  const roi = netSavingsFromYear1.reduce((s, v) => s + v, 0) / input.solarInitialCapex; // B59
  const twentyFiveYearNetSavings = allNetSavings.reduce((s, v) => s + v, 0); // B60
  const npv = excelNpv(input.discountRate, netSavingsFromYear1) + years[0].netSavings; // B61

  return { years, headline: { payback, written, irr, roi, twentyFiveYearNetSavings, npv } };
}

module.exports = {
  sizeGenerator,
  runDieselComparison,
  simplePayback,
  writtenPayback,
  irrBisection,
  excelNpv,
  runOffGridDieselFeasibility,
};
