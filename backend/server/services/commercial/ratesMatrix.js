const RatesConfig = require('../../models/commercial/ratesConfigModel');
const ApiError = require('../../utils/apiError');
const { canonicalRegion } = require('../../utils/commercial/regions');

// Reservia Commercial - Mongo-backed Rates Matrix lookup, feeding onGridEngine.js's
// install/transport-band functions. Throws on an unmapped region/country - the project's
// explicit acceptance test: "a region missing from the Rates matrix raises an error and does not
// produce a zero."

async function getActiveRatesConfig(country) {
  const config = await RatesConfig.findOne({ country }).sort({ effectiveDate: -1 }).lean();
  if (!config) throw new ApiError(`No Rates Matrix configured for country "${country}"`, 400);
  return config;
}

/**
 * Shapes a RatesConfig document into the plain object onGridEngine.js's catalog parameter expects.
 * Region rows are keyed by their CANONICAL name (utils/commercial/regions.js) so a row stored under
 * the workbook's long label (e.g. "... - Wadi El Natrun - Alexandria") is found by the exact key the
 * project's Region dropdown saves. The standing per-kWp rates stored on the config (earthing,
 * accessories, DC-cable route allowance) are passed through so Finance/admin edits to the Rates
 * matrix actually reach the BOQ instead of being shadowed by constants in the engine.
 */
function toEngineCatalogShape(ratesConfig) {
  const installRatesByRegion = {};
  const transportRatesByRegion = {};
  ratesConfig.regions.forEach((region, i) => {
    const key = canonicalRegion(region) || region;
    installRatesByRegion[key] = ratesConfig.installRatesEgpPerKwpByRegion[i];
    transportRatesByRegion[key] = ratesConfig.transportRatesEgpByRegion[i];
  });
  return {
    EGYPT_REGIONS: ratesConfig.regions.map(r => canonicalRegion(r) || r),
    INSTALL_RATES_BY_REGION: installRatesByRegion,
    TRANSPORT_RATES_BY_REGION: transportRatesByRegion,
    MOUNTING_STRUCTURE_RATES: Object.fromEntries(ratesConfig.mountingStructureRatesEgpPerKwp instanceof Map ? ratesConfig.mountingStructureRatesEgpPerKwp : Object.entries(ratesConfig.mountingStructureRatesEgpPerKwp)),
    EARTHING_RATE_EGP_PER_KWP: ratesConfig.earthingRateEgpPerKwp ?? null,
    ACCESSORIES_RATE_EGP_PER_KWP: ratesConfig.accessoriesRateEgpPerKwp ?? null,
    DC_CABLE_ROUTE_M_PER_KWP: ratesConfig.dcCableRouteMPerKwp ?? null,
  };
}

/** Installation EGP/kWp for a region + size band (1-5) - used by the Off-Grid engine (QA U7). Throws on an unknown region. */
function installRateFor(catalogShape, region, band) {
  const row = catalogShape.INSTALL_RATES_BY_REGION[canonicalRegion(region) || region];
  if (!row) throw new ApiError(`Region "${region}" is not in the installation Rates matrix`, 400);
  return row[band - 1];
}

module.exports = { getActiveRatesConfig, toEngineCatalogShape, installRateFor };
