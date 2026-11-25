const RatesConfig = require('../../models/commercial/ratesConfigModel');
const ApiError = require('../../utils/apiError');
const { canonicalRegion, canonicalCountry, EGYPT_REGIONS, RATES_MATRIX_COUNTRIES } = require('../../utils/commercial/regions');
const onGridCatalog = require('./catalogData/onGridCatalog');

// Reservia Commercial - Mongo-backed Rates Matrix lookup, feeding onGridEngine.js's
// install/transport-band functions. Throws on an unmapped region/country - the project's
// explicit acceptance test: "a region missing from the Rates matrix raises an error and does not
// produce a zero."
//
// The matrix is versioned: one document per (country, effectiveDate). A change is saved as a NEW
// version, never an edit - every revision already stores the exact install/transport rate it used,
// so past revisions are never altered. The version in force is the latest whose effectiveDate has
// arrived (a future-dated version waits for its date).

const BANDS = 5; // <=15, >15-30, >30-50, >50-100, >100 kWp - the Rates Matrix's own header labels
const MOUNTING = ['Rooftop', 'Ground Mounted', 'Hangar Roof'];
const WHERE = 'Deal Engine -> Pricing Config -> Rates Matrix';

/** The country spelling the Rates Matrix is stored under (case-insensitive input). */
function ratesCountry(country) {
  const c = canonicalCountry(country);
  if (!c) throw new ApiError(`Country "${country}" is not a Deal Engine country.`, 400);
  if (!RATES_MATRIX_COUNTRIES.includes(c)) throw new ApiError(`${c} is not priced with a Rates Matrix.`, 400);
  return c;
}

async function getActiveRatesConfig(rawCountry, { at = new Date() } = {}) {
  const country = ratesCountry(rawCountry);
  const config = await RatesConfig.findOne({ country, effectiveDate: { $lte: at } }).sort({ effectiveDate: -1, createdAt: -1 }).lean();
  if (!config) {
    // A genuinely missing matrix stops the calculation with a clear, actionable message - never a
    // silent zero installation or transport rate.
    throw new ApiError(
      `No Rates Matrix configured for country "${country}". The installation and transport rates are required to calculate. A Pricing Config manager (Commercial MD, Sales and Commercial Director or ERP admin) can load or enter it on ${WHERE}.`,
      400
    );
  }
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
    AC_CABLE_DERATING_FACTOR: ratesConfig.acCableDeratingFactor ?? null,
  };
}

/** Installation EGP/kWp for a region + size band (1-5) - used by the Off-Grid engine (QA U7). Throws on an unknown region. */
function installRateFor(catalogShape, region, band) {
  const row = catalogShape.INSTALL_RATES_BY_REGION[canonicalRegion(region) || region];
  if (!row) throw new ApiError(`Region "${region}" is not in the installation Rates matrix`, 400);
  return row[band - 1];
}

/**
 * The reference Egypt matrix: the client's own On_Grid.xlsx `Material Price List`!A104:F123 rates
 * table, as extracted in catalogData/onGridCatalog.js - the same values the
 * db:seed-commercial-materials script writes. Nothing here is a developer estimate.
 */
function referenceMatrix(country = 'Egypt', effectiveDate = new Date('2026-11-04')) {
  if (country !== 'Egypt') return null;
  return {
    country: 'Egypt',
    regions: onGridCatalog.EGYPT_REGIONS,
    installRatesEgpPerKwpByRegion: onGridCatalog.EGYPT_REGIONS.map(r => onGridCatalog.INSTALL_RATES_BY_REGION[r]),
    transportRatesEgpByRegion: onGridCatalog.EGYPT_REGIONS.map(r => onGridCatalog.TRANSPORT_RATES_BY_REGION[r]),
    mountingStructureRatesEgpPerKwp: onGridCatalog.MOUNTING_STRUCTURE_RATES,
    earthingRateEgpPerKwp: 100,
    accessoriesRateEgpPerKwp: 85,
    dcCableRouteMPerKwp: 8, // On-Grid Design!D26's 8 m/kWp route allowance
    effectiveDate,
  };
}

/* ---------- management (Pricing Config page) ---------- */

/** A stored version as the Pricing Config page shows it: one row per region. */
function shapeVersion(doc) {
  if (!doc) return null;
  const mounting = doc.mountingStructureRatesEgpPerKwp instanceof Map ? Object.fromEntries(doc.mountingStructureRatesEgpPerKwp) : doc.mountingStructureRatesEgpPerKwp || {};
  return {
    _id: String(doc._id),
    country: doc.country,
    effectiveDate: doc.effectiveDate,
    createdAt: doc.createdAt,
    createdBy: doc.createdBy ? { _id: String(doc.createdBy._id || doc.createdBy), name: doc.createdBy.name || null } : null,
    source: doc.source || 'seed',
    note: doc.note || '',
    regions: doc.regions.map((r, i) => ({ region: canonicalRegion(r) || r, install: doc.installRatesEgpPerKwpByRegion[i] || [], transport: doc.transportRatesEgpByRegion[i] || [] })),
    mountingStructureRatesEgpPerKwp: Object.fromEntries(MOUNTING.map(k => [k, mounting[k] ?? null])),
    earthingRateEgpPerKwp: doc.earthingRateEgpPerKwp ?? null,
    accessoriesRateEgpPerKwp: doc.accessoriesRateEgpPerKwp ?? null,
    dcCableRouteMPerKwp: doc.dcCableRouteMPerKwp ?? null,
    acCableDeratingFactor: doc.acCableDeratingFactor ?? null,
  };
}

/** The version in force, the versions waiting for their date, and the history (newest first). */
async function getMatrixView(rawCountry) {
  const country = ratesCountry(rawCountry);
  const now = new Date();
  const all = await RatesConfig.find({ country }).sort({ effectiveDate: -1, createdAt: -1 }).populate('createdBy', 'name').lean();
  const active = all.find(d => new Date(d.effectiveDate) <= now) || null;
  return {
    country,
    bands: ['<= 15 kWp', '> 15 - 30 kWp', '> 30 - 50 kWp', '> 50 - 100 kWp', '> 100 kWp'],
    requiredRegions: country === 'Egypt' ? EGYPT_REGIONS : [],
    mountingTypes: MOUNTING,
    active: shapeVersion(active),
    scheduled: all.filter(d => new Date(d.effectiveDate) > now).map(shapeVersion),
    history: all.map(d => ({ _id: String(d._id), effectiveDate: d.effectiveDate, createdAt: d.createdAt, createdBy: d.createdBy?.name || null, source: d.source || 'seed', note: d.note || '', active: active && String(active._id) === String(d._id) })),
    referenceAvailable: !!referenceMatrix(country),
  };
}

const num = (v, label, { min = 0, max = 1e7 } = {}) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new ApiError(`${label} must be a number between ${min} and ${max}.`, 400);
  return n;
};

/**
 * Validates a full matrix from the page. Every region of the country must have all five install and
 * five transport values - a blank is refused, never stored as zero.
 */
function validateMatrix(country, body) {
  const rows = Array.isArray(body?.regions) ? body.regions : null;
  if (!rows || !rows.length) throw new ApiError('Enter the rates for every region.', 400);
  const seen = new Set();
  const regions = [];
  const install = [];
  const transport = [];
  rows.forEach(row => {
    const region = canonicalRegion(row?.region);
    if (!region) throw new ApiError(`Region "${row?.region}" is not a Rates matrix region.`, 400);
    if (seen.has(region)) throw new ApiError(`Region "${region}" is listed twice.`, 400);
    seen.add(region);
    const ins = Array.isArray(row.install) ? row.install : [];
    const tra = Array.isArray(row.transport) ? row.transport : [];
    if (ins.length !== BANDS || tra.length !== BANDS) throw new ApiError(`${region}: enter all ${BANDS} installation and ${BANDS} transport values.`, 400);
    regions.push(region);
    install.push(ins.map((v, i) => num(v, `${region} installation, band ${i + 1} (EGP/kWp)`)));
    transport.push(tra.map((v, i) => num(v, `${region} transport, band ${i + 1} (EGP)`)));
  });
  if (country === 'Egypt') {
    const missing = EGYPT_REGIONS.filter(r => !seen.has(r));
    if (missing.length) throw new ApiError(`Rates are missing for: ${missing.join('; ')}.`, 400);
  }
  const m = body.mountingStructureRatesEgpPerKwp || {};
  const mounting = Object.fromEntries(MOUNTING.map(k => [k, num(m[k], `Mounting structure - ${k} (EGP/kWp)`)]));
  let effectiveDate = new Date();
  if (body.effectiveDate) {
    effectiveDate = new Date(body.effectiveDate);
    if (Number.isNaN(effectiveDate.getTime())) throw new ApiError('Effective date is not a valid date.', 400);
  }
  return {
    country,
    regions,
    installRatesEgpPerKwpByRegion: install,
    transportRatesEgpByRegion: transport,
    mountingStructureRatesEgpPerKwp: mounting,
    earthingRateEgpPerKwp: num(body.earthingRateEgpPerKwp, 'Earthing rate (EGP/kWp)'),
    accessoriesRateEgpPerKwp: num(body.accessoriesRateEgpPerKwp, 'Accessories rate (EGP/kWp)'),
    dcCableRouteMPerKwp: num(body.dcCableRouteMPerKwp, 'DC cable route allowance (m/kWp)', { min: 0.1, max: 1000 }),
    acCableDeratingFactor: num(body.acCableDeratingFactor ?? 0.8, 'AC cable derating factor', { min: 0.1, max: 1 }),
    effectiveDate,
    note: typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '',
  };
}

/** Saves the page's matrix as a NEW version (previous versions and every revision stay as they are). */
async function saveVersion(rawCountry, body, user) {
  const country = ratesCountry(rawCountry);
  const doc = await RatesConfig.create({ ...validateMatrix(country, body), source: 'manual', createdBy: user?._id || null });
  return shapeVersion(doc.toObject());
}

/**
 * Loads the reference matrix (the client's workbook) for a country that has NO matrix yet - the fix
 * for a production database where db:seed-commercial-materials was never run. Refused once any
 * version exists: changes after that are new versions entered on the page.
 */
async function loadReference(rawCountry, user) {
  const country = ratesCountry(rawCountry);
  const ref = referenceMatrix(country, new Date());
  if (!ref) throw new ApiError(`There is no reference Rates Matrix for ${country}. Enter it on the page.`, 400);
  if (await RatesConfig.exists({ country })) throw new ApiError(`${country} already has a Rates Matrix. Save changes as a new version instead.`, 409);
  const doc = await RatesConfig.create({ ...ref, source: 'reference', note: 'Reference rates from On_Grid.xlsx (Material Price List, Rates Matrix)', createdBy: user?._id || null });
  return shapeVersion(doc.toObject());
}

module.exports = { getActiveRatesConfig, toEngineCatalogShape, installRateFor, referenceMatrix, getMatrixView, saveVersion, loadReference, validateMatrix, MOUNTING, BANDS };
