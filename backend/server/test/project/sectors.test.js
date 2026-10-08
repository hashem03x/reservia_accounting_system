const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Admin-managed Project Sectors: CRUD rules (services/project/sectorService.js), how projects keep
// referencing them (Project.sector holds the sector name), and the seed that preserves existing
// values (scripts/seedSectors.js).

const DB_URI = process.env.TEST_DB_URI || 'mongodb://127.0.0.1:27017/reversia_test_sectors';

let Sector, Project, User;
let sectorService;
let manager;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  Sector = require('../../models/project/sectorModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  sectorService = require('../../services/project/sectorService');
  await Promise.all([Sector.init(), Project.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([Sector.deleteMany({}), Project.deleteMany({}), User.deleteMany({})]);
  await mongoose.connection.collection('projects').deleteMany({});
  manager = await User.create({ name: 'Sector Manager', email: `sector-mgr-${Date.now()}@example.com`, role: 'admin', type: 'online' });
});

const createProject = (sector, extra = {}) =>
  Project.create({
    projectNumber: `PRJ-SEC-${Date.now()}-${Math.random()}`,
    contractValue: 1000,
    projectManager: manager._id,
    startDate: new Date('2026-01-01'),
    deliveryDate: new Date('2026-06-01'),
    sector,
    ...extra,
  });
const statusOf = async promise => {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    return `${err.statusCode || 'error'}: ${err.message}`;
  }
};

// ---------------------------------------------------------------- CRUD

test('create: a sector is created active by default and listed (admin list and active list)', async () => {
  const created = await sectorService.createSector({ name: '  Engineering  ' });
  assert.equal(created.name, 'Engineering', 'name is trimmed');
  assert.equal(created.isActive, true);
  assert.equal(created.projectsCount, 0);

  assert.deepEqual((await sectorService.listSectors()).map(s => s.name), ['Engineering']);
  assert.deepEqual((await sectorService.listSectors({ activeOnly: true })).map(s => s.name), ['Engineering']);
});

test('create: duplicate names are rejected, case-insensitively, with a clean 400', async () => {
  await sectorService.createSector({ name: 'Engineering' });
  assert.match(await statusOf(sectorService.createSector({ name: 'Engineering' })), /^400: A sector named "Engineering" already exists/);
  assert.match(await statusOf(sectorService.createSector({ name: 'ENGINEERING ' })), /^400: A sector named "Engineering" already exists/);
  assert.equal(await Sector.countDocuments({}), 1);
  // The unique index is the backstop when the service check is bypassed (e.g. simultaneous creates).
  await assert.rejects(() => Sector.create({ name: 'engineering' }), err => err.code === 11000);
});

test('list: ordered by name, keyword search, and per-sector project usage counts', async () => {
  await sectorService.createSector({ name: 'Villa' });
  await sectorService.createSector({ name: 'Industrials' });
  await sectorService.createSector({ name: 'Engineering' });
  await createProject('Villa');
  await createProject('Villa');

  const all = await sectorService.listSectors();
  assert.deepEqual(all.map(s => s.name), ['Engineering', 'Industrials', 'Villa']);
  assert.equal(all.find(s => s.name === 'Villa').projectsCount, 2);
  assert.deepEqual((await sectorService.listSectors({ keyword: 'ind' })).map(s => s.name), ['Industrials']);
  assert.deepEqual((await sectorService.listSectors({ keyword: '.*' })).map(s => s.name), [], 'keyword is matched literally, not as a regex');
});

test('get: returns the sector with its usage; unknown id -> 404', async () => {
  const created = await sectorService.createSector({ name: 'Villa' });
  await createProject('Villa');
  assert.equal((await sectorService.getSector(created._id)).projectsCount, 1);
  assert.match(await statusOf(sectorService.getSector(new mongoose.Types.ObjectId())), /^404: No sector found/);
});

test('edit: renaming "Engineering" to "Engineering & Technical" renames it on every project using it (incl. soft-deleted)', async () => {
  const sector = await sectorService.createSector({ name: 'Engineering' });
  const p1 = await createProject('Engineering');
  const p2 = await createProject('Engineering');
  const other = await sectorService.createSector({ name: 'Villa' });
  const p3 = await createProject('Villa');
  await Project.collection.updateOne({ _id: p2._id }, { $set: { isDeleted: true } });

  const updated = await sectorService.updateSector(sector._id, { name: 'Engineering & Technical' });
  assert.equal(updated.name, 'Engineering & Technical');
  assert.equal(updated.projectsCount, 2);

  const raw = id => Project.collection.findOne({ _id: id });
  assert.equal((await raw(p1._id)).sector, 'Engineering & Technical');
  assert.equal((await raw(p2._id)).sector, 'Engineering & Technical');
  assert.equal((await raw(p3._id)).sector, 'Villa', 'other sectors untouched');
  assert.equal((await sectorService.getSector(other._id)).name, 'Villa');
  assert.equal((await Project.findById(p1._id)).contractValue, 1000, 'nothing else on the project changes');
});

test('edit: cannot rename onto another sector\'s name; renaming only the case is allowed', async () => {
  const a = await sectorService.createSector({ name: 'Villa' });
  await sectorService.createSector({ name: 'Industrials' });
  assert.match(await statusOf(sectorService.updateSector(a._id, { name: 'industrials' })), /^400: A sector named "Industrials" already exists/);
  assert.equal((await sectorService.updateSector(a._id, { name: 'VILLA' })).name, 'VILLA');
  assert.match(await statusOf(sectorService.updateSector(new mongoose.Types.ObjectId(), { name: 'X' })), /^404/);
});

// ---------------------------------------------------------------- deactivate / delete

test('deactivate: stays visible to admins, leaves the selectable list, existing projects keep it', async () => {
  const sector = await sectorService.createSector({ name: 'Villa' });
  const project = await createProject('Villa');

  const updated = await sectorService.updateSector(sector._id, { isActive: false });
  assert.equal(updated.isActive, false);
  assert.deepEqual((await sectorService.listSectors()).map(s => s.name), ['Villa'], 'still in the admin list');
  assert.deepEqual((await sectorService.listSectors({ activeOnly: true })).map(s => s.name), [], 'not selectable');

  const fresh = await Project.findById(project._id);
  assert.equal(fresh.sector, 'Villa', 'the project keeps its sector');
  fresh.name = 'Edited without touching the sector';
  await fresh.save(); // an unrelated edit of a project on an inactive sector still works
  assert.equal((await Project.findById(project._id)).sector, 'Villa');

  await assert.rejects(() => createProject('Villa'), /inactive and cannot be selected/, 'a new project cannot pick it');
});

test('delete: refused (400) while any project uses the sector, including soft-deleted ones; nothing changes', async () => {
  const sector = await sectorService.createSector({ name: 'Villa' });
  const project = await createProject('Villa');
  await Project.collection.updateOne({ _id: project._id }, { $set: { isDeleted: true } });

  assert.match(await statusOf(sectorService.deleteSector(sector._id)), /^400: The sector "Villa" is used by 1 project and cannot be deleted\. Deactivate it instead/);
  assert.equal(await Sector.countDocuments({}), 1);
  assert.equal((await Project.collection.findOne({ _id: project._id })).sector, 'Villa');
});

test('delete: an unused sector is permanently deleted; deleting it again -> 404', async () => {
  const sector = await sectorService.createSector({ name: 'Temporary' });
  await sectorService.deleteSector(sector._id);
  assert.equal(await Sector.countDocuments({}), 0);
  assert.match(await statusOf(sectorService.deleteSector(sector._id)), /^404/);
});

// ---------------------------------------------------------------- projects

test('project create: only an existing, active sector is accepted, stored by its canonical name', async () => {
  await sectorService.createSector({ name: 'Engineering' });
  const project = await createProject('engineering ');
  assert.equal(project.sector, 'Engineering', 'normalized to the Sector record\'s own name');
  await assert.rejects(() => createProject('Marketing'), /"Marketing" is not a valid sector/);
  const none = await createProject(null);
  assert.equal(none.sector, null, 'no sector stays valid');
});

test('project edit: changing the sector persists; clearing it works; unchanged values are never re-checked', async () => {
  await sectorService.createSector({ name: 'Villa' });
  await sectorService.createSector({ name: 'Industrials' });
  const project = await createProject('Villa');

  project.sector = 'Industrials';
  await project.save();
  assert.equal((await Project.findById(project._id)).sector, 'Industrials');

  project.sector = null;
  await project.save();
  assert.equal((await Project.findById(project._id)).sector, null);
});

test('resolveProjectSector (used by the API validators): keeping the current inactive sector is allowed, switching to it is not', async () => {
  const villa = await sectorService.createSector({ name: 'Villa' });
  await sectorService.updateSector(villa._id, { isActive: false });

  assert.equal(await sectorService.resolveProjectSector('Villa', { currentValue: 'Villa' }), 'Villa');
  await assert.rejects(() => sectorService.resolveProjectSector('Villa', { currentValue: 'Industrials' }), /inactive/);
  assert.equal(await sectorService.resolveProjectSector('', {}), null);
  assert.equal(await sectorService.resolveProjectSector(null, {}), null);
  await assert.rejects(() => sectorService.resolveProjectSector(42, {}), /must be a sector name/);
});

test('a project holding a legacy sector value with no Sector record still loads and saves (backward compatibility)', async () => {
  const _id = new mongoose.Types.ObjectId();
  await Project.collection.insertOne({
    _id,
    projectNumber: `PRJ-OLD-${Date.now()}`,
    contractValue: 500,
    projectManager: manager._id,
    startDate: new Date('2026-01-01'),
    deliveryDate: new Date('2026-06-01'),
    sector: 'Legacy Sector',
    isDeleted: false,
    executedPercentage: 0,
  });
  const loaded = await Project.findById(_id);
  assert.equal(loaded.sector, 'Legacy Sector');
  loaded.description = 'touched';
  await loaded.save(); // e.g. a Sales Order recalculating Executed % re-saves the project
  assert.equal((await Project.findById(_id)).sector, 'Legacy Sector');
});

// ---------------------------------------------------------------- seed

test('seed: creates Villa + Industrials and every sector value already on projects, idempotently, without touching projects', async () => {
  const { seedSectors } = require('../../scripts/seedSectors');
  await Project.collection.insertMany([
    { projectNumber: 'SEED-1', sector: 'Villa', isDeleted: false },
    { projectNumber: 'SEED-2', sector: 'Hospitality', isDeleted: false },
    { projectNumber: 'SEED-3', sector: 'hospitality', isDeleted: true },
    { projectNumber: 'SEED-4', sector: null, isDeleted: false },
  ]);
  await sectorService.createSector({ name: 'Industrials' }); // already exists -> kept as-is

  const dry = await seedSectors({ dryRun: true, connect: false });
  assert.deepEqual(dry.created.sort(), ['Hospitality', 'Villa']);
  assert.equal(await Sector.countDocuments({}), 1, 'dry run writes nothing');

  const first = await seedSectors({ connect: false });
  assert.deepEqual(first.created.sort(), ['Hospitality', 'Villa']);
  assert.deepEqual((await sectorService.listSectors()).map(s => s.name), ['Hospitality', 'Industrials', 'Villa']);

  const second = await seedSectors({ connect: false });
  assert.deepEqual(second.created, [], 'idempotent');
  assert.equal((await Project.collection.findOne({ projectNumber: 'SEED-3' })).sector, 'hospitality', 'projects are never modified');
});
