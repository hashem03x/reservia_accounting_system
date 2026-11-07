// On-Grid / Utility-Scale engineering + BOQ engine.
//
// Ported formula-by-formula from On_Grid.xlsx, sheets `Estimator Input`, `On-Grid Design` and
// `BOQ On-Grid Design` (Utility-Scale BOQ reuses this same engine for equipment - see
// utilityEngine.js for its own manual adder lines). Every exported function cites the exact
// source cell(s) in a comment. Pure functions: no DB access, no HTTP - the catalog/rates data is
// always passed in, never hardcoded here (see catalogData/onGridCatalog.js for the literal Price
// List extraction, and services/commercial/priceBookLookup.js / ratesMatrix.js for the Mongo-backed
// adapters that supply this same shape in production).
//
// Known, deliberately-preserved quirks of the source workbook (see the implementation plan for the
// full discrepancy list) are called out inline rather than "fixed":
//   - the AC cable sizing is permanently self-flagged by the workbook as "VERIFY ENGINEERING";
//   - the installation-rate size band collapses bands 1 and 2 (harmless only because every Egypt
//     region's band-1 and band-2 rate happen to be identical in the live table);
//   - the AC Distribution Board selection sizes against the PRE-string-rounding "required" capacity
//     (Estimator/Design!G8-equivalent), while the mounting structure and DC cable size against the
//     POST-string-rounding "final installed" capacity (Design!D10-equivalent) - these are two
//     different capacity figures in the live workbook, not a bug introduced here.

'use strict';

const SQRT3 = Math.sqrt(3);

function ceil(n) {
  return Math.ceil(n);
}

function round(n, dp = 0) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Estimator Input!B7:B9 and D12:D23 - area+bills kWp estimate and monthly production spread
 * across a 30 kWp reference system's seasonal shape (Estimator Input!E12:E23).
 * @param {{areaM2:number, areaPerKwp:number}} input
 * @param {Record<string,number>} monthlyReference30Kwp
 */
function estimateCapacityFromArea({ areaM2, areaPerKwp }, monthlyReference30Kwp) {
  if (!(areaM2 > 0) || !(areaPerKwp > 0)) return { kWp: 0, monthlyProductionKwh: {}, annualProductionKwh: 0 };
  const kWp = areaM2 / areaPerKwp; // Estimator Input!B9
  const monthlyProductionKwh = {};
  let annualProductionKwh = 0;
  for (const [month, ref30kwp] of Object.entries(monthlyReference30Kwp)) {
    // Estimator Input!D12 = ROUND(kWp/30 * E12, 0)
    const v = round((kWp / 30) * ref30kwp, 0);
    monthlyProductionKwh[month] = v;
    annualProductionKwh += v;
  }
  return { kWp, monthlyProductionKwh, annualProductionKwh };
}

/** On-Grid Design!C8/D8/G8 - PV module quantity, cost and "selected" (pre-string) capacity. */
function sizePvModules({ kWp, module }) {
  const modulesRequired = ceil((kWp * 1000) / module.pmaxW); // C8 = ROUNDUP(kWp*1000/moduleW,0)
  const totalModuleCost = round(modulesRequired * module.pmaxW * module.pricePerWatt, 2); // F8
  const selectedCapacityKwp = round((modulesRequired * module.pmaxW) / 1000, 6); // G8
  return { modulesRequired, totalModuleCost, selectedCapacityKwp, unitPrice: round(module.pmaxW * module.pricePerWatt, 4) };
}

/**
 * On-Grid Design!H10 - suggested max modules/string from inverter DC-voltage and MPPT-voltage
 * limits with cold/hot module voltage. Advisory only; `modulesPerString` stays a user input.
 */
function suggestModulesPerString({ modulesRequired, module, inverter, minCellTempC = 0 }) {
  if (!inverter.maxDcV || !inverter.mpptMaxV) return null; // data gap in the source catalog row - never fabricated
  const coldVoc = module.voc * (1 + (module.vocTempCoeffPctPerC / 100) * (minCellTempC - 25));
  const byMaxDcV = Math.trunc(inverter.maxDcV / coldVoc);
  const byMpptMaxV = Math.trunc(inverter.mpptMaxV / module.vmp);
  return Math.max(0, Math.min(modulesRequired, byMaxDcV, byMpptMaxV));
}

/**
 * On-Grid Design!A10:L10 string design. `modulesPerString` (A10) is a manual Reservia input in
 * the source sheet (default used in the reference scenario: 14) - never auto-derived; callers
 * should default it to `suggestModulesPerString` when the user hasn't chosen one yet.
 */
function sizeStrings({ modulesRequired, modulesPerString, module, minCellTempC = 0 }) {
  if (!(modulesPerString > 0)) return null;
  const parallelStrings = ceil(modulesRequired / modulesPerString); // B10
  const finalModules = modulesPerString * parallelStrings; // D10
  const unassignedModules = modulesRequired - finalModules; // E10
  const coldStringVoc = round(modulesPerString * module.voc * (1 + (module.vocTempCoeffPctPerC / 100) * (minCellTempC - 25)), 4); // I10
  const stringVmpSTC = round(modulesPerString * module.vmp, 4); // J10
  return { modulesPerString, parallelStrings, finalModules, unassignedModules, coldStringVoc, stringVmpSTC };
}

/**
 * On-Grid Design!C14 - nearest-kWp-match grid-tie inverter selection, clamped to the catalog's
 * own min/max. Catalog must be pre-sorted ascending by ratedKw (as in the source sheet).
 */
function selectGridInverter({ selectedCapacityKwp, inverters }) {
  if (!inverters.length) throw new Error('Grid inverter catalog is empty');
  const first = inverters[0];
  const last = inverters[inverters.length - 1];
  if (selectedCapacityKwp <= first.ratedKw) return first;
  if (selectedCapacityKwp >= last.ratedKw) return last;
  for (let i = 0; i < inverters.length - 1; i++) {
    const lower = inverters[i];
    const upper = inverters[i + 1];
    if (selectedCapacityKwp >= lower.ratedKw && selectedCapacityKwp <= upper.ratedKw) {
      // ties go to the lower one, matching the sheet's ABS(..)<=ABS(..) comparison
      return Math.abs(selectedCapacityKwp - lower.ratedKw) <= Math.abs(selectedCapacityKwp - upper.ratedKw) ? lower : upper;
    }
  }
  return last;
}

/**
 * On-Grid Design!A26:G26 - DC cable sizing from module Isc (NOT temperature-adjusted - the
 * workbook only temp-adjusts Voc for the string check, not Isc for cable sizing) and quantity from
 * installed kWp x 8 m/kWp (D26 - already covers both positive and negative conductors, no doubling
 * needed per the sheet's own note at A36).
 */
function sizeDcCable({ module, finalModules, cables }) {
  const designCurrentA = round(module.isc * 1.25, 6); // B26
  let cableSizeMm2;
  if (designCurrentA <= 30) cableSizeMm2 = 4;
  else if (designCurrentA <= 40) cableSizeMm2 = 6;
  else if (designCurrentA <= 55) cableSizeMm2 = 10;
  else if (designCurrentA <= 75) cableSizeMm2 = 16;
  else if (designCurrentA <= 100) cableSizeMm2 = 25;
  else if (designCurrentA <= 125) cableSizeMm2 = 35;
  else if (designCurrentA <= 150) cableSizeMm2 = 50;
  else if (designCurrentA <= 190) cableSizeMm2 = 70;
  else throw new Error(`DC design current ${designCurrentA}A exceeds the sizing table (ERROR: SIZE in the source sheet)`);

  const lengthM = ceil(finalModules * module.pmaxW * 0.008); // D26 = ROUNDUP(D10*moduleW/1000*8,0)
  const candidates = cables.filter(c => c.sizeMm2 === cableSizeMm2);
  if (!candidates.length) throw new Error(`No DC cable of ${cableSizeMm2} mm2 in the Price Book`);
  const cheapest = candidates.reduce((a, b) => (b.pricePerM < a.pricePerM ? b : a)); // E26/F26 = MINIFS by size
  const totalCost = round(lengthM * cheapest.pricePerM, 2); // G26
  return { designCurrentA, cableSizeMm2, lengthM, brand: cheapest.brand, pricePerM: cheapest.pricePerM, totalCost };
}

/** On-Grid Design!A40:E40 - mounting structure cost against the FINAL (post-string) capacity. */
function sizeMountingStructure({ finalModules, module, structureType, structureRates }) {
  const capacityKwp = round((finalModules * module.pmaxW) / 1000, 6); // C40
  const ratePerKwp = structureRates[structureType];
  if (ratePerKwp === undefined) throw new Error(`No mounting-structure rate for type "${structureType}"`);
  const totalCost = round(capacityKwp * ratePerKwp, 2); // E40
  return { capacityKwp, ratePerKwp, totalCost };
}

/**
 * On-Grid Design!A44:K44 - AC cable sizing, permanently flagged by the source sheet itself as
 * "REFERENCE TABLE SELECTION - VERIFY ENGINEERING" (never presented as a fully verified number).
 * `acLengthM` is a commercial/site input (no formula derives it in the source sheet either).
 */
function sizeAcCable({ inverterRatedKw, acVoltage = 400, powerFactor = 0.98, acLengthM, overridePricePerM, catalog }) {
  const inverterCurrentA = round((inverterRatedKw * 1000) / (SQRT3 * acVoltage * powerFactor), 6); // C44
  const designCurrentA = round(inverterCurrentA * 1.25, 6); // D44

  // J44 = LOOKUP(I44, A58:A81) - approximate match on an ascending array: the largest table HP <=
  // the inverter's own kW value used directly as the lookup key (I44 = C14).
  const rows = catalog.AC_CABLE_MAX_LENGTH_BY_HP;
  let matchedRow = null;
  for (const row of rows) {
    if (row.hp <= inverterRatedKw) matchedRow = row;
    else break;
  }
  if (!matchedRow) {
    return { inverterCurrentA, designCurrentA, cableSize: null, pricePerM: null, totalCost: null, flag: 'ERROR: NO SUITABLE CABLE (below HP table range)' };
  }
  let sizeIndex = -1;
  for (let i = 0; i < matchedRow.lengths.length; i++) {
    if (matchedRow.lengths[i] != null && matchedRow.lengths[i] >= acLengthM) { sizeIndex = i; break; }
  }
  if (sizeIndex === -1) {
    return { inverterCurrentA, designCurrentA, cableSize: null, pricePerM: null, totalCost: null, flag: 'ERROR: NO SUITABLE CABLE' };
  }
  const cableSize = catalog.AC_CABLE_SIZES[sizeIndex]; // E44
  const pricePerM = overridePricePerM > 0 ? overridePricePerM : catalog.AC_CABLE_PRICE_PER_M[cableSize]; // G44 (override wins, per the Developer Brief's own "price = override if above 0, otherwise Price Book" rule for this exact line)
  const totalCost = round(pricePerM * acLengthM, 2); // H44
  return { inverterCurrentA, designCurrentA, cableSize, lengthM: acLengthM, pricePerM, totalCost, flag: 'REFERENCE TABLE SELECTION - VERIFY ENGINEERING' };
}

/**
 * On-Grid Design!A48:G48 - required tray length then a greedy roll-combination: as many 50 m
 * rolls as fit, with the remainder covered by exactly one smaller roll.
 */
function sizeCableTray({ dcCableLengthM, acCableLengthM, rolls }) {
  const requiredLengthM = ceil(dcCableLengthM / 2 + 10 + acCableLengthM + 5); // D48
  if (!(requiredLengthM > 0)) return { requiredLengthM: 0, rolls: [], totalCost: 0 };
  const sorted = [...rolls].sort((a, b) => a.lengthM - b.lengthM);
  const biggest = sorted[sorted.length - 1];
  const fullBigRolls = Math.max(0, ceil(requiredLengthM / biggest.lengthM) - 1); // P101
  const remainder = requiredLengthM - fullBigRolls * biggest.lengthM;
  const selected = [];
  if (fullBigRolls > 0) selected.push({ lengthM: biggest.lengthM, qty: fullBigRolls });
  const fit = sorted.find(r => remainder <= r.lengthM) || biggest;
  const existing = selected.find(s => s.lengthM === fit.lengthM);
  if (existing) existing.qty += 1;
  else selected.push({ lengthM: fit.lengthM, qty: 1 });
  const totalRolls = selected.reduce((s, r) => s + r.qty, 0); // E48
  const totalCost = selected.reduce((s, r) => s + r.qty * sorted.find(x => x.lengthM === r.lengthM).pricePerRoll, 0); // F48
  const description = selected.map(r => `${r.qty} x ${r.lengthM} m roll`).join(' + '); // G48
  return { requiredLengthM, rolls: selected, totalRolls, totalCost: round(totalCost, 2), description };
}

/** On-Grid Design!A60:E60 - AC breaker selection by design current, same current formula as the AC cable. */
function selectAcBreaker({ inverterRatedKw, acVoltage = 400, powerFactor = 0.98, inverterQty, breakers }) {
  const designCurrentA = round(((inverterRatedKw * 1000) / (SQRT3 * acVoltage * powerFactor)) * 1.25, 6); // A60
  const sorted = [...breakers].sort((a, b) => a.ratingA - b.ratingA);
  const selected = sorted.find(b => b.ratingA >= designCurrentA);
  if (!selected) throw new Error(`No breaker rated >= ${designCurrentA} A in the Price Book`);
  const totalCost = round(selected.price * inverterQty, 2); // E60
  return { designCurrentA, ratingA: selected.ratingA, type: selected.type, unitPrice: selected.price, totalCost };
}

/** On-Grid Design!A66:D66 - MC4 connectors, strings*2+4, priced per piece. */
function sizeMc4({ totalStrings, pricePerPiece }) {
  const quantity = totalStrings * 2 + 4; // B66
  const totalCost = round(quantity * pricePerPiece, 2); // D66
  return { quantity, unitPrice: pricePerPiece, totalCost };
}

/**
 * On-Grid Design!A70:D70 - AC distribution board, selected against the PRE-string "selected"
 * capacity (selectedCapacityKwp from sizePvModules), not the post-string final capacity.
 */
function selectAcDistributionBoard({ selectedCapacityKwp, boards }) {
  const sorted = [...boards].sort((a, b) => a.maxPvKwp - b.maxPvKwp);
  const selected = sorted.find(b => b.maxPvKwp >= selectedCapacityKwp);
  if (!selected) return { dimensionsCm: 'PRICE / SIZE NOT AVAILABLE', unitPrice: null, totalCost: null };
  return { dimensionsCm: selected.dimensionsCm, unitPrice: selected.price, totalCost: selected.price, quantity: 1 };
}

/**
 * BOQ On-Grid Design!F21 - installation rate size band. Faithfully reproduces the source
 * formula's own quirk: it never returns band 2 (anything <=30 kWp maps straight to band 1).
 * Only safe because every Egypt region's band-1 and band-2 installation rate are identical in the
 * live table (see onGridCatalog.js's header comment) - documented, not silently "corrected" to a
 * 5-way split.
 */
function installationBand(kWp) {
  if (kWp <= 30) return 1;
  if (kWp <= 50) return 3;
  if (kWp <= 100) return 4;
  return 5;
}

/** BOQ On-Grid Design!E22 formula - the correct 5-way size band, used for transport only. */
function transportBand(kWp) {
  if (kWp <= 15) return 1;
  if (kWp <= 30) return 2;
  if (kWp <= 50) return 3;
  if (kWp <= 100) return 4;
  return 5;
}

/**
 * Runs the full On-Grid Design chain for one set of inputs and returns both the raw design
 * results and the BOQ On-Grid Design line items + total, in the sheet's own row order.
 */
function runOnGridDesign(input, catalog) {
  const {
    kWp, module, inverterCandidates, structureType, modulesPerStringOverride,
    acLengthM, acPricePerMOverride, country, region, minCellTempC = 0,
  } = input;

  const pv = sizePvModules({ kWp, module });
  const modulesPerString = modulesPerStringOverride || suggestModulesPerString({
    modulesRequired: pv.modulesRequired, module, inverter: selectGridInverter({ selectedCapacityKwp: pv.selectedCapacityKwp, inverters: inverterCandidates }), minCellTempC,
  }) || pv.modulesRequired;
  const strings = sizeStrings({ modulesRequired: pv.modulesRequired, modulesPerString, module, minCellTempC });
  const inverter = selectGridInverter({ selectedCapacityKwp: pv.selectedCapacityKwp, inverters: inverterCandidates });
  const inverterQty = 1; // On-Grid Design!D14 - manual input, default 1 in the reference scenario
  const dcAcRatio = round(pv.selectedCapacityKwp / (inverter.ratedKw * inverterQty), 6); // G14

  const dcCable = sizeDcCable({ module, finalModules: strings.finalModules, cables: catalog.DC_CABLES });
  const structure = sizeMountingStructure({ finalModules: strings.finalModules, module, structureType, structureRates: catalog.MOUNTING_STRUCTURE_RATES });
  const acCable = sizeAcCable({ inverterRatedKw: inverter.ratedKw, acLengthM, overridePricePerM: acPricePerMOverride, catalog });
  const tray = sizeCableTray({ dcCableLengthM: dcCable.lengthM, acCableLengthM: acLengthM, rolls: catalog.CABLE_TRAY_ROLLS });
  const breaker = selectAcBreaker({ inverterRatedKw: inverter.ratedKw, inverterQty, breakers: catalog.AC_BREAKERS });
  const mc4 = sizeMc4({ totalStrings: strings.parallelStrings, pricePerPiece: catalog.MC4_CONNECTOR_PRICE_PER_PIECE });
  const adb = selectAcDistributionBoard({ selectedCapacityKwp: pv.selectedCapacityKwp, boards: catalog.AC_DISTRIBUTION_BOARDS });

  const finalCapacityKwp = structure.capacityKwp; // BOQ!B5
  const isEgypt = country === 'Egypt';
  const earthing = { qty: finalCapacityKwp, rate: 100, total: round(finalCapacityKwp * 100, 2) }; // BOQ!E18/F18/G18
  const accessories = { qty: finalCapacityKwp, rate: 85, total: round(finalCapacityKwp * 85, 2) }; // BOQ!E19/F19/G19 (Excel: 85, NOT the HTML brief's 150)
  const installRate = isEgypt ? catalog.INSTALL_RATES_BY_REGION[region]?.[installationBand(finalCapacityKwp) - 1] : null;
  if (isEgypt && installRate === undefined) throw new Error(`Region "${region}" is not in the installation Rates matrix`);
  const installation = { qty: finalCapacityKwp, rate: installRate ?? null, total: installRate != null ? round(finalCapacityKwp * installRate, 2) : null };
  const transportRate = isEgypt ? catalog.TRANSPORT_RATES_BY_REGION[region]?.[transportBand(kWp) - 1] : null;
  if (isEgypt && transportRate === undefined) throw new Error(`Region "${region}" is not in the transport Rates matrix`);
  const transportation = { qty: isEgypt ? 1 : null, rate: isEgypt ? transportRate : null, total: isEgypt ? round(transportRate, 2) : null };

  const lines = [
    // BOQ!E9/G9 bill the FINAL installed module count (post string-rounding), not the
    // theoretical "required" count - you pay for whole strings, not fractional modules.
    { no: 1, component: 'PV Modules', description: module.model, unit: 'pcs', qty: strings.finalModules, unitPrice: pv.unitPrice, total: round(strings.finalModules * pv.unitPrice, 2) },
    { no: 2, component: 'Solar Inverters', description: inverter.model, unit: 'pcs', qty: inverterQty, unitPrice: inverter.price, total: round(inverterQty * inverter.price, 2) },
    { no: 3, component: 'DC Solar Cable', description: `${dcCable.brand} ${dcCable.cableSizeMm2} mm2`, unit: 'm', qty: dcCable.lengthM, unitPrice: dcCable.pricePerM, total: dcCable.totalCost },
    { no: 4, component: 'Mounting Structure', description: `${structureType}`, unit: 'kWp', qty: structure.capacityKwp, unitPrice: structure.ratePerKwp, total: structure.totalCost },
    { no: 5, component: 'AC Cable', description: acCable.cableSize, unit: 'm', qty: acCable.lengthM ?? null, unitPrice: acCable.pricePerM, total: acCable.totalCost, flag: acCable.flag },
    { no: 6, component: 'Cable Tray', description: tray.description, unit: 'roll', qty: tray.totalRolls, unitPrice: tray.totalRolls ? round(tray.totalCost / tray.totalRolls, 2) : null, total: tray.totalCost },
    { no: 7, component: 'AC Circuit Breaker', description: `${breaker.ratingA} A ${breaker.type}`, unit: 'pcs', qty: inverterQty, unitPrice: breaker.unitPrice, total: breaker.totalCost },
    { no: 8, component: 'MC4 Connectors', description: 'MC4 PV Connector', unit: 'pcs', qty: mc4.quantity, unitPrice: mc4.unitPrice, total: mc4.totalCost },
    { no: 9, component: 'AC Distribution Board', description: adb.dimensionsCm, unit: 'pcs', qty: adb.quantity ?? null, unitPrice: adb.unitPrice, total: adb.totalCost },
    { no: 11, component: 'Earthing', description: 'Earthing works - 100 EGP per installed kWp', unit: 'kWp', qty: earthing.qty, unitPrice: earthing.rate, total: earthing.total },
    { no: 12, component: 'Accessories', description: 'PV system accessories - 85 EGP per installed kWp', unit: 'kWp', qty: accessories.qty, unitPrice: accessories.rate, total: accessories.total },
    { no: 13, component: 'Installation', description: 'Installation labor - automatic rate by location and capacity', unit: 'kWp', qty: installation.qty, unitPrice: installation.rate, total: installation.total },
    { no: 14, component: 'Transportation', description: isEgypt ? region : 'Transportation - quote required outside Egypt', unit: 'lot', qty: transportation.qty, unitPrice: transportation.rate, total: transportation.total },
  ];
  const total = round(lines.reduce((s, l) => s + (l.total || 0), 0), 2); // BOQ!G23
  const perKwp = finalCapacityKwp ? round(total / finalCapacityKwp, 10) : null; // BOQ!G24

  return {
    design: { pv, modulesPerString, strings, inverter, inverterQty, dcAcRatio, dcCable, structure, acCable, tray, breaker, mc4, adb },
    boq: { lines, total, perKwp, finalCapacityKwp },
  };
}

module.exports = {
  estimateCapacityFromArea,
  sizePvModules,
  suggestModulesPerString,
  sizeStrings,
  selectGridInverter,
  sizeDcCable,
  sizeMountingStructure,
  sizeAcCable,
  sizeCableTray,
  selectAcBreaker,
  sizeMc4,
  selectAcDistributionBoard,
  installationBand,
  transportBand,
  runOnGridDesign,
};
