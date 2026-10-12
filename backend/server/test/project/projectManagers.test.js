const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Admin-managed Project Managers: CRUD rules (services/project/projectManagerService.js), how projects
// reference them (Project.projectManager), the import of managers that projects referenced as staff
// users before the list existed, and that only admins can change the list.

const DB_URI = process.env.TEST_DB_URI_PROJECT_MANAGERS || 'mongodb://127.0.0.1:27017/reversia_test_project_managers';

let ProjectManager, Project, User;
let pm;

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  ProjectManager = require('../../models/project/projectManagerModel');
  Project = require('../../models/project/projectModel');
  User = require('../../models/userModel');
  pm = require('../../services/project/projectManagerService');
  await Promise.all([ProjectManager.init(), Project.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all(['projectmanagers', 'projects', 'users'].map(c => mongoose.connection.collection(c).deleteMany({})));
});

let seq = 0;
const createProject = (projectManager, extra = {}) =>
  Project.create({ projectNumber: `PRJ-PM-${(seq += 1)}`, contractValue: 1000, projectManager, startDate: new Date('2026-01-01'), deliveryDate: new Date('2026-06-01'), ...extra });
const failure = async promise => {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    return `${err.statusCode || 'error'}: ${err.message}`;
  }
};

test('create: trimmed, active by default, listed in both lists; email lower-cased; blanks stored as null', async () => {
  const created = await pm.createProjectManager({ name: '  Ahmed Ali  ', email: 'Ahmed@Example.com', phone: ' ' });
  assert.deepEqual([created.name, created.email, created.phone, created.isActive, created.projectsCount], ['Ahmed Ali', 'ahmed@example.com', null, true, 0]);
  assert.deepEqual((await pm.listProjectManagers()).map(m => m.name), ['Ahmed Ali']);
  assert.deepEqual((await pm.listProjectManagers({ activeOnly: true })).map(m => m.name), ['Ahmed Ali']);
});

test('create / edit: duplicate names (any case) and emails are refused with a clean 400', async () => {
  const a = await pm.createProjectManager({ name: 'Mona Saleh', email: 'mona@example.com' });
  await pm.createProjectManager({ name: 'Omar Fathy' });
  assert.match(await failure(pm.createProjectManager({ name: 'mona saleh' })), /^400: A project manager named "Mona Saleh" already exists/);
  assert.match(await failure(pm.createProjectManager({ name: 'Other', email: 'MONA@example.com' })), /^400: The email mona@example.com is already used/);
  assert.match(await failure(pm.updateProjectManager(a._id, { name: 'OMAR FATHY' })), /^400: A project manager named "Omar Fathy"/);
  // Changing only the case of one's own name is fine.
  assert.equal((await pm.updateProjectManager(a._id, { name: 'MONA SALEH' })).name, 'MONA SALEH');
  assert.equal(await ProjectManager.countDocuments(), 2);
});

test('list: by name, keyword over name / email / phone, project counts (soft-deleted projects included)', async () => {
  const z = await pm.createProjectManager({ name: 'Zeinab', phone: '01000000001' });
  const a = await pm.createProjectManager({ name: 'adel', email: 'adel@site.com' });
  await createProject(z._id);
  await createProject(z._id, { isDeleted: true });
  const list = await pm.listProjectManagers();
  assert.deepEqual(list.map(m => [m.name, m.projectsCount]), [['adel', 0], ['Zeinab', 2]]);
  assert.deepEqual((await pm.listProjectManagers({ keyword: 'SITE' })).map(m => m.name), ['adel']);
  assert.deepEqual((await pm.listProjectManagers({ keyword: '0100' })).map(m => m.name), ['Zeinab']);
  assert.equal((await pm.getProjectManager(a._id)).projectsCount, 0);
  assert.match(await failure(pm.getProjectManager(new mongoose.Types.ObjectId())), /^404/);
});

test('edit: a new name / phone shows on every project at once (projects reference the manager by id)', async () => {
  const m = await pm.createProjectManager({ name: 'Karim' });
  const project = await createProject(m._id);
  await pm.updateProjectManager(m._id, { name: 'Karim Hassan', phone: '+20 100 000 0000' });
  const loaded = await Project.findById(project._id);
  assert.deepEqual([loaded.projectManager.name, loaded.projectManager.phone], ['Karim Hassan', '+20 100 000 0000']);
  const R = Object.fromEntries([...require('../../services/reports/reportRegistry').REPORTS_BY_KEY].map(([k, r]) => [k, r.run]));
  const report = await R['projects-status']({});
  assert.equal(report.sections[0].rows.find(r => r.projectNumber === project.projectNumber).projectManager, 'Karim Hassan', 'reports show the current name');
});

test('deactivate: stays on its projects, leaves the selectable list, cannot be newly selected', async () => {
  const m = await pm.createProjectManager({ name: 'Sara' });
  const project = await createProject(m._id);
  await pm.updateProjectManager(m._id, { isActive: false });
  assert.deepEqual((await pm.listProjectManagers({ activeOnly: true })).map(x => x.name), []);
  assert.equal(String((await Project.findById(project._id)).projectManager._id), String(m._id));
  assert.match(await failure(pm.assertSelectableProjectManager(m._id)), /^400: The project manager "Sara" is inactive/);
  assert.equal(await failure(pm.assertSelectableProjectManager(m._id, { currentValue: m._id })), 'ok', 'keeping the current manager is allowed');
  assert.match(await failure(pm.assertSelectableProjectManager(new mongoose.Types.ObjectId())), /^400: Project manager does not exist/);
  assert.match(await failure(pm.assertSelectableProjectManager('nope')), /^400: Invalid project manager id/);
});

test('delete: refused while any project (including a soft-deleted one) refers to it; an unused one is deleted', async () => {
  const used = await pm.createProjectManager({ name: 'Used' });
  const unused = await pm.createProjectManager({ name: 'Unused' });
  await createProject(used._id, { isDeleted: true });
  assert.match(await failure(pm.deleteProjectManager(used._id)), /^400: "Used" is the project manager of 1 project and cannot be deleted\. Deactivate/);
  assert.equal(await ProjectManager.countDocuments({ _id: used._id }), 1);
  await pm.deleteProjectManager(unused._id);
  assert.equal(await ProjectManager.countDocuments({ _id: unused._id }), 0);
  assert.match(await failure(pm.deleteProjectManager(unused._id)), /^404/);
});

test('import: managers projects referenced as users become Project Managers with the same id; projects untouched; idempotent', async () => {
  const staff = await User.create({ name: 'Old Manager', email: `old-${Date.now()}@example.com`, phone: '01011111111', role: 'operator', type: 'online' });
  const clash = await User.create({ name: 'Taken Name', email: `clash-${Date.now()}@example.com`, role: 'operator', type: 'online' });
  await pm.createProjectManager({ name: 'taken name' });
  const gone = new mongoose.Types.ObjectId();
  const p1 = await createProject(staff._id);
  await createProject(staff._id);
  await createProject(clash._id);
  await createProject(gone);
  const before = await mongoose.connection.collection('projects').find({}).toArray();

  assert.equal((await Project.findById(p1._id)).projectManager, null, 'before the import the reference has no Project Manager record');
  const legacy = await pm.legacyProjectManagers();
  assert.deepEqual(legacy.map(l => [l.name, l.projectsCount, l.userFound]).sort(), [['Old Manager', 2, true], ['Taken Name', 1, true], [null, 1, false]].sort());

  const { imported, skipped } = await pm.importLegacyProjectManagers();
  assert.deepEqual(imported.map(i => [i._id, i.name, i.projectsCount]), [[String(staff._id), 'Old Manager', 2]]);
  assert.deepEqual(skipped.map(s => s._id).sort(), [String(clash._id), String(gone)].sort(), 'a name clash and a missing user are left for the admin');
  const loaded = await Project.findById(p1._id);
  assert.deepEqual([loaded.projectManager.name, loaded.projectManager.email, loaded.projectManager.phone], ['Old Manager', staff.email, '01011111111']);
  assert.deepEqual(await mongoose.connection.collection('projects').find({}).toArray(), before, 'no project document changed');

  const again = await pm.importLegacyProjectManagers();
  assert.equal(again.imported.length, 0);
  assert.equal(await ProjectManager.countDocuments({ name: 'Old Manager' }), 1);
});

test('only admins can change the list; reading it needs the Projects read permission', async () => {
  const router = require('../../routes/project/projectManagerRoute');
  const authController = require('../../controller/user/authController');
  assert.equal(router.stack[0].handle, authController.protect, 'every route requires sign-in');
  const routeOf = path => router.stack.find(l => l.route?.path === path).route;
  const firstGuard = (path, method) => routeOf(path).stack.find(l => l.method === method).handle;
  const run = (guard, user) =>
    new Promise(resolve => {
      guard({ user }, {}, err => resolve(err ? err.statusCode : 'next'));
    });
  const moderator = { role: 'moderator', isAdmin: false };
  const admin = { role: 'admin', isAdmin: false };
  for (const [path, method] of [['/', 'post'], ['/:id', 'patch'], ['/:id', 'delete'], ['/legacy', 'get'], ['/legacy/import', 'post']]) {
    assert.equal(await run(firstGuard(path, method), moderator), 403, `${method} ${path} refuses a non-admin`);
    assert.equal(await run(firstGuard(path, method), admin), 'next', `${method} ${path} lets an admin through`);
  }
});
