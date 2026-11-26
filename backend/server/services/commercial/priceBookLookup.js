const MaterialItem = require('../../models/commercial/materialItemModel');
const ApiError = require('../../utils/apiError');
const { effectivePrice } = require('./supplierPricing');
const { missingSpecs } = require('../../utils/commercial/engineSpecs');

// Reservia Commercial - Mongo-backed Price Book lookups for the calculation engines. Mirrors the
// reference HTML's own `makeLookup` behaviour deliberately: throws on a missing key rather than
// defaulting to 0 (the project's explicit rule - "never silently replace a missing material price
// with zero or produce a misleading quotation").

/** Current supplier statuses and names (Deal Engine C19) - one small read per lookup. */
async function supplierStatuses() {
  // eslint-disable-next-line global-require
  const Supplier = require('../../models/commercial/supplierModel');
  const rows = await Supplier.find({}).select('_id status code legalName').lean();
  return new Map(rows.map(r => [String(r._id), r]));
}

/** The active Pricing Configuration's exchange rates (EGP per USD/EUR/CNY), used to convert foreign supplier quotes at calculation time. */
async function currentFxRates() {
  // eslint-disable-next-line global-require
  const pricingConfigService = require('./pricingConfigService');
  // eslint-disable-next-line global-require
  const { engineSettings } = require('./dealEngineSettings');
  return engineSettings(await pricingConfigService.getActiveConfig()).fxRatesEgp || {};
}

/**
 * Applies the effective price (supplierPricing.effectivePrice: lowest Approved supplier price, else
 * Conditional with a flag, else the Reference price) to an item: unitPrice becomes the price the BOQ
 * uses, `priceInfo` says where it came from. PV modules are priced per watt in the engine, so their
 * per-watt price follows a supplier's per-piece price.
 */
function withEffectivePrice(item, suppliers, now = new Date(), fxRates = null) {
  const info = effectivePrice(item, suppliers, now, fxRates);
  const out = { ...item, unitPrice: info.unitPrice, priceInfo: info };
  if (info.source === 'supplier' && item.attrs && item.attrs.pmaxW > 0 && item.attrs.pricePerWatt != null) {
    out.attrs = { ...item.attrs, pricePerWatt: info.unitPrice / item.attrs.pmaxW };
  }
  return out;
}

async function getItemsByCategory(category) {
  const [items, suppliers, fx] = await Promise.all([MaterialItem.find({ category, archived: false, status: { $ne: 'PLACEHOLDER' } }).lean(), supplierStatuses(), currentFxRates()]);
  const now = new Date();
  return items.map(it => withEffectivePrice(it, suppliers, now, fx));
}

async function getItemByKey(key) {
  const item = await MaterialItem.findOne({ key, archived: false }).lean();
  if (!item) throw new ApiError(`Price Book item not found: "${key}"`, 400);
  const [suppliers, fx] = await Promise.all([supplierStatuses(), currentFxRates()]);
  return withEffectivePrice(item, suppliers, new Date(), fx);
}

/**
 * Agriculture Pumping: the pump and motor are SELECTED from the engineering reference curves
 * (catalogData/pumpingCatalog.js - flow/head/casing tables, not a priced catalog) but PRICED from the
 * live Price Book item of the same model, so supplier price lists and Materials edits reach the BOQ.
 * The seeded key is tried first (keys never change), then a unique model match in the given
 * categories. Returns null when the Price Book has no single item for that model.
 */
async function findPricedItem({ key, categories, model }) {
  let item = key ? await MaterialItem.findOne({ key, archived: false }).lean() : null;
  if (!item) {
    const found = await MaterialItem.find({ category: { $in: categories }, model, archived: false }).limit(2).lean();
    item = found.length === 1 ? found[0] : null;
  }
  if (!item) return null;
  const [suppliers, fx] = await Promise.all([supplierStatuses(), currentFxRates()]);
  return withEffectivePrice(item, suppliers, new Date(), fx);
}

/**
 * The PV module an engineering input names, from the engine catalog (toPvModuleShape). When it is not
 * usable, says WHY instead of a bare "not found": the engineering form lists every non-archived
 * module, but a module a supplier upload created stays PLACEHOLDER (no electrical data yet) and is
 * kept out of the engine catalog until it is completed on Deal Engine -> Materials.
 */
async function resolvePvModule(modules, model) {
  const name = String(model || '').trim();
  if (!name) throw new ApiError('Choose the PV module.', 400);
  const found = modules.find(m => m.model === name);
  const gaps = found ? missingSpecs('PV Modules', found) : null;
  if (found && !gaps.length) return found;
  const item = found ? null : await MaterialItem.findOne({ category: 'PV Modules', model: name }).sort({ archived: 1 }).lean();
  if (!found && !item) throw new ApiError(`PV module "${name}" is not in the Price Book. Choose a module from the list (Deal Engine -> Materials shows the catalog).`, 400);
  if (item && item.archived) throw new ApiError(`PV module "${name}" was archived in the Price Book. Choose another module.`, 400);
  const missing = gaps || missingSpecs('PV Modules', item.attrs);
  throw new ApiError(
    `PV module "${name}" cannot be used in a calculation yet: its electrical data is incomplete${missing.length ? ` (missing: ${missing.join(', ')})` : ' (it is still marked PLACEHOLDER)'}. ` +
    'A Materials editor (MD, Sales and Commercial Director or Procurement) can complete it on Deal Engine -> Materials, then calculate again.',
    400
  );
}

/** Reshapes 'PV Modules' CommercialMaterialItem docs into onGridEngine.js's PV_MODULES shape. */
function toPvModuleShape(items) {
  return items.map(it => ({ brand: it.brand, model: it.model, pmaxW: it.attrs.pmaxW, vmp: it.attrs.vmp, imp: it.attrs.imp, voc: it.attrs.voc, isc: it.attrs.isc, vocTempCoeffPctPerC: it.attrs.vocTempCoeffPctPerC, maxDcV: it.attrs.maxDcV, pricePerWatt: it.attrs.pricePerWatt, key: it.key, priceInfo: it.priceInfo }));
}

/** Reshapes 'On-Grid Inverter' CommercialMaterialItem docs into onGridEngine.js's GRID_INVERTERS shape (ascending by ratedKw, as the nearest-match selector requires). */
function toGridInverterShape(items) {
  return items
    .map(it => ({ key: it.key, priceInfo: it.priceInfo, brand: it.brand, model: it.model, ratedKw: it.attrs.ratedKw, price: it.unitPrice, maxDcV: it.attrs.maxDcV, mpptMinV: it.attrs.mpptMinV, mpptMaxV: it.attrs.mpptMaxV, mpptCount: it.attrs.mpptCount, dcInputs: it.attrs.dcInputs, inputsPerMppt: it.attrs.inputsPerMppt, maxPvRecommendedKwp: it.attrs.maxPvRecommendedKwp }))
    .sort((a, b) => a.ratedKw - b.ratedKw);
}

function toDcCableShape(items) {
  return items.map(it => ({ brand: it.brand, sizeMm2: it.attrs.sizeMm2, pricePerM: it.unitPrice, key: it.key, priceInfo: it.priceInfo }));
}

function toAcBreakerShape(items) {
  return items.map(it => ({ ratingA: it.attrs.ratingA, type: it.attrs.type, price: it.unitPrice, key: it.key, priceInfo: it.priceInfo }));
}

function toAcDistributionBoardShape(items) {
  return items.map(it => ({ maxPvKwp: it.attrs.maxPvKwp, dimensionsCm: it.attrs.dimensionsCm, price: it.unitPrice, key: it.key, priceInfo: it.priceInfo }));
}

module.exports = {
  getItemsByCategory, getItemByKey, findPricedItem, withEffectivePrice, supplierStatuses, currentFxRates, resolvePvModule,
  toPvModuleShape, toGridInverterShape, toDcCableShape, toAcBreakerShape, toAcDistributionBoardShape,
};
