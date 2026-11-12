'use strict';

const ApiError = require('../../utils/apiError');
const PricingConfig = require('../../models/commercial/pricingConfigModel');
const { BRIEF_DEFAULT_LEVERS, LEVER_KEYS } = require('./commercialPricingService');
const { CATEGORIES } = require('../../utils/commercial/constants');
const { engineSettings, proposalSettings, validateEngine, validateProposal } = require('./dealEngineSettings');

const { Audit } = PricingConfig;
const KEY = 'default';

// Upper bounds a Finance edit is checked against - generous, but they stop an obvious typo (19
// entered as 1900%) from reaching a quote. Fractions (0.19 = 19%).
const LEVER_MAX = { overheadPct: 0.5, contingencyPct: 0.25, profitPct: 0.5, salesBonusPct: 0.5, engineeringIncentivePct: 0.5, categoryAdditionPct: 0.5, discountPct: 0.5 };
const VAT_MAX = 0.3;

/** The live configuration, created from the brief section 3.3 defaults on first use. */
async function getActiveConfig() {
  const existing = await PricingConfig.findOne({ key: KEY }).lean();
  if (existing) return normalize(existing);
  try {
    await PricingConfig.create({ key: KEY, version: 1, levers: { ...BRIEF_DEFAULT_LEVERS }, note: 'Initial defaults - Developer Brief section 3.3' });
  } catch (err) {
    if (err?.code !== 11000) throw err; // a concurrent first call seeded it
  }
  return normalize(await PricingConfig.findOne({ key: KEY }).lean());
}

function normalize(doc) {
  const vat = doc.vatPctByCountry instanceof Map ? Object.fromEntries(doc.vatPctByCountry) : { ...(doc.vatPctByCountry || {}) };
  return { ...doc, vatPctByCountry: vat, categoryOverrides: doc.categoryOverrides || {}, engine: engineSettings(doc), proposal: proposalSettings(doc) };
}

/** Levers a NEW revision of `category` starts with. */
function leversFor(config, category) {
  const base = {};
  for (const k of LEVER_KEYS) base[k] = config.levers[k];
  const override = config.categoryOverrides?.[category] || {};
  for (const k of LEVER_KEYS) if (typeof override[k] === 'number') base[k] = override[k];
  return base;
}

/** VAT fraction for a country, or undefined when the configuration has none. */
function vatFor(config, country) {
  const v = config.vatPctByCountry?.[country];
  return typeof v === 'number' ? v : undefined;
}

function assertFraction(name, value, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new ApiError(`${name} must be a percentage between 0% and ${Math.round(max * 100)}%.`, 400);
  }
}

/**
 * Finance update. `patch` uses fractions: { levers: {...}, vatPctByCountry: {...}, categoryOverrides, discountAuthorityPct, note }.
 * Increments the version and appends an audit row with the before/after values. Never touches revisions.
 */
async function updateConfig(patch, { userId = null, userName = null } = {}) {
  const current = await getActiveConfig();
  const next = {
    levers: { ...current.levers },
    vatPctByCountry: { ...current.vatPctByCountry },
    categoryOverrides: { ...current.categoryOverrides },
    discountAuthorityPct: current.discountAuthorityPct,
    engine: current.engine,
    proposal: current.proposal,
  };
  if (patch.engine !== undefined) next.engine = validateEngine(patch.engine, current.engine);
  if (patch.proposal !== undefined) next.proposal = validateProposal(patch.proposal, current.proposal);
  if (patch.levers && typeof patch.levers === 'object') {
    for (const k of LEVER_KEYS) {
      if (patch.levers[k] === undefined) continue;
      const v = Number(patch.levers[k]);
      assertFraction(k, v, LEVER_MAX[k]);
      next.levers[k] = v;
    }
  }
  if (patch.vatPctByCountry && typeof patch.vatPctByCountry === 'object') {
    for (const [country, raw] of Object.entries(patch.vatPctByCountry)) {
      const name = String(country).trim().slice(0, 60);
      if (!name) continue;
      if (raw === null) {
        delete next.vatPctByCountry[name];
        continue;
      }
      const v = Number(raw);
      assertFraction(`VAT for ${name}`, v, VAT_MAX);
      next.vatPctByCountry[name] = v;
    }
  }
  if (patch.categoryOverrides && typeof patch.categoryOverrides === 'object') {
    const overrides = {};
    for (const [category, levers] of Object.entries(patch.categoryOverrides)) {
      if (!CATEGORIES.includes(category)) throw new ApiError(`Unknown category "${category}".`, 400);
      if (!levers || typeof levers !== 'object') continue;
      const clean = {};
      for (const k of LEVER_KEYS) {
        if (levers[k] === undefined || levers[k] === null || levers[k] === '') continue;
        const v = Number(levers[k]);
        assertFraction(`${category} ${k}`, v, LEVER_MAX[k]);
        clean[k] = v;
      }
      if (Object.keys(clean).length) overrides[category] = clean;
    }
    next.categoryOverrides = overrides;
  }
  if (patch.discountAuthorityPct !== undefined) {
    const v = Number(patch.discountAuthorityPct);
    assertFraction('Discount authority', v, 0.5);
    next.discountAuthorityPct = v;
  }

  const before = { levers: current.levers, vatPctByCountry: current.vatPctByCountry, categoryOverrides: current.categoryOverrides, discountAuthorityPct: current.discountAuthorityPct, engine: current.engine, proposal: current.proposal };
  const version = current.version + 1;
  const note = String(patch.note || '').trim().slice(0, 500);
  const updated = await PricingConfig.findOneAndUpdate(
    { key: KEY, version: current.version }, // optimistic concurrency: two simultaneous edits can't both win
    { $set: { ...next, version, note, updatedBy: userId, updatedByName: userName } },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError('The pricing configuration was changed by someone else - reload and try again.', 409);
  await Audit.create({ configKey: KEY, version, before, after: next, note, changedBy: userId, changedByName: userName });
  return normalize(updated);
}

async function getHistory(limit = 50) {
  return Audit.find({ configKey: KEY }).sort({ version: -1 }).limit(Math.min(Math.max(limit, 1), 200)).lean();
}

/**
 * Who may change the configuration: Commercial MD / Commercial Director, or an ERP admin (the
 * finance/accounting system's administrators). Server-side, from the DB-loaded memberships only.
 */
function canManagePricingConfig(user) {
  const memberships = Array.isArray(user?.systemMemberships) ? user.systemMemberships : [];
  return memberships.some(
    m => m.isActive && ((m.system === 'COMMERCIAL' && ['md', 'commercial_director'].includes(m.role)) || (m.system === 'ERP' && m.role === 'admin'))
  );
}

module.exports = { getActiveConfig, leversFor, vatFor, updateConfig, getHistory, canManagePricingConfig, LEVER_MAX, VAT_MAX };
