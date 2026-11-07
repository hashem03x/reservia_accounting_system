const RatesConfig = require('../../models/commercial/ratesConfigModel');
const ApiError = require('../../utils/apiError');

// Reservia Commercial - Mongo-backed Rates Matrix lookup, feeding onGridEngine.js's
// install/transport-band functions. Throws on an unmapped region/country - the project's
// explicit acceptance test: "a region missing from the Rates matrix raises an error and does not
// produce a zero."

async function getActiveRatesConfig(country) {
  const config = await RatesConfig.findOne({ country }).sort({ effectiveDate: -1 }).lean();
  if (!config) throw new ApiError(`No Rates Matrix configured for country "${country}"`, 400);
  return config;
}

/** Shapes a RatesConfig document into the plain object onGridEngine.js's catalog parameter expects. */
function toEngineCatalogShape(ratesConfig) {
  const installRatesByRegion = {};
  const transportRatesByRegion = {};
  ratesConfig.regions.forEach((region, i) => {
    installRatesByRegion[region] = ratesConfig.installRatesEgpPerKwpByRegion[i];
    transportRatesByRegion[region] = ratesConfig.transportRatesEgpByRegion[i];
  });
  return {
    EGYPT_REGIONS: ratesConfig.regions,
    INSTALL_RATES_BY_REGION: installRatesByRegion,
    TRANSPORT_RATES_BY_REGION: transportRatesByRegion,
    MOUNTING_STRUCTURE_RATES: Object.fromEntries(ratesConfig.mountingStructureRatesEgpPerKwp instanceof Map ? ratesConfig.mountingStructureRatesEgpPerKwp : Object.entries(ratesConfig.mountingStructureRatesEgpPerKwp)),
  };
}

module.exports = { getActiveRatesConfig, toEngineCatalogShape };
