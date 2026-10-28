const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Parent Account Groups: the group CRUD rules (services/accounting/accountParentGroupService.js),
// the real /account-parent-groups route stack (permissions + validation), the Chart of Accounts
// create/update integration (parentGroup -> parentGroupNameEn/Ar), and the legacy-data migration
// (scripts/migrateAccountParentGroups.js).

const DB_URI = process.env.TEST_DB_URI_PARENT_GROUPS || 'mongodb://127.0.0.1:27017/reversia_test_account_parent_groups';

let AccountParentGroup, AccountParentGroupLog, ChartOfAccount, JournalEntry;
let groupService, groupRoute, chartOfAccountRoute, migration;
let admin;

const erp = { systemMemberships: [{ system: 'ERP', isActive: true }] };
const userWith = permissions => ({ _id: new mongoose.Types.ObjectId(), role: 'moderator', permissions, ...erp });

// The real middleware stack of one route (permission check -> validators -> controller), minus the
// router-level `protect` (req.user is supplied directly) - same helper as currency.test.js.
async function runRoute(router, method, path, req) {
  const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
  assert.ok(layer, `route ${method.toUpperCase()} ${path} exists`);
  const handlers = layer.route.stack.filter(s => s.method === method).map(s => s.handle);
  const fullReq = { headers: {}, query: {}, body: {}, params: {}, user: admin, ...req };
  for (const handler of handlers) {
    // eslint-disable-next-line no-await-in-loop
    const outcome = await new Promise(resolve => {
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          resolve({ done: true, status: this.statusCode, body });
        },
      };
      Promise.resolve(handler(fullReq, res, err => resolve(err ? { done: true, status: err.statusCode || 500, error: err } : { done: false }))).catch(err =>
        resolve({ done: true, status: err.statusCode || 500, error: err })
      );
    });
    if (outcome.done) return outcome;
  }
  return { status: 200 };
}

const errorOf = async promise => {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    return `${err.statusCode || 'error'}: ${err.message}`;
  }
};

const silent = () => {};

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  AccountParentGroup = require('../../models/accounting/accountParentGroupModel');
  AccountParentGroupLog = require('../../models/accounting/accountParentGroupLogModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  groupService = require('../../services/accounting/accountParentGroupService');
  groupRoute = require('../../routes/accounting/accountParentGroupRoute');
  chartOfAccountRoute = require('../../routes/accounting/chartOfAccountRoute');
  migration = require('../../scripts/migrateAccountParentGroups');
  await Promise.all([AccountParentGroup.init(), ChartOfAccount.init(), AccountParentGroupLog.init()]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([AccountParentGroup.deleteMany({}), AccountParentGroupLog.deleteMany({}), ChartOfAccount.deleteMany({}), JournalEntry.deleteMany({})]);
  admin = { _id: new mongoose.Types.ObjectId(), role: 'admin', ...erp };
});

const cashGroup = () => groupService.createGroup({ nameEn: 'Cash & Cash Equivalents', nameAr: 'النقدية وما في حكمها', type: 'asset' }, admin._id);
const receivables = () => groupService.createGroup({ nameEn: 'Accounts Receivable', nameAr: 'العملاء', type: 'asset' }, admin._id);

// ---------------------------------------------------------------- group CRUD

test('create: a group is created with its names, type, next sortOrder per type and an audit entry', async () => {
  const first = await receivables();
  const second = await groupService.createGroup({ nameEn: 'Prepaid Expenses', nameAr: 'مصروفات مقدمة', type: 'asset' }, admin._id);
  const liability = await groupService.createGroup({ nameEn: 'Accounts Payable', nameAr: 'الموردين', type: 'liability', description: 'Vendors' }, admin._id);

  assert.equal(first.nameEn, 'Accounts Receivable');
  assert.equal(first.isActive, true);
  assert.equal(first.isSystemDefault, false);
  assert.equal(first.accountCount, 0);
  assert.equal(first.nameEnKey, undefined, 'normalized keys are internal');
  assert.deepEqual([first.sortOrder, second.sortOrder, liability.sortOrder], [1, 2, 1]);

  const logs = await AccountParentGroupLog.find({ group: first._id }).lean();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, 'create');
  assert.equal(String(logs[0].actor), String(admin._id));
});

test('create: the names a business rule reads are created as system-default groups', async () => {
  assert.equal((await cashGroup()).isSystemDefault, true);
  assert.equal((await receivables()).isSystemDefault, false);
});

test('create: duplicate English or Arabic names are refused in any spelling, case or spacing', async () => {
  await cashGroup();
  assert.match(await errorOf(groupService.createGroup({ nameEn: '  cash  &  CASH equivalents ', nameAr: 'اسم آخر', type: 'asset' })), /^400: .*already exists/);
  assert.match(await errorOf(groupService.createGroup({ nameEn: 'Treasury', nameAr: 'النقدية  وما في حكمها', type: 'asset' })), /^400: .*Arabic name/);
  assert.equal(await AccountParentGroup.countDocuments({}), 1);
});

test('create: an invalid account type is refused by the service and the schema', async () => {
  assert.match(await errorOf(groupService.createGroup({ nameEn: 'X', nameAr: 'س', type: 'income' })), /^400: Account type must be one of/);
  await assert.rejects(() => AccountParentGroup.create({ nameEn: 'X', nameAr: 'س', type: 'income' }), /not a valid account type/);
});

test('list: search, status and type filters, sorting, pagination and account counts', async () => {
  const cash = await cashGroup();
  await receivables();
  const payables = await groupService.createGroup({ nameEn: 'Accounts Payable', nameAr: 'الموردين', type: 'liability' });
  await groupService.setGroupStatus(payables._id, false);
  await ChartOfAccount.create([
    { code: '1101', name: 'NBE', type: 'asset', parentGroupNameEn: 'Cash & Cash Equivalents', parentGroupNameAr: 'النقدية وما في حكمها' },
    { code: '1102', name: 'CIB', type: 'asset', parentGroupNameEn: 'cash &  cash equivalents', parentGroupNameAr: 'النقدية وما في حكمها', isActive: false },
  ]);

  const all = await groupService.listGroups({});
  assert.deepEqual(all.data.map(g => g.nameEn), ['Cash & Cash Equivalents', 'Accounts Receivable', 'Accounts Payable'], 'asset groups first, then by sortOrder');
  assert.equal(all.totalCount, 3);
  assert.equal(all.data.find(g => String(g._id) === String(cash._id)).accountCount, 2, 'counts every spelling, inactive accounts included');

  assert.deepEqual((await groupService.listGroups({ keyword: 'receiv' })).data.map(g => g.nameEn), ['Accounts Receivable']);
  assert.deepEqual((await groupService.listGroups({ keyword: 'الموردين' })).data.map(g => g.nameEn), ['Accounts Payable']);
  assert.deepEqual((await groupService.listGroups({ status: 'inactive' })).data.map(g => g.nameEn), ['Accounts Payable']);
  assert.equal((await groupService.listGroups({ status: 'active' })).totalCount, 2);
  assert.deepEqual((await groupService.listGroups({ type: 'liability' })).data.map(g => g.nameEn), ['Accounts Payable']);
  assert.deepEqual((await groupService.listGroups({ sort: '-accountCount' })).data[0].nameEn, 'Cash & Cash Equivalents');
  assert.deepEqual((await groupService.listGroups({ sort: 'nameEn' })).data.map(g => g.nameEn), ['Accounts Payable', 'Accounts Receivable', 'Cash & Cash Equivalents']);

  const page2 = await groupService.listGroups({ limit: 2, page: 2 });
  assert.equal(page2.data.length, 1);
  assert.equal(page2.paginationResult.numberOfPages, 2);
  assert.equal(page2.paginationResult.prev, 1);

  const selectable = await groupService.getSelectableGroups({});
  assert.deepEqual(selectable.map(g => g.nameEn), ['Cash & Cash Equivalents', 'Accounts Receivable'], 'inactive groups are not selectable');
  assert.deepEqual((await groupService.getSelectableGroups({ type: 'liability' })).map(g => g.nameEn), []);
});

test('update: renaming a group renames it on every account under it (all spellings), in one audited change; nothing else moves', async () => {
  const group = await receivables();
  await ChartOfAccount.create([
    { code: '1201', name: 'Customer A', type: 'asset', parentGroupNameEn: 'Accounts Receivable', parentGroupNameAr: 'العملاء' },
    { code: '1202', name: 'Customer B', type: 'asset', parentGroupNameEn: 'accounts  receivable', parentGroupNameAr: 'العملاء', state: 'current' },
    { code: '1300', name: 'Stock', type: 'asset', parentGroupNameEn: 'Inventory', parentGroupNameAr: 'المخزون' },
  ]);
  const entriesBefore = await JournalEntry.countDocuments({});

  const updated = await groupService.updateGroup(group._id, { nameEn: 'Trade Receivables', nameAr: 'المدينون التجاريون' }, admin._id);
  assert.equal(updated.nameEn, 'Trade Receivables');
  assert.equal(updated.accountsUpdated, 2);
  assert.equal(updated.accountCount, 2);

  const accounts = await ChartOfAccount.find({}).sort({ code: 1 }).lean();
  assert.deepEqual(
    accounts.map(a => [a.code, a.parentGroupNameEn, a.parentGroupNameAr, a.type]),
    [
      ['1201', 'Trade Receivables', 'المدينون التجاريون', 'asset'],
      ['1202', 'Trade Receivables', 'المدينون التجاريون', 'asset'],
      ['1300', 'Inventory', 'المخزون', 'asset'],
    ]
  );
  assert.equal(accounts[1].state, 'current', 'no other account field changes');
  assert.equal(await JournalEntry.countDocuments({}), entriesBefore, 'no journal entry is created');

  const log = await AccountParentGroupLog.findOne({ group: group._id, action: 'update' }).lean();
  assert.equal(log.accountsUpdated, 2);
  assert.equal(log.before.nameEn, 'Accounts Receivable');
  assert.equal(log.after.nameEn, 'Trade Receivables');
});

test('update: the type cannot change while accounts use the group; it can when none do', async () => {
  const group = await receivables();
  const empty = await groupService.createGroup({ nameEn: 'Misc', nameAr: 'متنوعة', type: 'asset' });
  await ChartOfAccount.create({ code: '1201', name: 'Customer A', type: 'asset', parentGroupNameEn: 'Accounts Receivable', parentGroupNameAr: 'العملاء' });

  assert.match(await errorOf(groupService.updateGroup(group._id, { type: 'liability' })), /^400: 1 account is classified/);
  assert.equal((await groupService.updateGroup(empty._id, { type: 'liability' })).type, 'liability');
});

test('update: a rename to another group\'s name (any spelling) is refused', async () => {
  await cashGroup();
  const group = await receivables();
  assert.match(await errorOf(groupService.updateGroup(group._id, { nameEn: 'CASH & cash equivalents' })), /^400: .*already exists/);
});

test('activate / deactivate: accounts keep their classification; audit entries record each change', async () => {
  const group = await receivables();
  await ChartOfAccount.create({ code: '1201', name: 'Customer A', type: 'asset', parentGroupNameEn: 'Accounts Receivable', parentGroupNameAr: 'العملاء' });

  assert.equal((await groupService.setGroupStatus(group._id, false, admin._id)).isActive, false);
  const account = await ChartOfAccount.findOne({ code: '1201' }).lean();
  assert.equal(account.parentGroupNameEn, 'Accounts Receivable');
  assert.equal((await groupService.setGroupStatus(group._id, true, admin._id)).isActive, true);

  const actions = (await AccountParentGroupLog.find({ group: group._id }).sort({ createdAt: 1, _id: 1 }).lean()).map(l => l.action);
  assert.deepEqual(actions, ['create', 'deactivate', 'activate']);
});

test('system-default groups: names, type and status are locked and they cannot be deleted; description/order stay editable', async () => {
  const cash = await cashGroup();
  assert.match(await errorOf(groupService.updateGroup(cash._id, { nameEn: 'Cash' })), /^400: .*system-default/);
  assert.match(await errorOf(groupService.updateGroup(cash._id, { nameAr: 'نقدية' })), /^400: .*system-default/);
  assert.match(await errorOf(groupService.updateGroup(cash._id, { type: 'liability' })), /^400: .*system-default/);
  assert.match(await errorOf(groupService.setGroupStatus(cash._id, false)), /^400: .*cannot be deactivated/);
  assert.match(await errorOf(groupService.deleteGroup(cash._id)), /^400: .*cannot be deleted/);

  const edited = await groupService.updateGroup(cash._id, { description: 'Banks and cash boxes', sortOrder: 5 });
  assert.equal(edited.description, 'Banks and cash boxes');
  assert.equal(edited.sortOrder, 5);
  assert.equal(edited.nameEn, 'Cash & Cash Equivalents');
});

test('delete: a group assigned to any account (even an inactive one) is refused; an unused group is deleted and the deletion is logged', async () => {
  const used = await receivables();
  const unused = await groupService.createGroup({ nameEn: 'Misc', nameAr: 'متنوعة', type: 'asset' });
  await ChartOfAccount.create({ code: '1201', name: 'Old customer', type: 'asset', parentGroupNameEn: 'Accounts Receivable', parentGroupNameAr: 'العملاء', isActive: false });

  assert.match(await errorOf(groupService.deleteGroup(used._id)), /^400: .*assigned to 1 account.*Deactivate it instead/);
  await groupService.deleteGroup(unused._id, admin._id);
  assert.equal(await AccountParentGroup.countDocuments({ _id: unused._id }), 0);
  const log = await AccountParentGroupLog.findOne({ group: unused._id, action: 'delete' }).lean();
  assert.equal(log.groupNameEn, 'Misc');
  assert.equal(String(log.actor), String(admin._id));
  assert.match(await errorOf(groupService.getGroup(unused._id)), /^404/);
});

// ---------------------------------------------------------------- routes: permissions + validation

test('routes: reading needs accounts:read; managing needs accounts create/update/delete; ERP access is required', async () => {
  const group = await receivables();
  const reader = userWith([{ resource: 'accounts', actions: ['read'] }]);
  const list = await runRoute(groupRoute, 'get', '/', { user: reader });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  assert.equal((await runRoute(groupRoute, 'get', '/selectable', { user: reader })).status, 200);

  assert.equal((await runRoute(groupRoute, 'post', '/', { user: reader, body: { nameEn: 'A', nameAr: 'أ', type: 'asset' } })).status, 403);
  assert.equal((await runRoute(groupRoute, 'patch', '/:id', { user: reader, params: { id: String(group._id) }, body: { description: 'x' } })).status, 403);
  assert.equal((await runRoute(groupRoute, 'patch', '/:id/status', { user: reader, params: { id: String(group._id) }, body: { isActive: false } })).status, 403);
  assert.equal((await runRoute(groupRoute, 'delete', '/:id', { user: reader, params: { id: String(group._id) } })).status, 403);

  assert.equal((await runRoute(groupRoute, 'get', '/', { user: userWith([]) })).status, 403);
  const noErp = { ...userWith([{ resource: 'accounts', actions: ['read'] }]), systemMemberships: [] };
  assert.equal((await runRoute(groupRoute, 'get', '/', { user: noErp })).status, 403);

  const manager = userWith([{ resource: 'accounts', actions: ['create', 'read', 'update', 'delete'] }]);
  const created = await runRoute(groupRoute, 'post', '/', { user: manager, body: { nameEn: 'Accounts Payable', nameAr: 'الموردين', type: 'liability' } });
  assert.equal(created.status, 201);
  const id = String(created.body.data._id);
  assert.equal((await runRoute(groupRoute, 'patch', '/:id/status', { user: manager, params: { id }, body: { isActive: false } })).body.data.isActive, false);
  assert.equal((await runRoute(groupRoute, 'delete', '/:id', { user: manager, params: { id } })).status, 200);
});

test('routes: the router requires sign-in before anything else', () => {
  const authController = require('../../controller/user/authController');
  const first = groupRoute.stack.find(l => !l.route);
  assert.equal(first.handle, authController.protect);
});

test('routes: invalid requests are refused by the server-side validators', async () => {
  const bad = async body => (await runRoute(groupRoute, 'post', '/', { body })).status;
  assert.equal(await bad({ nameAr: 'أ', type: 'asset' }), 400, 'English name is required');
  assert.equal(await bad({ nameEn: 'A', type: 'asset' }), 400, 'Arabic name is required');
  assert.equal(await bad({ nameEn: '   ', nameAr: 'أ', type: 'asset' }), 400);
  assert.equal(await bad({ nameEn: 'A', nameAr: 'أ' }), 400, 'type is required');
  assert.equal(await bad({ nameEn: 'A', nameAr: 'أ', type: 'income' }), 400);
  assert.equal(await bad({ nameEn: 'A', nameAr: 'أ', type: 'asset', sortOrder: -1 }), 400);
  assert.equal(await bad({ nameEn: 'A'.repeat(101), nameAr: 'أ', type: 'asset' }), 400);

  assert.equal((await runRoute(groupRoute, 'get', '/:id', { params: { id: 'not-an-id' } })).status, 400);
  assert.equal((await runRoute(groupRoute, 'get', '/:id', { params: { id: String(new mongoose.Types.ObjectId()) } })).status, 404);
  const group = await receivables();
  assert.equal((await runRoute(groupRoute, 'patch', '/:id', { params: { id: String(group._id) }, body: { isSystemDefault: true } })).status, 400);
  assert.equal((await runRoute(groupRoute, 'patch', '/:id/status', { params: { id: String(group._id) }, body: {} })).status, 400);
  assert.equal((await runRoute(groupRoute, 'get', '/', { query: { status: 'weird' } })).status, 400);
});

// ---------------------------------------------------------------- Chart of Accounts integration

const createAccount = body => runRoute(chartOfAccountRoute, 'post', '/', { body });
const updateAccount = (id, body) => runRoute(chartOfAccountRoute, 'patch', '/:id', { params: { id: String(id) }, body });

test('chart of accounts: creating with a group stores the group\'s names; raw names from the client are ignored', async () => {
  const cash = await cashGroup();
  const res = await createAccount({ code: '1101', name: 'NBE', type: 'asset', parentGroup: String(cash._id), parentGroupNameEn: 'Hacked', parentGroupNameAr: 'x' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.parentGroupNameEn, 'Cash & Cash Equivalents');
  assert.equal(res.body.data.parentGroupNameAr, 'النقدية وما في حكمها');

  const raw = await createAccount({ code: '1102', name: 'CIB', type: 'asset', parentGroupNameEn: 'Hacked' });
  assert.equal(raw.status, 201);
  assert.equal(raw.body.data.parentGroupNameEn, null);
});

test('chart of accounts: a group of another type, an inactive group or an unknown group is refused', async () => {
  const cash = await cashGroup();
  const payables = await groupService.createGroup({ nameEn: 'Accounts Payable', nameAr: 'الموردين', type: 'liability' });
  await groupService.setGroupStatus(payables._id, false);

  const wrongType = await createAccount({ code: '2101', name: 'Vendor', type: 'liability', parentGroup: String(cash._id) });
  assert.equal(wrongType.status, 400);
  assert.match(wrongType.error.message, /for asset accounts/);
  assert.match((await createAccount({ code: '2102', name: 'Vendor', type: 'liability', parentGroup: String(payables._id) })).error.message, /inactive/);
  assert.equal((await createAccount({ code: '2103', name: 'Vendor', type: 'liability', parentGroup: String(new mongoose.Types.ObjectId()) })).status, 400);
  assert.equal((await createAccount({ code: '2104', name: 'Vendor', type: 'liability', parentGroup: 'nope' })).status, 400);
  assert.equal(await ChartOfAccount.countDocuments({}), 0);
});

test('chart of accounts: editing keeps the current group (even inactive or unmanaged) unless it is explicitly changed or cleared', async () => {
  const receivable = await receivables();
  const legacy = await ChartOfAccount.create({ code: '1201', name: 'Customer A', type: 'asset', parentGroupNameEn: 'accounts  receivable', parentGroupNameAr: 'العملاء' });
  const unmanaged = await ChartOfAccount.create({ code: '1300', name: 'Stock', type: 'asset', parentGroupNameEn: 'Inventory', parentGroupNameAr: 'المخزون' });
  await groupService.setGroupStatus(receivable._id, false);

  // Other fields only: group untouched, stored spelling preserved.
  const renamed = await updateAccount(legacy._id, { name: 'Customer A Ltd' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.parentGroupNameEn, 'accounts  receivable');
  // Re-sending the current (now inactive) group is fine and rewrites nothing.
  const same = await updateAccount(legacy._id, { parentGroup: String(receivable._id), name: 'Customer A Ltd' });
  assert.equal(same.status, 200);
  assert.equal(same.body.data.parentGroupNameEn, 'accounts  receivable');
  // A legacy name with no managed group is kept on edit.
  assert.equal((await updateAccount(unmanaged._id, { description: 'Goods' })).body.data.parentGroupNameEn, 'Inventory');

  // Explicit change and explicit clear.
  const cash = await cashGroup();
  const moved = await updateAccount(legacy._id, { parentGroup: String(cash._id) });
  assert.equal(moved.body.data.parentGroupNameEn, 'Cash & Cash Equivalents');
  const cleared = await updateAccount(legacy._id, { parentGroup: null });
  assert.equal(cleared.body.data.parentGroupNameEn, null);
  assert.equal(cleared.body.data.parentGroupNameAr, null);
});

test('chart of accounts: changing only the type is refused when the account\'s managed group has another type', async () => {
  await receivables();
  const account = await ChartOfAccount.create({ code: '1201', name: 'Customer A', type: 'asset', parentGroupNameEn: 'Accounts Receivable', parentGroupNameAr: 'العملاء' });
  const res = await updateAccount(account._id, { type: 'liability' });
  assert.equal(res.status, 400);
  assert.match(res.error.message, /asset group/);
  assert.equal((await ChartOfAccount.findById(account._id).lean()).type, 'asset');

  // Changing type together with a matching group works; the parentAccount hierarchy is independent.
  const payables = await groupService.createGroup({ nameEn: 'Accounts Payable', nameAr: 'الموردين', type: 'liability' });
  const moved = await updateAccount(account._id, { type: 'liability', parentGroup: String(payables._id) });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.data.type, 'liability');
  assert.equal(moved.body.data.parentAccount, null);
});

// ---------------------------------------------------------------- legacy migration

const legacyAccounts = () =>
  ChartOfAccount.collection.insertMany([
    { code: '11000001', name: 'misr banque-EGP', type: 'asset', parentGroupNameEn: 'Cash & Cash Equivalents', parentGroupNameAr: 'النقدية وما في حكمها', isActive: true },
    { code: '11000002', name: 'NBE', type: 'asset', parentGroupNameEn: 'cash &  cash equivalents', parentGroupNameAr: 'النقدية وما في حكمها', isActive: true },
    { code: '12000001', name: 'Customer A', type: 'asset', parentGroupNameEn: 'Accounts Receivable', parentGroupNameAr: 'العملاء', isActive: true },
    // Conflicting types for one name.
    { code: '13000001', name: 'Deposit', type: 'asset', parentGroupNameEn: 'Deposits', parentGroupNameAr: 'تأمينات', isActive: true },
    { code: '21000001', name: 'Deposit held', type: 'liability', parentGroupNameEn: 'Deposits', parentGroupNameAr: 'تأمينات', isActive: true },
    // Conflicting Arabic names for one name.
    { code: '22000001', name: 'Tax A', type: 'liability', parentGroupNameEn: 'Taxes Payable', parentGroupNameAr: 'ضرائب مستحقة', isActive: true },
    { code: '22000002', name: 'Tax B', type: 'liability', parentGroupNameEn: 'Taxes Payable', parentGroupNameAr: 'مصلحة الضرائب', isActive: true },
    // No Arabic name at all.
    { code: '50000001', name: 'Rent', type: 'expense', parentGroupNameEn: 'Admin Expenses', parentGroupNameAr: null, isActive: true },
    // No group.
    { code: '30000001', name: 'Capital', type: 'equity', parentGroupNameEn: null, parentGroupNameAr: null, isActive: true },
  ]);

test('migration: creates one group per consistent legacy name, flags conflicts and missing translations, and changes no account', async () => {
  await legacyAccounts();
  const before = await ChartOfAccount.collection.find({}).sort({ code: 1 }).toArray();

  const dry = await migration.migrateAccountParentGroups({ dryRun: true, connect: false, log: silent });
  assert.equal(dry.created, 0);
  assert.equal(await AccountParentGroup.countDocuments({}), 0, 'a dry run writes nothing');

  const result = await migration.migrateAccountParentGroups({ dryRun: false, connect: false, log: silent });
  assert.equal(result.created, 2);
  const groups = await AccountParentGroup.find({}).sort({ nameEn: 1 }).lean();
  assert.deepEqual(
    groups.map(g => [g.nameEn, g.nameAr, g.type, g.isSystemDefault]),
    [
      ['Accounts Receivable', 'العملاء', 'asset', false],
      ['Cash & Cash Equivalents', 'النقدية وما في حكمها', 'asset', true],
    ]
  );
  assert.deepEqual(result.conflicts.map(c => c.nameEn).sort(), ['Deposits', 'Taxes Payable']);
  assert.match(result.conflicts.find(c => c.nameEn === 'Deposits').reason, /conflicting account types/);
  assert.match(result.conflicts.find(c => c.nameEn === 'Taxes Payable').reason, /conflicting Arabic names/);
  assert.deepEqual(result.missingTranslations.map(m => m.nameEn), ['Admin Expenses']);

  const after = await ChartOfAccount.collection.find({}).sort({ code: 1 }).toArray();
  assert.deepEqual(after, before, 'no Chart of Accounts record is modified');

  const listed = await groupService.listGroups({});
  assert.equal(listed.data.find(g => g.nameEn === 'Cash & Cash Equivalents').accountCount, 2);
});

test('migration: running it again is a no-op (idempotent), and existing groups are never duplicated', async () => {
  await legacyAccounts();
  await receivables(); // created by hand before the migration ran
  const first = await migration.migrateAccountParentGroups({ dryRun: false, connect: false, log: silent });
  assert.equal(first.created, 1);
  const second = await migration.migrateAccountParentGroups({ dryRun: false, connect: false, log: silent });
  assert.equal(second.created, 0);
  assert.equal(second.skippedExisting, 2);
  assert.equal(await AccountParentGroup.countDocuments({}), 2);
});

test('migration plan: a name whose Arabic name belongs to another group is flagged, not merged', () => {
  const plan = migration.planParentGroupMigration(
    [
      { code: '1', type: 'asset', parentGroupNameEn: 'Customers', parentGroupNameAr: 'العملاء' },
      { code: '2', type: 'asset', parentGroupNameEn: 'Clients', parentGroupNameAr: 'العملاء' },
    ],
    []
  );
  assert.deepEqual(plan.toCreate.map(g => g.nameEn), ['Customers']);
  assert.match(plan.conflicts[0].reason, /already belongs to another group/);
});
