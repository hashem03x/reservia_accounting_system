const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// End-to-end coverage (through the real controller, not just the number-generation service - see
// projectNumberAndOrderCode.test.js for the lower-level unit tests) of sector-based Project ID
// generation (docs section "Automatic Project ID Generation"): projectController.js#createProject
// now requires a real, active Sector and derives the project number's prefix from it, never a
// frontend-supplied prefix; projectController.js#updateProject never touches projectNumber, so
// changing a project's sector afterward can never alter its already-generated number.

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_sector_project_numbering';

let Project, Sector, User;
let createProject, updateProject;
let createSector;

function callHandler(handler, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
    };
    Promise.resolve(handler({ headers: {}, query: {}, body: {}, params: {}, ...req }, res, err => (err ? reject(err) : resolve({ status: res.statusCode })))).catch(reject);
  });
}

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Project = require('../../models/project/projectModel');
  Sector = require('../../models/project/sectorModel');
  User = require('../../models/userModel');
  ({ createProject, updateProject } = require('../../controller/project/projectController'));
  ({ createSector } = require('../../services/project/sectorService'));
  await Promise.all([Project.init(), Sector.init(), User.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let seq = 0;
let manager, customer, admin;

beforeEach(async () => {
  await Promise.all(['projects', 'sectors', 'users', 'counters'].map(c => mongoose.connection.collection(c).deleteMany({})));
  manager = await User.create({ name: 'PM', email: `pm-${(seq += 1)}@example.com`, role: 'admin', type: 'online' });
  customer = await User.create({ name: 'Customer', email: `cust-${seq}@example.com`, role: 'user', type: 'offline' });
  admin = { _id: manager._id };
});

function baseBody(overrides = {}) {
  return {
    name: 'Test Project',
    contractValue: 100000,
    projectManager: String(manager._id),
    startDate: new Date('2026-01-01'),
    deliveryDate: new Date('2026-12-31'),
    customer: String(customer._id),
    ...overrides,
  };
}

test('createProject: first project in a sector is numbered "<PREFIX>-0000001"', async () => {
  await createSector({ name: 'Agriculture' });
  const res = await callHandler(createProject, { body: baseBody({ sector: 'Agriculture' }), user: admin });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.projectNumber, 'AGR-0000001');
  assert.equal(res.body.data.sector, 'Agriculture');
});

test('createProject: a second project in the SAME sector continues the sequence', async () => {
  await createSector({ name: 'Construction' });
  const first = await callHandler(createProject, { body: baseBody({ sector: 'Construction' }), user: admin });
  const second = await callHandler(createProject, { body: baseBody({ sector: 'Construction' }), user: admin });
  assert.equal(first.body.data.projectNumber, 'CON-0000001');
  assert.equal(second.body.data.projectNumber, 'CON-0000002');
});

test('createProject: different sectors are numbered independently', async () => {
  await createSector({ name: 'Engineering' });
  await createSector({ name: 'Technology' });
  const eng = await callHandler(createProject, { body: baseBody({ sector: 'Engineering' }), user: admin });
  const tec = await callHandler(createProject, { body: baseBody({ sector: 'Technology' }), user: admin });
  const eng2 = await callHandler(createProject, { body: baseBody({ sector: 'Engineering' }), user: admin });
  assert.equal(eng.body.data.projectNumber, 'ENG-0000001');
  assert.equal(tec.body.data.projectNumber, 'TEC-0000001');
  assert.equal(eng2.body.data.projectNumber, 'ENG-0000002');
});

test('createProject: a sector name is resolved case-insensitively to its canonical form, and still shares one sequence', async () => {
  await createSector({ name: 'Technology' });
  const lower = await callHandler(createProject, { body: baseBody({ sector: 'technology' }), user: admin });
  const upper = await callHandler(createProject, { body: baseBody({ sector: 'TECHNOLOGY' }), user: admin });
  assert.equal(lower.body.data.sector, 'Technology', 'stored sector is always the canonical name, not whatever case the client sent');
  assert.equal(lower.body.data.projectNumber, 'TEC-0000001');
  assert.equal(upper.body.data.projectNumber, 'TEC-0000002');
});

test('createProject: rejects a missing sector with a clear error, and never creates a project or burns a number', async () => {
  const res = await callHandler(createProject, { body: baseBody({ sector: undefined }), user: admin }).catch(err => ({ error: err }));
  assert.match(res.error.message, /[Ss]ector is required/);
  assert.equal(await Project.countDocuments({}), 0);
});

test('createProject: rejects a sector that does not exist / is not active, with a clear error', async () => {
  const res = await callHandler(createProject, { body: baseBody({ sector: 'Nonexistent Sector' }), user: admin }).catch(err => ({ error: err }));
  assert.match(res.error.message, /not a valid sector/);

  await createSector({ name: 'Retired', isActive: false });
  const res2 = await callHandler(createProject, { body: baseBody({ sector: 'Retired' }), user: admin }).catch(err => ({ error: err }));
  assert.match(res2.error.message, /inactive/);

  assert.equal(await Project.countDocuments({}), 0);
});

test('createProject: concurrent creations in the same sector never collide on project number', async () => {
  await createSector({ name: 'Industrials' });
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      callHandler(createProject, { body: baseBody({ sector: 'Industrials', name: `Concurrent ${i}` }), user: admin })
    )
  );
  const numbers = results.map(r => r.body.data.projectNumber);
  assert.equal(new Set(numbers).size, 10, 'no two concurrently-created projects in the same sector may share a number');
});

test('updateProject: changing a project\'s sector afterward never changes its already-generated project number', async () => {
  await createSector({ name: 'Agriculture' });
  await createSector({ name: 'Construction' });
  const created = await callHandler(createProject, { body: baseBody({ sector: 'Agriculture' }), user: admin });
  const originalNumber = created.body.data.projectNumber;
  assert.equal(originalNumber, 'AGR-0000001');

  await callHandler(updateProject, { params: { id: String(created.body.data._id) }, body: { sector: 'Construction' }, user: admin });

  const reloaded = await Project.findById(created.body.data._id);
  assert.equal(reloaded.projectNumber, originalNumber, 'projectNumber is immutable through update, regardless of sector changes');
  assert.equal(reloaded.sector, 'Construction', 'the sector itself does change');
});

test('compatibility: historical/legacy free-text project numbers (pre-dating sector-based numbering) coexist without collision', async () => {
  // Simulates a project created before this feature existed - an arbitrary, manually-entered
  // projectNumber with no relation to any sector prefix.
  await mongoose.connection.collection('projects').insertOne({
    projectNumber: 'LEGACY-0001',
    contractValue: 5000,
    projectManager: manager._id,
    startDate: new Date('2025-01-01'),
    deliveryDate: new Date('2025-06-01'),
    sector: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await createSector({ name: 'Agriculture' });
  const created = await callHandler(createProject, { body: baseBody({ sector: 'Agriculture' }), user: admin });
  assert.equal(created.body.data.projectNumber, 'AGR-0000001', 'the new sector-based sequence starts cleanly regardless of unrelated legacy numbers');

  const legacy = await Project.findOne({ projectNumber: 'LEGACY-0001' });
  assert.ok(legacy, 'the legacy project is untouched and still readable');
});
