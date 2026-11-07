const MaterialItem = require('../../models/commercial/materialItemModel');
const ApiError = require('../../utils/apiError');

// Reservia Commercial - Mongo-backed Price Book lookups for the calculation engines. Mirrors the
// reference HTML's own `makeLookup` behaviour deliberately: throws on a missing key rather than
// defaulting to 0 (the project's explicit rule - "never silently replace a missing material price
// with zero or produce a misleading quotation").

async function getItemsByCategory(category) {
  const items = await MaterialItem.find({ category, archived: false }).lean();
  return items;
}

async function getItemByKey(key) {
  const item = await MaterialItem.findOne({ key, archived: false }).lean();
  if (!item) throw new ApiError(`Price Book item not found: "${key}"`, 400);
  return item;
}

/** Reshapes 'PV Modules' CommercialMaterialItem docs into onGridEngine.js's PV_MODULES shape. */
function toPvModuleShape(items) {
  return items.map(it => ({ brand: it.brand, model: it.model, pmaxW: it.attrs.pmaxW, vmp: it.attrs.vmp, imp: it.attrs.imp, voc: it.attrs.voc, isc: it.attrs.isc, vocTempCoeffPctPerC: it.attrs.vocTempCoeffPctPerC, maxDcV: it.attrs.maxDcV, pricePerWatt: it.attrs.pricePerWatt }));
}

/** Reshapes 'On-Grid Inverter' CommercialMaterialItem docs into onGridEngine.js's GRID_INVERTERS shape (ascending by ratedKw, as the nearest-match selector requires). */
function toGridInverterShape(items) {
  return items
    .map(it => ({ brand: it.brand, model: it.model, ratedKw: it.attrs.ratedKw, price: it.unitPrice, maxDcV: it.attrs.maxDcV, mpptMinV: it.attrs.mpptMinV, mpptMaxV: it.attrs.mpptMaxV, mpptCount: it.attrs.mpptCount, dcInputs: it.attrs.dcInputs, inputsPerMppt: it.attrs.inputsPerMppt, maxPvRecommendedKwp: it.attrs.maxPvRecommendedKwp }))
    .sort((a, b) => a.ratedKw - b.ratedKw);
}

function toDcCableShape(items) {
  return items.map(it => ({ brand: it.brand, sizeMm2: it.attrs.sizeMm2, pricePerM: it.unitPrice }));
}

function toAcBreakerShape(items) {
  return items.map(it => ({ ratingA: it.attrs.ratingA, type: it.attrs.type, price: it.unitPrice }));
}

function toAcDistributionBoardShape(items) {
  return items.map(it => ({ maxPvKwp: it.attrs.maxPvKwp, dimensionsCm: it.attrs.dimensionsCm, price: it.unitPrice }));
}

module.exports = {
  getItemsByCategory, getItemByKey,
  toPvModuleShape, toGridInverterShape, toDcCableShape, toAcBreakerShape, toAcDistributionBoardShape,
};
