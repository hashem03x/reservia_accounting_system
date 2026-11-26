'use strict';

const mongoose = require('mongoose');
const XLSX = require('xlsx');
const { parse: parseCsv } = require('csv-parse/sync');
const ApiError = require('../../utils/apiError');
const Supplier = require('../../models/commercial/supplierModel');
const MaterialItem = require('../../models/commercial/materialItemModel');
const Upload = require('../../models/commercial/priceListUploadModel');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const pricingConfigService = require('./pricingConfigService');
const { engineSettings } = require('./dealEngineSettings');
const { assertCanAccessEnginePage } = require('../../utils/commercial/dealEnginePermissions');
const { canonicalMaterialKey } = require('../../utils/commercial/materialKey');

// Deal Engine C21-C24 / Spec Part 2 section 5 - supplier price list upload. Nothing is written to the
// Price Book without a preview; the confirm writes only the rows shown as Update (and New rows the
// user ticked); every confirmed upload can be rolled back on its own.
//
//   preview: read CSV/XLSX -> propose the column mapping (the supplier's saved one first, else by
//            header name) -> match each row to a Price Book key (brand | model | spec, case and space
//            insensitive) -> current price, new price, change %, availability, status
//            (Update / New / Unchanged / Error). Errors: missing price, unknown unit, duplicate key,
//            currency without a rate, missing rated value (C22).
//   confirm: writes each price with the supplier code, check date = upload date, validity date and
//            source = file name; keeps the previous entry on the upload for rollback; flags every
//            open revision using a changed item "Price changed since calculation" (C24).

const FIELDS = ['category', 'brand', 'model', 'spec', 'unit', 'unitPrice', 'currency', 'availability', 'leadTimeDays', 'minQuantity', 'ratedValue', 'ratedUnit', 'validityDate'];
const REQUIRED_FIELDS = ['category', 'brand', 'model', 'unitPrice'];
// Header names recognised for each field (the A2 template's headers first).
// Matched against normalizeHeader(header): lower case, camelCase split, punctuation removed and a
// trailing "(EGP)"-style currency note dropped - so "Unit Price (EGP)", "UnitPrice", "unit_price"
// and "Unit price" all read as "unit price". The template's own headers are unchanged.
const SYNONYMS = {
  category: ['category', 'item category', 'type', 'product category'],
  brand: ['brand', 'manufacturer', 'make', 'brand name'],
  model: ['model', 'model code', 'part number', 'item', 'model no', 'model number', 'part no', 'item code'],
  spec: ['spec', 'specification', 'specifications', 'description', 'item description'],
  unit: ['unit', 'uom', 'unit of measure'],
  unitPrice: ['unit price', 'price', 'unit cost', 'cost', 'net price', 'purchase price', 'price per unit', 'unit rate', 'rate', 'list price', 'net unit price', 'cost price', 'supplier price', 'dealer price'],
  currency: ['currency', 'ccy', 'cur'],
  availability: ['availability', 'stock', 'status', 'stock status'],
  leadTimeDays: ['lead time days', 'lead time', 'delivery days', 'delivery time', 'lead time in days'],
  minQuantity: ['minimum quantity', 'min qty', 'moq', 'minimum order', 'minimum order quantity'],
  ratedValue: ['rated value', 'rating', 'power', 'rated power'],
  ratedUnit: ['rated unit', 'rating unit'],
  validityDate: ['validity date', 'valid until', 'validity', 'valid to', 'expiry date'],
};
const UNITS = ['pcs', 'm', 'kwp', 'roll', 'set', 'lot', 'pair'];
const CURRENCIES = ['EGP', 'USD', 'EUR', 'CNY'];
// C22: categories whose sizing depends on a rated value, and the unit it must be in.
const RATED = {
  'PV Modules': 'W',
  'On-Grid Inverter': 'kW',
  'Solar Inverter (off-grid)': 'kW',
  'Off-Grid Inverter': 'kW',
  'Solar Pump Drive': 'kW',
  'Lithium Batteries': 'Ah',
  'DC Cable': 'mm2',
  'AC Cable': 'mm2',
};
const RATED_ATTR = { W: 'pmaxW', kW: 'ratedKw', Ah: 'capacityAh', mm2: 'sizeMm2' };
const MAX_ROWS = 2000;

const norm = v => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const keyOf = (brand, model, spec) => `${String(brand).trim()} | ${String(model).trim()} | ${String(spec ?? '').trim()}`;

/** "Unit Price (EGP)" / "UnitPrice" / "unit_price" -> "unit price" (see SYNONYMS). */
function normalizeHeader(h) {
  return String(h ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\((egp|usd|eur|cny|rmb|le|l\.e\.?|\$|€|¥)\)|\[(egp|usd|eur|cny)\]/g, ' ')
    .replace(/\b(in )?(egp|usd|eur|cny)\b$/, ' ')
    .replace(/[_\-./:#()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const headerMatches = (field, h) => SYNONYMS[field].includes(normalizeHeader(h)) || SYNONYMS[field].includes(norm(h));

/** A currency stated in the price column's header ("Unit Price (USD)") - used when there is no currency column. */
function currencyFromHeader(h) {
  const m = String(h || '').toUpperCase().match(/\b(EGP|USD|EUR|CNY|RMB)\b|\$|€|¥/);
  if (!m) return null;
  const c = m[1] || { $: 'USD', '€': 'EUR', '¥': 'CNY' }[m[0]];
  return c === 'RMB' ? 'CNY' : c;
}

/**
 * The header row: suppliers' own lists often carry a title/address block above the table, so the
 * first 20 rows are scanned for the one that names a price column and the most other known fields.
 */
function findHeaderRow(matrix) {
  let best = { idx: -1, score: 0 };
  for (let i = 0; i < Math.min(matrix.length, 20); i += 1) {
    const row = matrix[i] || [];
    if (!row.some(h => headerMatches('unitPrice', h))) continue;
    const score = FIELDS.filter(f => row.some(h => headerMatches(f, h))).length;
    if (score > best.score) best = { idx: i, score };
  }
  return best.idx;
}

/** Reads the first sheet with a header row (CSV or XLSX). Returns { headers, rows: [{header: value}] }. */
function readFile({ buffer, originalname }) {
  const name = String(originalname || '').toLowerCase();
  let matrix;
  if (name.endsWith('.csv')) {
    matrix = parseCsv(buffer.toString('utf8').replace(/^﻿/, ''), { relax_column_count: true, skip_empty_lines: true });
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    // The template's first sheet is "Price list"; any sheet with a price header row works.
    const sheets = wb.SheetNames.map(n => ({ n, m: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true }) }));
    matrix = (sheets.find(s => findHeaderRow(s.m) >= 0) || sheets[0]).m;
  } else {
    throw new ApiError('Upload a CSV or XLSX file.', 400);
  }
  const headerIdx = Math.max(0, findHeaderRow(matrix));
  const headers = (matrix[headerIdx] || []).map(h => String(h).trim());
  if (!headers.filter(Boolean).length) throw new ApiError('The file has no header row.', 400);
  const body = matrix.slice(headerIdx + 1).filter(r => r.some(c => String(c ?? '').trim() !== ''));
  if (body.length > MAX_ROWS) throw new ApiError(`At most ${MAX_ROWS} rows per upload (this file has ${body.length}).`, 400);
  // rowNo = the row number the user sees in Excel (header row + 1-based).
  return { headers, headerRowNo: headerIdx + 1, rows: body.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]]))) };
}

/** Field -> header. The supplier's saved mapping wins where its header is still present; else by name. */
function proposeMapping(headers, saved = null) {
  const mapping = {};
  for (const f of FIELDS) {
    if (saved && saved[f] && headers.includes(saved[f])) mapping[f] = saved[f];
    else mapping[f] = headers.find(h => headerMatches(f, h)) || null;
  }
  return mapping;
}

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
/**
 * A spreadsheet price as a number: numbers as they are; text with a currency symbol or code,
 * thousands separators, Arabic-Indic digits or a decimal comma ("1.250,50") is read correctly.
 * Anything else is null - reported as "Missing price", never read as 0.
 */
function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(ARABIC_DIGITS, d => {
    const c = d.charCodeAt(0);
    return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
  });
  s = s.replace(/٫/g, '.').replace(/٬/g, ',');
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/^[^\d-]+/, ''));
  s = s.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the LAST one is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // Only commas: thousands groups ("12,500" / "1,250,000") unless it is a single decimal comma ("12,5").
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.split(',').length === 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, ''); // "1.250.000"
  }
  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}
function toDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v).trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Pricing confidentiality (26 Nov 2026): supplier price lists are uploaded, confirmed, discounted and
 * rolled back by the MD, the Sales and Commercial Director or BDM only (ENGINE_PAGE_MATRIX.priceLists) -
 * Procurement no longer handles prices. Checked against the authenticated user's own Commercial roles.
 */
function assertEditor(roles) {
  assertCanAccessEnginePage(roles, 'priceLists', 'edit');
}

/** Builds the preview rows. Pure apart from the Price Book and config reads. */
async function buildPreview({ supplier, headers, rows, mapping, validityDate, headerRowNo = 1 }) {
  for (const f of REQUIRED_FIELDS) if (!mapping[f]) throw new ApiError(`Map a column to "${f}" (required).`, 400);
  for (const [f, h] of Object.entries(mapping)) if (h && !headers.includes(h)) throw new ApiError(`Column "${h}" (mapped to ${f}) is not in the file.`, 400);

  const config = await pricingConfigService.getActiveConfig();
  const fx = engineSettings(config).fxRatesEgp || {};
  const items = await MaterialItem.find({ archived: false }).select('key keyNorm category unitPrice currency supplierPrices status').lean();
  // 2026 QA fix: matched by the canonical key (utils/commercial/materialKey.js - case, whitespace,
  // punctuation and common unit-format insensitive), not a bare lowercase/trim of the display
  // `key` string, so "SUN2000-60KTL-M0"/"60 kW" and "sun2000 60ktl m0"/"60kw" resolve to the SAME
  // Price Book item instead of creating a duplicate. Legacy items saved before `keyNorm` existed
  // fall back to computing it on the fly here (it is auto-set on their next save regardless).
  const byKey = new Map(items.map(it => [it.keyNorm || canonicalMaterialKey({ brand: it.key.split('|')[0], model: it.key.split('|')[1], spec: it.key.split('|')[2] }), it]));
  const seen = new Map();
  const get = (row, f) => (mapping[f] ? row[mapping[f]] : undefined);

  const out = rows.map((row, i) => {
    const errors = [];
    const category = String(get(row, 'category') ?? '').trim();
    const brand = String(get(row, 'brand') ?? '').trim();
    const model = String(get(row, 'model') ?? '').trim();
    const spec = String(get(row, 'spec') ?? '').trim();
    if (!category) errors.push('Missing category');
    if (!brand || !model) errors.push('Missing brand or model');
    const key = keyOf(brand, model, spec);
    const nk = canonicalMaterialKey({ brand, model, spec });
    if (brand && model) {
      if (seen.has(nk)) errors.push(`Duplicate key (also on row ${seen.get(nk)})`);
      else seen.set(nk, headerRowNo + 1 + i);
    }
    const rawPrice = get(row, 'unitPrice');
    const price = toNumber(rawPrice);
    // Each case named, so a blank price is never shown as an empty value nor imported as 0.
    if (rawPrice === undefined || rawPrice === null || String(rawPrice).trim() === '') errors.push('Missing price');
    else if (price === null) errors.push(`Price "${String(rawPrice).slice(0, 40)}" is not a number`);
    else if (price <= 0) errors.push('Price must be greater than 0');
    const unitRaw = norm(get(row, 'unit') || 'pcs');
    const unit = unitRaw === 'pc' ? 'pcs' : unitRaw;
    if (!UNITS.includes(unit)) errors.push(`Unknown unit "${get(row, 'unit')}"`);
    // Currency: the row's own column, else one stated in the price header ("Unit Price (USD)"), else the supplier's terms.
    const currency = String(get(row, 'currency') || currencyFromHeader(mapping.unitPrice) || supplier.terms?.currency || 'EGP').trim().toUpperCase().replace(/^RMB$/, 'CNY');
    let rate = null;
    if (!CURRENCIES.includes(currency)) errors.push(`Unknown currency "${currency}"`);
    else if (currency !== 'EGP') {
      // `??` not `||`: a rate can never legitimately be 0 (validated >= 0.0001 on save,
      // dealEngineSettings.js), but `??` is the precise "missing" check either way - never treats
      // a real, validated rate as absent.
      rate = fx[currency] ?? null;
      if (!rate) errors.push(`Currency without rate: enter the ${currency} rate on Pricing Configuration first`);
    }
    const egp = price !== null && (currency === 'EGP' || rate) ? Math.round(price * (currency === 'EGP' ? 1 : rate) * 100) / 100 : null;
    // C22 - rated values the sizing depends on.
    const ratedUnitNeeded = RATED[category] || null;
    const ratedValue = toNumber(get(row, 'ratedValue'));
    const ratedUnit = String(get(row, 'ratedUnit') || '').trim();
    if (ratedUnitNeeded) {
      if (ratedValue === null || ratedValue <= 0) errors.push(`Rated value missing (${ratedUnitNeeded} for ${category})`);
      else if (ratedUnit && norm(ratedUnit) !== norm(ratedUnitNeeded)) errors.push(`Rated unit must be ${ratedUnitNeeded} for ${category}, not "${ratedUnit}"`);
    }
    const availRaw = norm(get(row, 'availability') || 'in stock');
    const availability = availRaw.startsWith('lead') ? 'Lead time' : 'In stock';
    const leadTimeDays = toNumber(get(row, 'leadTimeDays'));
    const minQuantity = toNumber(get(row, 'minQuantity'));
    const rowValidity = toDate(get(row, 'validityDate')) || validityDate || null;

    const item = brand && model ? byKey.get(nk) : null;
    if (item && item.category !== category && category) errors.push(`Category "${category}" differs from the Price Book item's "${item.category}"`);
    const previous = item ? (item.supplierPrices || []).find(sp => String(sp.supplier) === String(supplier._id)) : null;
    const current = previous ? previous.unitPrice : item ? item.unitPrice : null;
    const changePct = current && egp !== null ? Math.round(((egp - current) / current) * 10000) / 100 : null;
    let status;
    if (errors.length) status = 'Error';
    else if (!item) status = 'New';
    else if (previous && Math.abs(previous.unitPrice - egp) < 0.005 && String(previous.validUntil || '') === String(rowValidity || '') && previous.availability === availability) status = 'Unchanged';
    else status = 'Update';
    return {
      rowNo: headerRowNo + 1 + i, key, itemId: item ? item._id : null, category, brand, model, spec, unit,
      price, currency, fxRate: rate, egp, current, currentSource: previous ? 'this supplier' : item ? 'Price Book' : null, changePct,
      availability, leadTimeDays, minQuantity, ratedValue, ratedUnit: ratedUnitNeeded || ratedUnit || null, validUntil: rowValidity,
      status, errors,
    };
  });
  const summary = out.reduce((s, r) => ({ ...s, [r.status]: (s[r.status] || 0) + 1 }), { total: out.length });
  return { rows: out, summary };
}

async function previewUpload(supplierId, { file, mapping: mappingInput, validityDate }, { user, role, roles }) {
  assertEditor(roles || [role]);
  if (!file || !file.buffer) throw new ApiError('Choose the price list file (CSV or XLSX).', 400);
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) throw new ApiError('Supplier not found.', 404);
  if (['Suspended', 'Removed'].includes(supplier.status)) throw new ApiError(`${supplier.code} is ${supplier.status} - its prices would never be used. Change its status first.`, 400);
  const { headers, rows, headerRowNo } = readFile(file);
  if (!rows.length) throw new ApiError('The file has no data rows.', 400);
  let mapping = proposeMapping(headers, supplier.columnMapping);
  if (mappingInput) {
    const m = typeof mappingInput === 'string' ? JSON.parse(mappingInput) : mappingInput;
    for (const f of FIELDS) if (m[f] !== undefined) mapping[f] = m[f] || null;
  }
  const validity = validityDate ? toDate(validityDate) : null;
  if (validityDate && !validity) throw new ApiError('The quote validity date is not a valid date.', 400);
  const { rows: preview, summary } = await buildPreview({ supplier, headers, rows, mapping, validityDate: validity, headerRowNo });
  const upload = await Upload.create({
    supplier: supplier._id, supplierCode: supplier.code, supplierName: supplier.legalName, supplierStatus: supplier.status, fileName: String(file.originalname || 'upload').slice(0, 200), validityDate: validity,
    mapping, headers, rows: preview, summary, uploadedBy: user._id, uploadedByName: user.name || null,
  });
  return upload;
}

/** Revisions still open for quoting that price from one of the items (C24). */
async function flagOpenRevisions(items) {
  const keys = items.map(i => i.key);
  const models = items.map(i => i.model);
  const filter = {
    isCurrent: true,
    $or: [{ 'boqLines.materialItemKey': { $in: keys } }, { 'boqLines.description': { $in: models } }, { 'engineeringInput.pvModuleModel': { $in: models } }, { 'engineeringResult.inverter.model': { $in: models } }],
  };
  const revisions = await CommercialRevision.find(filter).select('_id boqLines.materialItemKey boqLines.description engineeringInput.pvModuleModel engineeringResult.inverter.model priceChangedItems').lean();
  let n = 0;
  for (const r of revisions) {
    const used = new Set([...(r.boqLines || []).flatMap(l => [l.materialItemKey, l.description]), r.engineeringInput?.pvModuleModel, r.engineeringResult?.inverter?.model].filter(Boolean));
    const hit = items.filter(i => used.has(i.key) || used.has(i.model)).map(i => i.key);
    if (!hit.length) continue;
    // eslint-disable-next-line no-await-in-loop
    await CommercialRevision.updateOne({ _id: r._id }, { $set: { priceChangedSinceCalculation: true }, $addToSet: { priceChangedItems: { $each: hit } } });
    n += 1;
  }
  return n;
}

async function confirmUpload(uploadId, { createNew = [] } = {}, { user, role, roles }) {
  assertEditor(roles || [role]);
  if (!mongoose.isValidObjectId(uploadId)) throw new ApiError('Invalid upload id.', 400);
  // Claim the upload (only a 'previewed' upload can be confirmed, once).
  const upload = await Upload.findOneAndUpdate({ _id: uploadId, status: 'previewed' }, { $set: { status: 'confirmed', confirmedBy: user._id, confirmedAt: new Date() } }, { new: true });
  if (!upload) throw new ApiError('This upload was already confirmed or rolled back - upload the file again.', 409);
  const supplier = await Supplier.findById(upload.supplier);
  const checkedAt = upload.createdAt;
  const wanted = new Set((createNew || []).map(Number));
  const changes = [];
  const changedItems = [];
  try {
    for (const row of upload.rows) {
      const isNew = row.status === 'New' && wanted.has(row.rowNo);
      if (row.status !== 'Update' && !isNew) continue;
      const entry = {
        supplier: supplier._id, supplierCode: supplier.code, unitPrice: row.egp, foreignPrice: row.currency !== 'EGP' ? row.price : null, currency: row.currency, fxRate: row.fxRate,
        availability: row.availability, leadTimeDays: row.leadTimeDays, minQuantity: row.minQuantity, checkedAt, validUntil: row.validUntil || null, sourceFile: upload.fileName, upload: upload._id,
      };
      let item;
      let before = null;
      if (isNew) {
        const attr = RATED_ATTR[RATED[row.category]];
        // New items carry the rated value only; electrical data must be completed before the engine
        // sizes with them, so they start as PLACEHOLDER (kept out of the engine catalogs).
        // eslint-disable-next-line no-await-in-loop
        item = await MaterialItem.create({
          category: row.category, brand: row.brand, model: row.model, spec: row.spec, unit: row.unit, n1: row.ratedValue ?? null, attrs: attr ? { [attr]: row.ratedValue } : {},
          unitPrice: row.egp, currency: 'EGP', status: 'PLACEHOLDER', sourceWorkbook: `Supplier upload ${supplier.code}`, sourceSheet: upload.fileName, key: row.key, supplierPrices: [entry], createdBy: user._id,
        });
      } else {
        // eslint-disable-next-line no-await-in-loop
        item = await MaterialItem.findById(row.itemId);
        if (!item) continue;
        const idx = item.supplierPrices.findIndex(sp => String(sp.supplier) === String(supplier._id));
        if (idx >= 0) {
          before = item.supplierPrices[idx].toObject();
          item.supplierPrices.splice(idx, 1);
        }
        item.supplierPrices.push(entry);
        item.priceHistory.push({ price: row.egp, currency: 'EGP', effectiveDate: checkedAt, changedBy: user._id });
        // eslint-disable-next-line no-await-in-loop
        await item.save();
      }
      changes.push({ item: item._id, itemKey: item.key, created: isNew, before, after: entry });
      changedItems.push({ key: item.key, model: item.model });
    }
  } catch (err) {
    // Undo what was written, so a failed confirm leaves the Price Book as it was.
    // eslint-disable-next-line no-use-before-define
    await revertChanges(changes).catch(() => {});
    await Upload.updateOne({ _id: upload._id }, { $set: { status: 'previewed', confirmedBy: null, confirmedAt: null } });
    throw err;
  }
  upload.changes = changes;
  // Accurate counts after the write (the preview summary counts rows, not what was written).
  upload.summary = { ...(upload.summary || {}), imported: changes.length, created: changes.filter(c => c.created).length, updated: changes.filter(c => !c.created).length };
  upload.markModified('summary');
  upload.supplierName = supplier.legalName;
  upload.supplierStatus = supplier.status;
  upload.flaggedRevisions = await flagOpenRevisions(changedItems);
  await upload.save();
  supplier.columnMapping = upload.mapping; // C21: reused on the next upload
  supplier.notes.push({ by: user._id, byName: user.name || null, kind: 'upload', text: `Price list "${upload.fileName}" confirmed: ${changes.length} price(s) written, ${upload.flaggedRevisions} open revision(s) flagged.` });
  await supplier.save();
  return upload;
}

async function revertChanges(changes) {
  for (const c of [...changes].reverse()) {
    if (c.created) {
      // eslint-disable-next-line no-await-in-loop
      await MaterialItem.deleteOne({ _id: c.item, supplierPrices: { $size: 1 } });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const item = await MaterialItem.findById(c.item);
    if (!item) continue;
    const supplierId = String(c.after.supplier);
    item.supplierPrices = item.supplierPrices.filter(sp => String(sp.supplier) !== supplierId);
    if (c.before) item.supplierPrices.push(c.before);
    // eslint-disable-next-line no-await-in-loop
    await item.save();
  }
}

/** C21: rollback restores the previous prices for THIS upload only. */
async function rollbackUpload(uploadId, { user, role, roles }) {
  assertEditor(roles || [role]);
  if (!mongoose.isValidObjectId(uploadId)) throw new ApiError('Invalid upload id.', 400);
  const upload = await Upload.findById(uploadId);
  if (!upload) throw new ApiError('Upload not found.', 404);
  if (upload.status !== 'confirmed') throw new ApiError('Only a confirmed upload can be rolled back.', 400);
  // A later upload from the same supplier that changed the same items wins - refuse to undo under it.
  const later = await Upload.findOne({ supplier: upload.supplier, status: 'confirmed', confirmedAt: { $gt: upload.confirmedAt }, 'changes.itemKey': { $in: upload.changes.map(c => c.itemKey) } }).select('fileName').lean();
  if (later) throw new ApiError(`A later upload ("${later.fileName}") changed the same items - roll that one back first.`, 409);
  await revertChanges(upload.changes);
  upload.status = 'rolledBack';
  upload.rolledBackBy = user._id;
  upload.rolledBackAt = new Date();
  await upload.save();
  await flagOpenRevisions(upload.changes.map(c => ({ key: c.itemKey, model: c.itemKey.split(' | ')[1] || '' })));
  await Supplier.updateOne({ _id: upload.supplier }, { $push: { notes: { by: user._id, byName: user.name || null, kind: 'upload', text: `Price list "${upload.fileName}" rolled back (${upload.changes.length} price(s) restored).`, at: new Date() } } });
  return upload;
}

/**
 * A blanket percentage discount (or markup, if `pct` is negative) across every Price Book item
 * this supplier currently prices - no file to prepare/upload for a quick "everything 5% off this
 * month" from the supplier. Written through the SAME upload/change record the file flow uses
 * (confirmUpload's own shape), so the existing rollback, price history and C24 "flag open
 * revisions using a changed item" all apply to it unchanged - this is not a second price-change
 * mechanism, just a second way to produce one.
 */
async function applyPercentageDiscount(supplierId, { pct, note } = {}, { user, role, roles }) {
  assertEditor(roles || [role]);
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) throw new ApiError('Supplier not found.', 404);
  if (['Suspended', 'Removed'].includes(supplier.status)) throw new ApiError(`${supplier.code} is ${supplier.status} - its prices would never be used. Change its status first.`, 400);
  const p = Number(pct);
  if (!Number.isFinite(p) || p <= 0 || p > 100) throw new ApiError('Enter a discount percentage greater than 0 and up to 100.', 400);

  const items = await MaterialItem.find({ archived: false, 'supplierPrices.supplier': supplier._id }).select('key model supplierPrices priceHistory');
  if (!items.length) throw new ApiError(`${supplier.code} has no current prices in the Price Book to discount - upload a price list first.`, 400);

  const checkedAt = new Date();
  const changes = [];
  const changedItems = [];
  const factor = 1 - p / 100;
  for (const item of items) {
    const idx = item.supplierPrices.findIndex(sp => String(sp.supplier) === String(supplier._id));
    if (idx < 0) continue; // guard only - the query above already requires this
    const before = item.supplierPrices[idx].toObject();
    const unitPrice = Math.round(before.unitPrice * factor * 100) / 100;
    const foreignPrice = before.foreignPrice != null ? Math.round(before.foreignPrice * factor * 100) / 100 : null;
    const entry = { ...before, unitPrice, foreignPrice, checkedAt, sourceFile: `Percentage discount (-${p}%)`, upload: null };
    item.supplierPrices.splice(idx, 1);
    item.supplierPrices.push(entry);
    item.priceHistory.push({ price: unitPrice, currency: 'EGP', effectiveDate: checkedAt, changedBy: user._id });
    // eslint-disable-next-line no-await-in-loop
    await item.save();
    changes.push({ item: item._id, itemKey: item.key, created: false, before, after: entry });
    changedItems.push({ key: item.key, model: item.model });
  }

  const upload = await Upload.create({
    // `mapping` is a genuinely empty `{}` for a discount (there is no file/column mapping) - but
    // Mongoose's Mixed `required` check sees an empty object read back from storage as unset, so
    // this uses a one-key marker instead of a bare `{}` to stay truthy across a save-after-fetch
    // (exactly what rollbackUpload below does).
    supplier: supplier._id, supplierCode: supplier.code, kind: 'discount', discountPct: p,
    fileName: `Percentage discount (-${p}%)`, mapping: { discount: true }, headers: [], rows: [], summary: { total: changes.length, Update: changes.length },
    status: 'confirmed', uploadedBy: user._id, uploadedByName: user.name || null, confirmedBy: user._id, confirmedAt: checkedAt, changes,
  });
  upload.flaggedRevisions = await flagOpenRevisions(changedItems);
  await upload.save();
  supplier.notes.push({ by: user._id, byName: user.name || null, kind: 'upload', text: `Percentage discount of ${p}% applied to ${changes.length} price(s)${note ? ` - ${String(note).trim().slice(0, 300)}` : ''}.` });
  await supplier.save();
  return upload;
}

/** Whether the Deal Engine prices from this supplier at all (supplierPricing.effectivePrice). */
const pricesBoq = status => status === 'Approved' || status === 'Conditional';

/**
 * Upload records with the supplier's CURRENT name and status (an upload made before supplierName was
 * stored, or a supplier renamed since, still shows the right name - never an id or a blank).
 */
async function withSupplier(uploads) {
  const ids = [...new Set(uploads.map(u => String(u.supplier)))];
  const sups = await Supplier.find({ _id: { $in: ids } }).select('code legalName status').lean();
  const byId = new Map(sups.map(x => [String(x._id), x]));
  return uploads.map(u => {
    const sup = byId.get(String(u.supplier));
    const rows = u.rows || [];
    return {
      ...u,
      supplierName: sup?.legalName || u.supplierName || null,
      supplierStatus: sup?.status || u.supplierStatus || null,
      supplierPricesBoq: pricesBoq(sup?.status),
      // Counts for the history table even when rows are not sent.
      counts: {
        rows: u.summary?.total ?? rows.length,
        errors: u.summary?.Error ?? rows.filter(r => r.status === 'Error').length,
        imported: u.status === 'previewed' ? 0 : u.summary?.imported ?? (u.changes || []).length,
      },
    };
  });
}

async function listUploads(supplierId) {
  const uploads = await Upload.find({ supplier: supplierId }).select('-rows').sort({ createdAt: -1 }).limit(50).lean();
  return withSupplier(uploads);
}

async function getUpload(uploadId) {
  if (!mongoose.isValidObjectId(uploadId)) throw new ApiError('Invalid upload id.', 400);
  const u = await Upload.findById(uploadId).lean();
  if (!u) throw new ApiError('Upload not found.', 404);
  return (await withSupplier([u]))[0];
}

module.exports = { pricesBoq, toNumber, normalizeHeader, findHeaderRow, currencyFromHeader, previewUpload, confirmUpload, rollbackUpload, applyPercentageDiscount, listUploads, getUpload, readFile, proposeMapping, buildPreview, flagOpenRevisions, FIELDS, RATED };
