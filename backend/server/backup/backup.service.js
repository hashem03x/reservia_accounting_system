'use strict';

const mongoose = require('mongoose');
const Backup = require('../models/system/backupModel');
const RestoreLog = require('../models/system/restoreLogModel');
const ApiError = require('../utils/apiError');
const { getSettings } = require('./backup.settings');
const { notifyFailure } = require('./backup.notifier');
const store = require('./backup.store');
const { writeBackup, verifyBackup } = require('./backup.format');

// Full backups and restores of the Reservia database (every business collection - users and
// permissions, chart of accounts, journal entries and numbering counters, customers, vendors,
// projects, orders, payments, advances, fixed assets and depreciation runs, expenses, inventory ...
// - discovered from the database itself, so a collection added later is included automatically).
//
// A backup is written as a stream (backup.format.js) to the configured storage (backup.store.js),
// then read back and verified; only then is it `completed`. A restore:
//   1. verifies the backup file again,
//   2. takes and verifies a recovery backup of the current data (the way back),
//   3. loads every collection into staging collections and checks every count,
//   4. swaps the staging collections in by rename - on any failure the swap is rolled back to the
//      data as it was (and the recovery backup is there if even that fails),
//   5. drops the replaced collections.
// Restores REPLACE the data (no merge - merging two ledgers would break numbering and balances).
// Backup / restore bookkeeping is never backed up or replaced, so its history survives a restore.

const STALE_MS = 3 * 60 * 60 * 1000; // a 'running' record older than this is a crashed run
const db = () => {
  const conn = mongoose.connection;
  if (conn.readyState !== 1 || !conn.db) throw new ApiError('The database is not connected yet. Try again in a moment.', 503);
  return conn.db;
};
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function assertIdle() {
  const since = new Date(Date.now() - STALE_MS);
  const [backup, restore] = await Promise.all([Backup.exists({ status: 'running', kind: { $ne: 'uploaded' }, startedAt: { $gte: since } }), RestoreLog.exists({ status: 'running', startedAt: { $gte: since } })]);
  if (backup || restore) throw new ApiError(`A ${restore ? 'restore' : 'backup'} is already in progress. Try again when it has finished.`, 409);
}

/** Reads a stored backup back and checks it; records and returns the result. */
async function verifyStored(record) {
  const result = await verifyBackup(store.openRead(record));
  await Backup.updateOne({ _id: record._id }, { $set: { verification: { ok: result.ok, checkedAt: new Date(), problems: result.problems } } });
  return result;
}

/**
 * Creates a full backup. `kind`: manual | scheduled | pre-restore. Resolves with the completed,
 * verified record; a failed backup is recorded as failed, its partial file removed, and rejected.
 */
async function createBackup({ kind = 'manual', userId = null, skipIdleCheck = false } = {}) {
  const database = db();
  if (!skipIdleCheck) await assertIdle();
  const fileName = `reservia-backup-${stamp()}-${kind}-${new mongoose.Types.ObjectId().toString().slice(-6)}.rsvbak`;
  const target = await store.openWrite(fileName);
  const record = await Backup.create({ kind, status: 'running', fileName, storage: target.storage, createdBy: userId });
  try {
    const { manifest, sizeBytes, sha256 } = await writeBackup(database, target.stream, { include: store.isBusinessCollection });
    record.fileRef = target.ref();
    record.sizeBytes = sizeBytes;
    record.sha256 = sha256;
    record.manifest = { ...manifest, createdAt: new Date(manifest.createdAt), collections: manifest.collections.map(({ name, count }) => ({ name, count })) };
    await record.save();
    const verification = await verifyStored(record);
    if (!verification.ok) throw new Error(`The written backup failed verification: ${verification.problems.join('; ')}`);
    record.status = 'completed';
    record.completedAt = new Date();
    record.verification = { ok: true, checkedAt: new Date(), problems: [] };
    await record.save();
    console.log(`[Backup] ${kind} backup completed (${record.fileName}, ${record.manifest.totalDocuments} documents, ${sizeBytes} bytes).`);
    return record.toObject();
  } catch (err) {
    // GridFS: abort removes the chunks already written; a file stream is closed and deleted below.
    if (typeof target.stream.abort === 'function') await Promise.resolve(target.stream.abort()).catch(() => {});
    else target.stream.destroy();
    await store.remove({ storage: target.storage, fileRef: record.fileRef || (target.storage === 'filesystem' ? fileName : null) }).catch(() => {});
    record.status = 'failed';
    record.error = String(err.message || err).slice(0, 1000);
    record.completedAt = new Date();
    await record.save().catch(() => {});
    console.error(`[Backup] ${kind} backup failed: ${record.error}`);
    throw err instanceof ApiError ? err : new ApiError(`Backup failed: ${record.error}`, 500);
  }
}

/** The scheduled run (backup.scheduler.js): a scheduled backup, retention, and an alert on failure. */
async function runBackup() {
  try {
    const record = await createBackup({ kind: 'scheduled' });
    await pruneScheduled(getSettings().maxFiles);
    return record;
  } catch (err) {
    await notifyFailure(err);
    throw err;
  }
}

/** Keeps the newest `keep` scheduled backups; older scheduled files are deleted (manual ones never). */
async function pruneScheduled(keep) {
  const max = Math.max(1, Number(keep) || 10);
  const old = await Backup.find({ kind: 'scheduled', status: 'completed' }).sort({ createdAt: -1 }).skip(max).lean();
  for (const record of old) {
    // eslint-disable-next-line no-await-in-loop
    await store.remove(record);
    // eslint-disable-next-line no-await-in-loop
    await Backup.updateOne({ _id: record._id }, { $set: { status: 'deleted', deletedAt: new Date() } });
  }
  return old.length;
}

const listBackups = () => Backup.find({ status: { $ne: 'deleted' } }).sort({ createdAt: -1 }).limit(200).populate({ path: 'createdBy', select: 'name' }).lean();
const listRestores = () =>
  RestoreLog.find({})
    .sort({ createdAt: -1 })
    .limit(100)
    .populate({ path: 'startedBy', select: 'name' })
    .populate({ path: 'backup', select: 'fileName kind createdAt' })
    .populate({ path: 'recoveryBackup', select: 'fileName createdAt' })
    .lean();

async function getUsable(id) {
  if (!mongoose.Types.ObjectId.isValid(String(id))) throw new ApiError('Invalid backup id.', 400);
  const record = await Backup.findById(id).lean();
  if (!record || record.status === 'deleted') throw new ApiError('Backup not found.', 404);
  if (record.status !== 'completed') throw new ApiError('This backup is not complete.', 400);
  return record;
}

async function openDownload(id) {
  const record = await getUsable(id);
  return { stream: store.openRead(record), fileName: record.fileName, sizeBytes: record.sizeBytes };
}

async function verify(id) {
  const record = await getUsable(id);
  return verifyStored(record);
}

async function deleteBackup(id, userId) {
  if (!mongoose.Types.ObjectId.isValid(String(id))) throw new ApiError('Invalid backup id.', 400);
  const record = await Backup.findById(id).lean();
  if (!record || record.status === 'deleted') throw new ApiError('Backup not found.', 404);
  if (record.status === 'running') throw new ApiError('A backup in progress cannot be deleted.', 409);
  await store.remove(record);
  await Backup.updateOne({ _id: record._id }, { $set: { status: 'deleted', deletedAt: new Date(), deletedBy: userId } });
}

// ---------------------------------------------------------------- uploads (chunked)
// A backup to restore from is uploaded in chunks (each under the hosting request-size limit), then
// assembled into the backup storage and verified before anything can be restored from it.
const CHUNK_MAX_BYTES = 3.5 * 1024 * 1024;
const maxUploadBytes = () => Math.max(1, Number(process.env.BACKUP_MAX_UPLOAD_MB) || 1024) * 1024 * 1024;
const uploads = () => mongoose.connection.collection('backupuploads');
const chunks = () => mongoose.connection.collection('backupuploadchunks');

async function startUpload({ fileName, sizeBytes, userId }) {
  const size = Number(sizeBytes);
  if (!Number.isFinite(size) || size <= 0) throw new ApiError('Choose a backup file.', 400);
  if (size > maxUploadBytes()) throw new ApiError(`The file is larger than the ${Math.round(maxUploadBytes() / 1048576)} MB upload limit.`, 413);
  if (typeof fileName !== 'string' || !/\.rsvbak$/i.test(fileName)) throw new ApiError('Choose a Reservia backup file (.rsvbak).', 400);
  const { insertedId } = await uploads().insertOne({ fileName: fileName.slice(0, 200), sizeBytes: size, received: 0, createdBy: userId, createdAt: new Date() });
  return { uploadId: String(insertedId), chunkBytes: CHUNK_MAX_BYTES, chunks: Math.ceil(size / CHUNK_MAX_BYTES) };
}

async function putChunk(uploadId, index, data) {
  if (!mongoose.Types.ObjectId.isValid(String(uploadId))) throw new ApiError('Invalid upload id.', 400);
  const n = Number(index);
  if (!Number.isInteger(n) || n < 0) throw new ApiError('Invalid chunk index.', 400);
  if (!Buffer.isBuffer(data) || !data.length || data.length > CHUNK_MAX_BYTES) throw new ApiError('Invalid chunk.', 400);
  const upload = await uploads().findOne({ _id: new mongoose.Types.ObjectId(uploadId) });
  if (!upload) throw new ApiError('Upload not found.', 404);
  await chunks().updateOne({ upload: upload._id, index: n }, { $set: { upload: upload._id, index: n, data } }, { upsert: true });
  const received = (await chunks().aggregate([{ $match: { upload: upload._id } }, { $group: { _id: null, bytes: { $sum: { $binarySize: '$data' } } } }]).toArray())[0]?.bytes || 0;
  if (received > upload.sizeBytes) throw new ApiError('More data was sent than the file size.', 400);
  await uploads().updateOne({ _id: upload._id }, { $set: { received } });
  return { received };
}

/** Assembles the chunks into a stored backup and verifies it - the preview a restore starts from. */
async function completeUpload(uploadId, userId) {
  if (!mongoose.Types.ObjectId.isValid(String(uploadId))) throw new ApiError('Invalid upload id.', 400);
  const id = new mongoose.Types.ObjectId(uploadId);
  const upload = await uploads().findOne({ _id: id });
  if (!upload) throw new ApiError('Upload not found.', 404);
  if (upload.received !== upload.sizeBytes) throw new ApiError(`The upload is incomplete (${upload.received} of ${upload.sizeBytes} bytes).`, 400);
  const fileName = `reservia-backup-${stamp()}-uploaded-${String(id).slice(-6)}.rsvbak`;
  const target = await store.openWrite(fileName);
  const record = await Backup.create({ kind: 'uploaded', status: 'running', fileName, storage: target.storage, createdBy: userId });
  try {
    // eslint-disable-next-line no-restricted-syntax
    for await (const chunk of chunks().find({ upload: id }).sort({ index: 1 })) {
      const buf = Buffer.from(chunk.data.buffer || chunk.data);
      if (!target.stream.write(buf)) await new Promise(resolve => target.stream.once('drain', resolve));
    }
    target.stream.end();
    await require('stream/promises').finished(target.stream); // eslint-disable-line global-require
    record.fileRef = target.ref();
    record.sizeBytes = upload.sizeBytes;
    await record.save();
    const result = await verifyStored(record);
    record.status = result.ok ? 'completed' : 'failed';
    record.error = result.ok ? null : result.problems.join('; ').slice(0, 1000);
    record.completedAt = new Date();
    if (result.manifest) record.manifest = { ...result.manifest, createdAt: new Date(result.manifest.createdAt), collections: result.manifest.collections.map(({ name, count }) => ({ name, count })) };
    await record.save();
    if (!result.ok) await store.remove(record);
    return { backup: record.toObject(), verification: result };
  } finally {
    await chunks().deleteMany({ upload: id });
    await uploads().deleteOne({ _id: id });
  }
}

// ---------------------------------------------------------------- restore

/**
 * Replaces the database's business collections with the backup's. `confirm` must be "RESTORE".
 * `hooks` are for tests only (failure injection) - never reachable from the API.
 */
async function restoreBackup({ backupId, confirm, userId, hooks = {} }) {
  if (confirm !== 'RESTORE') throw new ApiError('Type RESTORE to confirm replacing all current data with this backup.', 400);
  const backup = await getUsable(backupId);
  const database = db();
  await assertIdle();

  const log = await RestoreLog.create({ backup: backup._id, startedBy: userId });
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const staging = name => `${store.STAGING_PREFIX}${token}_${name}`;
  const parked = name => `${store.OLD_PREFIX}${token}_${name}`;
  const staged = [];
  const fail = async (status, err) => {
    await RestoreLog.updateOne({ _id: log._id }, { $set: { status, error: String(err.message || err).slice(0, 1000), completedAt: new Date() } });
  };

  try {
    // 1. The file, again, right before using it.
    const check = await verifyStored(backup);
    if (!check.ok) throw new ApiError(`The backup failed verification: ${check.problems.join('; ')}`, 400);

    // 2. The way back: a verified backup of the data about to be replaced.
    const recovery = await createBackup({ kind: 'pre-restore', userId, skipIdleCheck: true });
    await RestoreLog.updateOne({ _id: log._id }, { $set: { recoveryBackup: recovery._id } });

    // 3. Stage every collection and check its count.
    let batch = [];
    let current = null;
    let documents = 0;
    const flush = async () => {
      if (!batch.length) return;
      await database.collection(staging(current)).insertMany(batch, { ordered: true });
      batch = [];
    };
    const loaded = await verifyBackup(store.openRead(backup), {
      onCollectionStart: async (name, indexes) => {
        if (!store.isBusinessCollection(name)) throw new Error(`The backup contains a reserved collection "${name}".`);
        current = name;
        await database.collection(staging(name)).drop().catch(() => {});
        await database.createCollection(staging(name));
        staged.push({ name, indexes });
      },
      onDocument: async (name, doc) => {
        batch.push(doc);
        documents += 1;
        if (batch.length >= 500) await flush();
      },
      onCollectionEnd: async (name, count) => {
        await flush();
        const stored = await database.collection(staging(name)).countDocuments();
        if (stored !== count) throw new Error(`${name}: ${stored} of ${count} documents staged.`);
        const { indexes } = staged.find(s => s.name === name);
        if (indexes.length) await database.collection(staging(name)).createIndexes(indexes);
        if (hooks.afterStage) await hooks.afterStage(name);
      },
    });
    if (!loaded.ok) throw new ApiError(`The backup could not be loaded: ${loaded.problems.join('; ')}`, 400);

    // 4. Swap. Every current business collection is parked (so collections the backup does not have
    // are gone after the restore, as in the backup), then the staged ones take their names.
    const existing = (await database.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(store.isBusinessCollection);
    const parkedNames = [];
    const swappedIn = [];
    try {
      for (const name of existing) {
        // eslint-disable-next-line no-await-in-loop
        await database.renameCollection(name, parked(name));
        parkedNames.push(name);
      }
      for (const { name } of staged) {
        // eslint-disable-next-line no-await-in-loop
        if (hooks.beforeSwapIn) await hooks.beforeSwapIn(name);
        // eslint-disable-next-line no-await-in-loop
        await database.renameCollection(staging(name), name);
        swappedIn.push(name);
      }
    } catch (swapErr) {
      // Roll back to the data as it was: remove what was swapped in, give the parked ones their names back.
      for (const name of swappedIn) {
        // eslint-disable-next-line no-await-in-loop
        await database.collection(name).drop().catch(() => {});
      }
      for (const name of parkedNames) {
        // eslint-disable-next-line no-await-in-loop
        await database.renameCollection(parked(name), name);
      }
      throw Object.assign(swapErr, { rolledBack: true });
    }

    // 5. The replaced data is no longer needed (the recovery backup holds it).
    for (const name of parkedNames) {
      // eslint-disable-next-line no-await-in-loop
      await database.collection(parked(name)).drop().catch(() => {});
    }
    await RestoreLog.updateOne({ _id: log._id }, { $set: { status: 'completed', collections: staged.length, documents, completedAt: new Date() } });
    console.log(`[Backup] Restore completed from ${backup.fileName} (${staged.length} collections, ${documents} documents).`);
    return RestoreLog.findById(log._id).lean();
  } catch (err) {
    // Nothing staged survives a failed restore; the current data was never touched (or was put back).
    for (const { name } of staged) {
      // eslint-disable-next-line no-await-in-loop
      await database.collection(staging(name)).drop().catch(() => {});
    }
    await fail(err.rolledBack || staged.length ? 'rolled_back' : 'failed', err);
    console.error(`[Backup] Restore failed and was rolled back: ${err.message}`);
    throw err instanceof ApiError ? err : new ApiError(`The restore failed and was rolled back - the current data is unchanged. ${err.message}`, 500);
  }
}

module.exports = {
  runBackup,
  createBackup,
  pruneScheduled,
  listBackups,
  listRestores,
  openDownload,
  verify,
  deleteBackup,
  startUpload,
  putChunk,
  completeUpload,
  restoreBackup,
  CHUNK_MAX_BYTES,
};
