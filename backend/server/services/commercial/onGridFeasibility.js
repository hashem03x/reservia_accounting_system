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

// ---------------------------------------------------------------------------------------------
// Customer feasibility - Developer Brief section 3.4 (the contract; QA finding B4). This is the
// HEADLINE model the Feasibility tab shows; the R74 `Feasibility Table` port above is kept only for
// its existing tests and is no longer used by the revision pipeline.
//
//   Capex                   = FINAL PRICE INCL VAT, at year 0 (what the customer actually pays)
//   Yield year n            = design kWp x specific yield x (1 - degradation)^(n - 1)
//   Market tariff year n    = tariff x (1 + escalation)^(n - 1)
//   Avoided cost (savings)  = yield x tariff
//   Simple payback          = first year cumulative cash turns positive, interpolated
//   IRR                     = over the discrete cash flows, year 0 to 25
//   NPV                     = -capex + sum of savings discounted at the discount rate
//   Levelised cost per kWh  = capex / sum of 25-year yield
//   O&M                     = included in the EPC offer, so NOTHING is deducted by default (0%)
//
// Headline case: 10% tariff escalation. Sensitivities: 3% and flat (0%). Defaults are the brief's
// section 9 values (yield 1,800 kWh/kWp, degradation 0.7%/yr, tariff 2.80 EGP/kWh, discount rate
// 22%) and every one is an editable input. Reference acceptance (brief section 8): capex 2,009,443
// -> payback 4.2775 years, IRR 28.98%, NPV 948,944, 25-year avoided cost 35,338,644.

const CUSTOMER_FEASIBILITY_DEFAULTS = Object.freeze({
  yieldKwhPerKwp: 1800,
  degradationPct: 0.007,
  tariffEgpPerKwh: 2.8,
  headlineEscalation: 0.1,
  sensitivityEscalations: [0.03, 0],
  discountRate: 0.22,
  maintenancePctOfCapex: 0,
  years: 25,
});

function irrOfCashflows(cf) {
  return irrBisection(cf);
}

/**
 * Tariff multiplier for year n. `escalation` is a flat yearly rate, or (Deal Engine C9) a two-phase
 * path { first, years, then }: `first` for the first `years` years, then `then`.
 */
function tariffFactor(escalation, n) {
  if (escalation && typeof escalation === 'object') {
    const early = Math.min(n - 1, escalation.years);
    const late = Math.max(0, n - 1 - escalation.years);
    return (1 + escalation.first) ** early * (1 + escalation.then) ** late;
  }
  return (1 + escalation) ** (n - 1);
}

function escalationLabel(escalation) {
  if (escalation && typeof escalation === 'object') return `+${round(escalation.first * 100, 2)}% for ${escalation.years} years, then +${round(escalation.then * 100, 2)}%`;
  return escalation === 0 ? 'Flat tariff' : `+${round(escalation * 100, 2)}% per year`;
}

/**
 * One escalation scenario of the brief 3.4 model.
 * Deal Engine additions (12 Nov 2026): `inverterReplacement` { year, costEgp } is deducted in its year
 * (C7); the result carries the discounted payback (C6), the undiscounted "simple cost per kWh" under
 * its own name and a discounted LCOE (C6).
 */
function runCustomerScenario({ capex, designKwp, yieldKwhPerKwp, degradationPct, tariffEgpPerKwh, escalation, discountRate, maintenancePctOfCapex, years, inverterReplacement = null }) {
  const yr1 = designKwp * yieldKwhPerKwp;
  const cf = [-capex];
  const rows = [];
  let cum = -capex;
  let payback = null;
  let yieldSum = 0;
  let savingsSum = 0;
  let npv = -capex;
  let discCum = -capex;
  let discountedPayback = null;
  let discYield = 0;
  let discCosts = capex;
  for (let n = 1; n <= years; n++) {
    const generationKwh = yr1 * (1 - degradationPct) ** (n - 1);
    const tariff = tariffEgpPerKwh * tariffFactor(escalation, n);
    const savings = generationKwh * tariff;
    // O&M is in the EPC offer - deducted only if the estimator deliberately enters a percentage.
    const maintenance = maintenancePctOfCapex > 0 ? capex * maintenancePctOfCapex : 0;
    const replacement = inverterReplacement && inverterReplacement.year === n ? inverterReplacement.costEgp : 0;
    const net = savings - maintenance - replacement;
    const prev = cum;
    cum += net;
    if (payback === null && prev < 0 && cum >= 0) payback = n - 1 + -prev / net;
    const df = (1 + discountRate) ** n;
    const prevDisc = discCum;
    discCum += net / df;
    if (discountedPayback === null && prevDisc < 0 && discCum >= 0) discountedPayback = n - 1 + -prevDisc / (net / df);
    cf.push(net);
    npv += net / df;
    yieldSum += generationKwh;
    savingsSum += savings;
    discYield += generationKwh / df;
    discCosts += (maintenance + replacement) / df;
    rows.push({ n, generationKwh, tariff, savings, maintenance, inverterReplacement: replacement, net, cumulative: cum });
  }
  const simpleCostPerKwh = yieldSum ? capex / yieldSum : null;
  return {
    escalation,
    label: escalationLabel(escalation),
    paybackYears: payback,
    paybackLabel: payback === null ? `Beyond ${years} years` : paybackLabel(payback),
    // C6: the stricter companion figure - cash flows discounted at the discount rate.
    discountedPaybackYears: discountedPayback,
    discountedPaybackLabel: discountedPayback === null ? `Beyond ${years} years` : paybackLabel(discountedPayback),
    irr: irrOfCashflows(cf),
    npv,
    lifetimeSavings: savingsSum,
    lifetimeGenerationKwh: yieldSum,
    year1GenerationKwh: yr1,
    year1Savings: rows[0]?.savings ?? 0,
    // C6: price / 25-year generation, UNDISCOUNTED - never to be called LCOE in a customer document.
    // `levelisedCostPerKwh` keeps the same value for revisions and screens that read the old name.
    simpleCostPerKwh,
    levelisedCostPerKwh: simpleCostPerKwh,
    // C6: true LCOE - costs (capex, O&M, inverter replacement) and energy discounted at the same rate.
    lcoePerKwh: discYield ? discCosts / discYield : null,
    inverterReplacement: inverterReplacement || null,
    years: rows,
  };
}

function paybackLabel(years) {
  const whole = Math.floor(years);
  const months = Math.round((years - whole) * 12);
  const y = months === 12 ? whole + 1 : whole;
  const m = months === 12 ? 0 : months;
  return `${y} years ${m} months`;
}

/**
 * Brief 3.4 customer feasibility for a priced revision.
 * @param {object} args
 * @param {{netExclVat:number, vatAmt:number, grossInclVat:number, vatPct:number}} args.pricing
 * @param {number} args.designKwp
 * @param {number} [args.boqCost] - internal cost-side view only (QA note 14), never the headline
 * @param {object} [args.inputs] - per-project overrides of CUSTOMER_FEASIBILITY_DEFAULTS
 */
function runCustomerFeasibility({ pricing, designKwp, boqCost = null, annualConsumptionKwh = null, inputs = {} }) {
  if (!(pricing?.grossInclVat > 0) || !(designKwp > 0)) return null;
  const pick = (k, d) => (typeof inputs[k] === 'number' && Number.isFinite(inputs[k]) ? inputs[k] : d);
  const a = {
    yieldKwhPerKwp: pick('yieldKwhPerKwp', CUSTOMER_FEASIBILITY_DEFAULTS.yieldKwhPerKwp),
    degradationPct: pick('degradationPct', CUSTOMER_FEASIBILITY_DEFAULTS.degradationPct),
    tariffEgpPerKwh: pick('tariffEgpPerKwh', CUSTOMER_FEASIBILITY_DEFAULTS.tariffEgpPerKwh),
    headlineEscalation: pick('headlineEscalation', CUSTOMER_FEASIBILITY_DEFAULTS.headlineEscalation),
    discountRate: pick('discountRate', CUSTOMER_FEASIBILITY_DEFAULTS.discountRate),
    maintenancePctOfCapex: pick('maintenancePctOfCapex', CUSTOMER_FEASIBILITY_DEFAULTS.maintenancePctOfCapex),
    years: CUSTOMER_FEASIBILITY_DEFAULTS.years,
  };
  const sens = Array.isArray(inputs.sensitivityEscalations) && inputs.sensitivityEscalations.every(v => typeof v === 'number' && Number.isFinite(v))
    ? inputs.sensitivityEscalations
    : CUSTOMER_FEASIBILITY_DEFAULTS.sensitivityEscalations;

  const capex = pricing.grossInclVat;
  // C7: an inverter replacement in the chosen year, at today's Price Book price (when supplied).
  const inverterReplacement = inputs.inverterReplacement && inputs.inverterReplacement.costEgp > 0 && inputs.inverterReplacement.year >= 1 && inputs.inverterReplacement.year <= a.years ? { year: inputs.inverterReplacement.year, costEgp: inputs.inverterReplacement.costEgp } : null;
  const common = { capex, designKwp, yieldKwhPerKwp: a.yieldKwhPerKwp, degradationPct: a.degradationPct, tariffEgpPerKwh: a.tariffEgpPerKwh, discountRate: a.discountRate, maintenancePctOfCapex: a.maintenancePctOfCapex, years: a.years, inverterReplacement };
  const headline = runCustomerScenario({ ...common, escalation: a.headlineEscalation });
  const sensitivities = sens.filter(e => e !== a.headlineEscalation).map(e => runCustomerScenario({ ...common, escalation: e }));
  // C9: the two-phase path (10% for 5 years, then 5%) as a further scenario, when configured.
  const tp = inputs.twoPhaseEscalation;
  if (tp && [tp.first, tp.years, tp.then].every(v => typeof v === 'number' && Number.isFinite(v))) sensitivities.push(runCustomerScenario({ ...common, escalation: { first: tp.first, years: tp.years, then: tp.then } }));
  // C5: performance ratio (IEC 61724-1) = specific yield / annual in-plane irradiation - only when entered.
  const irradiation = typeof inputs.annualIrradiationKwhPerM2 === 'number' && inputs.annualIrradiationKwhPerM2 > 0 ? inputs.annualIrradiationKwhPerM2 : null;
  const performanceRatio = irradiation ? a.yieldKwhPerKwp / irradiation : null;

  // Internal, cost-side check only (QA note 14: "keep it as a second, clearly labelled line, never as
  // the headline") - payback if the customer paid the raw BOQ cost.
  const internalCostView = boqCost > 0 ? (() => {
    const s = runCustomerScenario({ ...common, capex: boqCost, escalation: a.headlineEscalation });
    return { capex: boqCost, paybackYears: s.paybackYears, paybackLabel: s.paybackLabel, label: 'Internal cost-side check only (raw BOQ cost) - not the customer case' };
  })() : null;

  return {
    model: 'brief-3.4',
    priceBasis: {
      netExclVat: pricing.netExclVat,
      vatPct: pricing.vatPct,
      vatAmt: pricing.vatAmt,
      grossInclVat: pricing.grossInclVat,
      capex,
      capexBasis: 'Final price incl VAT (year 0)',
    },
    assumptions: {
      ...a,
      sensitivityEscalations: sens,
      designKwp,
      omIncludedInEpc: a.maintenancePctOfCapex === 0,
      // Where the yield and the tariff came from (C4, C8), for the proposal's basis table.
      yieldSource: inputs.yieldSource || null,
      yieldBasis: inputs.yieldBasis || null,
      tariffSource: inputs.tariffSource || null,
      tariffNote: inputs.tariffNote || null,
      annualBillEgp: inputs.annualBillEgp || null,
      inverterReplacement,
      twoPhaseEscalation: tp || null,
    },
    performance: { annualIrradiationKwhPerM2: irradiation, performanceRatio, status: performanceRatio === null ? 'pending' : 'computed' },
    annualConsumptionKwh: annualConsumptionKwh || null,
    year1CoverageOfConsumption: annualConsumptionKwh > 0 ? headline.year1GenerationKwh / annualConsumptionKwh : null,
    headline,
    sensitivities,
    internalCostView,
  };
}

module.exports = {
  DEGRADATION_TABLE_25YR,
  runScenario,
  simplePaybackWithMonths,
  irrBisection,
  runOnGridFeasibility,
  CUSTOMER_FEASIBILITY_DEFAULTS,
  runCustomerScenario,
  runCustomerFeasibility,
  tariffFactor,
  escalationLabel,
};
