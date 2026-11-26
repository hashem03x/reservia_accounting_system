'use strict';

const MaterialItem = require('../../../models/commercial/materialItemModel');
const RatesConfig = require('../../../models/commercial/ratesConfigModel');
const ApiError = require('../../../utils/apiError');
const { canonicalMaterialKey, canonicalizePart } = require('../../../utils/commercial/materialKey');
const { ENGINE_SPECS, missingSpecs } = require('../../../utils/commercial/engineSpecs');
const { assertCanAccessEnginePage } = require('../../../utils/commercial/dealEnginePermissions');
const { canonicalRegion } = require('../../../utils/commercial/regions');
const ratesMatrix = require('../ratesMatrix');
const pricingConfigService = require('../pricingConfigService');
const erpProductSync = require('./erpProductSync');
const { parseWorkbook } = require('./parseWorkbook');

// Deal Engine -> Materials -> "Import workbook". Turns a parsed workbook (parseWorkbook.js) into a
// plan against the live Price Book, shows it, and applies it on confirmation:
//   - an item already in the Price Book is UPDATED, never duplicated: matched by the workbook's own
//     Item ID (R07 "SP-00001", remembered on the item), else by the canonical brand|model|spec key,
//     else - only when it is unambiguous on both sides - by model within the same kind of item
//     (R07 writes "Jinko" where On_Grid.xlsx wrote "JinkoSolar"). Its key, brand, model and spec
//     are never rewritten (saved revisions reference the key); a changed reference price is
//     appended to priceHistory (the Price Book's own rule), technical data is merged;
//   - a new item is created - PLACEHOLDER ("needs technical data") when the calculation needs data
//     the workbook does not give, so it can never be picked by an engine half-described;
//   - archived items stay archived; rows without a price and reference-only rows are reported;
//   - optionally (separate permission each): a new Rates Matrix version when the workbook's Egypt
//     rates differ from the active one, the workbook's pricing levers as a category override (the
//     audited Pricing Config save), and ERP products for Price Book items (erpProductSync.js).
// The same file is uploaded again to apply - the plan is recomputed, so what is applied is exactly
// what the database holds at that moment (nothing is cached between the two requests).

// Kinds of item a model-only match may cross (legacy pumps were seeded under "Solar Pump Drive").
const FAMILY = {
  'Submersible Pump': doc => doc.category === 'Submersible Pump' || (doc.category === 'Solar Pump Drive' && doc.sourceSheet === 'Pump Price List'),
  'Pump Motor': doc => doc.category === 'Pump Motor',
  'PV Modules': doc => doc.category === 'PV Modules',
  'On-Grid Inverter': doc => doc.category === 'On-Grid Inverter',
  'Off-Grid Inverter': doc => doc.category === 'Off-Grid Inverter' || doc.category === 'Solar Inverter (off-grid)',
  'Solar Pump Drive': doc => doc.category === 'Solar Pump Drive' && doc.sourceSheet !== 'Pump Price List',
};

const samePrice = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const sameValue = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : JSON.stringify(a) === JSON.stringify(b));
const SAMPLE = 60;

function canManageRates(user) {
  return pricingConfigService.canManagePricingConfig(user);
}

async function buildPlan(parsed) {
  const existing = await MaterialItem.find({})
    .select('category brand model spec key keyNorm unitPrice currency attrs status archived n1 n2 sourceSheet sourceWorkbook erpProduct')
    .lean();
  const byKeyNorm = new Map();
  const byMasterId = new Map();
  const byFamilyModel = new Map();
  for (const d of existing) {
    const kn = d.keyNorm || canonicalMaterialKey(d);
    byKeyNorm.set(kn, d);
    if (d.attrs?.masterId) byMasterId.set(String(d.attrs.masterId), d);
  }
  const familyKey = (family, model) => `${family}#${canonicalizePart(model)}`;
  for (const [family, test] of Object.entries(FAMILY)) {
    for (const d of existing) {
      if (d.archived || !test(d)) continue;
      const k = familyKey(family, d.model);
      byFamilyModel.set(k, [...(byFamilyModel.get(k) || []), d]);
    }
  }
  // How many workbook rows share a family+model - a model-only match needs exactly one on each side.
  const wbFamilyCount = new Map();
  for (const it of parsed.items) {
    if (!FAMILY[it.category]) continue;
    const k = familyKey(it.category, it.model);
    wbFamilyCount.set(k, (wbFamilyCount.get(k) || 0) + 1);
  }

  const claimed = new Set();
  const seenKeys = new Set();
  const creates = [];
  const updates = [];
  const unchanged = [];
  const skipped = [...parsed.skipped];
  const archived = [];

  for (const it of parsed.items) {
    const keyNorm = canonicalMaterialKey(it);
    if (seenKeys.has(keyNorm)) {
      skipped.push({ row: it.row, sheet: it.sourceSheet, label: `${it.brand} ${it.model}`, reason: 'Same item listed twice in the workbook (first row kept)' });
      continue;
    }
    seenKeys.add(keyNorm);

    let doc = (it.masterId && byMasterId.get(it.masterId)) || byKeyNorm.get(keyNorm) || null;
    let matchedBy = doc ? (it.masterId && byMasterId.get(it.masterId) === doc ? 'item id' : 'key') : null;
    if (!doc && FAMILY[it.category]) {
      const k = familyKey(it.category, it.model);
      const candidates = (byFamilyModel.get(k) || []).filter(d => !claimed.has(String(d._id)));
      if (candidates.length === 1 && wbFamilyCount.get(k) === 1) {
        [doc] = candidates;
        matchedBy = 'model';
      }
    }
    if (doc && claimed.has(String(doc._id))) doc = null; // two workbook rows never update one item
    if (doc && doc.archived) {
      archived.push({ row: it.row, label: `${doc.brand} ${doc.model}`, category: doc.category });
      continue;
    }
    if (!doc) {
      const status = ENGINE_SPECS[it.category] && missingSpecs(it.category, it.attrs).length ? 'PLACEHOLDER' : 'Available';
      creates.push({ item: it, keyNorm, status, missing: missingSpecs(it.category, it.attrs) });
      continue;
    }
    claimed.add(String(doc._id));

    const set = {};
    const changes = [];
    if (!samePrice(doc.unitPrice, it.unitPrice)) {
      set.unitPrice = it.unitPrice;
      changes.push({ field: 'price', before: doc.unitPrice, after: it.unitPrice });
    }
    const attrs = { ...(doc.attrs || {}) };
    for (const [k, v] of Object.entries(it.attrs || {})) {
      if (k === 'pricePerWatt') continue; // re-derived below from the (possibly new) unit price
      if (!sameValue(attrs[k], v)) {
        if (k !== 'masterId') changes.push({ field: k, before: attrs[k] ?? null, after: v });
        attrs[k] = v;
        set.attrs = attrs;
      }
    }
    if (doc.category === 'PV Modules' || it.category === 'PV Modules') {
      const pmaxW = attrs.pmaxW;
      const price = set.unitPrice ?? doc.unitPrice;
      if (pmaxW > 0) {
        const ppw = Math.round((price / pmaxW) * 1e6) / 1e6;
        if (!sameValue(attrs.pricePerWatt, ppw)) {
          attrs.pricePerWatt = ppw;
          set.attrs = attrs;
        }
      }
    }
    if (doc.category !== it.category && it.category === 'Submersible Pump') {
      set.category = it.category;
      changes.push({ field: 'category', before: doc.category, after: it.category });
    }
    // The first Price Book seed stored pumps under the placeholder brand "Generic"; the workbook
    // names the real one. The key (referenced by saved revisions) stays; the matching key follows.
    if (matchedBy === 'model' && doc.brand === 'Generic' && it.brand && it.brand !== 'Generic') {
      const keyNormNext = canonicalMaterialKey({ brand: it.brand, model: doc.model, spec: doc.spec });
      if (!byKeyNorm.has(keyNormNext)) {
        set.brand = it.brand;
        set.keyNorm = keyNormNext;
        changes.push({ field: 'brand', before: doc.brand, after: it.brand });
      }
    }
    if (doc.n1 == null && it.n1 != null) set.n1 = it.n1;
    if (doc.n2 == null && it.n2 != null) set.n2 = it.n2;
    const category = set.category || doc.category;
    const missing = missingSpecs(category, attrs);
    if (doc.status === 'PLACEHOLDER' && ENGINE_SPECS[category] && !missing.length) {
      set.status = 'Available';
      changes.push({ field: 'status', before: 'PLACEHOLDER', after: 'Available' });
    }
    const meaningful = changes.length > 0;
    if (!meaningful && !set.attrs && set.n1 === undefined && set.n2 === undefined) {
      unchanged.push({ id: String(doc._id), label: `${doc.brand} ${doc.model}`, category });
      continue;
    }
    updates.push({ id: String(doc._id), doc, item: it, set, changes, matchedBy, missing, meaningful });
  }
  return { creates, updates, unchanged, skipped, archived };
}

/** Rates Matrix comparison for a workbook that carries the Egypt rates (On_Grid.xlsx). */
async function planRates(parsed, user) {
  if (!parsed.rates) return null;
  const view = await ratesMatrix.getMatrixView('Egypt');
  const active = view.active;
  const regions = Object.keys(parsed.rates.install).map(name => ({
    region: canonicalRegion(name) || name,
    install: parsed.rates.install[name],
    transport: parsed.rates.transport[name] || [],
  }));
  const body = {
    regions,
    mountingStructureRatesEgpPerKwp: { ...(active?.mountingStructureRatesEgpPerKwp || {}), ...parsed.rates.mounting },
    // Not in the workbook's rate tables - kept from the version in force (or the reference values).
    earthingRateEgpPerKwp: active?.earthingRateEgpPerKwp ?? 100,
    accessoriesRateEgpPerKwp: active?.accessoriesRateEgpPerKwp ?? 85,
    dcCableRouteMPerKwp: active?.dcCableRouteMPerKwp ?? 8,
    acCableDeratingFactor: active?.acCableDeratingFactor ?? 0.8,
    note: `Imported from ${parsed.fileName} (Material Price List: installation and transport rates)`,
  };
  const diffs = [];
  if (active) {
    for (const r of regions) {
      const cur = active.regions.find(a => a.region === r.region);
      ['install', 'transport'].forEach(kind => r[kind].forEach((v, b) => {
        const before = cur?.[kind]?.[b];
        if (!samePrice(before ?? NaN, v)) diffs.push({ region: r.region, kind, band: view.bands[b], before: before ?? null, after: v });
      }));
    }
    for (const [type, v] of Object.entries(parsed.rates.mounting)) {
      const before = active.mountingStructureRatesEgpPerKwp?.[type];
      if (!samePrice(before ?? NaN, v)) diffs.push({ region: 'Mounting structure', kind: type, band: 'per kWp', before: before ?? null, after: v });
    }
  }
  const status = !active ? 'missing' : diffs.length ? 'changed' : 'unchanged';
  return { status, diffs: diffs.slice(0, 80), diffCount: diffs.length, body, canApply: canManageRates(user) };
}

async function planPricing(parsed, user) {
  if (!parsed.pricing) return null;
  const config = await pricingConfigService.getActiveConfig();
  const current = pricingConfigService.leversFor(config, parsed.pricing.category);
  const diffs = Object.entries(parsed.pricing.levers)
    .filter(([k, v]) => !sameValue(current[k], v))
    .map(([k, v]) => ({ lever: k, before: current[k], after: v }));
  let canApply = true;
  let reason = null;
  try {
    pricingConfigService.assertCanSavePolicyChange(user, config);
  } catch (e) {
    canApply = false;
    reason = e.message;
  }
  return { category: parsed.pricing.category, levers: parsed.pricing.levers, current, diffs, canApply, reason };
}

function summarize(plan) {
  const byCategory = {};
  const bump = (cat, k) => {
    byCategory[cat] = byCategory[cat] || { category: cat, create: 0, update: 0, unchanged: 0, needsData: 0 };
    byCategory[cat][k] += 1;
  };
  plan.creates.forEach(c => {
    bump(c.item.category, 'create');
    if (c.status === 'PLACEHOLDER') bump(c.item.category, 'needsData');
  });
  plan.updates.forEach(u => bump(u.set.category || u.doc.category, 'update'));
  plan.unchanged.forEach(u => bump(u.category, 'unchanged'));
  const skippedByReason = {};
  plan.skipped.forEach(s => { skippedByReason[s.reason] = (skippedByReason[s.reason] || 0) + 1; });
  return {
    create: plan.creates.length,
    update: plan.updates.length,
    priceChanges: plan.updates.filter(u => u.changes.some(c => c.field === 'price')).length,
    unchanged: plan.unchanged.length,
    skipped: plan.skipped.length,
    archived: plan.archived.length,
    needsData: plan.creates.filter(c => c.status === 'PLACEHOLDER').length,
    byCategory: Object.values(byCategory).sort((a, b) => a.category.localeCompare(b.category)),
    skippedByReason: Object.entries(skippedByReason).map(([reason, count]) => ({ reason, count })),
    samples: {
      create: plan.creates.slice(0, SAMPLE).map(c => ({ category: c.item.category, brand: c.item.brand, model: c.item.model, spec: c.item.spec, unitPrice: c.item.unitPrice, unit: c.item.unit, status: c.status, missing: c.missing, row: c.item.row })),
      update: plan.updates.filter(u => u.meaningful).slice(0, SAMPLE).map(u => ({ category: u.set.category || u.doc.category, brand: u.doc.brand, model: u.doc.model, matchedBy: u.matchedBy, changes: u.changes, row: u.item.row })),
      skipped: plan.skipped.slice(0, SAMPLE),
      archived: plan.archived.slice(0, SAMPLE),
    },
  };
}

/** Parses and plans - nothing is written. */
async function previewImport(file, { user, roles }) {
  assertCanAccessEnginePage(roles, 'materials', 'edit');
  const parsed = parseWorkbook(file);
  const plan = await buildPlan(parsed);
  const [rates, pricing, erp] = await Promise.all([planRates(parsed, user), planPricing(parsed, user), erpProductSync.status(user)]);
  return {
    workbook: { fileName: parsed.fileName, kind: parsed.kind, title: parsed.title },
    notes: parsed.notes,
    items: summarize(plan),
    rates: rates && { status: rates.status, diffs: rates.diffs, diffCount: rates.diffCount, canApply: rates.canApply },
    pricing,
    erp,
  };
}

async function writeItems(plan, user, fileName) {
  const now = new Date();
  const ops = [];
  for (const c of plan.creates) {
    const it = c.item;
    ops.push({
      insertOne: {
        document: {
          category: it.category, brand: it.brand, model: it.model, spec: it.spec || '', unit: it.unit, n1: it.n1, n2: it.n2, attrs: it.attrs,
          unitPrice: it.unitPrice, currency: 'EGP', status: c.status, sourceWorkbook: fileName, sourceSheet: it.sourceSheet,
          effectiveDate: now, referenceCheckedAt: now, key: `${it.brand} | ${it.model} | ${it.spec || ''}`, keyNorm: c.keyNorm,
          priceHistory: [{ price: it.unitPrice, currency: 'EGP', effectiveDate: now, changedBy: user._id }], createdBy: user._id,
          archived: false, supplierPrices: [], erpProduct: null,
        },
      },
    });
  }
  for (const u of plan.updates) {
    const set = { ...u.set, referenceCheckedAt: now };
    const update = { $set: set };
    if (u.set.unitPrice !== undefined) {
      set.effectiveDate = now;
      update.$push = { priceHistory: { price: u.set.unitPrice, currency: 'EGP', effectiveDate: now, changedBy: user._id } };
    }
    ops.push({ updateOne: { filter: { _id: u.doc._id, archived: false }, update } });
  }
  let inserted = 0;
  let modified = 0;
  const errors = [];
  for (let i = 0; i < ops.length; i += 500) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await MaterialItem.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      inserted += res.insertedCount || 0;
      modified += res.modifiedCount || 0;
    } catch (err) {
      // ordered:false - the rest of the batch is written; report what failed (e.g. a duplicate key
      // created by someone else between preview and import).
      inserted += err.result?.insertedCount || err.insertedCount || 0;
      modified += err.result?.modifiedCount || 0;
      for (const we of err.writeErrors || []) errors.push(we.errmsg || we.err?.errmsg || String(we));
      if (!err.writeErrors) throw err;
    }
  }
  return { inserted, modified, errors: errors.slice(0, 20), errorCount: errors.length };
}

/**
 * Applies the import. `options`: { rates, pricing, erpProducts } (booleans) - each needs its own
 * permission; asking for one the user may not do is refused before anything is written.
 */
async function applyImport(file, options, { user, roles }) {
  assertCanAccessEnginePage(roles, 'materials', 'edit');
  const parsed = parseWorkbook(file);
  const opts = { rates: !!options?.rates, pricing: !!options?.pricing, erpProducts: !!options?.erpProducts };
  const [rates, pricing, erp] = await Promise.all([planRates(parsed, user), planPricing(parsed, user), erpProductSync.status(user)]);
  if (opts.rates && rates && !rates.canApply) throw new ApiError('Only a Pricing Config manager (Commercial MD, Sales and Commercial Director or ERP admin) can update the Rates Matrix.', 403);
  if (opts.pricing && pricing && !pricing.canApply) throw new ApiError(pricing.reason || 'You may not change the pricing configuration.', 403);
  if (opts.erpProducts && !erp.canApply) throw new ApiError(erp.reason, 403);

  const plan = await buildPlan(parsed);
  const written = await writeItems(plan, user, parsed.fileName);
  const result = { items: { ...summarize(plan), written }, rates: null, pricing: null, erp: null };
  // C24: open revisions that use an item whose price this import changed are flagged to recalculate.
  const repriced = plan.updates.filter(u => u.set.unitPrice !== undefined || (u.doc.category === 'PV Modules' && u.set.attrs !== undefined)).map(u => ({ key: u.doc.key, model: u.doc.model }));
  // eslint-disable-next-line global-require
  if (repriced.length) result.items.flaggedRevisions = await require('../priceListUploadService').flagOpenRevisions(repriced);

  if (opts.rates && rates && rates.status !== 'unchanged') {
    const version = await RatesConfig.create({ ...ratesMatrix.validateMatrix('Egypt', rates.body), source: 'workbook', createdBy: user._id });
    result.rates = { created: true, effectiveDate: version.effectiveDate, diffCount: rates.diffCount };
  } else if (rates) {
    result.rates = { created: false, status: rates.status };
  }

  if (opts.pricing && pricing && pricing.diffs.length) {
    const config = await pricingConfigService.getActiveConfig();
    const overrides = { ...(config.categoryOverrides || {}) };
    overrides[pricing.category] = { ...(overrides[pricing.category] || {}), ...pricing.levers };
    await pricingConfigService.updateConfig(
      { categoryOverrides: overrides, note: `${pricing.category} levers imported from ${parsed.fileName} (Cost Summary)` },
      { userId: user._id, userName: user.name || null }
    );
    result.pricing = { applied: true, category: pricing.category, diffs: pricing.diffs };
  } else if (pricing) {
    result.pricing = { applied: false, diffs: pricing.diffs };
  }

  if (opts.erpProducts) result.erp = await erpProductSync.apply(user);
  return result;
}

module.exports = { previewImport, applyImport, buildPlan };
