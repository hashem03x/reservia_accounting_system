// Solar Pumping engineering engine - ported formula-by-formula from Solar_Pumping3.xlsx, sheets
// `Agricultural Load`, `Reference Data`, `Design`, `Motor Price List`, `Submersible Cable List`,
// `DC Cable Price List`, `PV Module Datasheets`. The full nearest-match pump selection against a
// ~500-row catalog, motor selection, PV sizing/strings, and submersible/DC cable sizing are all
// implemented with genuine, reconstructable formulas from the sheet.
//
// Two items are DELIBERATELY NOT auto-selected here, flagged instead of invented:
//   - Rising-main PIPE selection: `Pipe Price List`'s own "Match helper" column (I4:I33) has NO
//     formula in it at all - it is a column a human manually fills in per scenario with their own
//     pre-filtered candidate price(s) before the Design sheet's MIN()/INDEX() picks among them.
//     There is no reconstructable selection algorithm here, only the diameter BAND, which IS a
//     real formula (`pipeDiameterBand`). Per "do not invent engineering formulas to fill gaps,"
//     actual pipe brand/model/price selection is left for manual commercial entry.
//   - Pump VFD/inverter selection: brand-specific compatibility tables with many
//     "Preliminary"/"Not available" states (Design!G18:H20) that depend on an `Inverter Price
//     List` this engine does not yet model - left for manual selection rather than guessed.

'use strict';

function ceil(n) {
  return Math.ceil(n);
}

/** Agricultural Load!H6:H10 - field-crop water demand by irrigation method. */
function fieldCropFlow(rows, irrigationMethods) {
  let total = 0;
  const codesUsed = [];
  for (const r of rows) {
    const method = irrigationMethods[r.irrigationCode];
    if (!method || !(r.areaFeddan > 0)) continue;
    codesUsed.push(r.irrigationCode);
    total += (r.areaFeddan * method.m3PerFeddanPerIrrigation) / Math.max(1, r.intervalDays) / Math.max(1, r.sunHours);
  }
  return { total, codesUsed };
}

/** Agricultural Load!H16:H20 - tree water demand (fixed 5-sun-hour divisor, not user-configurable). */
function treeFlow(rows, treeTypes) {
  let total = 0;
  let anyTreeArea = false;
  for (const r of rows) {
    const type = treeTypes[r.treeCode];
    if (!type || !(r.areaFeddan > 0)) continue;
    anyTreeArea = true;
    total += (r.areaFeddan * type.treesPerFeddan * type.litresPerTree) / 1000 / Math.max(1, r.intervalDays) / 5;
  }
  return { total, anyTreeArea };
}

/**
 * Agricultural Load!H31/H32 - combined flow and head. The pressure allowance's "drip" (+20) term
 * fires on ANY tree area being used at all (not on the tree row's own declared irrigation
 * method) - preserved exactly as the sheet computes it, not "fixed" to check the tree's method.
 */
function computeWaterDemand({ fieldCropRows, treeRows, waterLevelM, safetyAllowanceM }, { irrigationMethods, treeTypes }) {
  const crops = fieldCropFlow(fieldCropRows, irrigationMethods);
  const trees = treeFlow(treeRows, treeTypes);
  const totalFlowM3h = crops.total + trees.total; // H31
  const usesFlood = crops.codesUsed.includes(1);
  const usesDripOrAnyTree = crops.codesUsed.includes(2) || trees.anyTreeArea;
  const usesSprinkler = crops.codesUsed.includes(3);
  const pressureAllowanceM = (usesFlood ? 10 : 0) + (usesDripOrAnyTree ? 20 : 0) + (usesSprinkler ? 30 : 0);
  const totalHeadM = waterLevelM + pressureAllowanceM + safetyAllowanceM; // H32
  return { totalFlowM3h, pressureAllowanceM, totalHeadM };
}

/** Design!A6:G6 - nearest-match pump selection by flow/head score (lower is better, ties go to the first occurrence). */
function selectPump({ requiredFlowM3h, requiredHeadM, pumps }) {
  if (!pumps.length) throw new Error('Pump catalog is empty');
  let best = null;
  let bestScore = Infinity;
  for (const p of pumps) {
    const score = Math.abs(p.flowM3h - requiredFlowM3h) / Math.max(1, requiredFlowM3h) + Math.abs(p.headM - requiredHeadM) / Math.max(1, requiredHeadM);
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/**
 * Design!A10:E10 / Motor Price List!H4:H27 - motor selection: same casing size as the selected
 * pump, HP >= the pump's own rated HP, cheapest/smallest qualifying HP wins. A compound casing
 * label (e.g. `6-8"`) cannot be parsed to a single number - the source sheet's own
 * VALUE(SUBSTITUTE(...)) would error in that case too, so no motor is matched (not guessed).
 */
function selectMotor({ pump, motors }) {
  const casingNumeric = /^\d+(\.\d+)?$/.test(pump.casing.replace('"', '')) ? Number(pump.casing.replace('"', '')) : null;
  if (casingNumeric === null) return null;
  const candidates = motors.filter(m => m.casing === casingNumeric && m.hp >= pump.hp);
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.hp < a.hp ? b : a));
}

/** Design!A14:G14 - PV sizing from the selected motor's kW rating. */
function sizePvForMotor({ motorKw, sizingFactor = 1.35, module }) {
  const modulesRequired = ceil((motorKw * sizingFactor * 1000) / module.pmaxW); // D14
  const installedKwp = (modulesRequired * module.pmaxW) / 1000; // E14
  const dcMotorRatio = installedKwp / motorKw; // F14
  return { modulesRequired, installedKwp, dcMotorRatio };
}

/** Design!A40:D40 - string design (modulesPerString is a manual Reservia input, as in on-grid). */
function sizeStrings({ modulesRequired, modulesPerString, module }) {
  const strings = ceil(modulesRequired / modulesPerString); // B40
  const installedModules = modulesPerString * strings; // C40
  const installedKwp = (installedModules * module.pmaxW) / 1000; // D40
  return { strings, installedModules, installedKwp };
}

/** Design!A30:G30 - submersible drop-cable sizing by motor HP and length (wellDepth + 20 + 10 extra). */
function sizeSubmersibleCable({ motorHp, wellDepthM, extraCableM = 10, catalog }) {
  const cableLengthM = wellDepthM + 20 + extraCableM; // D30 = (wellDepth+20) + extra
  const row = catalog.SUBMERSIBLE_CABLE_MAX_LENGTH_BY_HP.find(r => r.hp >= motorHp); // MATCH(TRUE, A>=motorHp, 0): first HP >= target
  if (!row) return { cableLengthM, size: 'Not listed' };
  const idx = row.lengths.findIndex(l => l != null && l >= cableLengthM);
  if (idx === -1) return { cableLengthM, size: 'Not listed' };
  return { cableLengthM, size: catalog.SUBMERSIBLE_CABLE_SIZES[idx] };
}

/** Design!A44:E47 - DC home-run cable by voltage-drop (uses module Imp, NOT Isc - no safety factor, unlike On-Grid). */
function sizeDcCable({ installedKwp, strings, module, stringVmpStc, dcCables, allowanceMPerKwp = 10, maxVoltDropPct = 2, copperResistivity = 0.0175 }) {
  const totalLengthM = ceil(installedKwp * allowanceMPerKwp); // C44
  const oneWayLengthM = totalLengthM / (2 * strings); // D44
  const requiredMm2 = (2 * oneWayLengthM * module.imp * copperResistivity) / ((stringVmpStc * maxVoltDropPct) / 100); // A47
  const sorted = [...dcCables].sort((a, b) => a.sizeMm2 - b.sizeMm2);
  const selected = sorted.find(c => c.sizeMm2 >= requiredMm2);
  if (!selected) throw new Error(`No DC cable >= ${requiredMm2} mm2 in the Price Book`);
  const totalCost = totalLengthM * selected.pricePerM; // E47 = C44*D47 (C44 already covers both polarities)
  return { totalLengthM, requiredMm2, selectedSizeMm2: selected.sizeMm2, pricePerM: selected.pricePerM, totalCost };
}

/** Design!B24 - rising-main pipe diameter BAND from flow. Real formula; the actual priced pipe selection is manual (see file header). */
function pipeDiameterBand(flowM3h) {
  if (flowM3h <= 70) return 3;
  if (flowM3h <= 120) return 4;
  if (flowM3h <= 160) return 5;
  return 6;
}

module.exports = {
  fieldCropFlow,
  treeFlow,
  computeWaterDemand,
  selectPump,
  selectMotor,
  sizePvForMotor,
  sizeStrings,
  sizeSubmersibleCable,
  sizeDcCable,
  pipeDiameterBand,
};
