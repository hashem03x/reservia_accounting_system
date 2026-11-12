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
const dealEngineSettings = require('./dealEngineSettings');
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
    // Standing per-kWp rates stored on the Rates matrix (earthing, accessories, DC route allowance).
    EARTHING_RATE_EGP_PER_KWP: rates.EARTHING_RATE_EGP_PER_KWP ?? null,
    ACCESSORIES_RATE_EGP_PER_KWP: rates.ACCESSORIES_RATE_EGP_PER_KWP ?? null,
    DC_CABLE_ROUTE_M_PER_KWP: rates.DC_CABLE_ROUTE_M_PER_KWP ?? null,
  };
}

async function runOnGridOrUtility({ category, engineeringInput, country, region, manualOverrides, engineSettings = null }) {
  const catalog = await buildOnGridCatalog(country, region);
  const module_ = catalog.PV_MODULES.find(m => m.model === engineeringInput.pvModuleModel);
  if (!module_) throw new ApiError(`PV module "${engineeringInput.pvModuleModel}" not found in the Price Book`, 400);
  const siteCosts = engineeringInput.siteCrew > 0 && engineeringInput.siteDays > 0
    ? {
      crew: engineeringInput.siteCrew,
      days: engineeringInput.siteDays,
      ...(engineeringInput.fareEgp > 0 ? { fareEgp: engineeringInput.fareEgp } : {}),
      ...(engineeringInput.hotelEgpPerRoomNight > 0 ? { hotelEgpPerRoomNight: engineeringInput.hotelEgpPerRoomNight } : {}),
      ...(engineeringInput.perDiemEgp > 0 ? { perDiemEgp: engineeringInput.perDiemEgp } : {}),
      ...(engineeringInput.allowanceEgpPerPersonDay > 0 ? { allowanceEgpPerPersonDay: engineeringInput.allowanceEgpPerPersonDay } : {}),
    }
    : null;
  const input = {
    ...engineeringInput,
    module: module_,
    inverterCandidates: catalog.GRID_INVERTERS,
    country,
    region,
    dcCableBrand: engineeringInput.dcCableBrand || null,
    siteCosts,
    // Deal Engine C1-C3 (pricing configuration) and an estimator-forced inverter (C3 acceptance).
    engineSettings,
    inverterModel: engineeringInput.inverterModel || null,
  };
  const result = category === 'Utility Scale'
    ? utility.runUtilityScaleDesign(input, catalog, engineeringInput.manualAdders || {})
    : onGrid.runOnGridDesign(input, catalog);
  const lines = applyManualOverrides(result.boq.lines, manualOverrides);
  const boqTotal = lines.reduce((s, l) => s + (l.total || 0), 0);
  // DESIGN kWp - the basis of the per-kWp lines and the price per kWp (QA finding section 4).
  const kWp = result.boq.designKwp ?? result.boq.finalCapacityKwp;

  // Feasibility is no longer computed here: its capex is the FINAL PRICE incl VAT (QA finding B4 /
  // brief 3.4), which only exists after pricing - see computeFeasibility() below.
  return { engineeringResult: result.design, lines, boqTotal, kWp };
}

/**
 * Customer feasibility for a priced revision (QA findings B4/U8, brief 3.4). On-Grid and Utility:
 * the brief 3.4 yield model with capex = final price incl VAT, 10% headline escalation, 3% and flat
 * sensitivities, no O&M deduction by default. Off-Grid: the Off_Grid.xlsx solar-vs-diesel model,
 * whose solar capex is likewise the revision's final price incl VAT. Agriculture Pumping: none
 * (Solar_Pumping3.xlsx has no financial sheet).
 *
 * Feasibility inputs on the engineering form (all optional): tariffEgpPerKwh, headlineEscalation,
 * sensitivityEscalations, yieldKwhPerKwp, degradationPct, discountRate, maintenancePctOfCapex,
 * annualConsumptionKwh. Legacy inputs from the R74 form (escalationScenario2/3) are honoured as
 * the two escalation values so an older revision recalculates sensibly.
 */
/**
 * Deal Engine C8: the year-1 tariff. With the bills entered (annual bill EGP and annual kWh), the
 * default is bill / kWh; an estimator-typed tariff that differs is kept with its note (the audit trail).
 * Without bills, a typed tariff is used, else the 2.80 reference value - flagged as a default.
 */
function resolveTariff(ei) {
  const billTariff = ei.annualBillEgp > 0 && ei.annualConsumptionKwh > 0 ? Math.round((ei.annualBillEgp / ei.annualConsumptionKwh) * 10000) / 10000 : null;
  const typed = typeof ei.tariffEgpPerKwh === 'number' && ei.tariffEgpPerKwh > 0 ? ei.tariffEgpPerKwh : null;
  if (billTariff !== null && (typed === null || Math.abs(typed - billTariff) < 0.005)) return { tariff: billTariff, source: 'bill', note: null };
  if (typed !== null) return { tariff: typed, source: billTariff !== null ? 'manual-override' : 'manual', note: ei.tariffNote || null, billTariff };
  return { tariff: 2.8, source: 'default', note: 'No bills entered - reference tariff 2.80 EGP/kWh used.' };
}

function computeFeasibility({ category, engineeringInput = {}, pricing, boqTotal, kWp, engineeringResult, engineSettings = null, region = null }) {
  if (category === 'On-Grid C&I' || category === 'Utility Scale') {
    const ei = engineeringInput;
    // C4 / C7 / C8 / C9 / discount rate from the Deal Engine settings (when supplied).
    const yieldPick = engineSettings ? dealEngineSettings.resolveYield(engineSettings, region, ei.yieldKwhPerKwp) : null;
    const tariffPick = engineSettings ? resolveTariff(ei) : null;
    const inv = engineeringResult && engineeringResult.inverter;
    const inverterReplacement =
      engineSettings && inv && inv.price > 0
        ? { year: ei.inverterReplacementYear > 0 ? ei.inverterReplacementYear : engineSettings.inverterReplacementYear, costEgp: Math.round(inv.price * (engineeringResult.inverterQty || 1) * 100) / 100 }
        : null;
    const legacyEsc = [ei.escalationScenario2, ei.escalationScenario3].filter(v => typeof v === 'number');
    const headlineEscalation = typeof ei.headlineEscalation === 'number' ? ei.headlineEscalation : legacyEsc.includes(0.1) ? 0.1 : undefined;
    const sensitivities = Array.isArray(ei.sensitivityEscalations) ? ei.sensitivityEscalations : undefined;
    return {
      feasibility: onGridFeasibility.runCustomerFeasibility({
        pricing,
        designKwp: kWp,
        boqCost: boqTotal,
        annualConsumptionKwh: ei.annualConsumptionKwh > 0 ? ei.annualConsumptionKwh : null,
        inputs: {
          tariffEgpPerKwh: tariffPick ? tariffPick.tariff : ei.tariffEgpPerKwh,
          headlineEscalation,
          sensitivityEscalations: sensitivities,
          yieldKwhPerKwp: yieldPick ? yieldPick.kwhPerKwp : ei.yieldKwhPerKwp,
          degradationPct: ei.degradationPct,
          discountRate: typeof ei.discountRate === 'number' ? ei.discountRate : engineSettings ? engineSettings.discountRate : undefined,
          maintenancePctOfCapex: ei.maintenancePctOfCapex,
          ...(engineSettings
            ? {
              yieldSource: yieldPick.source,
              yieldBasis: yieldPick.source === 'site' ? ei.yieldSourceNote || 'Site-specific value' : engineSettings.yield.basis,
              tariffSource: tariffPick.source,
              tariffNote: tariffPick.note,
              annualBillEgp: ei.annualBillEgp > 0 ? ei.annualBillEgp : null,
              inverterReplacement,
              twoPhaseEscalation: engineSettings.twoPhaseEscalation,
              annualIrradiationKwhPerM2: ei.annualIrradiationKwhPerM2 > 0 ? ei.annualIrradiationKwhPerM2 : null,
            }
            : {}),
        },
      }),
      dieselComparison: null,
    };
  }
  if (category === 'Off-Grid' && engineeringInput.generatorPurchasePrice > 0) {
    const r = engineeringResult || {};
    return {
      feasibility: null,
      dieselComparison: offGridFeasibility.runOffGridDieselFeasibility({
        dailyWh: r.load?.dailyWh || 0,
        generatorPurchasePrice: engineeringInput.generatorPurchasePrice,
        dieselPriceEgpPerL: engineeringInput.dieselPriceEgpPerL ?? 20,
        dieselTransportEgpPerL: engineeringInput.dieselTransportEgpPerL ?? 2,
        dieselAnnualEscalation: engineeringInput.dieselAnnualEscalation ?? 0.025,
        generatorSpecificFuelUseLPerKwh: engineeringInput.generatorSpecificFuelUseLPerKwh ?? 0.3,
        generatorMaintenancePct: engineeringInput.generatorMaintenancePct ?? 0.1,
        generatorReplacementIntervalYears: engineeringInput.generatorReplacementIntervalYears ?? 10,
        solarAnnualOmPct: engineeringInput.solarAnnualOmPct ?? 0.025,
        batteryReplacementIntervalYears: engineeringInput.batteryReplacementIntervalYears ?? 10,
        batteryReplacementCost: r.batteryLineTotal || 0,
        // The customer's real solar investment: the revision's final price incl VAT.
        solarInitialCapex: pricing.grossInclVat,
        discountRate: engineeringInput.discountRate ?? 0.1,
        analysisPeriodYears: engineeringInput.analysisPeriodYears ?? 25,
      }),
    };
  }
  return { feasibility: null, dieselComparison: null };
}

/**
 * QA finding U7: the Off-Grid module, battery and inverter are SELECTED from the Price Book (by key)
 * and priced from it - their ratings (module W, battery V/Ah, inverter kW) come from the same item -
 * and installation uses the Rates matrix [region, band] instead of the flat 650 EGP/kWp that used to
 * be typed in. The Rev05 sizing method itself (Load Assessment -> Design -> BOQ) is unchanged.
 *
 * Legacy revisions without keys keep their typed prices so they still recalculate, but those lines
 * are flagged so nobody mistakes them for Price Book prices.
 */
async function resolveOffGridInput(engineeringInput, country, region) {
  const ei = { ...engineeringInput };
  const keys = {};
  if (ei.moduleKey) {
    const it = await priceBook.getItemByKey(ei.moduleKey);
    ei.moduleWattage = it.attrs?.pmaxW || it.n1;
    ei.moduleUnitPrice = it.unitPrice;
    keys.module = it;
  }
  if (ei.batteryKey) {
    const it = await priceBook.getItemByKey(ei.batteryKey);
    ei.batteryUnitVoltage = it.attrs?.voltageV ?? it.n1;
    ei.batteryUnitAh = it.attrs?.capacityAh ?? it.n2;
    ei.batteryUnitPrice = it.unitPrice;
    keys.battery = it;
  }
  if (ei.inverterKey) {
    const it = await priceBook.getItemByKey(ei.inverterKey);
    const kw = it.attrs?.ratedKw ?? it.n1;
    if (!(kw > 0)) throw new ApiError(`Price Book inverter "${it.key}" has no kW rating - cannot size the Off-Grid inverter.`, 400);
    ei.inverterAcRatingW = kw * 1000;
    ei.inverterUnitPrice = it.unitPrice;
    keys.inverter = it;
  }
  for (const [field, label] of [['moduleUnitPrice', 'PV module'], ['batteryUnitPrice', 'battery'], ['inverterUnitPrice', 'inverter']]) {
    if (!(ei[field] >= 0)) throw new ApiError(`Select the ${label} from the Price Book.`, 400);
  }

  let installSource = 'manual';
  let installRates = null;
  if (country === 'Egypt') {
    installRates = ratesMatrix.toEngineCatalogShape(await ratesMatrix.getActiveRatesConfig('Egypt'));
    installSource = 'rates';
  }
  return { ei, keys, installRates, installSource };
}

async function runOffGrid({ engineeringInput, manualOverrides, country, region }) {
  const { ei, keys, installRates, installSource } = await resolveOffGridInput(engineeringInput, country, region);
  // Sizing never depends on prices, so a first pass gives the installed kWp the install band needs.
  let result = offGrid.runOffGridDesign({ ...ei, installationRatePerKwp: ei.installationRatePerKwp ?? 0 });
  let installBand = null;
  if (installRates) {
    installBand = onGrid.installationBand(result.installedKwp);
    ei.installationRatePerKwp = ratesMatrix.installRateFor(installRates, region, installBand);
    result = offGrid.runOffGridDesign(ei);
  }

  const keyByComponent = { 'Solar PV Modules': keys.module, 'Battery Bank': keys.battery, 'Off-Grid Inverter': keys.inverter };
  const tagged = result.lineItems.map(l => {
    if (l.component in keyByComponent) {
      const item = keyByComponent[l.component];
      return item
        ? { ...l, materialItemKey: item.key, description: `${item.brand} ${item.model} - ${item.spec}`.slice(0, 200) }
        : { ...l, flag: 'MANUAL PRICE - select the item from the Price Book' };
    }
    if (l.component === 'Installation & Testing') {
      return installSource === 'rates'
        ? { ...l, description: `Rates matrix: ${region}, band ${installBand}` }
        : { ...l, description: 'Manual rate (no Rates matrix outside Egypt)' };
    }
    return l;
  });
  const lines = applyManualOverrides(tagged, manualOverrides);
  const boqTotal = lines.reduce((s, l) => s + (l.total || 0), 0);

  return {
    engineeringResult: {
      pv: result.pv,
      battery: result.battery,
      inverter: result.inverter,
      load: result.load,
      installedKwp: result.installedKwp,
      installation: { source: installSource, band: installBand, ratePerKwp: ei.installationRatePerKwp },
      batteryLineTotal: lines.find(l => l.component === 'Battery Bank')?.total || 0,
      // The Rev05 workbook's own internal costing (contingency 2% + profit on cost) - reference only;
      // the revision is priced by the standard Commercial pricing stack.
      rev05InternalPricing: result.pricing,
    },
    lines,
    boqTotal,
    kWp: result.installedKwp,
  };
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

async function buildBoq({ category, engineeringInput, country, region, manualOverrides = {}, engineSettings = null }) {
  if (category === 'On-Grid C&I' || category === 'Utility Scale') return runOnGridOrUtility({ category, engineeringInput, country, region, manualOverrides, engineSettings });
  if (category === 'Off-Grid') return runOffGrid({ engineeringInput, manualOverrides, country, region });
  if (category === 'Agriculture Pumping') return runAgriculturePumping({ engineeringInput, manualOverrides });
  // Street Lighting / Solar Water Heating: no complete engineering source in any of the three
  // workbooks (see the implementation plan) - flagged rather than faked.
  throw new ApiError(`Category "${category}" has no complete engineering/BOQ model yet - its source workbooks only have placeholder Price Book entries, not a sizing formula. Enter BOQ lines manually.`, 400);
}

/**
 * Prices a BOQ with an explicit set of levers (the caller - revisionService.js - resolves them from
 * the Finance configuration for a new revision, or from the revision's own stored levers on a
 * recalculation). There are no hidden defaults here: a lever not supplied is 0.
 */
function priceBoq({ boqTotal, kWp, vatPct, levers = {}, discountAuthorityPct = null }) {
  const pricing = pricingService.priceCommercialRevision({ cogs: boqTotal, kWp, vatPct, ...pricingService.pickLevers(levers) });
  pricing.discountAboveAuthority = discountAuthorityPct != null && pricing.discountPct > discountAuthorityPct;
  return pricing;
}

module.exports = { buildBoq, priceBoq, computeFeasibility, applyManualOverrides, buildPumpingBoqLines };
