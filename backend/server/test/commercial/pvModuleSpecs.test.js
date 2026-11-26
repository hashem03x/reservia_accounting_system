const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');

// Deal Engine - 'PV module "Jinko Solar III 730W" not found in the Price Book' on Calculate & Create
// Revision. Root cause: a supplier price-list upload creates a NEW module with its rated power only
// and status PLACEHOLDER; the engineering form lists every non-archived module, but the calculation
// leaves PLACEHOLDER items out of its catalog - and nothing in the app could complete them. These
// tests run the REAL routes on a REAL MongoDB: the clear error, completing the technical data on
// Materials (editors only, validated), the item becoming Available, and the calculation then
// working. Self-skips without TEST_DB_URI.

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

let User, MaterialItem, CommercialRevision;
let server, baseUrl;
const MODEL = 'Jinko Solar III 730W';
const INPUT = { kWp: 80, pvModuleModel: MODEL, structureType: 'Hangar Roof', acLengthM: 20, acPricePerMOverride: 1195, annualConsumptionKwh: 155000 };
// Datasheet values for a 730 W n-type module.
const DATASHEET = { pmaxW: 730, vmp: 41.5, imp: 17.6, voc: 49.6, isc: 18.6, vocTempCoeffPctPerC: -0.25, maxDcV: 1500 };

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  MaterialItem = require('../../models/commercial/materialItemModel');
  CommercialRevision = require('../../models/commercial/commercialRevisionModel');
  require('../../models/commercial/pricingConfigModel');
  await Promise.all([User.init(), MaterialItem.init()]);
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/commercial/projects', require('../../routes/commercial/projectRoute'));
  app.use('/api/v1/commercial/revisions', require('../../routes/commercial/revisionRoute'));
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
async function setup() {
  const t = {
    md: await makeUser('Ahmed MD', [m('COMMERCIAL', 'md')]),
    procurement: await makeUser('Paula Procurement', [m('COMMERCIAL', 'procurement')]),
    tech: await makeUser('Tarek Tech', [m('COMMERCIAL', 'technical')]),
  };
  // Exactly what priceListUploadService.js#confirmUpload creates for a new module row.
  t.item = await MaterialItem.create({
    category: 'PV Modules', brand: 'Jinko Solar', model: MODEL, spec: '730W', unit: 'pcs', n1: 730, attrs: { pmaxW: 730 },
    unitPrice: 7300, currency: 'EGP', status: 'PLACEHOLDER', sourceWorkbook: 'Supplier upload SUP-001', sourceSheet: 'jinko.xlsx', key: `Jinko Solar | ${MODEL} | 730W`,
  });
  const customer = await User.create({ name: `Customer ${++seq}`, phone: `0100000${String(seq).padStart(4, '0')}`, role: 'user', type: 'offline', isOffline: true });
  const p = await api('POST', '/api/v1/commercial/projects', { user: t.md, body: { name: '730 W modules', customer: customer._id, country: 'Egypt', region: 'Cairo - 10th of Ramadan', category: 'On-Grid C&I', scope: 'Supply & Installation' } });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  t.project = p.body.data.project;
  return t;
}
const calc = (t, input = INPUT) => api('POST', `/api/v1/commercial/revisions/project/${t.project._id}`, { user: t.tech, body: { engineeringInput: input } });

maybeTest('a module without its electrical data: listed as not ready, and the calculation says why', async () => {
  const t = await setup();
  const list = await api('GET', '/api/v1/commercial/materials?category=PV%20Modules&limit=200', { user: t.tech });
  assert.equal(list.status, 200);
  const row = list.body.data.find(x => x.model === MODEL);
  assert.ok(row, 'the form lists it');
  assert.ok(row.missingSpecs.includes('Voltage at max power (Vmp)'));
  assert.equal(row.missingSpecs.includes('Rated power (Pmax)'), false, 'the uploaded rated power counts');
  const seeded = list.body.data.find(x => x.model === 'JKM475M-7RL3');
  assert.deepEqual(seeded.missingSpecs, [], 'seeded modules are complete');

  const r = await calc(t);
  assert.equal(r.status, 400);
  assert.match(r.body.message, /PV module "Jinko Solar III 730W" cannot be used in a calculation yet/);
  assert.match(r.body.message, /missing: Voltage at max power \(Vmp\), Current at max power \(Imp\)/);
  assert.match(r.body.message, /Deal Engine -> Materials/);
  assert.equal(await CommercialRevision.countDocuments({ project: t.project._id }), 0, 'no partial revision');

  const unknown = await calc(t, { ...INPUT, pvModuleModel: 'Nope 1W' });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.message, /PV module "Nope 1W" is not in the Price Book/);

  await MaterialItem.updateOne({ _id: t.item._id }, { archived: true });
  assert.match((await calc(t)).body.message, /was archived in the Price Book/);
});

maybeTest('an editor completes the technical data; it becomes Available and the calculation works', async () => {
  const t = await setup();
  const url = `/api/v1/commercial/materials/${t.item._id}`;
  assert.equal((await api('PATCH', url, { user: t.tech, body: { attrs: DATASHEET } })).status, 403, 'Technical cannot edit the Price Book');
  const badSign = await api('PATCH', url, { user: t.md, body: { attrs: { ...DATASHEET, vocTempCoeffPctPerC: 0.25 } } });
  assert.equal(badSign.status, 400);
  assert.match(badSign.body.message, /Voc temperature coefficient must be a negative number/);
  const early = await api('PATCH', url, { user: t.md, body: { status: 'Available' } });
  assert.equal(early.status, 400, 'cannot be forced Available while data is missing');
  assert.match(early.body.message, /missing: Voltage at max power/);
  assert.equal((await MaterialItem.findById(t.item._id).lean()).status, 'PLACEHOLDER');

  const partial = await api('PATCH', url, { user: t.procurement, body: { attrs: { vmp: 41.5, imp: 17.6 } } });
  assert.equal(partial.status, 200);
  assert.equal(partial.body.data.status, 'PLACEHOLDER', 'still incomplete');
  assert.deepEqual(partial.body.data.missingSpecs, ['Open-circuit voltage (Voc)', 'Short-circuit current (Isc)', 'Voc temperature coefficient']);

  const done = await api('PATCH', url, { user: t.procurement, body: { attrs: { voc: 49.6, isc: 18.6, vocTempCoeffPctPerC: -0.25, maxDcV: 1500 } } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.data.status, 'Available');
  assert.deepEqual(done.body.data.missingSpecs, []);
  const saved = await MaterialItem.findById(t.item._id).lean();
  assert.equal(saved.attrs.pmaxW, 730, 'merged, not replaced');
  assert.equal(saved.attrs.pricePerWatt, 10, 'per-watt price from the unit price (7300 / 730)');
  assert.equal(saved.priceHistory.length, 0, 'no price change recorded');

  const r = await calc(t);
  assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  const line = r.body.data.boqLines.find(l => l.component === 'PV Modules');
  assert.match(line.description, /Jinko Solar III 730W/);
  assert.equal(line.unitPrice, 7300);
  assert.equal(line.qty, Math.ceil(80000 / 730));
});
