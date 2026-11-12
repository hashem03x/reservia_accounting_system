'use strict';

const ApiError = require('../../utils/apiError');
const { EGYPT_REGIONS } = require('../../utils/commercial/regions');

// Deal Engine settings that are DATA, not code (Deal Engine Changes Required, 12 Nov 2026, and Spec
// Part 2). Stored on the versioned, audited pricing configuration (pricingConfigService) in two
// blocks - `engine` and `proposal` - so a Finance/MD change is logged and a revision records which
// settings it was calculated with. Every default below either keeps today's behaviour (where the
// MD has not decided yet: C1, C2) or is the value the change list gives (C3, C4, C7, C9). Values the
// documents do not give (other regions' yields, the 50/50 small-deal threshold) are left empty, never
// guessed.

// The rule set a revision is calculated with (C11). Revisions calculated before it carry no
// ruleVersion and keep their own labels ("installed kWp").
const RULE_VERSION = 'DE-2026-11-12';
const RULE_VERSION_DATE = '2026-11-12';

const ENGINE_DEFAULTS = Object.freeze({
  // C1 - MD decision pending. 'strings' = strings x 2 + 4 pieces (R74 master, today's behaviour,
  // 22 pcs on the reference deal); 'modulePairs' = ceil(modules / 2) pairs (Rev03 workbook).
  mc4: { rule: 'strings', unitPriceEgp: 40 },
  // C2 - MD decision pending. null = the Rates matrix value (85 EGP per design kWp today).
  accessoriesRateEgpPerKwp: null,
  // C3 - inverter loading: choose the smallest Price Book inverter giving DC/AC in [min, max];
  // flag below `flagBelow` or above `flagAbove` on the Design tab.
  dcAcRatio: { min: 1.1, max: 1.3, flagBelow: 1.0, flagAbove: 1.35 },
  // C4 - specific yield. Cairo measured / modelled references: 1,725 to 1,734 kWh/kWp (Spec Part 2,
  // section 2); 1,734 = NREL ATB 2024 Class 1. `byRegion` holds the other regions once the MD sets
  // them; a region without a value uses `defaultKwhPerKwp`.
  yield: {
    defaultKwhPerKwp: 1734,
    byRegion: { 'Cairo - 10th of Ramadan': 1734 },
    basis: 'Cairo reference value (NREL ATB 2024 Class 1; measured Helwan system 1,725 to 1,734 kWh/kWp); site-specific simulation on request',
  },
  // Spec Part 2: "Keep 22%. Make it a configuration value next to the levers."
  discountRate: 0.22,
  // C7 - inverter replacement in the 25-year customer case.
  inverterReplacementYear: 13,
  // C9 - fourth tariff scenario: 10% for 5 years, then 5%.
  twoPhaseEscalation: { first: 0.1, years: 5, then: 0.05 },
});

const PROPOSAL_DEFAULTS = Object.freeze({
  validityDays: 14,
  senderMailbox: 'Reservia_Sales@reservia-energy.com',
  company: {
    name: 'Reservia Integrated Energy Solutions LLC',
    registry: 'Commercial Register No. 314505, Cairo Investment Registry',
    website: 'www.reservia-energy.com',
    slogan: 'GENERATE | STORE | OPTIMIZE | SUSTAIN',
    address: 'Elite Tower, Unit M-19-3, 3rd floor, Zahraa El Maadi entrance, Maadi, Cairo',
    phones: '+20 121 189 2995 | +20 2 2522 2814',
    signatoryTitle: 'Managing Director',
  },
  inclusions:
    'Included: design, supply, installation, testing and commissioning, grid connection support, operation and maintenance during the warranty period.',
  exclusions:
    "Excluded: civil works beyond the mounting structure, utility connection fees, and any upgrade to the customer's existing electrical installation.",
  paymentTerms: {
    standard: '40% with order, 30% on delivery of modules and inverter to site, 30% on commissioning.',
    small: '50% with order, 50% on commissioning.',
    // "50 / 50 for small deals" - the threshold is not given in the documents. null = always standard.
    smallDealMaxNetEgp: null,
  },
  priceNote: 'Equipment prices are based on supplier quotations current at the date of this proposal.',
  deliveryWarranty: [
    'Delivery and installation: 6 to 8 weeks from order confirmation and advance payment, subject to equipment availability.',
    'Modules: 12-year product and 25-year linear performance warranty (manufacturer). Inverter: 5-year manufacturer warranty, extendable. Installation workmanship: 2 years by Reservia.',
    'Operation and maintenance: included during the workmanship warranty, with two preventive visits a year and remote monitoring.',
  ],
  terms: [
    'This proposal is valid for 14 days from its date. Prices may be revised after that date to reflect supplier quotations and exchange rates.',
    'The design is based on the consumption data and site information provided by the customer. A site survey before contract signature confirms the roof condition, shading and the electrical connection point.',
    "Grid connection and net metering are subject to the distribution company's approval and procedures.",
    'Title to equipment passes on full payment. Risk passes on delivery to site.',
    'Any work outside the scope in section 2 is quoted separately.',
    'This proposal is confidential and prepared for the named customer.',
  ],
});

const clone = v => JSON.parse(JSON.stringify(v));
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/** Deep-merges stored settings over the defaults (unknown keys are dropped). */
function mergeDefaults(defaults, stored) {
  const out = clone(defaults);
  if (!isObj(stored)) return out;
  for (const k of Object.keys(out)) {
    if (stored[k] === undefined) continue;
    if (isObj(out[k]) && isObj(stored[k]) && k !== 'byRegion') out[k] = mergeDefaults(out[k], stored[k]);
    else out[k] = clone(stored[k]);
  }
  return out;
}

const engineSettings = config => mergeDefaults(ENGINE_DEFAULTS, config && config.engine);
const proposalSettings = config => mergeDefaults(PROPOSAL_DEFAULTS, config && config.proposal);

function num(name, v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ApiError(`${name} must be a number between ${min} and ${max}.`, 400);
  return n;
}
const text = (v, max) => String(v ?? '').trim().slice(0, max);

/** Validates an `engine` patch against the current settings; returns the next settings. */
function validateEngine(patch, current) {
  const next = clone(current);
  if (!isObj(patch)) return next;
  if (patch.mc4) {
    if (patch.mc4.rule !== undefined) {
      if (!['strings', 'modulePairs'].includes(patch.mc4.rule)) throw new ApiError('MC4 rule must be "strings" (strings x 2 + 4) or "modulePairs" (ceil(modules / 2) pairs).', 400);
      next.mc4.rule = patch.mc4.rule;
    }
    if (patch.mc4.unitPriceEgp !== undefined) next.mc4.unitPriceEgp = num('MC4 unit price', patch.mc4.unitPriceEgp, 0, 10000);
  }
  if (patch.accessoriesRateEgpPerKwp !== undefined) {
    next.accessoriesRateEgpPerKwp = patch.accessoriesRateEgpPerKwp === null || patch.accessoriesRateEgpPerKwp === '' ? null : num('Accessories rate', patch.accessoriesRateEgpPerKwp, 0, 10000);
  }
  if (patch.dcAcRatio) {
    for (const k of ['min', 'max', 'flagBelow', 'flagAbove']) if (patch.dcAcRatio[k] !== undefined) next.dcAcRatio[k] = num(`DC/AC ${k}`, patch.dcAcRatio[k], 0.5, 2);
    const r = next.dcAcRatio;
    if (!(r.flagBelow <= r.min && r.min < r.max && r.max <= r.flagAbove)) throw new ApiError('DC/AC limits must satisfy: flag below <= min < max <= flag above.', 400);
  }
  if (patch.yield) {
    if (patch.yield.defaultKwhPerKwp !== undefined) next.yield.defaultKwhPerKwp = num('Default specific yield', patch.yield.defaultKwhPerKwp, 800, 2600);
    if (patch.yield.basis !== undefined) next.yield.basis = text(patch.yield.basis, 300);
    if (isObj(patch.yield.byRegion)) {
      const byRegion = {};
      for (const [region, v] of Object.entries(patch.yield.byRegion)) {
        if (!EGYPT_REGIONS.includes(region)) throw new ApiError(`Unknown Rates region "${region}".`, 400);
        if (v === null || v === '') continue;
        byRegion[region] = num(`Specific yield for ${region}`, v, 800, 2600);
      }
      next.yield.byRegion = byRegion;
    }
  }
  if (patch.discountRate !== undefined) next.discountRate = num('Discount rate', patch.discountRate, 0, 1);
  if (patch.inverterReplacementYear !== undefined) next.inverterReplacementYear = Math.round(num('Inverter replacement year', patch.inverterReplacementYear, 1, 25));
  if (patch.twoPhaseEscalation) {
    const t = patch.twoPhaseEscalation;
    if (t.first !== undefined) next.twoPhaseEscalation.first = num('Two-phase escalation, first rate', t.first, 0, 1);
    if (t.years !== undefined) next.twoPhaseEscalation.years = Math.round(num('Two-phase escalation, years', t.years, 1, 24));
    if (t.then !== undefined) next.twoPhaseEscalation.then = num('Two-phase escalation, later rate', t.then, 0, 1);
  }
  return next;
}

/** Validates a `proposal` patch (text blocks) against the current settings; returns the next settings. */
function validateProposal(patch, current) {
  const next = clone(current);
  if (!isObj(patch)) return next;
  if (patch.validityDays !== undefined) next.validityDays = Math.round(num('Validity days', patch.validityDays, 1, 120));
  if (patch.senderMailbox !== undefined) next.senderMailbox = text(patch.senderMailbox, 120);
  if (isObj(patch.company)) for (const k of Object.keys(next.company)) if (patch.company[k] !== undefined) next.company[k] = text(patch.company[k], 200);
  for (const k of ['inclusions', 'exclusions', 'priceNote']) if (patch[k] !== undefined) next[k] = text(patch[k], 1500);
  if (isObj(patch.paymentTerms)) {
    for (const k of ['standard', 'small']) if (patch.paymentTerms[k] !== undefined) next.paymentTerms[k] = text(patch.paymentTerms[k], 500);
    if (patch.paymentTerms.smallDealMaxNetEgp !== undefined) {
      const v = patch.paymentTerms.smallDealMaxNetEgp;
      next.paymentTerms.smallDealMaxNetEgp = v === null || v === '' ? null : num('Small deal threshold', v, 0, 1e9);
    }
  }
  for (const k of ['deliveryWarranty', 'terms']) {
    if (patch[k] === undefined) continue;
    if (!Array.isArray(patch[k])) throw new ApiError(`${k} must be a list of paragraphs.`, 400);
    const list = patch[k].map(p => text(p, 800)).filter(Boolean);
    if (k === 'terms' && (list.length < 1 || list.length > 12)) throw new ApiError('Terms and conditions need 1 to 12 clauses.', 400);
    next[k] = list;
  }
  return next;
}

/** C4: the specific yield a revision uses - a per-site override wins, else the region's configured value, else the Egypt default. */
function resolveYield(settings, region, override) {
  if (typeof override === 'number' && override > 0) return { kwhPerKwp: override, source: 'site', regionDefault: regionYield(settings, region) };
  return { kwhPerKwp: regionYield(settings, region), source: settings.yield.byRegion?.[region] ? 'region' : 'default', regionDefault: regionYield(settings, region) };
}
function regionYield(settings, region) {
  return settings.yield.byRegion?.[region] || settings.yield.defaultKwhPerKwp;
}

module.exports = {
  RULE_VERSION,
  RULE_VERSION_DATE,
  ENGINE_DEFAULTS,
  PROPOSAL_DEFAULTS,
  engineSettings,
  proposalSettings,
  validateEngine,
  validateProposal,
  resolveYield,
  regionYield,
};
