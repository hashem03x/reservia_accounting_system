'use strict';

const crypto = require('crypto');
const { CUSTOMER_INPUT_KEYS, PRICE_INPUT_KEYS, scrubMoneyText } = require('./dealEnginePermissions');

// Deal Engine 3-stage approval (26 Nov 2026) - what each approval stage actually signed, as three
// fingerprints of the calculated revision. A recalculation compares them before/after and resets
// ONLY the approvals whose underlying data changed (approvalService.js#invalidateForChanges):
//
//   technical  - the engineering inputs (design, without customer feasibility and price inputs) and
//                the BOQ's technical content (components, descriptions, units, quantities)
//                -> Stage 1 Technical, and everything after it
//   customer   - the customer / opportunity inputs (bills, consumption, tariff, escalation...)
//                -> Stage 2 Sales/BDM, and Stage 3
//   commercial - the prices: BOQ unit prices, totals and supplier sources, price inputs, the full
//                pricing stack (levers, commission, margins, final price)
//                -> Stage 3 Final Commercial only
//
// A recalculation that changes none of them invalidates nothing.

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (v && typeof v === 'object' && !v._bsontype) {
    return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  if (v && v._bsontype) return JSON.stringify(String(v));
  return JSON.stringify(v === undefined ? null : v);
}
const hash = v => crypto.createHash('sha1').update(stable(v)).digest('hex').slice(0, 16);
const round = n => (typeof n === 'number' ? Math.round(n * 100) / 100 : n ?? null);

function pick(obj, keys, include) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (keys.includes(k) === include) out[k] = v;
  return out;
}

/** The three fingerprints of a calculated revision (plain object or document). */
function fingerprints(revision) {
  const r = typeof revision.toObject === 'function' ? revision.toObject() : revision;
  const input = r.engineeringInput || {};
  const lines = r.boqLines || [];
  const technicalInput = pick(pick(input, CUSTOMER_INPUT_KEYS, false), PRICE_INPUT_KEYS, false);
  return {
    technical: hash({ input: technicalInput, lines: lines.map(l => ({ c: l.component, d: scrubMoneyText(l.description || ''), u: l.unit, q: round(l.qty) })) }),
    customer: hash(pick(input, CUSTOMER_INPUT_KEYS, true)),
    commercial: hash({
      prices: pick(input, PRICE_INPUT_KEYS, true),
      lines: lines.map(l => ({ c: l.component, p: round(l.unitPrice), t: round(l.total), s: l.priceSource || null, sc: l.supplierCode || null })),
      pricing: Object.fromEntries(Object.entries(r.pricing || {}).map(([k, v]) => [k, round(v)])),
    }),
  };
}

/** Which fingerprint changed between two calculations ({technical, customer, commercial} booleans). */
function changedParts(before, after) {
  const b = before || {};
  return {
    technical: !b.technical || b.technical !== after.technical,
    customer: !b.customer || b.customer !== after.customer,
    commercial: !b.commercial || b.commercial !== after.commercial,
  };
}

module.exports = { fingerprints, changedParts, stable };
