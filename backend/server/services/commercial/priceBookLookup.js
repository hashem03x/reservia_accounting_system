const MaterialItem = require('../../models/commercial/materialItemModel');
const ApiError = require('../../utils/apiError');
const { effectivePrice } = require('./supplierPricing');
const { missingSpecs } = require('../../utils/commercial/engineSpecs');

// Reservia Commercial - Mongo-backed Price Book lookups for the calculation engines. Mirrors the
// reference HTML's own `makeLookup` behaviour deliberately: throws on a missing key rather than
// defaulting to 0 (the project's explicit rule - "never silently replace a missing material price
// with zero or produce a misleading quotation").

/** Current supplier statuses (Deal Engine C19) - one small read per lookup. */
async function supplierStatuses() {
  // eslint-disable-next-line global-require
  const Supplier = require('../../models/commercial/supplierModel');
  const rows = await Supplier.find({}).select('_id status code').lean();
  return new Map(rows.map(r => [String(r._id), r]));
}

/**
 * Applies the effective price (supplierPricing.effectivePrice: lowest Approved supplier price, else
 * Conditional with a flag, else the Reference price) to an item: unitPrice becomes the price the BOQ
 * uses, `priceInfo` says where it came from. PV modules are priced per watt in the engine, so their
 * per-watt price follows a supplier's per-piece price.
 */
function withEffectivePrice(item, suppliers, now = new Date()) {
  const info = effectivePrice(item, suppliers, now);
  const out = { ...item, unitPrice: info.unitPrice, priceInfo: info };
  if (info.source === 'supplier' && item.attrs && item.attrs.pmaxW > 0 && item.attrs.pricePerWatt != null) {
    out.attrs = { ...item.attrs, pricePerWatt: info.unitPrice / item.attrs.pmaxW };
  }
  return out;
}

async function getItemsByCategory(category) {
  const [items, suppliers] = await Promise.all([MaterialItem.find({ category, archived: false, status: { $ne: 'PLACEHOLDER' } }).lean(), supplierStatuses()]);
  const now = new Date();
  return items.map(it => withEffectivePrice(it, suppliers, now));
}

async function getItemByKey(key) {
  const item = await MaterialItem.findOne({ key, archived: false }).lean();
  if (!item) throw new ApiError(`Price Book item not found: "${key}"`, 400);
  return withEffectivePrice(item, await supplierStatuses());
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
  getItemsByCategory, getItemByKey, withEffectivePrice, supplierStatuses, resolvePvModule,
  toPvModuleShape, toGridInverterShape, toDcCableShape, toAcBreakerShape, toAcDistributionBoardShape,
};
