'use strict';

const XLSX = require('xlsx');
const ApiError = require('../../../utils/apiError');

// Deal Engine - reads the client's own estimating workbooks (the files in "xlsx data/") into Price
// Book rows, the Rates Matrix and pricing levers. Nothing is typed in by hand and nothing is guessed:
// a blank price stays out (reported), a technical reference row is not a price, a value the
// workbook does not state is not invented. Recognised workbooks:
//   - On_Grid.xlsx                          "Material Price List" (modules, inverters, DC cable,
//                                           mounting, AC breakers, MC4, AC boards) + the Egypt
//                                           installation / transport rates.
//   - Solar_Pumping_Agriculture_R07.xlsx    "Master Price List" (1,521 consolidated records: pumps,
//                                           motors, drives, PV modules, batteries, inverters,
//                                           protections, cables, pipes, panels...) + the
//                                           Agriculture pricing levers on "Cost Summary".
//   - Off_Grid.xlsx, Solar_Pumping3.xlsx    recognised, nothing to import (see the notes returned).
// The shapes match scripts/seedCommercialMaterials.js (same brand / model / spec / attrs names), so
// an item the seed already created is the SAME Price Book item here, not a duplicate.

const MAX_ROWS = 5000;

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const numOrNull = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
const round2 = n => Math.round(n * 100) / 100;
const lower = v => clean(v).toLowerCase();

function sheetRows(wb, name) {
  const sheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === name.toLowerCase());
  if (!sheetName) return null;
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: '', blankrows: true });
}

/** Index of the first row whose first non-empty cell starts with `title` (case-insensitive). */
function findRow(rows, pred, from = 0) {
  for (let i = from; i < rows.length; i += 1) if (pred(rows[i] || [], i)) return i;
  return -1;
}
const startsWith = (title, col = 0) => row => lower(row[col]).startsWith(title.toLowerCase());

/** Data rows after a header row, until the first row whose column `keyCol` is blank. */
function tableAfter(rows, headerIdx, keyCol = 0) {
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const r = rows[i] || [];
    if (clean(r[keyCol]) === '') break;
    out.push({ r, row: i + 1 });
  }
  return out;
}

function detect(wb, fileName) {
  const names = wb.SheetNames.map(n => n.trim().toLowerCase());
  if (names.includes('master price list')) return 'agriculture-master';
  if (names.includes('material price list') && names.includes('on-grid design')) return 'on-grid';
  if (names.includes('pump price list') && names.includes('motor price list')) return 'pumping3';
  if (names.includes('load assessment') && names.includes('design') && names.includes('boq')) return 'off-grid';
  throw new ApiError(`"${fileName}" is not one of the recognised workbooks (On_Grid.xlsx, Solar_Pumping_Agriculture_R07.xlsx, Off_Grid.xlsx, Solar_Pumping3.xlsx).`, 400);
}

/* ------------------------------------------------------------------ On_Grid.xlsx */

function parseOnGrid(wb) {
  const SHEET = 'Material Price List';
  const rows = sheetRows(wb, SHEET);
  const items = [];
  const skipped = [];
  const add = (row, item) => items.push({ ...item, sourceSheet: SHEET, row, currency: 'EGP' });

  // PV modules (title "PV Module", header on the next row).
  const pvT = findRow(rows, startsWith('PV Module'));
  if (pvT >= 0) {
    for (const { r, row } of tableAfter(rows, pvT + 1)) {
      const [brand, model, pmaxW, vmp, imp, voc, isc, coeff, maxDcV, ppw] = r.map(numOrNull).map((n, i) => (i < 2 ? clean(r[i]) : n));
      if (!(pmaxW > 0) || !(ppw > 0)) {
        skipped.push({ row, sheet: SHEET, label: `${brand} ${model}`, reason: 'No price or rated power in the workbook' });
        continue;
      }
      add(row, {
        category: 'PV Modules', brand, model, spec: `${pmaxW}W`, unit: 'pcs', unitPrice: round2(pmaxW * ppw), n1: pmaxW, n2: null,
        attrs: { pmaxW, vmp, imp, voc, isc, vocTempCoeffPctPerC: coeff, maxDcV, pricePerWatt: ppw },
      });
    }
  }

  // On-grid inverters.
  const invT = findRow(rows, startsWith('ON-GRID INVERTERS'));
  if (invT >= 0) {
    for (const { r, row } of tableAfter(rows, invT + 1)) {
      const n = i => numOrNull(r[i]);
      const brand = clean(r[0]);
      const model = clean(r[1]);
      const ratedKw = n(2);
      const price = n(3);
      if (!(ratedKw > 0) || !(price > 0)) {
        skipped.push({ row, sheet: SHEET, label: `${brand} ${model}`, reason: 'No price or rating in the workbook' });
        continue;
      }
      add(row, {
        category: 'On-Grid Inverter', brand, model, spec: `${ratedKw} kW grid-tied`, unit: 'pcs', unitPrice: price, n1: ratedKw, n2: null,
        attrs: { ratedKw, maxDcV: n(4), mpptMinV: n(5), mpptMaxV: n(6), mpptCount: n(12), dcInputs: n(13), inputsPerMppt: n(14), maxPvRecommendedKwp: n(15) },
      });
    }
  }

  // DC cables.
  const dcT = findRow(rows, startsWith('DC CABLES'));
  if (dcT >= 0) {
    for (const { r, row } of tableAfter(rows, dcT + 1)) {
      const brand = clean(r[0]);
      const size = numOrNull(r[1]);
      const price = numOrNull(r[4]);
      if (!(size > 0) || !(price > 0)) {
        skipped.push({ row, sheet: SHEET, label: `${brand} ${r[1]}`, reason: 'No size or price in the workbook' });
        continue;
      }
      add(row, { category: 'DC Cable', brand, model: `${size}mm2`, spec: `${size}mm2`, unit: 'm', unitPrice: price, n1: null, n2: null, attrs: { sizeMm2: size } });
    }
  }

  // Mounting structure (rate per installed kWp).
  const msT = findRow(rows, startsWith('MOUNTING STRUCTURE PRICE LIST'));
  const mounting = {};
  if (msT >= 0) {
    for (const { r, row } of tableAfter(rows, msT + 1)) {
      const type = clean(r[0]);
      const price = numOrNull(r[3]);
      if (!(price > 0)) continue;
      mounting[type] = price;
      add(row, { category: 'Mounting Structure', brand: 'Local', model: type, spec: 'Rate per installed PV kWp', unit: 'kWp', unitPrice: price, n1: null, n2: null, attrs: {} });
    }
  }

  // AC breakers.
  const brH = findRow(rows, startsWith('AC Breaker Rating'));
  if (brH >= 0) {
    for (const { r, row } of tableAfter(rows, brH)) {
      const ratingA = numOrNull(r[0]);
      const type = clean(r[1]);
      const price = numOrNull(r[2]);
      if (!(ratingA > 0) || !(price > 0)) continue;
      add(row, { category: 'AC Breaker', brand: 'Local', model: `${type} ${ratingA} A`, spec: 'Reference price', unit: 'pcs', unitPrice: price, n1: ratingA, n2: null, attrs: { ratingA, type } });
    }
  }

  // MC4 connector (one row under its title).
  const mcT = findRow(rows, startsWith('MC4 CONNECTORS'));
  if (mcT >= 0) {
    const r = rows[mcT + 1] || [];
    const price = numOrNull(r[2]);
    if (price > 0) add(mcT + 2, { category: 'MC4 Connectors', brand: 'Generic', model: 'MC4 PV connector', spec: 'pcs', unit: 'pcs', unitPrice: price, n1: null, n2: null, attrs: {} });
  }

  // AC distribution boards.
  const adbH = findRow(rows, startsWith('Max PV Capacity'));
  if (adbH >= 0) {
    for (const { r, row } of tableAfter(rows, adbH)) {
      const maxPvKwp = numOrNull(r[0]);
      const dims = clean(r[1]).replace(/\s*[×x]\s*/gi, ' x ');
      const price = numOrNull(r[2]);
      if (!(maxPvKwp > 0) || !(price > 0)) continue;
      add(row, { category: 'AC Distribution Board', brand: 'Local', model: `ADB up to ${maxPvKwp} kWp`, spec: dims, unit: 'pcs', unitPrice: price, n1: maxPvKwp, n2: null, attrs: { maxPvKwp, dimensionsCm: dims } });
    }
  }

  // Egypt installation (EGP/kWp) and transport (EGP) rates, five capacity bands per region.
  const regionTable = title => {
    const t = findRow(rows, startsWith(title));
    if (t < 0) return null;
    const out = {};
    for (const { r } of tableAfter(rows, t + 1)) {
      const vals = [1, 2, 3, 4, 5].map(i => numOrNull(r[i]));
      if (vals.every(v => v !== null)) out[clean(r[0])] = vals;
    }
    return Object.keys(out).length ? out : null;
  };
  const install = regionTable('INSTALLATION UNIT RATE');
  const transport = regionTable('TRANSPORTATION COST MATRIX');
  const rates = install && transport ? { country: 'Egypt', install, transport, mounting } : null;

  return {
    items, skipped, rates, pricing: null,
    notes: [
      'VAT on Master Project (Egypt 14%, Saudi Arabia 15%) is the value Pricing Config already uses.',
      'The AC cable size / length and cable-tray tables are engineering reference tables the calculation already carries; they are not Price Book items.',
    ],
  };
}

/* ------------------------------------------------- Solar_Pumping_Agriculture_R07.xlsx */

// R07 "Product Category" -> Price Book category. One place, so a reviewer can see every mapping.
const R07_CATEGORY = {
  pump: 'Submersible Pump',
  motor: 'Pump Motor',
  'solar inverter pump drive': 'Solar Pump Drive',
  pipe: 'Pipe',
  'electrical protections': 'Electrical Protection',
  'dc cable': 'DC Cable',
  'ac cable': 'AC Cable',
  'metallic panels': 'Metallic Panel',
  'ac reactor': 'AC Reactor',
  'dc charger': 'DC Charge Controller',
  'pv modules': 'PV Modules',
  'lithium batteries': 'Lithium Batteries',
  'mounting structure': 'Mounting Structure',
  // 'solar inverter' is split by what the row says it is - solarInverterCategory() below.
};

/**
 * R07 lists grid-tied, battery (off-grid / hybrid with a DC battery bus) and storage-controller
 * inverters under one "Solar Inverter" heading. A battery inverter states its DC battery voltage
 * ("24Vdc", "48Vdc"); a storage controller states its backup port. Everything else is grid-tied.
 */
function solarInverterCategory(model, spec) {
  const text = `${model} ${spec}`;
  if (/\d+(?:\.\d+)?\s*v\s*dc\b/i.test(text) || /\bvdc\b/i.test(text)) return 'Off-Grid Inverter';
  if (/backup port|\bstore\b/i.test(text)) return 'Hybrid Inverter';
  return 'On-Grid Inverter';
}

/** A rating stated in the row's own text (e.g. "166.0 kW", "25.6V 100A") - never derived from a model name. */
const statedNumber = (text, re) => {
  const m = String(text || '').match(re);
  return m ? Number(m[1]) : null;
};

function parseAgricultureMaster(wb) {
  const SHEET = 'Master Price List';
  const rows = sheetRows(wb, SHEET);
  const h = findRow(rows, r => r.some(c => lower(c) === 'product category') && r.some(c => lower(c) === 'item id'));
  if (h < 0) throw new ApiError('"Master Price List" has no header row (Product Category ... Item ID).', 400);
  const header = rows[h].map(lower);
  const col = name => header.indexOf(name.toLowerCase());
  const C = {
    category: col('product category'), brand: col('brand'), model: col('model / item'), material: col('material / construction'),
    motorInch: col('motor type / inch'), hp: col('hp'), kw: col('kw'), pipeInch: col('pipe inch'), pipePrice: col('pipe price'),
    pipeLength: col('pipe length'), pipePressure: col('pipe pressure'), outlet: col('inlet / outlet inch'), motorPrice: col('motor price'),
    pumpPrice: col('pump price'), setPrice: col('set / listed price'), castIron: col('cast iron price'), ss304: col('ss304 price'),
    tech: col('technical specifications'), unitPrice: col('unit price'), currency: col('currency'), unit: col('unit'), origin: col('origin'),
    status: col('price / data status'), voltage: col('voltage v'), phase: col('phase'), maxDcV: col('max dc v'), mpptMinV: col('mppt min v'),
    mpptMaxV: col('mppt max v'), dims: col('dimensions mm'), pmaxW: col('pv rated power w'), vmp: col('vmp v'), imp: col('imp a'), voc: col('voc v'),
    isc: col('isc a'), coeff: col('voc temp coeff %/c'), moduleMaxDcV: col('max module dc v'), areaM2: col('module area m2'), cableMm2: col('cable size mm2'),
    cableCores: col('cable cores'), q: ['q0 m3/h', 'q1 m3/h', 'q2 m3/h', 'q3 m3/h', 'q4 m3/h'].map(col), hd: ['h0 m', 'h1 m', 'h2 m', 'h3 m', 'h4 m'].map(col), id: col('item id'),
  };
  if (C.category < 0 || C.model < 0 || C.id < 0) throw new ApiError('"Master Price List" is missing the Product Category / Model / Item ID columns.', 400);

  const items = [];
  const skipped = [];
  let notStatedCurrency = 0;
  const dataRows = rows.slice(h + 1);
  if (dataRows.length > MAX_ROWS) throw new ApiError(`The master list has more than ${MAX_ROWS} rows.`, 400);

  dataRows.forEach((r, i) => {
    const row = h + 2 + i;
    const v = k => (C[k] >= 0 ? r[C[k]] : '');
    const n = k => numOrNull(v(k));
    const rawCat = lower(v('category'));
    if (!rawCat) return;
    const brand = clean(v('brand'));
    const masterId = clean(v('id'));
    const label = `${brand} ${clean(v('model'))}`.trim();
    const status = clean(v('status'));
    if (/technical reference only/i.test(status)) {
      skipped.push({ row, sheet: SHEET, label, reason: 'Technical reference (cable sizing), not a price', kind: 'reference' });
      return;
    }
    const tech = clean(v('tech'));
    const category = rawCat === 'solar inverter' ? solarInverterCategory(clean(v('model')), tech) : R07_CATEGORY[rawCat];
    if (!category) {
      skipped.push({ row, sheet: SHEET, label, reason: `Unknown product category "${clean(v('category'))}"` });
      return;
    }

    // The price: the row's unit price; a motor is listed cast-iron / SS304 (the Price Book bills the
    // cast-iron price, as the pumping BOQ does); a pipe has its own price column.
    let unitPrice = n('unitPrice');
    if (!(unitPrice > 0) && category === 'Pump Motor') unitPrice = n('castIron') > 0 ? n('castIron') : n('ss304');
    if (!(unitPrice > 0) && category === 'Pipe') unitPrice = n('pipePrice');
    if (!(unitPrice > 0) && n('setPrice') > 0) unitPrice = n('setPrice');
    if (!(unitPrice > 0)) {
      skipped.push({ row, sheet: SHEET, label, reason: status ? `No price in the workbook (${status})` : 'No price in the workbook', kind: 'no-price' });
      return;
    }
    const currencyRaw = clean(v('currency')).toUpperCase();
    if (currencyRaw !== 'EGP') notStatedCurrency += 1;

    let model = clean(v('model'));
    let spec = tech;
    let unit = clean(v('unit')) || 'pcs';
    let n1 = null;
    let n2 = null;
    const attrs = { masterId };

    switch (category) {
      case 'Submersible Pump': {
        const flow = C.q.map(c => numOrNull(r[c]));
        const head = C.hd.map(c => numOrNull(r[c]));
        Object.assign(attrs, { hp: n('hp'), kw: n('kw'), motorInch: clean(v('motorInch')) || null, outlet: clean(v('outlet')) || null, material: clean(v('material')) || null, motorPrice: n('motorPrice'), setPrice: n('setPrice') });
        if (flow.some(x => x !== null)) attrs.flowPointsM3h = flow;
        if (head.some(x => x !== null)) attrs.headPointsM = head;
        spec = [clean(v('material')), clean(v('motorInch')) && `${clean(v('motorInch'))} motor`, n('hp') && `${n('hp')} HP`, clean(v('outlet')) && `${clean(v('outlet'))} outlet`].filter(Boolean).join(', ');
        n1 = n('hp');
        break;
      }
      case 'Pump Motor':
        Object.assign(attrs, { hp: n('hp'), kw: n('kw'), motorInch: clean(v('motorInch')) || null, castIronPrice: n('castIron'), ss304Price: n('ss304') });
        spec = [n('hp') && `${n('hp')} HP`, clean(v('motorInch')) && `${String(clean(v('motorInch'))).replace(/"$/, '')}" motor`, n('castIron') > 0 ? 'cast iron' : 'SS304'].filter(Boolean).join(', ');
        n1 = n('hp');
        n2 = n('kw');
        break;
      case 'Solar Pump Drive':
        Object.assign(attrs, { ratedKw: n('kw'), hp: n('hp'), voltageV: n('voltage'), phase: n('phase'), maxDcV: n('maxDcV'), mpptMinV: n('mpptMinV'), mpptMaxV: n('mpptMaxV') });
        n1 = n('kw');
        break;
      case 'Pipe': {
        const inch = n('pipeInch');
        const pressure = n('pipePressure');
        const length = n('pipeLength');
        const material = clean(v('material'));
        // R07 keeps the ORIGIN in "Model / Item" for pipes - the pipe itself is diameter/material/pressure.
        model = [inch && `${inch}"`, material, pressure && `${pressure} bar`].filter(Boolean).join(' ');
        spec = [length && `${length} m length`, clean(v('origin')) && `origin ${clean(v('origin'))}`].filter(Boolean).join(', ');
        Object.assign(attrs, { diameterInch: inch, pressureBar: pressure, lengthM: length, material: material || null });
        n1 = inch;
        break;
      }
      case 'DC Cable':
      case 'AC Cable':
        if (n('cableMm2') > 0) attrs.sizeMm2 = n('cableMm2');
        if (n('cableCores') > 0) attrs.cores = n('cableCores');
        unit = 'm';
        break;
      case 'PV Modules': {
        const pmaxW = n('pmaxW');
        Object.assign(attrs, { pmaxW, vmp: n('vmp'), imp: n('imp'), voc: n('voc'), isc: n('isc'), vocTempCoeffPctPerC: n('coeff'), maxDcV: n('moduleMaxDcV'), areaM2: n('areaM2'), dimensionsMm: clean(v('dims')) || null });
        if (pmaxW > 0) {
          attrs.pricePerWatt = Math.round((unitPrice / pmaxW) * 1e6) / 1e6;
          spec = `${pmaxW}W`; // the Price Book's module spec, as the On_Grid.xlsx items carry it
        }
        n1 = pmaxW;
        break;
      }
      case 'Lithium Batteries': {
        const voltageV = statedNumber(tech, /(\d+(?:\.\d+)?)\s*V\b/i);
        const capacityAh = statedNumber(tech, /(\d+(?:\.\d+)?)\s*A(?:h)?\b/i);
        Object.assign(attrs, { voltageV, capacityAh });
        n1 = voltageV;
        n2 = capacityAh;
        break;
      }
      case 'Off-Grid Inverter':
      case 'Hybrid Inverter':
      case 'On-Grid Inverter': {
        const kw = statedNumber(tech, /(\d+(?:\.\d+)?)\s*kw\b/i);
        if (kw > 0) attrs.ratedKw = kw;
        if (category === 'Off-Grid Inverter') {
          const vdc = statedNumber(tech, /(\d+(?:\.\d+)?)\s*v\s*dc\b/i);
          if (vdc > 0) attrs.batteryVoltageV = vdc;
        }
        n1 = kw;
        break;
      }
      default:
        break;
    }
    // Strip nulls so an absent value never overwrites a value an editor entered.
    for (const k of Object.keys(attrs)) if (attrs[k] === null || attrs[k] === '' || (Array.isArray(attrs[k]) && !attrs[k].length)) delete attrs[k];
    items.push({ category, brand: brand || 'Unbranded', model: model || masterId, spec, unit, unitPrice: round2(unitPrice), currency: 'EGP', n1: n1 ?? null, n2: n2 ?? null, attrs, sourceSheet: SHEET, row, masterId });
  });

  // Agriculture pricing levers (Cost Summary "COMMERCIAL PRICING & PROFITABILITY").
  let pricing = null;
  const cs = sheetRows(wb, 'Cost Summary');
  if (cs) {
    const lever = label => {
      const i = findRow(cs, rr => lower(rr[1]).startsWith(label));
      if (i < 0) return null;
      const vals = cs[i].slice(2, 5).map(numOrNull).filter(x => x !== null && x >= 0 && x < 1);
      return vals.length ? vals[0] : null;
    };
    const levers = {
      overheadPct: lever('overhead / total cogs'),
      contingencyPct: lever('contingency / total cogs'),
      profitPct: lever('profit markup / total cogs'),
      salesBonusPct: lever('sales incentive / markup pool'),
      engineeringIncentivePct: lever('engineering incentive / markup pool'),
      categoryAdditionPct: lever('category profit addition / base price'),
    };
    for (const k of Object.keys(levers)) if (levers[k] === null) delete levers[k];
    if (Object.keys(levers).length) pricing = { category: 'Agriculture Pumping', levers, sourceSheet: 'Cost Summary' };
  }

  const notes = [
    'Pump flow/head curves are stored on each pump; the pumping calculation keeps its current pump-selection table (not changed by this import).',
    'Installation & testing for pumping (Master Project: EGP 450/kWp Cairo, 650/kWp elsewhere) is not part of the Price Book and is not imported.',
  ];
  if (notStatedCurrency) notes.push(`${notStatedCurrency} priced rows state no currency ("Not stated"); they are Egyptian supplier lists and are imported in EGP.`);
  return { items, skipped, rates: null, pricing, notes };
}

/* ------------------------------------------------------------------ entry point */

/** Parses an uploaded workbook. Returns { kind, title, items, skipped, rates, pricing, notes }. */
function parseWorkbook({ buffer, originalname }) {
  if (!buffer || !buffer.length) throw new ApiError('Choose the workbook (.xlsx) to import.', 400);
  const fileName = String(originalname || 'workbook.xlsx').slice(0, 200);
  if (!/\.xlsx$/i.test(fileName)) throw new ApiError('Upload the Excel workbook (.xlsx).', 400);
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellFormula: false, cellHTML: false });
  } catch {
    throw new ApiError('The file could not be read as an Excel workbook.', 400);
  }
  const kind = detect(wb, fileName);
  const base = { fileName, kind };
  if (kind === 'on-grid') return { ...base, title: 'On-Grid price list and Egypt rates', ...parseOnGrid(wb) };
  if (kind === 'agriculture-master') return { ...base, title: 'Agriculture master price list (R07)', ...parseAgricultureMaster(wb) };
  const empty = { items: [], skipped: [], rates: null, pricing: null };
  if (kind === 'pumping3') {
    return { ...base, title: 'Solar pumping workbook', ...empty, notes: ['Every price list in this workbook (pumps, motors, pump drives, pipes, DC cable) is consolidated in Solar_Pumping_Agriculture_R07.xlsx\'s Master Price List - import that workbook instead. Nothing was read from this file.'] };
  }
  return { ...base, title: 'Off-Grid design workbook', ...empty, notes: ['Off_Grid.xlsx is a design calculator: its BOQ prices are typed-in examples, not a price list. Batteries and off-grid inverters are imported from the R07 Master Price List. Nothing was read from this file.'] };
}

module.exports = { parseWorkbook, solarInverterCategory, R07_CATEGORY };
