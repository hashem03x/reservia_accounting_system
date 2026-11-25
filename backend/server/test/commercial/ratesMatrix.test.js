const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');

// Deal Engine - "No Rates Matrix configured for country Egypt" (Engineering -> Calculate & Create
// Revision). Root cause: the Egypt Rates Matrix is one document that only the manual
// db:seed-commercial-materials script created, with no way to create or maintain it in the app, and
// every country check compared to the exact string 'Egypt'. These tests run the REAL routes on a
// REAL MongoDB: the missing-matrix error, loading the reference matrix and saving versions from the
// Pricing Config API (managers only), calculation and revision creation, history kept, another
// country, an invalid / differently-cased country. Self-skips without TEST_DB_URI.

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

let User, RatesConfig, CommercialRevision, CommercialProject;
let server, baseUrl;
const REGION = 'Cairo - 10th of Ramadan';
const REF_INPUT = { kWp: 80, pvModuleModel: 'JKM475M-7RL3', structureType: 'Hangar Roof', acLengthM: 20, acPricePerMOverride: 1195, annualConsumptionKwh: 155000 };

before(async () => {
  if (!RUN) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  RatesConfig = require('../../models/commercial/ratesConfigModel');
  CommercialRevision = require('../../models/commercial/commercialRevisionModel');
  CommercialProject = require('../../models/commercial/commercialProjectModel');
  require('../../models/commercial/pricingConfigModel');
  await Promise.all([User.init(), RatesConfig.init(), CommercialProject.init()]);
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/commercial/projects', require('../../routes/commercial/projectRoute'));
  app.use('/api/v1/commercial/revisions', require('../../routes/commercial/revisionRoute'));
  app.use('/api/v1/commercial/pricing-config', require('../../routes/commercial/pricingConfigRoute'));
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

/** The Price Book as production has it, but WITHOUT a Rates Matrix (the failing state). */
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
  await RatesConfig.deleteMany({});
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
async function team() {
  return {
    md: await makeUser('Ahmed MD', [m('COMMERCIAL', 'md')]),
    sales: await makeUser('Sara Sales', [m('COMMERCIAL', 'sales')]),
    // Engineering inputs are entered by Technical (or the MD) - the Deal Engine's own rule.
    tech: await makeUser('Tarek Tech', [m('COMMERCIAL', 'technical')]),
  };
}
async function project(user, extra = {}) {
  const customer = await User.create({ name: `Customer ${++seq}`, phone: `0100000${String(seq).padStart(4, '0')}`, role: 'user', type: 'offline', isOffline: true });
  const res = await api('POST', '/api/v1/commercial/projects', { user, body: { name: 'Reference 80 kWp', customer: customer._id, country: 'Egypt', region: REGION, category: 'On-Grid C&I', scope: 'Supply & Installation', ...extra } });
  return res;
}
const calc = (user, id, input = REF_INPUT) => api('POST', `/api/v1/commercial/revisions/project/${id}`, { user, body: { engineeringInput: input } });

maybeTest('missing matrix: a clear, actionable error and nothing is created', async () => {
  const t = await team();
  const p = (await project(t.sales)).body.data.project;
  const r = await calc(t.tech, p._id);
  assert.equal(r.status, 400);
  assert.match(r.body.message, /No Rates Matrix configured for country "Egypt"/);
  assert.match(r.body.message, /Pricing Config -> Rates Matrix/);
  assert.equal(await CommercialRevision.countDocuments({ project: p._id }), 0, 'no partial revision');
  assert.equal((await CommercialProject.findById(p._id).lean()).currentRevision ?? null, null);
  const view = (await api('GET', '/api/v1/commercial/pricing-config/rates-matrix?country=Egypt', { user: t.sales })).body.data;
  assert.equal(view.active, null);
  assert.equal(view.referenceAvailable, true);
  assert.equal(view.canManage, false);
});

maybeTest('reference matrix: managers only, once; then Egypt calculates and creates revisions 1 and 2', async () => {
  const t = await team();
  assert.equal((await api('POST', '/api/v1/commercial/pricing-config/rates-matrix/reference', { user: t.sales, body: { country: 'Egypt' } })).status, 403);
  const load = await api('POST', '/api/v1/commercial/pricing-config/rates-matrix/reference', { user: t.md, body: { country: 'Egypt' } });
  assert.equal(load.status, 201, JSON.stringify(load.body));
  assert.equal(load.body.data.source, 'reference');
  assert.equal(load.body.data.regions.length, 8);
  assert.equal((await api('POST', '/api/v1/commercial/pricing-config/rates-matrix/reference', { user: t.md, body: { country: 'Egypt' } })).status, 409, 'never loaded twice');
  // Same values as the seed script (one definition).
  const { referenceMatrix } = require('../../services/commercial/ratesMatrix');
  const stored = await RatesConfig.findOne({ country: 'Egypt' }).lean();
  assert.deepEqual(stored.installRatesEgpPerKwpByRegion, referenceMatrix().installRatesEgpPerKwpByRegion);

  const p = (await project(t.sales)).body.data.project;
  const r1 = await calc(t.tech, p._id);
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.data.revisionNumber, 1);
  assert.ok(r1.body.data.boqTotal > 0);
  const r2 = await calc(t.tech, p._id);
  assert.equal(r2.status, 201);
  assert.equal(r2.body.data.revisionNumber, 2);
  const revs = await CommercialRevision.find({ project: p._id }).sort({ revisionNumber: 1 }).lean();
  assert.deepEqual(revs.map(r => [r.revisionNumber, r.isCurrent]), [[1, false], [2, true]], 'no duplicate, no overwrite');
  // The Engineering tab's revision history (GET /projects/:id/revisions) lists both - it used to
  // answer 500 ("shapeRevisionForRole is not defined").
  const history = await api('GET', `/api/v1/commercial/projects/${p._id}/revisions`, { user: t.tech });
  assert.equal(history.status, 200, JSON.stringify(history.body).slice(0, 200));
  assert.deepEqual(history.body.data.map(r => r.revisionNumber), [2, 1]);
});

maybeTest('a new version applies to new calculations only; earlier revisions and versions stay intact; future versions wait', async () => {
  const t = await team();
  await api('POST', '/api/v1/commercial/pricing-config/rates-matrix/reference', { user: t.md, body: { country: 'Egypt' } });
  const p = (await project(t.sales)).body.data.project;
  const r1 = (await calc(t.tech, p._id)).body.data;
  const install1 = r1.boqLines.find(l => /install/i.test(`${l.component} ${l.description || ''}`));
  const view = (await api('GET', '/api/v1/commercial/pricing-config/rates-matrix?country=Egypt', { user: t.md })).body.data;
  assert.equal(view.canManage, true);
  const edited = JSON.parse(JSON.stringify(view.active));
  edited.regions = edited.regions.map(row => (row.region === REGION ? { ...row, install: row.install.map(v => v + 100) } : row));
  // Validation: a blank value is refused, never stored as zero.
  const blank = JSON.parse(JSON.stringify(edited));
  blank.regions[0].install[0] = '';
  assert.equal((await api('POST', '/api/v1/commercial/pricing-config/rates-matrix', { user: t.md, body: { ...blank, country: 'Egypt' } })).status, 400);
  const missing = { ...edited, regions: edited.regions.slice(1) };
  assert.equal((await api('POST', '/api/v1/commercial/pricing-config/rates-matrix', { user: t.md, body: { ...missing, country: 'Egypt' } })).status, 400);
  assert.equal((await api('POST', '/api/v1/commercial/pricing-config/rates-matrix', { user: t.sales, body: { ...edited, country: 'Egypt' } })).status, 403);
  // A version dated next year is stored but not used yet.
  const future = await api('POST', '/api/v1/commercial/pricing-config/rates-matrix', { user: t.md, body: { ...edited, country: 'Egypt', effectiveDate: '2099-01-01', note: 'next year' } });
  assert.equal(future.status, 201);
  const rFuture = (await calc(t.tech, p._id)).body.data;
  assert.equal(rFuture.boqTotal, r1.boqTotal, 'future version not yet in force');
  const now = await api('POST', '/api/v1/commercial/pricing-config/rates-matrix', { user: t.md, body: { ...edited, country: 'Egypt', note: 'install +100' } });
  assert.equal(now.status, 201, JSON.stringify(now.body));
  assert.equal(now.body.data.source, 'manual');
  const r3 = (await calc(t.tech, p._id)).body.data;
  assert.ok(r3.boqTotal > r1.boqTotal, 'the new rate reaches the BOQ');
  const first = await CommercialRevision.findById(r1._id).lean();
  assert.equal(first.boqTotal, r1.boqTotal, 'revision 1 keeps its own numbers');
  if (install1) assert.deepEqual(first.boqLines.find(l => l.component === install1.component).unitPrice, install1.unitPrice);
  const after = (await api('GET', '/api/v1/commercial/pricing-config/rates-matrix?country=Egypt', { user: t.md })).body.data;
  assert.equal(after.history.length, 3, 'every version kept');
  assert.equal(after.scheduled.length, 1);
  assert.equal(after.active.note, 'install +100');
});

maybeTest('countries: another country calculates without a matrix; invalid refused; any casing of Egypt is Egypt', async () => {
  const t = await team();
  const ksa = await project(t.sales, { country: 'saudi arabia', region: 'Riyadh' });
  assert.equal(ksa.status, 201, JSON.stringify(ksa.body));
  assert.equal(ksa.body.data.project.country, 'Saudi Arabia', 'stored canonical');
  const rKsa = await calc(t.tech, ksa.body.data.project._id);
  assert.equal(rKsa.status, 201, JSON.stringify(rKsa.body));
  const bad = await project(t.sales, { country: 'Narnia' });
  assert.equal(bad.status, 400);
  assert.match(JSON.stringify(bad.body), /not a Deal Engine country/);
  const lower = await project(t.sales, { country: ' EGYPT ' });
  assert.equal(lower.status, 201);
  assert.equal(lower.body.data.project.country, 'Egypt');
  const noRegion = await project(t.sales, { country: 'egypt', region: '' });
  assert.equal(noRegion.status, 400, 'the Egypt region rule applies to any casing');
  // A legacy project stored as "egypt" (before this fix) is priced with the Egypt matrix.
  await api('POST', '/api/v1/commercial/pricing-config/rates-matrix/reference', { user: t.md, body: { country: 'Egypt' } });
  await CommercialProject.updateOne({ _id: lower.body.data.project._id }, { $set: { country: 'egypt' } });
  const rLegacy = await calc(t.tech, lower.body.data.project._id);
  assert.equal(rLegacy.status, 201, JSON.stringify(rLegacy.body));
  const rRef = (await calc(t.tech, (await project(t.sales)).body.data.project._id)).body.data;
  assert.equal(rLegacy.body.data.boqTotal, rRef.boqTotal, 'same matrix as a canonical Egypt project');
});
