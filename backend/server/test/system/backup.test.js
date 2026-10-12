const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const mongoose = require('mongoose');

// Full system backup and restore (server/backup/*): what a backup contains, that it is verified
// before it counts, that a restore brings back exactly the backed-up data (ids, types, numbering,
// relationships, balances), that bad files are refused before anything is touched, that a restore
// failing half-way is rolled back, that the history survives, and who may use it.

const DB_URI = process.env.TEST_DB_URI_BACKUP || 'mongodb://127.0.0.1:27017/reversia_test_backup';
process.env.BACKUP_STORAGE = 'gridfs';

let service, format, store, Backup, RestoreLog, getTrialBalance;
let JournalEntry, ChartOfAccount, User;
let admin;
let transactionsSupported = true;
const id = () => new mongoose.Types.ObjectId();
const { EJSON } = require(require.resolve('bson', { paths: [path.join(path.dirname(require.resolve('mongoose/package.json')), 'node_modules')] }));

const coll = name => mongoose.connection.collection(name);
const readAll = stream => new Promise((resolve, reject) => {
  const parts = [];
  stream.on('data', d => parts.push(d));
  stream.on('end', () => resolve(Buffer.concat(parts)));
  stream.on('error', reject);
});
const { Readable } = require('stream');
const bufferStream = buf => Readable.from([buf]);
/** Every business collection's documents (sorted by _id) in canonical EJSON - an exact snapshot. */
async function snapshot() {
  const names = (await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(store.isBusinessCollection).sort();
  const out = {};
  for (const name of names) out[name] = EJSON.stringify(await coll(name).find({}).sort({ _id: 1 }).toArray(), { relaxed: false });
  return out;
}

before(async () => {
  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();
  require('../../models/inventory/warehouseModel');
  require('../../models/vendor/paymentModel');
  JournalEntry = require('../../models/accounting/journalEntryModel');
  ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
  User = require('../../models/userModel');
  Backup = require('../../models/system/backupModel');
  RestoreLog = require('../../models/system/restoreLogModel');
  service = require('../../backup/backup.service');
  format = require('../../backup/backup.format');
  store = require('../../backup/backup.store');
  ({ getTrialBalance } = require('../../services/accounting/generalLedgerService'));
  await Promise.all([JournalEntry.init(), ChartOfAccount.init(), User.init()]);

  const probe = await mongoose.startSession();
  try {
    await probe.withTransaction(async () => {
      await coll('__txn_probe').insertOne({ ok: 1 }, { session: probe });
    });
  } catch {
    transactionsSupported = false;
  } finally {
    probe.endSession();
  }

  // A small but real ledger: accounts, users, journal entries with a reversal pair, the entry
  // numbering counter, and a document with every awkward BSON type.
  admin = await User.create({ name: 'Admin', email: `admin-${Date.now()}@example.com`, role: 'admin', type: 'online' });
  const bank = await ChartOfAccount.create({ code: '11000001', name: 'Bank Misr', type: 'asset' });
  const capital = await ChartOfAccount.create({ code: '20000001', name: 'Share Capital', type: 'equity' });
  const rent = await ChartOfAccount.create({ code: '61000001', name: 'Office Rent', type: 'expense' });
  const line = (account, debit, credit) => ({ account: account._id, debit, credit, description: 'x' });
  const e1 = { _id: id(), entryNumber: 1, date: new Date('2026-01-02'), description: 'Capital', source: 'manual', status: 'posted', lines: [line(bank, 100000.55, 0), line(capital, 0, 100000.55)] };
  const e2 = { _id: id(), entryNumber: 2, date: new Date('2026-02-01'), description: 'Rent', source: 'manual', status: 'reversed', lines: [line(rent, 1200, 0), line(bank, 0, 1200)] };
  const e3 = { _id: id(), entryNumber: 3, date: new Date('2026-02-03'), description: 'Reversal', source: 'manual', status: 'posted', reversalOfEntry: e2._id, lines: [line(bank, 1200, 0), line(rent, 0, 1200)] };
  await coll('journalentries').insertMany([e1, e2, e3]);
  await coll('journalentries').updateOne({ _id: e2._id }, { $set: { reversedByEntry: e3._id } });
  await coll('counters').insertOne({ _id: 'journalEntryNumber', seq: 3 });
  const { Decimal128, Long, Int32, Double } = mongoose.mongo.BSON;
  await coll('typefixtures').insertOne({ _id: id(), money: Decimal128.fromString('1234.5678'), int: new Int32(7), dbl: new Double(7), long: Long.fromString('9007199254740993'), when: new Date('2026-03-04T05:06:07.089Z'), nested: { list: [1, 'two', null] } });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

let first;
let before1;
let tbBefore;
test('a full backup contains every business collection (not its own bookkeeping), is verified, and preserves ids and types', async () => {
  before1 = await snapshot();
  tbBefore = await getTrialBalance();
  first = await service.createBackup({ kind: 'manual', userId: admin._id });
  assert.deepEqual([first.status, first.verification.ok, first.storage], ['completed', true, 'gridfs']);
  const names = first.manifest.collections.map(c => c.name);
  for (const required of ['chartofaccounts', 'journalentries', 'users', 'counters', 'typefixtures']) assert.ok(names.includes(required), required);
  for (const excluded of ['backups', 'restorelogs', 'backupfiles.files', 'backupfiles.chunks', '__txn_probe']) assert.ok(!names.includes(excluded), `${excluded} excluded`);
  assert.equal(first.manifest.collections.find(c => c.name === 'journalentries').count, 3);
  assert.equal(first.manifest.formatVersion, 1);
  assert.ok(first.sizeBytes > 0 && /^[0-9a-f]{64}$/.test(first.sha256));

  // The file itself: ids and types exactly as in the database.
  const docs = {};
  const result = await format.verifyBackup(store.openRead(first), { onDocument: (name, doc) => { (docs[name] = docs[name] || []).push(doc); } });
  assert.equal(result.ok, true, result.problems.join('; '));
  const typed = docs.typefixtures[0];
  assert.deepEqual([typed.money._bsontype, typed.int._bsontype || typeof typed.int, typed.long._bsontype, typed.when instanceof Date], ['Decimal128', 'Int32', 'Long', true]);
  assert.equal(String(typed.money), '1234.5678');
  const reversal = docs.journalentries.find(d => Number(d.entryNumber) === 3);
  assert.equal(String(reversal.reversalOfEntry), String(docs.journalentries.find(d => Number(d.entryNumber) === 2)._id), 'references preserved');
});

test('restore replaces the data with exactly the backup (ids, numbering, types, balances); a verified recovery backup is taken; history survives', async t => {
  // Change the data after the backup: a new entry, a deleted account, an edited user, a new collection.
  await coll('journalentries').insertOne({ _id: id(), entryNumber: 4, date: new Date(), description: 'After backup', source: 'manual', status: 'posted', lines: [] });
  await coll('chartofaccounts').deleteOne({ code: '61000001' });
  await coll('users').updateOne({ _id: admin._id }, { $set: { name: 'Renamed' } });
  await coll('counters').updateOne({ _id: 'journalEntryNumber' }, { $set: { seq: 4 } });
  await coll('createdlater').insertOne({ x: 1 });

  await assert.rejects(() => service.restoreBackup({ backupId: first._id, confirm: 'yes', userId: admin._id }), /Type RESTORE/);
  const log = await service.restoreBackup({ backupId: first._id, confirm: 'RESTORE', userId: admin._id });
  assert.equal(log.status, 'completed');
  assert.deepEqual(await snapshot(), before1, 'every business collection is exactly as backed up (the later collection is gone too)');
  assert.deepEqual(await getTrialBalance(), tbBefore, 'same accounting balances');
  const recovery = await Backup.findById(log.recoveryBackup).lean();
  assert.deepEqual([recovery.kind, recovery.status, recovery.verification.ok], ['pre-restore', 'completed', true]);
  assert.ok(recovery.manifest.collections.some(c => c.name === 'createdlater'), 'the recovery backup holds the replaced data');
  assert.ok(await Backup.exists({ _id: first._id }), 'backup history survives the restore');
  const leftovers = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name).filter(n => n.startsWith('__rs_') || n.startsWith('__old_'));
  assert.deepEqual(leftovers, []);
  // The indexes came back too.
  const indexes = await coll('journalentries').indexes();
  assert.ok(indexes.some(i => i.unique && i.key.entryNumber), 'unique entry number index restored');
  if (!transactionsSupported) t.diagnostic('transactions not available - restore does not need them');
});

test('bad files are refused before anything is touched: damaged, truncated, another format, a newer version, missing collections', async () => {
  const good = await readAll(store.openRead(first));
  const damaged = Buffer.from(good);
  damaged[Math.floor(damaged.length / 2)] ^= 0xff;
  const truncated = good.subarray(0, Math.floor(good.length * 0.6));
  const lines = zlib.gunzipSync(good).toString('utf8').trim().split('\n');
  const rewrite = mutate => zlib.gzipSync(mutate(lines.map(l => JSON.parse(l))).map(r => JSON.stringify(r)).join('\n'));
  const newer = rewrite(rs => [{ ...rs[0], formatVersion: 99 }, ...rs.slice(1)]);
  const foreign = zlib.gzipSync('{"hello":"world"}\n');
  const noUsers = rewrite(rs => rs.filter(r => !(r.name === 'users' || r.c === 'users')).map(r => (r.t === 'manifest' ? { ...r, collections: r.collections.filter(c => c.name !== 'users') } : r)));
  const tampered = rewrite(rs => rs.map(r => (r.t === 'd' && r.c === 'chartofaccounts' ? { ...r, d: { ...r.d, name: 'Tampered' } } : r)));

  for (const [label, buf, pattern] of [
    ['damaged', damaged, /not a valid backup|damaged|checksum/],
    ['truncated', truncated, /cut short|not a valid backup|damaged/],
    ['newer version', newer, /format version 99/],
    ['another format', foreign, /not a Reservia backup/],
    ['missing users', noUsers, /Required collection "users" is missing/],
    ['tampered', tampered, /does not match its checksum/],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const result = await format.verifyBackup(bufferStream(buf));
    assert.equal(result.ok, false, label);
    assert.match(result.problems.join(' '), pattern, label);
  }

  // Through the upload path: refused, recorded as failed, nothing restorable.
  const current = await snapshot();
  const { uploadId } = await service.startUpload({ fileName: 'broken.rsvbak', sizeBytes: damaged.length, userId: admin._id });
  await service.putChunk(uploadId, 0, damaged);
  const { backup, verification } = await service.completeUpload(uploadId, admin._id);
  assert.deepEqual([verification.ok, backup.status], [false, 'failed']);
  await assert.rejects(() => service.restoreBackup({ backupId: backup._id, confirm: 'RESTORE', userId: admin._id }), /not complete/);
  assert.deepEqual(await snapshot(), current, 'nothing changed');
  await assert.rejects(() => service.startUpload({ fileName: 'x.zip', sizeBytes: 10, userId: admin._id }), /\.rsvbak/);
  process.env.BACKUP_MAX_UPLOAD_MB = '1';
  await assert.rejects(() => service.startUpload({ fileName: 'big.rsvbak', sizeBytes: 5 * 1024 * 1024, userId: admin._id }), /upload limit/);
  delete process.env.BACKUP_MAX_UPLOAD_MB;
});

test('a restore that fails half-way is rolled back: the current data is untouched and no staging is left', async () => {
  await coll('journalentries').insertOne({ _id: id(), entryNumber: 10, date: new Date(), description: 'Current only', source: 'manual', status: 'posted', lines: [] });
  const current = await snapshot();
  let swapped = 0;
  await assert.rejects(
    () => service.restoreBackup({ backupId: first._id, confirm: 'RESTORE', userId: admin._id, hooks: { beforeSwapIn: async () => { swapped += 1; if (swapped === 3) throw new Error('disk full'); } } }),
    /rolled back|disk full/
  );
  assert.deepEqual(await snapshot(), current, 'exactly the data before the restore');
  const log = await RestoreLog.findOne({}).sort({ createdAt: -1 }).lean();
  assert.equal(log.status, 'rolled_back');
  const leftovers = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name).filter(n => n.startsWith('__rs_') || n.startsWith('__old_'));
  assert.deepEqual(leftovers, []);
});

test('an uploaded valid backup (in chunks) is verified and restorable; filesystem storage works too', async () => {
  const good = await readAll(store.openRead(first));
  const { uploadId } = await service.startUpload({ fileName: 'reservia.rsvbak', sizeBytes: good.length, userId: admin._id });
  const size = 1024;
  for (let i = 0, n = 0; i < good.length; i += size, n += 1) {
    // eslint-disable-next-line no-await-in-loop
    await service.putChunk(uploadId, n, good.subarray(i, i + size));
  }
  const { backup, verification } = await service.completeUpload(uploadId, admin._id);
  assert.deepEqual([verification.ok, backup.status, backup.kind], [true, 'completed', 'uploaded']);
  assert.equal(await coll('backupuploadchunks').countDocuments(), 0, 'chunks cleaned up');
  await service.restoreBackup({ backupId: backup._id, confirm: 'RESTORE', userId: admin._id });
  assert.deepEqual(await snapshot(), before1);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsvbak-'));
  process.env.BACKUP_STORAGE = 'filesystem';
  process.env.BACKUP_DIR = dir;
  try {
    const onDisk = await service.createBackup({ kind: 'manual', userId: admin._id });
    assert.deepEqual([onDisk.storage, onDisk.verification.ok], ['filesystem', true]);
    assert.ok(fs.existsSync(path.join(dir, onDisk.fileName)));
    await service.deleteBackup(onDisk._id, admin._id);
    assert.equal(fs.existsSync(path.join(dir, onDisk.fileName)), false);
    assert.equal((await Backup.findById(onDisk._id).lean()).status, 'deleted');
  } finally {
    process.env.BACKUP_STORAGE = 'gridfs';
    delete process.env.BACKUP_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a large collection is streamed (never loaded whole) and round-trips; retention keeps the newest scheduled backups', async () => {
  const big = coll('bigfixture');
  const batch = [];
  for (let i = 0; i < 25000; i += 1) batch.push({ _id: id(), i, text: `row ${i}`.padEnd(120, '.') });
  for (let i = 0; i < batch.length; i += 5000) {
    // eslint-disable-next-line no-await-in-loop
    await big.insertMany(batch.slice(i, i + 5000));
  }
  const heapBefore = process.memoryUsage().heapUsed;
  const backup = await service.createBackup({ kind: 'manual', userId: admin._id });
  const heapGrowth = process.memoryUsage().heapUsed - heapBefore;
  assert.equal(backup.manifest.collections.find(c => c.name === 'bigfixture').count, 25000);
  assert.ok(heapGrowth < 200 * 1024 * 1024, `heap grew ${Math.round(heapGrowth / 1048576)} MB`);
  await big.deleteMany({ i: { $gte: 100 } });
  await service.restoreBackup({ backupId: backup._id, confirm: 'RESTORE', userId: admin._id });
  assert.equal(await big.countDocuments(), 25000);

  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await service.createBackup({ kind: 'scheduled' });
  }
  assert.equal(await service.pruneScheduled(2), 1);
  assert.equal(await Backup.countDocuments({ kind: 'scheduled', status: 'completed' }), 2);
  assert.ok(await Backup.exists({ _id: first._id, status: 'completed' }), 'manual backups are never pruned');
});

test('only administrators reach the backup routes; the cron endpoint needs CRON_SECRET', async () => {
  const router = require('../../backup/backup.routes');
  const authController = require('../../controller/user/authController');
  const protectIndex = router.stack.findIndex(l => l.handle === authController.protect);
  assert.ok(protectIndex > 0, 'protect guards the router');
  const routesBefore = router.stack.slice(0, protectIndex).filter(l => l.route).map(l => l.route.path);
  assert.deepEqual(routesBefore, ['/cron'], 'only the cron endpoint is outside the admin guard');
  const adminGuard = router.stack[protectIndex + 1].handle;
  const run = (guard, user) => new Promise(resolve => guard({ user }, {}, err => resolve(err ? err.statusCode : 'next')));
  assert.equal(await run(adminGuard, { role: 'moderator', isAdmin: false }), 403);
  assert.equal(await run(adminGuard, { role: 'admin', isAdmin: false }), 'next');

  const { cronBackup } = require('../../backup/backup.controller');
  const call = headers => new Promise(resolve => cronBackup({ headers }, { status: () => ({ json: body => resolve({ ok: true, body }) }) }, err => resolve({ ok: false, status: err?.statusCode })));
  delete process.env.CRON_SECRET;
  assert.deepEqual(await call({ authorization: 'Bearer anything' }), { ok: false, status: 401 }, 'disabled without a secret');
  process.env.CRON_SECRET = 'a-very-long-cron-secret-value';
  assert.deepEqual(await call({ authorization: 'Bearer wrong-but-same-length-xxxxxx' }), { ok: false, status: 401 });
  const done = await call({ authorization: 'Bearer a-very-long-cron-secret-value' });
  assert.equal(done.ok, true);
  delete process.env.CRON_SECRET;
  const record = await Backup.findById(done.body.data.id).lean();
  assert.deepEqual([record.kind, record.status], ['scheduled', 'completed']);
  // Nothing in a backup record exposes the connection string.
  assert.ok(!JSON.stringify(record).includes('mongodb://'));
});
