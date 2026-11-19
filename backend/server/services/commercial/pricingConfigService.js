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

const SALES_LIMIT_KEYS = ['categoryAdditionDefaultPct', 'categoryAdditionMinPct', 'categoryAdditionMaxPct', 'discountMaxPct', 'concessionCeilingPct', 'gpFloorPct'];

/** R7: the Sales-limits row for `category`, falling back to the default row for any field the sector has no override of its own for. */
function salesLimitsFor(config, category) {
  const base = { ...config.salesLimits };
  const override = config.salesLimitsBySector?.[category] || {};
  for (const k of SALES_LIMIT_KEYS) if (typeof override[k] === 'number') base[k] = override[k];
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
  // R8: "a save needs a reason" - previously optional (defaulted to an empty string). Checked here,
  // not just in the controller/validator, so a direct API call can't skip it either.
  const note = String(patch.note || '').trim().slice(0, 500);
  if (!note) throw new ApiError('A reason is required to save a pricing configuration change.', 400);

  const current = await getActiveConfig();
  const next = {
    levers: { ...current.levers },
    vatPctByCountry: { ...current.vatPctByCountry },
    categoryOverrides: { ...current.categoryOverrides },
    discountAuthorityPct: current.discountAuthorityPct,
    salesLimits: { ...current.salesLimits },
    salesLimitsBySector: { ...current.salesLimitsBySector },
    requireMdApprovalForPolicyChange: current.requireMdApprovalForPolicyChange,
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
  // R6/R7: Sales limits - min/max/ceiling may be explicitly cleared back to "not set" (null), since
  // an unset limit is a valid, intentional state (R9 skips it rather than enforcing a guess), unlike
  // every other fraction field above where null/omitted just means "leave unchanged".
  if (patch.salesLimits && typeof patch.salesLimits === 'object') {
    const unboundedKeys = ['categoryAdditionMinPct', 'categoryAdditionMaxPct', 'concessionCeilingPct'];
    for (const k of SALES_LIMIT_KEYS) {
      if (patch.salesLimits[k] === undefined) continue;
      if (patch.salesLimits[k] === null) {
        if (unboundedKeys.includes(k)) { next.salesLimits[k] = null; continue; }
        throw new ApiError(`${k} cannot be cleared - it always needs a real value.`, 400);
      }
      const v = Number(patch.salesLimits[k]);
      assertFraction(k, v, 1);
      next.salesLimits[k] = v;
    }
    if (
      next.salesLimits.categoryAdditionMinPct != null &&
      next.salesLimits.categoryAdditionMaxPct != null &&
      next.salesLimits.categoryAdditionMinPct > next.salesLimits.categoryAdditionMaxPct
    ) {
      throw new ApiError('Category addition minimum cannot be above the maximum.', 400);
    }
  }
  if (patch.salesLimitsBySector && typeof patch.salesLimitsBySector === 'object') {
    const overrides = {};
    for (const [category, limits] of Object.entries(patch.salesLimitsBySector)) {
      if (!CATEGORIES.includes(category)) throw new ApiError(`Unknown category "${category}".`, 400);
      if (!limits || typeof limits !== 'object') continue;
      const clean = {};
      for (const k of SALES_LIMIT_KEYS) {
        if (limits[k] === undefined || limits[k] === null || limits[k] === '') continue;
        const v = Number(limits[k]);
        assertFraction(`${category} ${k}`, v, 1);
        clean[k] = v;
      }
      if (Object.keys(clean).length) overrides[category] = clean;
    }
    next.salesLimitsBySector = overrides;
  }
  if (patch.requireMdApprovalForPolicyChange !== undefined) {
    next.requireMdApprovalForPolicyChange = !!patch.requireMdApprovalForPolicyChange;
  }

  const before = {
    levers: current.levers, vatPctByCountry: current.vatPctByCountry, categoryOverrides: current.categoryOverrides,
    discountAuthorityPct: current.discountAuthorityPct, salesLimits: current.salesLimits, salesLimitsBySector: current.salesLimitsBySector,
    requireMdApprovalForPolicyChange: current.requireMdApprovalForPolicyChange, engine: current.engine, proposal: current.proposal,
  };
  const version = current.version + 1;
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

/**
 * R8: "MD approval of a policy change is optional; build it as a setting (off by default)."
 * canManagePricingConfig above stays the base gate (md/commercial_director/ERP admin may open and
 * save the page at all); when the config's own requireMdApprovalForPolicyChange flag is on, this
 * additionally narrows an actual SAVE to the Commercial MD (or ERP admin) only - a Commercial
 * Director can still view everything but a save is refused with a clear reason.
 */
function assertCanSavePolicyChange(user, config) {
  if (!canManagePricingConfig(user)) {
    throw new ApiError('Only Finance (ERP admin), the Commercial Director or the MD can change the pricing configuration.', 403);
  }
  if (!config.requireMdApprovalForPolicyChange) return;
  const memberships = Array.isArray(user?.systemMemberships) ? user.systemMemberships : [];
  const isMdOrAdmin = memberships.some(m => m.isActive && ((m.system === 'COMMERCIAL' && m.role === 'md') || (m.system === 'ERP' && m.role === 'admin')));
  if (!isMdOrAdmin) {
    throw new ApiError('This pricing configuration requires MD approval for any change (a setting on this page) - only the Managing Director can save it.', 403);
  }
}

module.exports = {
  getActiveConfig, leversFor, salesLimitsFor, vatFor, updateConfig, getHistory,
  canManagePricingConfig, assertCanSavePolicyChange, LEVER_MAX, VAT_MAX, SALES_LIMIT_KEYS,
};
