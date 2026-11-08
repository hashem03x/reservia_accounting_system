// On-Grid financial feasibility - ported from On_Grid.xlsx `Feasibility Table`.
//
// Key findings preserved here (see the implementation plan's discrepancy list for the full
// writeup, not re-litigated in every comment below):
//   - CapEx (A4) is the raw BOQ cost, with NO commercial markup applied - not the customer's final
//     selling price. Callers decide what capex to pass in; this module does not assume one.
//   - The 25 year-by-year degradation values (C10:C34) are LITERAL numbers typed into the sheet,
//     not a clean (1-d)^(n-1) formula - reproduced verbatim below, not re-derived.
//   - Three tariff-escalation scenarios run side by side (flat / +3%/yr / +10%/yr); the sheet's own
//     labeled headline cells (B38 payback, B39 ROI, B40 IRR) are wired to the FLAT scenario only.
//   - IRR (B40) is computed on the CUMULATIVE cashflow column (J9:J34), not the discrete per-year
//     cashflow series - an unusual choice, but it is what the live formula does, so it is what
//     this module does too.
//   - There is no NPV and no discount-rate input anywhere in this sheet.

'use strict';

// Feasibility Table!C10:C34 - literal, not a formula.
const DEGRADATION_TABLE_25YR = [
  0.975, 0.9682, 0.9614, 0.9545, 0.9477, 0.9409, 0.9341, 0.9273, 0.9205, 0.9136,
  0.9068, 0.9, 0.8928, 0.8857, 0.8785, 0.8714, 0.8642, 0.8571, 0.8499, 0.8428,
  0.8356, 0.8285, 0.8213, 0.8142, 0.807,
];

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** One tariff-escalation scenario's 25-year table (Feasibility Table!10:34, one column block). */
function runScenario({ capex, annualProductionKwhYear1, annualConsumptionKwh, baseTariffEgpPerKwh, maintenancePctOfCapex, escalationRate }) {
  const years = [];
  let cumulative = -capex; // row 9: J9/Q9/X9 = -A4
  const cashflows = [-capex];
  for (let n = 1; n <= 25; n++) {
    const productionKwh = round(DEGRADATION_TABLE_25YR[n - 1] * annualProductionKwhYear1, 10); // D_n
    const tariff = baseTariffEgpPerKwh * (1 + escalationRate) ** (n - 1); // L_n / S_n (flat when escalationRate=0)
    const revenue = round(annualConsumptionKwh * tariff, 10); // F_n / M_n / T_n
    const uncoveredKwh = annualConsumptionKwh - productionKwh; // G_n / N_n / U_n
    const projectedCost = round(tariff * uncoveredKwh, 10); // H_n / O_n / V_n
    const maintenance = n === 1 ? 0 : capex * maintenancePctOfCapex; // B_n (0 in year 1, flat thereafter)
    const yearlyCashflow = round(revenue - projectedCost - maintenance, 10); // I_n / P_n / W_n
    cumulative = round(cumulative + yearlyCashflow, 10); // J_n = SUM(I_10:I_n) - A4
    cashflows.push(yearlyCashflow);
    years.push({ n, productionKwh, tariff, revenue, uncoveredKwh, projectedCost, maintenance, yearlyCashflow, cumulative });
  }
  return { years, cashflows, finalCumulative: cumulative };
}

/** Feasibility Table!B38 - INDEX/MATCH simple-payback-with-months, reproduced literally. */
function simplePaybackWithMonths(years) {
  const firstPositiveIdx = years.findIndex(y => y.cumulative > 0); // MATCH(TRUE, J10:J34>0, 0)
  if (firstPositiveIdx <= 0) return null; // no crossing found, or already positive in year 1 (sheet would #REF here too)
  const lastNegative = years[firstPositiveIdx - 1];
  const nextYear = years[firstPositiveIdx];
  const months = Math.round((Math.abs(lastNegative.cumulative) / nextYear.yearlyCashflow) * 12);
  return { years: lastNegative.n, months, label: `${lastNegative.n} Years and ${months} Months` };
}

/** IRR by bisection, applied to the array passed in exactly as given - the flat scenario passes its CUMULATIVE series (B40's own choice), not the discrete cashflows. */
function irrBisection(series) {
  function npvAt(r) {
    let s = 0;
    for (let i = 0; i < series.length; i++) s += series[i] / (1 + r) ** i;
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

/**
 * Runs all 3 tariff-escalation scenarios and the sheet's own headline figures (flat-scenario
 * payback/ROI/IRR). `capex` is a plain parameter - callers decide whether to pass the raw BOQ
 * cost (matching the sheet exactly) or some other basis; this module never re-derives it.
 *
 * `baseTariffEgpPerKwh` (Feasibility Table!G4), `maintenancePctOfCapex` (!C4),
 * `escalationScenario2`/`escalationScenario3` (!M7/!T7) are all genuine EDITABLE input cells in
 * the source sheet, not formulas - their defaults below are the sheet's own live values, never
 * fabricated, but a caller (the commercial team, per-project) may override any of them.
 */
function runOnGridFeasibility({
  capex, annualProductionKwhYear1, annualConsumptionKwh,
  baseTariffEgpPerKwh = 2.8, maintenancePctOfCapex = 0.01,
  escalationScenario2 = 0.03, escalationScenario3 = 0.1,
}) {
  const scenarios = {
    flat: runScenario({ capex, annualProductionKwhYear1, annualConsumptionKwh, baseTariffEgpPerKwh, maintenancePctOfCapex, escalationRate: 0 }),
    escalation3pct: runScenario({ capex, annualProductionKwhYear1, annualConsumptionKwh, baseTariffEgpPerKwh, maintenancePctOfCapex, escalationRate: escalationScenario2 }),
    escalation10pct: runScenario({ capex, annualProductionKwhYear1, annualConsumptionKwh, baseTariffEgpPerKwh, maintenancePctOfCapex, escalationRate: escalationScenario3 }),
  };
  const flat = scenarios.flat;
  const payback = simplePaybackWithMonths(flat.years); // B38
  const roi = round(flat.finalCumulative / capex, 12); // B39 = J34/A4
  // B40 = IRR(J9:J34) - the CUMULATIVE series, per the sheet's own (unusual) choice.
  const cumulativeSeries = [-capex, ...flat.years.map(y => y.cumulative)];
  const irr = irrBisection(cumulativeSeries); // B40
  return { scenarios, headline: { payback, roi, irr } };
}

module.exports = {
  DEGRADATION_TABLE_25YR,
  runScenario,
  simplePaybackWithMonths,
  irrBisection,
  runOnGridFeasibility,
};
