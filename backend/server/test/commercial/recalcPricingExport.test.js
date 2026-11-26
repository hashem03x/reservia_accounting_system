const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

// Deal Engine - "Recalculate Pricing / Re-estimate Engineering / Recalculate BOQ do not update
// anything", "uploaded price lists show no price or supplier name", and the BOQ Excel/CSV export.
// Root causes covered here, each through the REAL routes on a REAL MongoDB and re-read from the DB:
//   1. a price list from a new (Candidate) supplier was written but silently never priced a BOQ;
//   2. every recalculation silently discarded the BOQ's saved manual overrides;
//   3. Agriculture Pumping priced pumps/motors from a static file, never the Price Book;
//   4. supplier names were never stored or shown (code only), uploads had no per-row price view;
//   5. foreign-currency quotes kept the upload-day exchange rate forever.
// Self-skips without TEST_DB_URI (a LOCAL replica set - never the cluster in backend/.env).

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

const uploads = require('../../services/commercial/priceListUploadService');
const { csvField } = require('../../services/commercial/boqExportService');

let User, CommercialRevision, MaterialItem, Supplier, pricingConfigService;
let server, baseUrl;
const REGION = 'Cairo - 10th of Ramadan';
const INPUT = { kWp: 80, pvModuleModel: 'JKM475M-7RL3', structureType: 'Hangar Roof', acLengthM: 20 };

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  CommercialRevision = require('../../models/commercial/commercialRevisionModel');
  MaterialItem = require('../../models/commercial/materialItemModel');
  Supplier = require('../../models/commercial/supplierModel');
  pricingConfigService = require('../../services/commercial/pricingConfigService');
  await Promise.all([User.init(), MaterialItem.init(), Supplier.init()]);
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/commercial/projects', require('../../routes/commercial/projectRoute'));
  app.use('/api/v1/commercial/revisions', require('../../routes/commercial/revisionRoute'));
  app.use('/api/v1/commercial/suppliers', require('../../routes/commercial/supplierRoute'));
  app.use('/api/v1/commercial/materials', require('../../routes/commercial/materialRoute'));
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
  const { seedCommercialMaterials } = require('../../scripts/seedCommercialMaterials');
  const log = console.log;
  console.log = () => {};
  try {
    await seedCommercialMaterials({ dryRun: false, connect: false });
  } finally {
    console.log = log;
  }
});

let seq = 0;
const m = (system, role) => ({ system, role, isActive: true });
async function makeUser(name, memberships) {
  seq += 1;
  return User.create({ name, email: `${name.toLowerCase().replace(/\s+/g, '.')}.${seq}@reservia.test`, password: 'x', role: 'operator', type: 'online', systemMemberships: memberships });
}
async function api(method, url, { user, body, form, raw } = {}) {
  const headers = { ...(user ? { 'x-test-user': String(user._id) } : {}), ...(form ? {} : { 'Content-Type': 'application/json' }) };
  const res = await fetch(`${baseUrl}${url}`, { method, headers, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
  if (raw) return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}
async function team() {
  return {
    md: await makeUser('Ahmed MD', [m('COMMERCIAL', 'md')]),
    proc: await makeUser('Pia Procurement', [m('COMMERCIAL', 'procurement')]),
    cd: await makeUser('Mona Director', [m('COMMERCIAL', 'commercial_director')]),
  };
}
async function project(user, extra = {}) {
  const customer = await User.create({ name: `Customer ${++seq}`, phone: `0100000${String(seq).padStart(4, '0')}`, role: 'user', type: 'offline', isOffline: true });
  const res = await api('POST', '/api/v1/commercial/projects', { user, body: { name: 'Recalc 80 kWp', customer: customer._id, country: 'Egypt', region: REGION, category: 'On-Grid C&I', scope: 'Supply & Installation', ...extra } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.project;
}
const line = (r, c) => r.boqLines.find(l => l.component === c);
const stored = id => CommercialRevision.findById(id).lean();

/** A price list in the template layout (or with the given header row / extra title rows). */
function priceListBuffer(rows, { header, titleRows = [] } = {}) {
  const head = header || ['Category', 'Brand', 'Model', 'Spec', 'Unit', 'Unit price', 'Currency', 'Availability', 'Lead time (days)', 'Minimum quantity', 'Rated value', 'Rated unit', 'Validity date'];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...titleRows, head, ...rows]), 'Price list');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
async function uploadAndConfirm(user, supplier, buffer, name = 'list.xlsx') {
  const fd = new FormData();
  fd.append('file', new Blob([buffer]), name);
  const prev = await api('POST', `/api/v1/commercial/suppliers/${supplier._id}/price-lists/preview`, { user, form: fd });
  assert.equal(prev.status, 201, JSON.stringify(prev.body));
  const conf = await api('POST', `/api/v1/commercial/suppliers/price-lists/${prev.body.data._id}/confirm`, { user, body: {} });
  assert.equal(conf.status, 200, JSON.stringify(conf.body));
  return { preview: prev.body, confirm: conf.body };
}
const itemRow = (item, price, currency = 'EGP', ratedAttr = null) => {
  const [brand, model, spec] = item.key.split(' | ');
  return [item.category, brand, model, spec, 'pcs', price, currency, 'In stock', 0, 1, ratedAttr ? item.attrs[ratedAttr] : '', '', '2099-12-31'];
};
async function calcFirst(t, p) {
  const r = await api('POST', `/api/v1/commercial/revisions/project/${p._id}`, { user: t.md, body: { engineeringInput: INPUT } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}
const recalc = (user, revId, body) => api('PATCH', `/api/v1/commercial/revisions/${revId}`, { user, body });

maybeTest('Candidate supplier: upload is stored and named, but not used - the BOQ line says why; once Approved, recalculation uses it and persists it', async () => {
  const t = await team();
  const p = await project(t.md);
  const rev = await calcFirst(t, p);
  const inv = line(rev, 'Solar Inverters');
  const invItem = await MaterialItem.findOne({ category: 'On-Grid Inverter', model: inv.description }).lean();
  assert.equal(inv.priceSource, 'reference');

  const sup = (await api('POST', '/api/v1/commercial/suppliers', { user: t.proc, body: { legalName: 'Delta Solar Trading', contacts: [{ name: 'S', phone: '01011112222' }] } })).body.data;
  assert.equal(sup.status, 'Candidate');
  const newPrice = Math.round(invItem.unitPrice * 0.9 * 100) / 100 + 0.5; // decimals kept end to end
  const { preview, confirm } = await uploadAndConfirm(t.proc, sup, priceListBuffer([itemRow(invItem, newPrice, 'EGP', 'ratedKw')]));
  assert.equal(preview.data.supplierName, 'Delta Solar Trading');
  assert.match(preview.message, /is Candidate - its prices are stored but the Deal Engine prices only from Approved or Conditional suppliers/);
  assert.match(confirm.message, /1 price\(s\) imported for Delta Solar Trading/);

  // History: the supplier's name, accurate counts, and the stored rows with the actual price.
  const hist = (await api('GET', `/api/v1/commercial/suppliers/${sup._id}/price-lists`, { user: t.proc })).body.data;
  assert.equal(hist[0].supplierName, 'Delta Solar Trading');
  assert.deepEqual(hist[0].counts, { rows: 1, errors: 0, imported: 1 });
  assert.equal(hist[0].supplierPricesBoq, false);
  const detail = (await api('GET', `/api/v1/commercial/suppliers/price-lists/${hist[0]._id}`, { user: t.proc })).body.data;
  assert.equal(detail.rows[0].price, newPrice);
  assert.equal(detail.rows[0].egp, newPrice);

  // Materials shows the supplier's name and that this price is not used.
  const mat = (await api('GET', `/api/v1/commercial/materials?keyword=${encodeURIComponent(invItem.model)}&category=On-Grid%20Inverter`, { user: t.md })).body.data.find(x => x.key === invItem.key);
  assert.equal(mat.supplierPrices[0].supplierName, 'Delta Solar Trading');
  assert.equal(mat.supplierPrices[0].usedInPricing, false);

  // The open revision was flagged; recalculating with a Candidate supplier keeps the reference price - and says why.
  assert.equal((await stored(rev._id)).priceChangedSinceCalculation, true);
  const r1 = await recalc(t.md, rev._id, { engineeringInput: INPUT });
  assert.equal(r1.status, 200);
  const s1 = await stored(rev._id);
  assert.equal(line(s1, 'Solar Inverters').unitPrice, invItem.unitPrice);
  assert.match(line(s1, 'Solar Inverters').priceNote, /SUP-\d+ \(Delta Solar Trading\) quoted .* but is Candidate/);
  assert.equal(s1.priceChangedSinceCalculation, false);

  // Approving the supplier flags the revision again; the recalculation now uses and STORES the supplier price.
  const approved = await api('PATCH', `/api/v1/commercial/suppliers/${sup._id}/status`, { user: t.cd, body: { status: 'Approved' } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal((await stored(rev._id)).priceChangedSinceCalculation, true, 'approval changes which price is used -> flagged');
  const r2 = await recalc(t.md, rev._id, { engineeringInput: INPUT });
  assert.match(r2.body.message, /^Revision 1 recalculated and saved - 1 BOQ line\(s\) changed/);
  assert.equal(r2.body.data.recalcSummary.revisionNumber, 1);
  const s2 = await stored(rev._id);
  const l2 = line(s2, 'Solar Inverters');
  assert.equal(l2.unitPrice, newPrice);
  assert.equal(l2.priceSource, 'supplier');
  assert.equal(l2.supplierName, 'Delta Solar Trading');
  assert.equal(l2.priceNote, null);
  assert.ok(Math.abs(s2.boqTotal - (s1.boqTotal - (invItem.unitPrice - newPrice) * l2.qty)) < 0.01, 'BOQ total follows the new price');
  assert.ok(s2.pricing.netExclVat < s1.pricing.netExclVat, 'deal price follows the BOQ');
  assert.ok(s2.lastCalculatedAt > s1.lastCalculatedAt);
  assert.equal(await CommercialRevision.countDocuments({ project: p._id }), 1, 'recalculation updates the current revision - no new revision');
});

maybeTest('BOQ overrides survive Recalculate BOQ / Pricing / Engineering; `null` resets one; engineering changes re-size and persist', async () => {
  const t = await team();
  const p = await project(t.md);
  const rev = await calcFirst(t, p);
  const ac = line(rev, 'AC Cable');
  const r1 = await recalc(t.md, rev._id, { engineeringInput: INPUT, manualOverrides: { 'AC Cable': { unitPrice: 999 } } });
  assert.equal(r1.status, 200);
  // Recalculate BOQ (no overrides sent), Recalculate Pricing (no lever change) - the override stays.
  await recalc(t.md, rev._id, { engineeringInput: INPUT });
  await recalc(t.md, rev._id, { engineeringInput: INPUT, pricingOverrides: {} });
  let s = await stored(rev._id);
  assert.equal(line(s, 'AC Cable').unitPrice, 999);
  assert.equal(line(s, 'AC Cable').source, 'override');
  assert.equal(line(s, 'AC Cable').autoUnitPrice, ac.unitPrice);

  // Re-estimate engineering: 80 -> 60 kWp re-sizes modules and inverter; the price override still applies.
  const before = line(s, 'PV Modules').qty;
  const r2 = await recalc(t.md, rev._id, { engineeringInput: { ...INPUT, kWp: 60 } });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  s = await stored(rev._id);
  assert.equal(s.engineeringInput.kWp, 60);
  assert.ok(line(s, 'PV Modules').qty < before);
  assert.equal(s.engineeringResult.inverter.model !== undefined, true);
  assert.equal(line(s, 'AC Cable').unitPrice, 999);
  assert.ok(r2.body.data.recalcSummary.changedLines.some(l => l.component === 'PV Modules' && l.qty));

  // Reset to auto: back to the CURRENT auto value (the 60 kWp design picks another AC cable).
  const autoNow = line(s, 'AC Cable').autoUnitPrice;
  await recalc(t.md, rev._id, { engineeringInput: s.engineeringInput, manualOverrides: { 'AC Cable': null } });
  s = await stored(rev._id);
  assert.equal(line(s, 'AC Cable').source, 'auto');
  assert.equal(line(s, 'AC Cable').unitPrice, autoNow);
});

maybeTest('Foreign-currency quotes are converted with the CURRENT configured rate on recalculation', async () => {
  const t = await team();
  await pricingConfigService.updateConfig({ engine: { fxRatesEgp: { USD: 50 } }, note: 'USD rate' }, { userId: t.md._id, userName: 'MD' });
  const p = await project(t.md);
  const rev = await calcFirst(t, p);
  const invItem = await MaterialItem.findOne({ category: 'On-Grid Inverter', model: line(rev, 'Solar Inverters').description }).lean();
  const sup = await Supplier.create({ code: 'SUP-0901', legalName: 'Shenzhen PV Export', status: 'Approved', contacts: [{ name: 'X', phone: '01099990000' }] });
  const usd = Math.round((invItem.unitPrice / 50) * 0.8);
  await uploadAndConfirm(t.proc, sup, priceListBuffer([itemRow(invItem, usd, 'USD', 'ratedKw')]));
  await recalc(t.md, rev._id, { engineeringInput: INPUT });
  let l = line(await stored(rev._id), 'Solar Inverters');
  assert.equal(l.unitPrice, usd * 50);
  assert.equal(l.fxRate, 50);
  assert.equal(l.foreignPrice, usd);
  assert.equal(l.priceCurrency, 'USD');

  await pricingConfigService.updateConfig({ engine: { fxRatesEgp: { USD: 52.5 } }, note: 'USD moved' }, { userId: t.md._id, userName: 'MD' });
  await recalc(t.md, rev._id, { engineeringInput: INPUT });
  l = line(await stored(rev._id), 'Solar Inverters');
  assert.equal(l.unitPrice, Math.round(usd * 52.5 * 100) / 100);
  assert.equal(l.fxRate, 52.5);
});

maybeTest('Agriculture Pumping prices the selected pump and motor from the Price Book (supplier price lists reach it)', async () => {
  const t = await team();
  const p = await project(t.md, { category: 'Agriculture Pumping', name: 'Farm pump' });
  const input = { fieldCropRows: [{ areaFeddan: 20, irrigationCode: 1, intervalDays: 2, sunHours: 5 }], treeRows: [], waterLevelM: 60, safetyAllowanceM: 10, wellDepthM: 60, pumpQty: 1, pvModuleModel: 'JKM475M-7RL3' };
  const r = await api('POST', `/api/v1/commercial/revisions/project/${p._id}`, { user: t.md, body: { engineeringInput: input } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const pumpLine = line(r.body.data, 'Submersible Water Pump');
  assert.equal(pumpLine.priceSource, 'reference', 'priced from the Price Book item, not the static file');
  assert.ok(pumpLine.materialItemKey);
  const item = await MaterialItem.findOne({ key: pumpLine.materialItemKey }).lean();
  const sup = await Supplier.create({ code: 'SUP-0902', legalName: 'Nile Pumps', status: 'Approved', contacts: [{ name: 'X', phone: '01099990001' }] });
  const price = Math.round(item.unitPrice * 0.85);
  const [brand, model, spec] = [item.brand, item.model, item.spec];
  await uploadAndConfirm(t.proc, sup, priceListBuffer([[item.category, brand, model, spec, 'pcs', price, 'EGP', 'In stock', 0, 1, item.n1 || 1, '', '2099-12-31']]));
  const r2 = await recalc(t.md, r.body.data._id, { engineeringInput: input });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  const l = line(await stored(r.body.data._id), 'Submersible Water Pump');
  assert.equal(l.unitPrice, price);
  assert.equal(l.supplierName, 'Nile Pumps');
  assert.equal(line(await stored(r.body.data._id), 'Pump Motor').priceSource, 'reference');
});

maybeTest('BOQ export (xlsx + csv) is the stored revision: rows, supplier names, totals, revision number; costs follow the role; history stays exportable', async () => {
  const t = await team();
  const p = await project(t.md);
  const rev = await calcFirst(t, p);
  const invItem = await MaterialItem.findOne({ category: 'On-Grid Inverter', model: line(rev, 'Solar Inverters').description }).lean();
  const sup = await Supplier.create({ code: 'SUP-0903', legalName: 'Cairo "Green", Energy', status: 'Approved', contacts: [{ name: 'X', phone: '01099990002' }] });
  await uploadAndConfirm(t.proc, sup, priceListBuffer([itemRow(invItem, 120000.25, 'EGP', 'ratedKw')]));
  await recalc(t.md, rev._id, { engineeringInput: INPUT });
  const s = await stored(rev._id);

  const x = await api('GET', `/api/v1/commercial/revisions/${rev._id}/boq-export?format=xlsx`, { user: t.md, raw: true });
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-disposition'), /BOQ_.*_Rev1\.xlsx/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(x.buffer);
  const ws = wb.getWorksheet('BOQ');
  const header = ws.getRow(4).values.slice(1);
  for (const h of ['Item No', 'Category', 'Subcategory', 'Item / Product', 'Description', 'Technical Specifications', 'Unit', 'Quantity', 'Unit Price', 'Total Price', 'Supplier Name', 'Currency', 'Exchange Rate', 'Pricing Source', 'Engineering Reference']) {
    assert.ok(header.includes(h), `column ${h}`);
  }
  const col = h => header.indexOf(h) + 1;
  const rows = [];
  for (let i = 5; i < 5 + s.boqLines.length; i += 1) rows.push(ws.getRow(i));
  const invRow = rows.find(r => r.getCell(col('Subcategory')).value === 'Solar Inverters');
  assert.equal(invRow.getCell(col('Unit Price')).value, 120000.25);
  assert.equal(invRow.getCell(col('Supplier Name')).value, 'Cairo "Green", Energy');
  assert.equal(invRow.getCell(col('Quantity')).value, line(s, 'Solar Inverters').qty);
  assert.equal(ws.getRow(5 + s.boqLines.length).getCell(col('Total Price')).value, s.boqTotal);
  assert.match(ws.getCell('A2').value, /^Revision 1 \(current\)/);
  const summary = wb.getWorksheet('Summary');
  const summaryText = [];
  summary.eachRow(r => summaryText.push(r.values.slice(1).join(' | ')));
  assert.ok(summaryText.some(l => l.startsWith('Revision | 1 (current)')));
  assert.ok(summaryText.some(l => l.startsWith('BOQ TOTAL (direct cost)')));
  assert.ok(summaryText.some(l => l.startsWith('Net price (excl. VAT)')));

  const c = await api('GET', `/api/v1/commercial/revisions/${rev._id}/boq-export?format=csv`, { user: t.md, raw: true });
  assert.equal(c.status, 200);
  const csv = c.buffer.toString('utf8');
  assert.ok(csv.startsWith('﻿Item No,Category,'), 'UTF-8 BOM + header');
  assert.ok(csv.includes('"Cairo ""Green"", Energy"'), 'quotes and commas escaped');
  assert.ok(csv.includes('\r\nBOQ TOTAL,'));
  assert.equal(csv.trim().split('\r\n').length, 1 + s.boqLines.length + 1);

  // Procurement may see BOQ lines but not BOQ costs: the export has no price columns.
  const pc = await api('GET', `/api/v1/commercial/revisions/${rev._id}/boq-export?format=csv`, { user: t.proc, raw: true });
  assert.equal(pc.status, 200);
  const head = pc.buffer.toString('utf8').split('\r\n')[0];
  assert.ok(!head.includes('Unit Price') && !head.includes('Supplier Name') && head.includes('Quantity'));

  // A new revision supersedes 1; revision 1 is kept and still exports as historical.
  await api('POST', `/api/v1/commercial/revisions/project/${p._id}`, { user: t.md, body: { engineeringInput: { ...INPUT, kWp: 60 } } });
  const old = await api('GET', `/api/v1/commercial/revisions/${rev._id}/boq-export?format=xlsx`, { user: t.md, raw: true });
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(old.buffer);
  assert.match(wb2.getWorksheet('BOQ').getCell('A2').value, /^Revision 1 \(historical\)/);
  assert.equal(await CommercialRevision.countDocuments({ project: p._id }), 2);
  assert.equal((await api('GET', `/api/v1/commercial/revisions/${rev._id}/boq-export?format=pdf`, { user: t.md })).status, 400);
});

maybeTest('A resubmitted "Calculate & Create Revision" (same requestId) returns the revision it created; same inputs with a new request are a legitimate new revision', async () => {
  const t = await team();
  const p = await project(t.md);
  const url = `/api/v1/commercial/revisions/project/${p._id}`;
  const first = await api('POST', url, { user: t.md, body: { engineeringInput: INPUT, requestId: 'form-1' } });
  assert.equal(first.status, 201);
  assert.match(first.body.message, /^Revision 1 calculated and created/);
  const again = await api('POST', url, { user: t.md, body: { engineeringInput: INPUT, requestId: 'form-1' } });
  assert.equal(again.status, 200);
  assert.match(again.body.message, /already created from these inputs/);
  assert.equal(again.body.data._id, first.body.data._id);
  assert.equal(await CommercialRevision.countDocuments({ project: p._id }), 1);
  const second = await api('POST', url, { user: t.md, body: { engineeringInput: INPUT, requestId: 'form-2' } });
  assert.equal(second.status, 201);
  assert.equal(await CommercialRevision.countDocuments({ project: p._id }), 2);
  const revs = await CommercialRevision.find({ project: p._id }).sort({ revisionNumber: 1 }).lean();
  assert.deepEqual(revs.map(r => [r.revisionNumber, r.isCurrent]), [[1, false], [2, true]], 'history kept, one current');
});

maybeTest('Price list files: title rows above the header, "Unit Price (USD)" headers, decimal commas - read, and bad prices named per row', async () => {
  const t = await team();
  await pricingConfigService.updateConfig({ engine: { fxRatesEgp: { USD: 50 } }, note: 'USD rate' }, { userId: t.md._id, userName: 'MD' });
  const sup = await Supplier.create({ code: 'SUP-0904', legalName: 'Alex Cables', status: 'Approved', contacts: [{ name: 'X', phone: '01099990003' }] });
  const cable = await MaterialItem.findOne({ category: 'DC Cable' }).lean();
  const [brand, model, spec] = cable.key.split(' | ');
  const header = ['Item Category', 'Manufacturer', 'Model No', 'Description', 'UOM', 'Unit Price (USD)', 'Rated value', 'Rated unit'];
  const buf = priceListBuffer([
    ['DC Cable', brand, model, spec, 'm', '1,25', cable.attrs.sizeMm2, 'mm2'],
    ['DC Cable', 'Nobrand', 'X1', '', 'm', '', 4, 'mm2'],
    ['DC Cable', 'Nobrand', 'X2', '', 'm', 'call us', 4, 'mm2'],
  ], { header, titleRows: [['Alex Cables - price list November'], ['Tel 0100'], []] });
  const fd = new FormData();
  fd.append('file', new Blob([buf]), 'alex.xlsx');
  const prev = await api('POST', `/api/v1/commercial/suppliers/${sup._id}/price-lists/preview`, { user: t.proc, form: fd });
  assert.equal(prev.status, 201, JSON.stringify(prev.body));
  const rows = prev.body.data.rows;
  assert.equal(prev.body.data.mapping.unitPrice, 'Unit Price (USD)');
  assert.equal(rows[0].rowNo, 5, 'row numbers are the ones the supplier sees in Excel');
  assert.equal(rows[0].price, 1.25);
  assert.equal(rows[0].currency, 'USD');
  assert.equal(rows[0].egp, 62.5);
  assert.equal(rows[0].status, 'Update');
  assert.deepEqual(rows[1].errors, ['Missing price']);
  assert.deepEqual(rows[2].errors, ['Price "call us" is not a number']);
  assert.equal(prev.body.data.summary.Error, 2);
});

test('toNumber / normalizeHeader / csvField (pure)', () => {
  assert.equal(uploads.toNumber(4132.5), 4132.5);
  assert.equal(uploads.toNumber('EGP 1,250.50'), 1250.5);
  assert.equal(uploads.toNumber('1.250,50'), 1250.5);
  assert.equal(uploads.toNumber('12,5'), 12.5);
  assert.equal(uploads.toNumber('1,250,000'), 1250000);
  assert.equal(uploads.toNumber('١٢٥٠٫٥'), 1250.5);
  assert.equal(uploads.toNumber('$ 99'), 99);
  assert.equal(uploads.toNumber('call us'), null);
  assert.equal(uploads.toNumber(''), null);
  assert.equal(uploads.normalizeHeader('Unit Price (EGP)'), 'unit price');
  assert.equal(uploads.normalizeHeader('UnitPrice'), 'unit price');
  assert.equal(uploads.normalizeHeader('unit_price'), 'unit price');
  assert.equal(uploads.normalizeHeader('Purchase Price'), 'purchase price');
  assert.equal(uploads.currencyFromHeader('Unit Price (USD)'), 'USD');
  assert.equal(uploads.currencyFromHeader('Price'), null);
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('two\nlines'), '"two\nlines"');
  assert.equal(csvField(12.5), '12.5');
  assert.equal(csvField(null), '');
});
