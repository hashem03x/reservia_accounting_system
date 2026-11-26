const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const XLSX = require('xlsx');

// Deal Engine -> Materials -> "Import workbook" (and the ERP products it creates). The client's real
// workbooks are not in the repository (they carry supplier prices), so these tests build workbooks
// with the SAME layout: On_Grid.xlsx's "Material Price List" from the values the code already
// carries (catalogData/onGridCatalog.js - itself extracted from that sheet), and a few rows of
// Solar_Pumping_Agriculture_R07.xlsx's "Master Price List" / "Cost Summary". Real routes, multipart
// uploads, real MongoDB:
//   - an EMPTY database (production before any seed) gets a working Price Book + Rates Matrix from
//     On_Grid.xlsx, and an On-Grid project then calculates;
//   - re-importing changes nothing; a changed price is appended to the history, the key never moves;
//   - R07: legacy items are matched (not duplicated), new modules without electrical data stay out of
//     the calculation, reference-only and unpriced rows are reported, archived items stay archived;
//   - Rates Matrix / pricing levers / ERP products each need their own permission;
//   - ERP products: one per Price Book item, linked, reused on an exact match, never duplicated.
// Self-skips without TEST_DB_URI.

const DB_URI = process.env.TEST_DB_URI;
const RUN = !!DB_URI;
const maybeTest = RUN ? test : test.skip;

const sendEmailPath = require.resolve('../../utils/sendEmail');
require.cache[sendEmailPath] = { id: sendEmailPath, filename: sendEmailPath, loaded: true, exports: async () => {} };
const ApiError = require('../../utils/apiError');
const authPath = require.resolve('../../controller/user/authController');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    protect: async (req, res, next) => {
      const id = req.header('x-test-user');
      if (!id) return next(new ApiError('You are not logged in.', 401));
      req.user = await mongoose.model('User').findById(id);
      return req.user ? next() : next(new ApiError('Unknown user.', 401));
    },
    forgotPassword: (req, res) => res.status(200).json({}),
  },
};

const onGrid = require('../../services/commercial/catalogData/onGridCatalog');

let User, MaterialItem, RatesConfig, Product;
let server, baseUrl;
let seq = 0;

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  MaterialItem = require('../../models/commercial/materialItemModel');
  RatesConfig = require('../../models/commercial/ratesConfigModel');
  Product = require('../../models/inventory/productModel');
  require('../../models/commercial/pricingConfigModel');
  require('../../models/categoryModel');
  require('../../models/subCategoryModel');
  await Promise.all([User.init(), MaterialItem.init(), RatesConfig.init(), Product.init(), mongoose.model('Category').init()]);
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/commercial/materials', require('../../routes/commercial/materialRoute'));
  app.use('/api/v1/commercial/projects', require('../../routes/commercial/projectRoute'));
  app.use('/api/v1/commercial/revisions', require('../../routes/commercial/revisionRoute'));
  app.use(require('../../middleware/errorMiddleware'));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!RUN) return;
  await new Promise(r => server.close(r));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  const names = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name);
  await Promise.all(names.map(n => mongoose.connection.collection(n).deleteMany({})));
});

const m = (system, role) => ({ system, role, isActive: true });
function mkUser(name, memberships, role = 'operator') {
  seq += 1;
  return User.create({ name, email: `${name.toLowerCase().replace(/\s+/g, '.')}.${seq}@reservia.test`, password: 'x', role, type: 'online', systemMemberships: memberships });
}
async function team() {
  return {
    md: await mkUser('Ahmed MD', [m('COMMERCIAL', 'md')]),
    procurement: await mkUser('Paula Procurement', [m('COMMERCIAL', 'procurement')]),
    sales: await mkUser('Sara Sales', [m('COMMERCIAL', 'sales')]),
    tech: await mkUser('Tarek Tech', [m('COMMERCIAL', 'technical')]),
    // ERP admin + Deal Engine procurement: may create ERP products.
    purchasing: await mkUser('Pam Purchasing', [m('COMMERCIAL', 'procurement'), m('ERP', 'admin')], 'admin'),
  };
}

async function api(method, url, { user, body } = {}) {
  const res = await fetch(`${baseUrl}${url}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': String(user._id) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}
async function upload(path, user, { buffer, name }, options) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  if (options) form.append('options', JSON.stringify(options));
  const res = await fetch(`${baseUrl}/api/v1/commercial/materials/${path}`, { method: 'POST', headers: { 'x-test-user': String(user._id) }, body: form });
  return { status: res.status, body: await res.json() };
}

/* ---------- workbooks with the client's layout ---------- */

function toBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** On_Grid.xlsx "Material Price List", from the values the code carries. `tweak` edits rows before writing. */
function onGridWorkbook(tweak = x => x) {
  const rows = [['Material Price List'], ['PV Module'], ['Factory', 'MODEL', 'Pmax W', 'Vmp V', 'Imp A', 'Voc V', 'Isc A', 'Voc temp %/C', 'Max module DC V', 'Price per watt']];
  onGrid.PV_MODULES.forEach(p => rows.push([p.brand, p.model, p.pmaxW, p.vmp, p.imp, p.voc, p.isc, p.vocTempCoeffPctPerC, p.maxDcV, p.pricePerWatt]));
  rows.push([], ['ON-GRID INVERTERS'], ['Factory', 'MODEL', 'Rated Power (kW)', 'Unit Price', 'Max DC Voltage (V)', 'MPPT Min (V)', 'MPPT Max (V)', 'Startup (V)', 'Rated DC (V)', 'Max MPPT Current (A)', 'Max Input Current (A)', 'Max Isc / MPPT (A)', 'MPPT Count', 'DC Inputs', 'Inputs / MPPT', 'Max PV Recommended (kWp)']);
  onGrid.GRID_INVERTERS.forEach(i => rows.push([i.brand, i.model, i.ratedKw, i.price, i.maxDcV ?? '', i.mpptMinV ?? '', i.mpptMaxV ?? '', '', '', '', '', '', i.mpptCount ?? '', i.dcInputs ?? '', i.inputsPerMppt ?? '', i.maxPvRecommendedKwp ?? '']));
  rows.push([], ['DC CABLES – EL MARWA PRICE LIST (OCT 2026)'], ['Brand', 'Cable Size (mm²)', 'Unit', 'Currency', 'Unit Price (EGP/m)']);
  onGrid.DC_CABLES.forEach(c => rows.push([c.brand, c.sizeMm2, 'm', 'EGP', c.pricePerM]));
  rows.push([], ['MOUNTING STRUCTURE PRICE LIST'], ['Structure Type', 'Specification', 'Unit', 'Unit Price (EGP/kWp)']);
  Object.entries(onGrid.MOUNTING_STRUCTURE_RATES).forEach(([t, v]) => rows.push([t, 'Locally Fabricated as per Site Conditions', 'kWp', v]));
  rows.push([], ['TRANSPORTATION COST MATRIX – EGYPT (EGP)'], ['Project Location', '≤15 kWp', '>15–30 kWp', '>30–50 kWp', '>50–100 kWp', '>100 kWp']);
  onGrid.EGYPT_REGIONS.forEach(r => rows.push([r, ...onGrid.TRANSPORT_RATES_BY_REGION[r]]));
  rows.push([], ['INSTALLATION UNIT RATE – EGYPT (EGP/kWp)'], ['Project Location', '≤15 kWp', '>15–30 kWp', '>30–50 kWp', '>50–100 kWp', '>100 kWp']);
  onGrid.EGYPT_REGIONS.forEach(r => rows.push([r, ...onGrid.INSTALL_RATES_BY_REGION[r]]));
  rows.push([], ['AC Breaker Rating (A)', 'Breaker Type', 'Unit Price (EGP)', 'Price Status']);
  onGrid.AC_BREAKERS.forEach(b => rows.push([b.ratingA, b.type, b.price, 'Reference price']));
  rows.push([], ['MC4 CONNECTORS – PRICE LIST', 'Unit', 'Unit Price (EGP)'], ['MC4 Connector', 'pcs', onGrid.MC4_CONNECTOR_PRICE_PER_PIECE]);
  rows.push([], ['AC Distribution Board'], ['Max PV Capacity (kWp)', 'AC Panel Box Dimensions (cm)', 'Unit Price (EGP)']);
  onGrid.AC_DISTRIBUTION_BOARDS.forEach(b => rows.push([b.maxPvKwp, b.dimensionsCm.replace(/ x /g, ' × '), b.price]));
  return { name: 'On_Grid.xlsx', buffer: toBuffer({ 'Master Project': [['RESERVIA']], 'Material Price List': tweak(rows), 'On-Grid Design': [['design']] }) };
}

const R07_HEADER = ['No.', 'Product Category', 'Brand', 'Model / Item', 'Material / Construction', 'Motor Type / inch', 'HP', 'kW', 'Pipe Inch', 'pipe price', 'Pipe Length', 'Pipe Pressure', 'Inlet / Outlet inch', 'Motor Price', 'Pump Price', 'Set / Listed Price', 'Cast Iron Price', 'SS304 Price', 'Flow Points (m3/h)', 'Head Points (m)', 'Source PDF', 'PDF Page', 'Technical Specifications', 'Unit Price', 'Currency', 'Unit', 'Origin', 'Price / Data Status', 'Voltage V', 'Phase', 'Max DC V', 'MPPT Min V', 'MPPT Max V', 'Max DC Input A', 'Recommended DC V', 'Rated AC Input A', 'Rated AC Output A', 'Dimensions mm', 'DC Data Source', 'DC Specifications Status', 'PV Rated Power W', 'Vmp V', 'Imp A', 'Voc V', 'Isc A', 'Voc Temp Coeff %/C', 'Max Module DC V', 'Module Area m2', 'Module Area mm2', 'Cable Size mm2', 'Cable Cores', 'DOL Max Length m', 'DOL Motor HP', 'Q0 m3/h', 'Q1 m3/h', 'Q2 m3/h', 'Q3 m3/h', 'Q4 m3/h', 'H0 m', 'H1 m', 'H2 m', 'H3 m', 'H4 m', 'Item ID', 'Source Notes'];
function r07Row(fields) {
  const row = R07_HEADER.map(() => '');
  for (const [k, v] of Object.entries(fields)) {
    const i = R07_HEADER.indexOf(k);
    if (i < 0) throw new Error(`no column ${k}`);
    row[i] = v;
  }
  return row;
}
function r07Workbook() {
  const rows = [
    ['RESERVIA | MASTER PRICE LIST 01 - AGRICULTURE'], ['Consolidated'], ['Original A:V configuration retained.'], ['Blank prices remain blank'], R07_HEADER,
    r07Row({ 'No.': 1, 'Product Category': 'motor', Brand: 'Ferat', 'Model / Item': 'FM- 7.5', 'Material / Construction': 'Cast iron / SS304 options', 'Motor Type / inch': 6, HP: 7.5, kW: 5.5, 'Cast Iron Price': 39216, 'SS304 Price': 51777, Currency: 'Not stated', Unit: 'pcs', 'Price / Data Status': 'Retained source listing', 'Item ID': 'SP-00002' }),
    r07Row({ 'No.': 2, 'Product Category': 'pump', Brand: 'Ferat', 'Model / Item': 'SP15/06', 'Material / Construction': 'Stainless steel', 'Motor Type / inch': '6"', HP: 5.5, 'Inlet / Outlet inch': '2.5"', 'Pump Price': 23585, 'Unit Price': 23585, Currency: 'Not stated', Unit: 'pcs', 'Q0 m3/h': 0, 'Q1 m3/h': 12, 'Q2 m3/h': 15, 'Q3 m3/h': 18, 'Q4 m3/h': 21, 'H0 m': 65, 'H1 m': 57, 'H2 m': 51, 'H3 m': 44, 'H4 m': 34, 'Item ID': 'SP-00025' }),
    r07Row({ 'No.': 3, 'Product Category': 'pump', Brand: 'KPS', 'Model / Item': 'KP 6-30-19', 'Material / Construction': 'Stainless steel', 'Motor Type / inch': '6"', HP: 25, 'Motor Price': 81200, 'Pump Price': 61500, 'Set / Listed Price': 142700, 'Unit Price': 61500, Currency: 'Not stated', 'Item ID': 'SP-00603' }),
    r07Row({ 'No.': 4, 'Product Category': 'PV Modules', Brand: 'Jinko', 'Model / Item': 'JKM730N-66HL5-BDV', 'Technical Specifications': 'JKM730N-66HL5-BDV - 730 Wp', 'Unit Price': 6278, Currency: 'EGP', Unit: 'pcs', 'Price / Data Status': 'Available', 'PV Rated Power W': 730, 'Item ID': 'SP-01247' }),
    r07Row({ 'No.': 5, 'Product Category': 'Solar Inverter', Brand: 'MUST', 'Model / Item': 'PV18-5048 VPK', 'Technical Specifications': 'Pure sine wave solar inverter 5kw, 48Vdc, 5kva', 'Unit Price': 19394, Currency: 'EGP', 'Price / Data Status': 'Available', 'Item ID': 'SP-01268' }),
    r07Row({ 'No.': 6, 'Product Category': 'Solar Inverter', Brand: 'INVT', 'Model / Item': 'BG 20 KTR', 'Technical Specifications': 'BG 20 KTR', 'Unit Price': 124600, Currency: 'EGP', 'Price / Data Status': 'Available', 'Item ID': 'SP-01261' }),
    r07Row({ 'No.': 7, 'Product Category': 'Lithium Batteries', Brand: 'MUST', 'Model / Item': 'LP16-48100', 'Technical Specifications': '51.2V, 100A, 6000 Cycle, DOD:80%', 'Unit Price': 47500, Currency: 'EGP', 'Item ID': 'SP-01278' }),
    r07Row({ 'No.': 8, 'Product Category': 'Cable', Brand: 'Reference', 'Model / Item': '3x2.5 / 5.5 HP', HP: 5.5, 'Price / Data Status': 'Technical reference only - no price supplied', 'Cable Size mm2': 2.5, 'Item ID': 'SP-01385' }),
    r07Row({ 'No.': 9, 'Product Category': 'AC Cable', Brand: 'Supplier quote required', 'Model / Item': '2.5 mm² AC feeder', Currency: 'EGP', 'Price / Data Status': 'Await quotation / unavailable', 'Item ID': 'SP-01373' }),
    r07Row({ 'No.': 10, 'Product Category': 'Electrical Protections', Brand: 'Suntree', 'Model / Item': 'SL7 - 63 DC 1000V 4P 16A', 'Technical Specifications': 'DC MCB, 16A, 1000V', 'Unit Price': 890, Currency: 'EGP', 'Item ID': 'SP-01286' }),
    r07Row({ 'No.': 11, 'Product Category': 'Metallic Panels', Brand: 'Metallic', 'Model / Item': '30X40X20', 'Unit Price': 1583, Currency: 'EGP', 'Item ID': 'SP-01347' }),
  ];
  const cost = [
    ['RESERVIA | PROJECT COST SUMMARY & PRICING'], [], [],
    ['', 'COMMERCIAL PRICING & PROFITABILITY (INTERNAL)'],
    ['', 'Overhead / total COGS', 0.38], ['', 'Contingency / total COGS', 0.02], ['', 'Profit markup / total COGS', 0.1],
    ['', 'Sales incentive / markup pool', 0.055], ['', 'Engineering incentive / markup pool', 0.05], ['', 'Category profit addition / base price', '', 0.06],
  ];
  return { name: 'Solar_Pumping_Agriculture_R07.xlsx', buffer: toBuffer({ 'Master Project': [['RESERVIA']], 'Master Price List ': rows, 'Cost Summary': cost }) };
}

/* ---------- tests ---------- */

maybeTest('On_Grid.xlsx into an EMPTY database: Price Book + Rates Matrix, then an On-Grid project calculates', async () => {
  const t = await team();
  const wb = onGridWorkbook();
  assert.equal((await upload('workbook-import/preview', t.sales, wb)).status, 403, 'sales may not import');
  assert.equal((await upload('workbook-import/preview', t.tech, wb)).status, 403, 'technical may not import');

  const preview = await upload('workbook-import/preview', t.procurement, wb);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const p = preview.body.data;
  assert.equal(p.workbook.kind, 'on-grid');
  assert.equal(p.items.create, 3 + 19 + 13 + 3 + 19 + 1 + 6);
  assert.equal(p.items.update, 0);
  assert.equal(p.rates.status, 'missing');
  assert.equal(p.rates.canApply, false, 'procurement does not manage the Rates Matrix');
  assert.equal(await MaterialItem.countDocuments(), 0, 'preview writes nothing');

  assert.equal((await upload('workbook-import/apply', t.procurement, wb, { rates: true })).status, 403, 'rates need a Pricing Config manager');
  assert.equal(await MaterialItem.countDocuments(), 0, 'a refused import writes nothing');
  const applied = await upload('workbook-import/apply', t.md, wb, { rates: true });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.data.items.written.inserted, 64);
  assert.equal(applied.body.data.rates.created, true);
  const matrix = await RatesConfig.findOne({ country: 'Egypt' }).lean();
  assert.equal(matrix.source, 'workbook');
  assert.equal(matrix.installRatesEgpPerKwpByRegion[0][0], onGrid.INSTALL_RATES_BY_REGION['Cairo - 10th of Ramadan'][0]);
  const seeded = await MaterialItem.findOne({ model: 'JKM475M-7RL3' }).lean();
  assert.equal(seeded.unitPrice, Math.round(475 * 8.7 * 100) / 100);
  assert.equal(seeded.status, 'Available');
  assert.equal(seeded.priceHistory.length, 1);
  assert.equal((await MaterialItem.findOne({ model: 'SUN2000-17KTL-M2' }).lean()).status, 'PLACEHOLDER', 'no DC data in the source row - kept out of the calculation');

  // The calculation now runs on the imported data.
  const customer = await User.create({ name: 'Customer', phone: '01000000001', role: 'user', type: 'offline', isOffline: true });
  const proj = await api('POST', '/api/v1/commercial/projects', { user: t.md, body: { name: '80 kWp', customer: customer._id, country: 'Egypt', region: 'Cairo - 10th of Ramadan', category: 'On-Grid C&I', scope: 'Supply & Installation' } });
  const calc = await api('POST', `/api/v1/commercial/revisions/project/${proj.body.data.project._id}`, { user: t.tech, body: { engineeringInput: { kWp: 80, pvModuleModel: 'JKM475M-7RL3', structureType: 'Hangar Roof', acLengthM: 20, acPricePerMOverride: 1195 } } });
  assert.equal(calc.status, 201, JSON.stringify(calc.body).slice(0, 300));

  // The same workbook again changes nothing.
  const again = (await upload('workbook-import/preview', t.md, wb)).body.data;
  assert.deepEqual([again.items.create, again.items.update, again.items.unchanged, again.rates.status], [0, 0, 64, 'unchanged']);
});

maybeTest('a changed price is appended to the history; the key and earlier revisions are untouched; archived stays archived', async () => {
  const t = await team();
  await upload('workbook-import/apply', t.md, onGridWorkbook());
  const before = await MaterialItem.findOne({ model: 'SUN2000-50KTL-M3' }).lean();
  await MaterialItem.updateOne({ model: 'SUN2000-60KTL-M0' }, { archived: true });
  const changed = onGridWorkbook(rows => rows.map(r => (r[1] === 'SUN2000-50KTL-M3' ? [r[0], r[1], r[2], 170000, ...r.slice(4)] : r)));
  const p = (await upload('workbook-import/preview', t.procurement, changed)).body.data;
  assert.equal(p.items.update, 1);
  assert.equal(p.items.archived, 1);
  assert.deepEqual(p.items.samples.update[0].changes, [{ field: 'price', before: before.unitPrice, after: 170000 }]);
  assert.equal((await upload('workbook-import/apply', t.procurement, changed)).status, 200, 'items alone: Materials editors');
  const after = await MaterialItem.findOne({ _id: before._id }).lean();
  assert.equal(after.unitPrice, 170000);
  assert.equal(after.key, before.key);
  assert.deepEqual(after.priceHistory.map(h => h.price), [before.unitPrice, 170000]);
  assert.equal((await MaterialItem.findOne({ model: 'SUN2000-60KTL-M0' }).lean()).archived, true);
  assert.equal(await MaterialItem.countDocuments({ model: 'SUN2000-60KTL-M0' }), 1, 'not re-created');
});

maybeTest('R07 master list: legacy items matched, incomplete modules kept out, unpriced rows reported, Agriculture levers by permission', async () => {
  const t = await team();
  // What the first seed left: a pump under the wrong category with a placeholder brand, a motor.
  await MaterialItem.create({ category: 'Solar Pump Drive', brand: 'Generic', model: 'SP 15/06', spec: '6" casing, 5.5 HP, 2.5" outlet', unit: 'pcs', unitPrice: 23000, sourceWorkbook: 'Solar_Pumping3.xlsx', sourceSheet: 'Pump Price List', key: 'Generic | SP 15/06 | 6" casing' });
  await MaterialItem.create({ category: 'Pump Motor', brand: 'Ferat/PMTech', model: 'FM-7.5', spec: '7.5 HP, 6" casing, cast iron', unit: 'pcs', unitPrice: 39216, sourceWorkbook: 'Solar_Pumping3.xlsx', sourceSheet: 'Motor Price List', key: 'Ferat/PMTech | FM-7.5 | 6in cast iron' });
  const wb = r07Workbook();
  const p = (await upload('workbook-import/preview', t.md, wb)).body.data;
  assert.equal(p.workbook.kind, 'agriculture-master');
  assert.equal(p.items.update, 2, 'the pump and the motor are the same items');
  assert.equal(p.items.create, 7);
  assert.deepEqual(p.items.skippedByReason.map(s => s.reason).sort(), ['No price in the workbook (Await quotation / unavailable)', 'Technical reference (cable sizing), not a price']);
  const byCat = Object.fromEntries(p.items.byCategory.map(c => [c.category, c]));
  assert.equal(byCat['PV Modules'].needsData, 1);
  assert.equal(byCat['On-Grid Inverter'].needsData, 1, 'no DC data stated');
  assert.equal(byCat['Off-Grid Inverter'].create, 1, 'a 48 Vdc battery inverter is off-grid');
  assert.deepEqual(p.pricing.diffs.map(d => d.lever).sort(), ['categoryAdditionPct', 'overheadPct']);

  assert.equal((await upload('workbook-import/apply', t.procurement, wb, { pricing: true })).status, 403, 'levers: Pricing Config managers only');
  const res = await upload('workbook-import/apply', t.md, wb, { pricing: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const pump = await MaterialItem.findOne({ model: 'SP 15/06' }).lean();
  assert.deepEqual([pump.category, pump.brand, pump.key, pump.unitPrice, pump.attrs.masterId], ['Submersible Pump', 'Ferat', 'Generic | SP 15/06 | 6" casing', 23585, 'SP-00025']);
  assert.deepEqual(pump.attrs.headPointsM, [65, 57, 51, 44, 34]);
  const motor = await MaterialItem.findOne({ model: 'FM-7.5' }).lean();
  assert.deepEqual([motor.attrs.castIronPrice, motor.attrs.ss304Price, motor.unitPrice], [39216, 51777, 39216]);
  const module730 = await MaterialItem.findOne({ model: 'JKM730N-66HL5-BDV' }).lean();
  assert.equal(module730.status, 'PLACEHOLDER');
  assert.equal(module730.attrs.pmaxW, 730);
  const battery = await MaterialItem.findOne({ model: 'LP16-48100' }).lean();
  assert.deepEqual([battery.attrs.voltageV, battery.attrs.capacityAh], [51.2, 100]);
  const { leversFor, getActiveConfig } = require('../../services/commercial/pricingConfigService');
  const cfg = await getActiveConfig();
  assert.equal(leversFor(cfg, 'Agriculture Pumping').overheadPct, 0.38);
  assert.equal(leversFor(cfg, 'On-Grid C&I').overheadPct, 0.1, 'other categories keep the standard levers');

  // Re-import: matched by the workbook's Item ID now - nothing new, nothing changed.
  const again = (await upload('workbook-import/preview', t.md, wb)).body.data;
  assert.deepEqual([again.items.create, again.items.update], [0, 0]);
});

maybeTest('ERP products: one per Price Book item, linked, exact reuse only, never duplicated; ERP permission required', async () => {
  const t = await team();
  await upload('workbook-import/apply', t.md, r07Workbook());
  // An ERP product Purchasing already created for the KPS pump - reused, not duplicated.
  const Category = mongoose.model('Category');
  const SubCategory = mongoose.model('SubCategory');
  const cat = await Category.create({ name: { en: 'Pumps', ar: 'مضخات' } });
  const brand = await SubCategory.create({ name: { en: 'KPS', ar: 'KPS' }, mainCategory: cat._id });
  const existing = await Product.create({ type: 'product', title: { en: 'KPS pump 6-30-19', ar: 'مضخة KPS' }, description: { en: 'pump', ar: 'مضخة' }, category: cat._id, subcategory: brand._id, model: 'KP 6-30-19' });

  const st = await api('GET', '/api/v1/commercial/materials/erp-products/status', { user: t.procurement });
  assert.equal(st.body.data.canApply, false);
  assert.equal((await api('POST', '/api/v1/commercial/materials/erp-products', { user: t.procurement })).status, 403, 'no ERP access');
  const items = await MaterialItem.countDocuments({ archived: false });
  const res = await api('POST', '/api/v1/commercial/materials/erp-products', { user: t.purchasing });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.linked, items);
  assert.equal(res.body.data.created, items - 1);
  assert.equal(res.body.data.remaining, 0);
  const kps = await MaterialItem.findOne({ model: 'KP 6-30-19' }).lean();
  assert.equal(String(kps.erpProduct?._id ?? kps.erpProduct), String(existing._id));
  const p = await Product.findOne({ model: 'JKM730N-66HL5-BDV' }).populate('category subcategory').lean();
  assert.equal(p.title.en, 'Jinko JKM730N-66HL5-BDV');
  assert.equal(p.category.name.en, 'PV Modules');
  assert.equal(p.subcategory.name.en, 'Jinko');
  assert.deepEqual([p.capacity.value, p.capacity.unit], [730, 'W']);
  assert.equal(p.cost, undefined, 'the reference price is not a purchase cost');
  const again = await api('POST', '/api/v1/commercial/materials/erp-products', { user: t.purchasing });
  assert.deepEqual([again.body.data.created, again.body.data.linked], [0, 0]);
  assert.equal(await Product.countDocuments(), items, 'no duplicates');
});

maybeTest('Off_Grid.xlsx and Solar_Pumping3.xlsx are recognised and say why nothing is read; other files are refused', async () => {
  const t = await team();
  const off = { name: 'Off_Grid.xlsx', buffer: toBuffer({ 'Load Assessment': [['x']], Design: [['x']], BOQ: [['x']] }) };
  const pump3 = { name: 'Solar_Pumping3.xlsx', buffer: toBuffer({ 'Pump Price List': [['x']], 'Motor Price List': [['x']] }) };
  const a = (await upload('workbook-import/preview', t.md, off)).body.data;
  assert.equal(a.items.create, 0);
  assert.match(a.notes[0], /design calculator/);
  const b = (await upload('workbook-import/preview', t.md, pump3)).body.data;
  assert.match(b.notes[0], /R07/);
  const other = await upload('workbook-import/preview', t.md, { name: 'random.xlsx', buffer: toBuffer({ Sheet1: [['a']] }) });
  assert.equal(other.status, 400);
  const csv = await upload('workbook-import/preview', t.md, { name: 'x.csv', buffer: Buffer.from('a,b') });
  assert.equal(csv.status, 400);
});
