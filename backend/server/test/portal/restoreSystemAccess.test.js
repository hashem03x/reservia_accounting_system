const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// scripts/restoreSystemAccess.js - safe role resolution for lost/malformed CRM and Commercial
// memberships. Pure planner tests run everywhere; the end-to-end ones need TEST_DB_URI (a
// disposable database - the script is exercised with connect:false against it, never DB_URI).

const { planRestoration, restoreSystemAccess } = require('../../scripts/restoreSystemAccess');

const MD_AUDIT = [
  // The real history of admin@reservia.com (Change Request 2, item 0), as the dry run printed it.
  { action: 'user.systems.update', createdAt: '2026-10-18T10:00:00Z', before: [{ system: 'ERP', role: 'admin', isActive: true }], after: [{ system: 'ERP', role: 'admin', isActive: true }, { system: 'HR', role: 'MEMBER', isActive: true }, { system: 'CRM', role: 'MEMBER', isActive: true }, { system: 'COMMERCIAL', role: 'MEMBER', isActive: true }, { system: 'WEBSITE', role: 'MEMBER', isActive: true }] },
  { action: 'user.systems.update', createdAt: '2026-10-29T10:00:00Z', before: [{ system: 'CRM', role: 'MEMBER', isActive: true }], after: [] },
  { action: 'user.systems.update', createdAt: '2026-10-29T11:00:00Z', before: [], after: [{ system: 'CRM', role: 'MEMBER', isActive: true }] },
  { action: 'user.systems.update', createdAt: '2026-11-08T21:30:00Z', before: [{ system: 'ERP', role: 'admin', isActive: true }, { system: 'HR', role: 'MEMBER', isActive: true }, { system: 'CRM', role: 'MEMBER', isActive: true }, { system: 'COMMERCIAL', role: 'MEMBER', isActive: true }, { system: 'WEBSITE', role: 'MEMBER', isActive: true }], after: [{ system: 'ERP', role: 'admin', isActive: true }, { system: 'WEBSITE', role: 'admin', isActive: true }] },
];
const platformAdmin = memberships => ({ platformAdmin: true, systemMemberships: [{ system: 'ERP', role: 'admin', isActive: true }, { system: 'WEBSITE', role: 'admin', isActive: true }, ...memberships] });
const bySystem = plan => Object.fromEntries(plan.items.map(i => [i.system, i]));

// ------------------------------------------------------------------------------- pure planner

test('1. an ACTIVE CRM membership with an undefined role is malformed - it is repaired, never reported as "nothing to restore"', () => {
  const plan = planRestoration({ user: platformAdmin([{ system: 'CRM', isActive: true }]), audit: MD_AUDIT, systems: ['CRM', 'COMMERCIAL'] });
  const crm = bySystem(plan).CRM;
  assert.equal(crm.action, 'set');
  assert.equal(crm.role, 'md');
  assert.match(crm.basis, /platform administrator/);
  // A stored entry with NO isActive and no role is equally malformed.
  assert.equal(bySystem(planRestoration({ user: platformAdmin([{ system: 'CRM' }]), audit: [], systems: ['CRM'] })).CRM.action, 'set');
});

test('2. a missing CRM membership is ADDED (not "set"), with a resolved role', () => {
  const crm = bySystem(planRestoration({ user: platformAdmin([]), audit: MD_AUDIT, systems: ['CRM'] })).CRM;
  assert.equal(crm.action, 'add');
  assert.equal(crm.role, 'md');
});

test('3. historical COMMERCIAL "MEMBER" is the legacy placeholder: never copied, never mapped to lower-case "member"', () => {
  const plan = planRestoration({ user: platformAdmin([]), audit: MD_AUDIT, systems: ['COMMERCIAL'] });
  const com = bySystem(plan).COMMERCIAL;
  assert.equal(com.action, 'add');
  assert.equal(com.role, 'md', 'resolved by the platform-administrator rule, not from "MEMBER"');
  assert.notEqual(com.role, 'MEMBER');
  assert.notEqual(com.role, 'member');
});

test('4. invalid historical roles are skipped; the most recent VALID historical role is restored', () => {
  const audit = [
    { action: 'user.systems.update', createdAt: '2026-11-01T10:00:00Z', before: [], after: [{ system: 'CRM', role: 'sales', isActive: true }] },
    { action: 'user.systems.update', createdAt: '2026-11-05T10:00:00Z', before: [], after: [{ system: 'CRM', role: 'MEMBER', isActive: true }] },
    { action: 'user.systems.update', createdAt: '2026-11-06T10:00:00Z', before: [], after: [{ system: 'CRM', role: 'superuser', isActive: true }] },
  ];
  const crm = bySystem(planRestoration({ user: { platformAdmin: false, systemMemberships: [] }, audit, systems: ['CRM'] })).CRM;
  assert.equal(crm.role, 'sales', 'MEMBER and the unknown "superuser" are never copied');
  assert.match(crm.basis, /audit trail/);
});

test('5. platform-administrator resolution needs BOTH platformAdmin and ERP admin; otherwise it fails safely', () => {
  const noErpAdmin = { platformAdmin: true, systemMemberships: [{ system: 'ERP', role: 'operator', isActive: true }] };
  assert.equal(bySystem(planRestoration({ user: noErpAdmin, audit: MD_AUDIT, systems: ['CRM'] })).CRM.action, 'unresolved');
  const notPlatformAdmin = { platformAdmin: false, systemMemberships: [{ system: 'ERP', role: 'admin', isActive: true }] };
  assert.equal(bySystem(planRestoration({ user: notPlatformAdmin, audit: MD_AUDIT, systems: ['CRM'] })).CRM.action, 'unresolved');
  // A valid historical role wins over the platform-admin rule (restore what they had, don't invent).
  const audit = [{ action: 'user.systems.update', createdAt: '2026-11-01T00:00:00Z', before: [], after: [{ system: 'CRM', role: 'admin', isActive: true }] }];
  assert.equal(bySystem(planRestoration({ user: platformAdmin([]), audit, systems: ['CRM'] })).CRM.role, 'admin');
});

test('6/7. ERP and Website are never in the plan; HR is refused outright', () => {
  const plan = planRestoration({ user: platformAdmin([]), audit: MD_AUDIT, systems: ['CRM', 'COMMERCIAL'] });
  assert.deepEqual(plan.items.map(i => i.system), ['CRM', 'COMMERCIAL']);
  const withHr = planRestoration({ user: platformAdmin([]), audit: MD_AUDIT, systems: ['HR'] });
  assert.equal(withHr.items[0].action, 'refused');
  assert.equal(withHr.ok, false, 'asking for HR stops the whole run');
});

test('a valid active role is never changed (no downgrade); a valid switched-off one is left alone unless --reactivate', () => {
  const keep = bySystem(planRestoration({ user: platformAdmin([{ system: 'CRM', role: 'sales', isActive: true }]), audit: MD_AUDIT, systems: ['CRM'] })).CRM;
  assert.equal(keep.action, 'keep');
  assert.equal(keep.role, 'sales', 'not "upgraded" to md either');
  const off = platformAdmin([{ system: 'CRM', role: 'admin', isActive: false }]);
  assert.equal(bySystem(planRestoration({ user: off, audit: [], systems: ['CRM'] })).CRM.action, 'skip_inactive');
  assert.equal(bySystem(planRestoration({ user: off, audit: [], systems: ['CRM'], reactivate: true })).CRM.action, 'set');
});

test('10. ambiguity fails safely: duplicate entries, an invalid explicit role, or no resolvable role -> plan.ok is false', () => {
  const dup = platformAdmin([{ system: 'CRM', role: 'md', isActive: true }, { system: 'CRM', isActive: true }]);
  assert.equal(bySystem(planRestoration({ user: dup, audit: [], systems: ['CRM'] })).CRM.action, 'ambiguous');
  const badFlag = planRestoration({ user: platformAdmin([]), audit: [], systems: ['CRM'], explicitRoles: { CRM: 'MEMBER' } });
  assert.equal(badFlag.ok, false);
  const ordinary = { platformAdmin: false, systemMemberships: [] };
  const unresolved = planRestoration({ user: ordinary, audit: MD_AUDIT, systems: ['CRM', 'COMMERCIAL'] });
  assert.equal(unresolved.ok, false);
  assert.match(bySystem(unresolved).COMMERCIAL.problem, /legacy placeholder/);
});

// --------------------------------------------------------------------------- end-to-end (DB)

const DB_URI = process.env.TEST_DB_URI;
const maybeTest = DB_URI ? test : test.skip;
let User;
let PlatformAuditLog;

before(async () => {
  if (!DB_URI) return;
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  User = require('../../models/userModel');
  PlatformAuditLog = require('../../models/platformAuditLogModel');
});
after(async () => {
  if (!DB_URI) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
beforeEach(async () => {
  if (!DB_URI) return;
  await Promise.all([mongoose.connection.collection('users').deleteMany({}), mongoose.connection.collection('platformauditlogs').deleteMany({})]);
});

/** Seeds admin@reservia.com exactly as the dry run found it: CRM entry with NO role (raw write). */
async function seedMd() {
  const { insertedId } = await mongoose.connection.collection('users').insertOne({
    name: 'Hashem Ahmed',
    email: 'admin@reservia.com',
    type: 'online',
    role: 'admin',
    isActive: true,
    platformAdmin: true,
    systemMemberships: [
      { _id: new mongoose.Types.ObjectId(), system: 'ERP', role: 'admin', isActive: true },
      { _id: new mongoose.Types.ObjectId(), system: 'WEBSITE', role: 'admin', isActive: true },
      { _id: new mongoose.Types.ObjectId(), system: 'CRM', isActive: true },
    ],
  });
  await PlatformAuditLog.insertMany(MD_AUDIT.map(e => ({ ...e, actor: insertedId, actorName: 'Hashem Ahmed', targetUser: insertedId })));
  return insertedId;
}
const quiet = () => {};
const raw = id => mongoose.connection.collection('users').findOne({ _id: id });
const dbName = () => mongoose.connection.db.databaseName;

maybeTest('9. a dry run writes NOTHING - users and audit log byte-identical', async () => {
  const id = await seedMd();
  const userBefore = await raw(id);
  const auditBefore = await PlatformAuditLog.countDocuments({});
  const result = await restoreSystemAccess({ connect: false, log: quiet, argv: ['node', 'x', '--email=admin@reservia.com'] });
  assert.equal(result.applied, false);
  assert.deepEqual(await raw(id), userBefore);
  assert.equal(await PlatformAuditLog.countDocuments({}), auditBefore);
  assert.deepEqual(result.plan.items.map(i => `${i.system}:${i.action}:${i.role}`), ['CRM:set:md', 'COMMERCIAL:add:md']);
});

maybeTest('--apply refuses without --confirm-db naming the connected database', async () => {
  await seedMd();
  await assert.rejects(
    restoreSystemAccess({ connect: false, log: quiet, argv: ['node', 'x', '--email=admin@reservia.com', '--apply', '--actor-email=admin@reservia.com'] }),
    /--confirm-db=/
  );
});

maybeTest('5/6/7/8. apply: CRM md + COMMERCIAL md for the platform admin; ERP/Website untouched (same entry ids); HR not granted; others untouched; a second run is a no-op', async () => {
  const id = await seedMd();
  const bystander = await User.create({ name: 'Bystander', email: 'b@reservia.test', password: 'x', role: 'operator', type: 'online', systemMemberships: [{ system: 'CRM', role: 'sales', isActive: true }] });
  const bystanderBefore = await raw(bystander._id);
  const before_ = await raw(id);

  const argv = ['node', 'x', '--email=admin@reservia.com', '--apply', '--actor-email=admin@reservia.com', `--confirm-db=${dbName()}`];
  const first = await restoreSystemAccess({ connect: false, log: quiet, argv });
  assert.equal(first.applied, true);
  assert.deepEqual(first.changed, ['CRM', 'COMMERCIAL']);

  const after_ = await raw(id);
  const summary = after_.systemMemberships.map(m => `${m.system}:${m.role}:${m.isActive}`).sort();
  assert.deepEqual(summary, ['COMMERCIAL:md:true', 'CRM:md:true', 'ERP:admin:true', 'WEBSITE:admin:true']);
  assert.ok(!after_.systemMemberships.some(m => m.system === 'HR'), 'HR is not granted');
  for (const system of ['ERP', 'WEBSITE', 'CRM']) {
    const b = before_.systemMemberships.find(m => m.system === system);
    const a = after_.systemMemberships.find(m => m.system === system);
    assert.equal(String(a._id), String(b._id), `${system} entry updated in place, not replaced`);
  }
  assert.deepEqual(after_.systemMemberships.find(m => m.system === 'ERP'), before_.systemMemberships.find(m => m.system === 'ERP'));
  assert.deepEqual(after_.systemMemberships.find(m => m.system === 'WEBSITE'), before_.systemMemberships.find(m => m.system === 'WEBSITE'));
  assert.deepEqual(await raw(bystander._id), bystanderBefore, 'other users untouched');
  assert.equal(await PlatformAuditLog.countDocuments({ targetUser: id }), MD_AUDIT.length + 1, 'the repair is audited');

  // The app now resolves the right roles from the repaired record.
  const { getEffectiveSystemAccess } = require('../../utils/systemAccess');
  const access = getEffectiveSystemAccess(await User.findById(id));
  assert.equal(access.CRM.role, 'md');
  assert.equal(access.COMMERCIAL.role, 'md');
  assert.equal(access.HR.hasMembership, false);

  const second = await restoreSystemAccess({ connect: false, log: quiet, argv });
  assert.equal(second.applied, false, 'idempotent');
  assert.deepEqual(second.changed, []);
  assert.deepEqual(await raw(id), after_);
  assert.equal(await PlatformAuditLog.countDocuments({ targetUser: id }), MD_AUDIT.length + 1, 'no extra audit entry');
});

maybeTest('10. an unresolvable system stops the WHOLE apply - nothing written for any system', async () => {
  const { insertedId } = await mongoose.connection.collection('users').insertOne({
    name: 'Ordinary',
    email: 'ordinary@reservia.test',
    type: 'online',
    role: 'operator',
    isActive: true,
    platformAdmin: false,
    systemMemberships: [{ _id: new mongoose.Types.ObjectId(), system: 'ERP', role: 'operator', isActive: true }],
  });
  await PlatformAuditLog.insertMany(MD_AUDIT.map(e => ({ ...e, actor: insertedId, actorName: 'x', targetUser: insertedId })));
  await User.create({ name: 'Admin', email: 'pa@reservia.test', password: 'x', role: 'admin', type: 'online', platformAdmin: true });
  const userBefore = await raw(insertedId);
  const result = await restoreSystemAccess({
    connect: false,
    log: quiet,
    argv: ['node', 'x', '--email=ordinary@reservia.test', '--role-CRM=sales', '--apply', '--actor-email=pa@reservia.test', `--confirm-db=${dbName()}`],
  });
  assert.equal(result.plan.ok, false, 'COMMERCIAL cannot be resolved for a non-admin whose only history is MEMBER');
  assert.equal(result.applied, false);
  assert.deepEqual(await raw(insertedId), userBefore, 'not even the resolvable CRM change was written');
});
