// Off-Grid engineering + BOQ + diesel-generator feasibility engine.
//
// Ported formula-by-formula from Off_Grid.xlsx, sheets `Load Assessment`, `Design`, `BOQ` and
// `Feasibility Study`. Pure functions - catalog/pricing data always passed in, never hardcoded
// here. Off-Grid is the ONLY one of the three workbooks that has a commercial pricing stack at
// all (contingency 2% + profit 10%, see `priceWithInternalCosting`) - On-Grid and Solar Pumping
// have none (see onGridEngine.js / pumpingEngine.js and the implementation plan's source-mapping
// table).

'use strict';

function ceil(n) {
  return Math.ceil(n);
}
function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Load Assessment!C4:J18 totals - Design!C4/C17 and Feasibility Study!B4/B5 all depend on these. */
function computeLoadTotals(appliances) {
  let dailyWh = 0;
  let dayWh = 0;
  let nightWh = 0;
  let connectedW = 0;
  for (const a of appliances) {
    const qty = Number(a.qty) || 0;
    const watts = Number(a.watts) || 0;
    const hoursPerDay = Number(a.hoursPerDay) || 0;
    const daytimeHours = Math.min(Number(a.daytimeHours) || 0, hoursPerDay);
    const nighttimeHours = hoursPerDay - daytimeHours;
    dailyWh += qty * watts * hoursPerDay; // F column
    dayWh += qty * watts * daytimeHours; // I column
    nightWh += qty * watts * nighttimeHours; // J column = C*D*H, i.e. qty*watts*nightHours - same shape as I
    connectedW += qty * watts; // SUMPRODUCT(C,D) used by Design!C31 and Feasibility!B5
  }
  return { dailyWh, dayWh, nightWh, connectedW };
}

/** Design!C7:C10 - PV sizing from daily energy. */
function sizePv({ dailyWh, peakSunHours, performanceFactor, moduleWattage }) {
  const requiredW = dailyWh / peakSunHours / performanceFactor; // C7
  const modulesRequired = ceil(requiredW / moduleWattage); // C9
  const installedW = modulesRequired * moduleWattage; // C10
  return { requiredW, modulesRequired, installedW };
}

/** Design!C21:C27 - battery sizing from night energy. */
function sizeBattery({ nightWh, autonomyNights, depthOfDischarge, systemEfficiency, batteryUnitVoltage, batteryUnitAh }) {
  const requiredWh = (nightWh * autonomyNights) / (depthOfDischarge * systemEfficiency); // C21
  const unitWh = batteryUnitVoltage * batteryUnitAh; // C24
  const unitsRequired = ceil(requiredWh / unitWh); // C25
  const installedWh = unitsRequired * unitWh; // C26
  const usableWh = installedWh * depthOfDischarge * systemEfficiency; // C27
  return { requiredWh, unitWh, unitsRequired, installedWh, usableWh };
}

/** Design!C34:C42 - inverter count from the larger of AC-power need and PV-input need. */
function sizeInverter({ connectedW, simultaneityFactor, safetyMargin, installedPvW, inverterAcRatingW, maxPvInputW }) {
  const requiredAcW = connectedW * simultaneityFactor * (1 + safetyMargin); // C34
  const unitsRequired = ceil(Math.max(requiredAcW / inverterAcRatingW, installedPvW / maxPvInputW)); // C38
  const installedAcW = inverterAcRatingW * unitsRequired; // C39
  const pass = installedAcW >= requiredAcW && maxPvInputW * unitsRequired >= installedPvW; // C42
  return { requiredAcW, unitsRequired, installedAcW, pass };
}

/** BOQ!F9/F14 - DC cable length rule and the cable-tray-is-half-of-DC-cable rule. */
function dcCableLengthM(installedKwp) {
  return installedKwp <= 15 ? ceil(installedKwp * 10) : ceil(installedKwp * 8);
}

/**
 * BOQ!H27:H33 - the ONLY commercial pricing stack found anywhere in the three source workbooks:
 * contingency (% of base cost) then profit markup (% of base+contingency), then VAT.
 */
function priceWithInternalCosting({ lineItems, contingencyRate = 0.02, profitMarginRate = 0.1, vatRate = 0.14 }) {
  // None of BOQ!H19/H27/H29/H31/H32/H33 are wrapped in ROUND() in the source sheet - raw
  // floating-point values are carried through (e.g. the live example's H19 = 67468.84452000001).
  // Rounding here would quietly diverge from the workbook; left unrounded to match it exactly.
  const baseCost = lineItems.reduce((s, l) => s + l.total, 0); // H27
  const contingency = baseCost * contingencyRate; // H29
  const profit = (baseCost + contingency) * profitMarginRate; // H31
  const quotedPriceExclVat = baseCost + contingency + profit; // H32
  const vat = quotedPriceExclVat * vatRate; // H19
  const grandTotalInclVat = quotedPriceExclVat + vat; // H20
  return { baseCost, contingencyRate, contingency, profitMarginRate, profit, quotedPriceExclVat, vatRate, vat, grandTotalInclVat };
}

/**
 * Runs the full Off-Grid chain (Load Assessment -> Design -> BOQ) for one set of inputs.
 * Catalog unit prices here are plain manual entries in the source workbook (the only item NOT
 * resolved via a brand/model Price Book lookup, unlike On-Grid) - callers pass whatever prices the
 * Material Price List / commercial team has on file, under the same line-item shape.
 */
function runOffGridDesign(input) {
  const {
    appliances, peakSunHours, performanceFactor, moduleWattage, moduleUnitPrice,
    autonomyNights, depthOfDischarge, systemEfficiency, batteryUnitVoltage, batteryUnitAh, batteryUnitPrice,
    simultaneityFactor, safetyMargin, inverterAcRatingW, maxPvInputW, inverterUnitPrice,
    dcCablePricePerM, acLengthM, acCablePricePerM, mc4Pairs, mc4PricePerPair,
    dcProtectionPrice, mountingStructureRatePerKwp, earthingRatePerKwp, miscRatePerKwp,
    installationRatePerKwp, transportationRatePerKwp,
    contingencyRate, profitMarginRate, vatRate,
  } = input;

  const load = computeLoadTotals(appliances);
  const pv = sizePv({ dailyWh: load.dailyWh, peakSunHours, performanceFactor, moduleWattage });
  const battery = sizeBattery({ nightWh: load.nightWh, autonomyNights, depthOfDischarge, systemEfficiency, batteryUnitVoltage, batteryUnitAh });
  const inverter = sizeInverter({ connectedW: load.connectedW, simultaneityFactor, safetyMargin, installedPvW: pv.installedW, inverterAcRatingW, maxPvInputW });

  const installedKwp = pv.installedW / 1000; // Design!C10/1000, used throughout the BOQ
  const dcLenM = dcCableLengthM(installedKwp); // F9
  const trayLenM = dcLenM / 2; // F14

  // BOQ!H5:H17 line totals are plain multiplications, never wrapped in ROUND() either.
  const lineItems = [
    { no: 1, component: 'Solar PV Modules', unit: 'pcs', qty: pv.modulesRequired, unitPrice: moduleUnitPrice, total: pv.modulesRequired * moduleUnitPrice },
    { no: 2, component: 'Battery Bank', unit: 'pcs', qty: battery.unitsRequired, unitPrice: batteryUnitPrice, total: battery.unitsRequired * batteryUnitPrice },
    { no: 3, component: 'Off-Grid Inverter', unit: 'pcs', qty: inverter.unitsRequired, unitPrice: inverterUnitPrice, total: inverter.unitsRequired * inverterUnitPrice },
    { no: 4, component: 'Mounting Structure', unit: 'kWp', qty: installedKwp, unitPrice: mountingStructureRatePerKwp, total: installedKwp * mountingStructureRatePerKwp },
    { no: 5, component: 'DC Cables', unit: 'm', qty: dcLenM, unitPrice: dcCablePricePerM, total: dcLenM * dcCablePricePerM },
    { no: 6, component: 'AC Cables', unit: 'm', qty: acLengthM, unitPrice: acCablePricePerM, total: acLengthM * acCablePricePerM },
    { no: 7, component: 'MC4 Connectors', unit: 'pair', qty: mc4Pairs, unitPrice: mc4PricePerPair, total: mc4Pairs * mc4PricePerPair },
    { no: 8, component: 'DC Protection / Combiner', unit: 'set', qty: 1, unitPrice: dcProtectionPrice, total: dcProtectionPrice },
    { no: 9, component: 'Earthing System', unit: 'kWp', qty: installedKwp, unitPrice: earthingRatePerKwp, total: installedKwp * earthingRatePerKwp },
    { no: 10, component: 'Cable Trays', unit: 'm', qty: trayLenM, unitPrice: miscRatePerKwp.cableTrayPerM ?? 70, total: trayLenM * (miscRatePerKwp.cableTrayPerM ?? 70) },
    { no: 11, component: 'Miscellaneous', unit: 'kWp', qty: installedKwp, unitPrice: miscRatePerKwp.accessoriesPerKwp ?? 150, total: installedKwp * (miscRatePerKwp.accessoriesPerKwp ?? 150) },
    // Installation!!! - the sheet's own note (BOQ!A23, §9 of the Developer Brief) flags this flat
    // 650 EGP/kWp rate as DIFFERENT from the Egypt install Rates matrix (360-480 EGP/kWp) used by
    // On-Grid - preserved exactly as the Off-Grid workbook has it, not reconciled to the other
    // workbook's rate.
    { no: 12, component: 'Installation & Testing', unit: 'kWp', qty: installedKwp, unitPrice: installationRatePerKwp, total: installedKwp * installationRatePerKwp },
  ];
  // Transportation!G17 = F16*500 -> installed kWp * a flat 500 EGP/kWp, itself derived from the
  // installation line's QUANTITY (kWp), not a region/band lookup.
  const transportTotal = installedKwp * transportationRatePerKwp;
  lineItems.push({ no: 13, component: 'Transportation', unit: 'lot', qty: 1, unitPrice: transportTotal, total: transportTotal });

  const pricing = priceWithInternalCosting({ lineItems, contingencyRate, profitMarginRate, vatRate });
  const pricePerKwpExclVat = installedKwp ? pricing.quotedPriceExclVat / installedKwp : null; // H21/H33

  return { load, pv, battery, inverter, installedKwp, lineItems, pricing, pricePerKwpExclVat };
}

module.exports = {
  computeLoadTotals,
  sizePv,
  sizeBattery,
  sizeInverter,
  dcCableLengthM,
  priceWithInternalCosting,
  runOffGridDesign,
};
