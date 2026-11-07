const ApiError = require('../../utils/apiError');
const onGrid = require('./onGridEngine');
const onGridFeasibility = require('./onGridFeasibility');
const utility = require('./utilityEngine');
const offGrid = require('./offGridEngine');
const offGridFeasibility = require('./offGridFeasibility');
const pumping = require('./pumpingEngine');
const onGridCatalogData = require('./catalogData/onGridCatalog');
const pumpingCatalogData = require('./catalogData/pumpingCatalog');
const pumpingExtras = require('./catalogData/pumpingExtras');
const priceBook = require('./priceBookLookup');
const ratesMatrix = require('./ratesMatrix');
const pricingService = require('./commercialPricingService');

// Reservia Commercial - orchestrates "which engine(s) does this project category need, and how
// do their outputs become one priced BOQ." Pulls prices/specs from the live Price Book
// (priceBookLookup.js) and Rates Matrix (ratesMatrix.js) - never a hardcoded catalog - then hands
// the result to commercialPricingService.js for the commercial markup layer.
//
// Manual BOQ-line overrides are merged on top of the freshly auto-calculated lines by matching on
// `component`: an override replaces `qty`/`unitPrice` but the freshly recalculated auto values are
// kept alongside as `autoQty`/`autoUnitPrice` so an override is visible and never silently
// destroys the underlying calculation (the project's own explicit rule).
//
// Every *Engine.js module numbers its own lines with `no` (the ORIGINAL item number from that
// line's source BOQ sheet, e.g. On_Grid.xlsx's own 1,2,...,9,11,12,13,14 - note "10" is skipped
// on purpose there, matching the sheet's own blank/merged row; see onGridEngine.js's header
// comment). `CommercialRevision.boqLines` (models/commercial/commercialRevisionModel.js) stores
// that same number under the schema's required `lineNo` field instead - `no` is a plain-object
// convenience inside the engines, `lineNo` is the persisted/schema name. This is the ONE place
// that rename happens, since every category's lines flow through here before being handed to
// revisionService.js - fixing it anywhere else (or in each engine) would either miss a category
// or duplicate the mapping.
function applyManualOverrides(lines, overridesByComponent = {}) {
  return lines.map(({ no, ...line }) => {
    const lineNo = line.lineNo ?? no;
    const override = overridesByComponent[line.component];
    if (!override) return { ...line, lineNo, autoQty: null, autoUnitPrice: null, source: line.source || 'auto' };
    const qty = override.qty ?? line.qty;
    const unitPrice = override.unitPrice ?? line.unitPrice;
    return {
      ...line,
      lineNo,
      qty, unitPrice,
      total: qty != null && unitPrice != null ? qty * unitPrice : null,
      autoQty: line.qty, autoUnitPrice: line.unitPrice,
      source: 'override', notes: override.notes || line.notes,
    };
  });
}

async function buildOnGridCatalog(country, region) {
  const [pvItems, invItems, dcItems, brkItems, adbItems] = await Promise.all([
    priceBook.getItemsByCategory('PV Modules'),
    priceBook.getItemsByCategory('On-Grid Inverter'),
    priceBook.getItemsByCategory('DC Cable'),
    priceBook.getItemsByCategory('AC Breaker'),
    priceBook.getItemsByCategory('AC Distribution Board'),
  ]);
  const rates = country === 'Egypt' ? ratesMatrix.toEngineCatalogShape(await ratesMatrix.getActiveRatesConfig(country)) : {};
  return {
    PV_MODULES: priceBook.toPvModuleShape(pvItems),
    GRID_INVERTERS: priceBook.toGridInverterShape(invItems),
    DC_CABLES: priceBook.toDcCableShape(dcItems),
    AC_BREAKERS: priceBook.toAcBreakerShape(brkItems),
    AC_DISTRIBUTION_BOARDS: priceBook.toAcDistributionBoardShape(adbItems),
    // The AC-cable HP/length matrix and cable-tray roll prices have no per-project variability in
    // either source workbook (they're universal engineering reference tables, not a priced
    // catalog an admin edits item-by-item) - reused directly from the static extraction.
    AC_CABLE_SIZES: onGridCatalogData.AC_CABLE_SIZES,
    AC_CABLE_MAX_LENGTH_BY_HP: onGridCatalogData.AC_CABLE_MAX_LENGTH_BY_HP,
    AC_CABLE_PRICE_PER_M: onGridCatalogData.AC_CABLE_PRICE_PER_M,
    CABLE_TRAY_ROLLS: onGridCatalogData.CABLE_TRAY_ROLLS,
    MC4_CONNECTOR_PRICE_PER_PIECE: onGridCatalogData.MC4_CONNECTOR_PRICE_PER_PIECE,
    MOUNTING_STRUCTURE_RATES: rates.MOUNTING_STRUCTURE_RATES || onGridCatalogData.MOUNTING_STRUCTURE_RATES,
    INSTALL_RATES_BY_REGION: rates.INSTALL_RATES_BY_REGION || {},
    TRANSPORT_RATES_BY_REGION: rates.TRANSPORT_RATES_BY_REGION || {},
  };
}

async function runOnGridOrUtility({ category, engineeringInput, country, region, manualOverrides }) {
  const catalog = await buildOnGridCatalog(country, region);
  const module_ = catalog.PV_MODULES.find(m => m.model === engineeringInput.pvModuleModel);
  if (!module_) throw new ApiError(`PV module "${engineeringInput.pvModuleModel}" not found in the Price Book`, 400);
  const input = { ...engineeringInput, module: module_, inverterCandidates: catalog.GRID_INVERTERS, country, region };
  const result = category === 'Utility Scale'
    ? utility.runUtilityScaleDesign(input, catalog, engineeringInput.manualAdders || {})
    : onGrid.runOnGridDesign(input, catalog);
  const lines = applyManualOverrides(result.boq.lines, manualOverrides);
  const boqTotal = lines.reduce((s, l) => s + (l.total || 0), 0);
  const kWp = result.boq.finalCapacityKwp;

  // Feasibility (On_Grid.xlsx `Feasibility Table`) needs the annual consumption figure, which has
  // no engineering-sizing role - it's a customer-billing input, only ever supplied when the
  // commercial team wants a feasibility view run. Annual production is derived from the same
  // monthly-reference-profile scaling `Estimator Input` itself uses (not a fabricated yield),
  // using the sheet's own default 8 m2/kWp area ratio since this flow sizes from kWp directly
  // rather than from an area input.
  let feasibility = null;
  if (engineeringInput.annualConsumptionKwh > 0) {
    const { annualProductionKwh } = onGrid.estimateCapacityFromArea({ areaM2: kWp * 8, areaPerKwp: 8 }, onGridCatalogData.MONTHLY_PRODUCTION_30KWP_REFERENCE);
    feasibility = onGridFeasibility.runOnGridFeasibility({
      capex: boqTotal, annualProductionKwhYear1: annualProductionKwh, annualConsumptionKwh: engineeringInput.annualConsumptionKwh,
    });
  }

  return { engineeringResult: result.design, lines, boqTotal, kWp, feasibility };
}

async function runOffGrid({ engineeringInput, manualOverrides }) {
  const result = offGrid.runOffGridDesign(engineeringInput);
  const lines = applyManualOverrides(result.lineItems, manualOverrides);
  // Off-Grid's own commercial pricing (contingency/profit/VAT) is already embedded in its BOQ
  // engine (Off_Grid.xlsx has no other pricing path) - callers still run commercialPricingService
  // afterwards for consistency, with the Off-Grid defaults, which reproduce the same numbers.
  const boqTotal = lines.reduce((s, l) => s + (l.total || 0), 0);

  // Diesel-generator comparison (Off_Grid.xlsx `Feasibility Study`) - the only feasibility model
  // for Off-Grid (see the implementation plan: no vs-grid-tariff model applies to a site with no
  // grid connection). Runs only when the commercial team supplies the diesel/generator
  // assumptions; otherwise left null rather than guessed.
  let dieselComparison = null;
  if (engineeringInput.generatorPurchasePrice > 0) {
    dieselComparison = offGridFeasibility.runOffGridDieselFeasibility({
      dailyWh: result.load.dailyWh,
      generatorPurchasePrice: engineeringInput.generatorPurchasePrice,
      dieselPriceEgpPerL: engineeringInput.dieselPriceEgpPerL ?? 20,
      dieselTransportEgpPerL: engineeringInput.dieselTransportEgpPerL ?? 2,
      dieselAnnualEscalation: engineeringInput.dieselAnnualEscalation ?? 0.025,
      generatorSpecificFuelUseLPerKwh: engineeringInput.generatorSpecificFuelUseLPerKwh ?? 0.3,
      generatorMaintenancePct: engineeringInput.generatorMaintenancePct ?? 0.1,
      generatorReplacementIntervalYears: engineeringInput.generatorReplacementIntervalYears ?? 10,
      solarAnnualOmPct: engineeringInput.solarAnnualOmPct ?? 0.025,
      batteryReplacementIntervalYears: engineeringInput.batteryReplacementIntervalYears ?? 10,
      batteryReplacementCost: result.lineItems.find(l => l.component === 'Battery Bank')?.total || 0,
      solarInitialCapex: result.pricing.grandTotalInclVat,
      discountRate: engineeringInput.discountRate ?? 0.1,
    });
  }

  return { engineeringResult: { pv: result.pv, battery: result.battery, inverter: result.inverter }, lines, boqTotal, kWp: result.installedKwp, dieselComparison };
}

async function runAgriculturePumping({ engineeringInput, manualOverrides }) {
  const demand = pumping.computeWaterDemand(engineeringInput, { irrigationMethods: pumpingExtras.IRRIGATION_METHODS, treeTypes: pumpingExtras.TREE_TYPES });
  const pump = pumping.selectPump({ requiredFlowM3h: demand.totalFlowM3h, requiredHeadM: demand.totalHeadM, pumps: pumpingCatalogData.PUMPS });
  const motor = pumping.selectMotor({ pump, motors: pumpingCatalogData.MOTORS });
  if (!motor) throw new ApiError(`No motor in the Price Book matches pump "${pump.model}" (casing ${pump.casing}, ${pump.hp} HP) - flagged for manual selection.`, 400);

  const pvItems = await priceBook.getItemsByCategory('PV Modules');
  const pvModules = priceBook.toPvModuleShape(pvItems);
  const module_ = pvModules.find(m => m.model === (engineeringInput.pvModuleModel || 'JKM670N-66QL6-BDV'));
  const pv = pumping.sizePvForMotor({ motorKw: motor.kw, module: module_ });
  const modulesPerString = engineeringInput.modulesPerString || pv.modulesRequired;
  const strings = pumping.sizeStrings({ modulesRequired: pv.modulesRequired, modulesPerString, module: module_ });
  const submersible = pumping.sizeSubmersibleCable({ motorHp: motor.hp, wellDepthM: engineeringInput.wellDepthM, catalog: pumpingExtras });
  const dcItems = await priceBook.getItemsByCategory('DC Cable');
  const dcCables = [...priceBook.toDcCableShape(dcItems), ...pumpingExtras.PUMPING_DC_CABLES];
  const dcCable = pumping.sizeDcCable({ installedKwp: strings.installedKwp, strings: strings.strings, module: module_, stringVmpStc: modulesPerString * module_.vmp, dcCables });

  const lines = applyManualOverrides(buildPumpingBoqLines({ pump, motor, module_, strings, dcCable, submersible, demand, pumpQty: engineeringInput.pumpQty }), manualOverrides);

  return {
    engineeringResult: { demand, pump, motor, pv, strings, submersible, dcCable },
    lines,
    boqTotal: lines.reduce((s, l) => s + (l.total || 0), 0),
    kWp: strings.installedKwp,
  };
}

/**
 * Builds the raw (pre-override) Agriculture Pumping BOQ lines. Extracted as its own pure
 * function (no DB access) so it is directly unit-testable - `runAgriculturePumping` above is the
 * only caller, after resolving `module_`/`dcCable` against the live Price Book.
 *
 * `no` on each line is the item number from Solar_Pumping3.xlsx's own `BOQ` sheet (A4:A21) -
 * preserved even though this engine only implements a subset of that sheet's 18 rows, so a line's
 * number always matches what the source workbook itself calls that component (1 Submersible Water
 * Pump, 2 Pump Motor, 3 Rising Main/Delivery Pipe, 4 Pump Drop Cable, 7 Solar PV Modules, 8 Solar
 * Pump Inverter, 10 DC Cables - rows 5/6/9/11-18 are not modeled here, see this file's own header
 * on Pipe/VFD selection being flagged rather than invented).
 */
function buildPumpingBoqLines({ pump, motor, module_, strings, dcCable, submersible, demand, pumpQty }) {
  const qty = pumpQty || 1;
  return [
    { no: 1, component: 'Submersible Water Pump', description: `${pump.model} | ${pump.casing} | ${pump.hp} HP | ${pump.flowM3h} m3/h | ${pump.headM} m head`, unit: 'pcs', qty, unitPrice: pump.price, total: qty * pump.price },
    { no: 2, component: 'Pump Motor', description: `${motor.model} | ${motor.hp} HP | ${motor.kw} kW`, unit: 'pcs', qty: 1, unitPrice: motor.castIronPrice, total: motor.castIronPrice },
    { no: 7, component: 'Solar PV Modules', description: `${module_.brand} ${module_.model}`, unit: 'pcs', qty: strings.installedModules, unitPrice: module_.pricePerWatt * module_.pmaxW, total: strings.installedModules * module_.pricePerWatt * module_.pmaxW },
    { no: 10, component: 'DC Cables', description: `${dcCable.selectedSizeMm2} mm2`, unit: 'm', qty: dcCable.totalLengthM, unitPrice: dcCable.pricePerM, total: dcCable.totalCost },
    { no: 4, component: 'Submersible Drop Cable', description: submersible.size, unit: 'm', qty: submersible.cableLengthM, unitPrice: null, total: null, flag: 'Requires supplier quotation for this cable size' },
    { no: 3, component: 'Rising Main Pipe', description: `Diameter band ${pumping.pipeDiameterBand(demand.totalFlowM3h)}" (manual pipe/price selection - no selection formula in the source workbook)`, unit: 'pcs', qty: null, unitPrice: null, total: null, flag: 'Manual selection required' },
    { no: 8, component: 'Pump Inverter / VFD', description: 'Manual selection required - brand compatibility tables not yet modeled', unit: 'pcs', qty: null, unitPrice: null, total: null, flag: 'Manual selection required' },
  ];
}

async function buildBoq({ category, engineeringInput, country, region, manualOverrides = {} }) {
  if (category === 'On-Grid C&I' || category === 'Utility Scale') return runOnGridOrUtility({ category, engineeringInput, country, region, manualOverrides });
  if (category === 'Off-Grid') return runOffGrid({ engineeringInput, manualOverrides });
  if (category === 'Agriculture Pumping') return runAgriculturePumping({ engineeringInput, manualOverrides });
  // Street Lighting / Solar Water Heating: no complete engineering source in any of the three
  // workbooks (see the implementation plan) - flagged rather than faked.
  throw new ApiError(`Category "${category}" has no complete engineering/BOQ model yet - its source workbooks only have placeholder Price Book entries, not a sizing formula. Enter BOQ lines manually.`, 400);
}

async function priceBoq({ category, boqTotal, kWp, vatPct, overrides = {} }) {
  const defaults = pricingService.defaultsForCategory(category);
  return pricingService.priceCommercialRevision({ cogs: boqTotal, kWp, vatPct, ...defaults, ...overrides });
}

module.exports = { buildBoq, priceBoq, applyManualOverrides, buildPumpingBoqLines };
