'use strict';

const os = require('os');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { pipeline } = require('stream/promises');
const Backup = require('../models/system/backupModel');
const RestoreLog = require('../models/system/restoreLogModel');
const ApiError = require('../utils/apiError');
const cloudinaryFiles = require('../services/files/cloudinaryFiles');
const { getSettings } = require('./backup.settings');
const { notifyFailure } = require('./backup.notifier');
const store = require('./backup.store');
const { writeBackup, verifyBackup, scopeOf, FileBackupError } = require('./backup.format');
const { filesFor, cloudinaryRefs, localPath, uploadsDir, GRIDFS_BUCKET, FILE_COLLECTIONS } = require('./backup.files');

// Full system backups and restores of Reservia: every business collection of the database (users and
// permissions, chart of accounts, journal entries and numbering counters, customers, vendors,
// projects, orders, payments, advances, fixed assets and depreciation runs, expenses, inventory ...
// - discovered from the database itself, so a collection added later is included automatically)
// AND the actual bytes of every stored file (backup.files.js): PDF attachments, Cloudinary business
// documents and contracts, and the images on the server's disk.
//
// A backup is written as a stream (backup.format.js) to the configured storage (backup.store.js),
// then read back and verified; only then is it `completed`. A file that cannot be read fails the
// full backup, naming the file and the record it belongs to - a full backup is never completed
// with a file missing. A "database" backup leaves the Cloudinary documents and server images out
// and is labelled so everywhere.
//
// A restore:
//   1. verifies the backup file again (records and files, by checksum),
//   2. takes and verifies a full recovery backup of the current data and files (the way back),
//   3. stages everything before touching anything live: every collection into staging collections
//      (counts checked); attachments into a staging GridFS bucket (read back and checked); server
//      images into a staging folder; Cloudinary documents that are missing or changed are uploaded
//      as NEW assets (an existing asset is never overwritten) and the staged records point at them;
//      then every attachment and document reference in the staged records is checked to resolve,
//   4. swaps the staged collections in by rename and moves the staged images into place - any
//      failure, including the check that follows, rolls all of it back to the data and files as
//      they were (the recovery backup is there if even that fails),
//   5. drops the replaced collections and the replaced images.
// Restores REPLACE the data (no merge - merging two ledgers would break numbering and balances).
// Backup / restore bookkeeping is never backed up or replaced, so its history survives a restore.

const STALE_MS = 3 * 60 * 60 * 1000; // a 'running' record older than this is a crashed run
const db = () => {
  const conn = mongoose.connection;
  if (conn.readyState !== 1 || !conn.db) throw new ApiError('The database is not connected yet. Try again in a moment.', 503);
  return conn.db;
};
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
// Collections dumped as documents; the attachment bucket goes in as files (with per-file checksums).
const dumpCollection = name => store.isBusinessCollection(name) && !FILE_COLLECTIONS.has(name);
const sha256Of = async stream => {
  const hash = crypto.createHash('sha256');
  // eslint-disable-next-line no-restricted-syntax
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
};

async function assertIdle() {
  const since = new Date(Date.now() - STALE_MS);
  const [backup, restore] = await Promise.all([
    Backup.exists({ status: 'running', kind: { $ne: 'uploaded' }, startedAt: { $gte: since } }),
    RestoreLog.exists({ status: 'running', startedAt: { $gte: since } }),
  ]);
  if (backup || restore) throw new ApiError(`A ${restore ? 'restore' : 'backup'} is already in progress. Try again when it has finished.`, 409);
}

const manifestSummary = manifest => ({
  ...manifest,
  createdAt: new Date(manifest.createdAt),
  collections: manifest.collections.map(({ name, count }) => ({ name, count })),
  files: undefined,
  scope: manifest.scope,
});
const fileSummary = manifest => ({
  count: manifest?.files?.count || 0,
  totalBytes: manifest?.files?.totalBytes || 0,
  sources: manifest?.files?.sources || {},
});

/** Reads a stored backup back and checks it; records and returns the result. */
async function verifyStored(record) {
  const result = await verifyBackup(store.openRead(record));
  await Backup.updateOne(
    { _id: record._id },
    { $set: { verification: { ok: result.ok, checkedAt: new Date(), problems: result.problems, files: result.ok ? result.files.count : null } } }
  );
  return result;
}

/**
 * Creates a backup. `kind`: manual | scheduled | pre-restore. `scope`: full (database + every stored
 * file) | database. Resolves with the completed, verified record; a failed backup is recorded as
 * failed (with the files that could not be read), its partial file removed, and rejected.
 */
async function createBackup({ kind = 'manual', scope = 'full', userId = null, skipIdleCheck = false, allowMissing = false } = {}) {
  const database = db();
  if (!skipIdleCheck) await assertIdle();
  const fileName = `reservia-backup-${stamp()}-${kind}${scope === 'database' ? '-db' : ''}-${new mongoose.Types.ObjectId().toString().slice(-6)}.rsvbak`;
  const target = await store.openWrite(fileName);
  const record = await Backup.create({ kind, scope, status: 'running', fileName, storage: target.storage, createdBy: userId });
  try {
    const { manifest, sizeBytes, sha256 } = await writeBackup(database, target.stream, { include: dumpCollection, files: filesFor(database, scope), scope, allowMissing });
    record.scope = manifest.scope;
    record.fileFailures = (manifest.files.missing || [])
      .slice(0, 200)
      .map(f => ({ source: f.source, key: f.key, name: f.name, refs: (f.refs || []).map(r => r.label || `${r.collection} ${r.id}`), error: f.error }));
    record.fileRef = target.ref();
    record.sizeBytes = sizeBytes;
    record.sha256 = sha256;
    record.manifest = manifestSummary(manifest);
    record.files = fileSummary(manifest);
    await record.save();
    const verification = await verifyStored(record);
    if (!verification.ok) throw new Error(`The written backup failed verification: ${verification.problems.join('; ')}`);
    record.status = 'completed';
    record.completedAt = new Date();
    record.verification = { ok: true, checkedAt: new Date(), problems: [], files: verification.files.count };
    await record.save();
    console.log(`[Backup] ${kind} ${scope} backup completed (${record.fileName}, ${manifest.totalDocuments} documents, ${record.files.count} files, ${sizeBytes} bytes).`);
    return record.toObject();
  } catch (err) {
    // GridFS: abort removes the chunks already written; a file stream is closed and deleted below.
    if (!target.stream.writableFinished) {
      if (typeof target.stream.abort === 'function') await Promise.resolve(target.stream.abort()).catch(() => {});
      else target.stream.destroy();
    }
    let fileRef = record.fileRef;
    try {
      fileRef = fileRef || target.ref();
    } catch {
      // nothing was stored
    }
    await store.remove({ storage: target.storage, fileRef }).catch(() => {});
    record.status = 'failed';
    record.error = String(err.message || err).slice(0, 2000);
    if (err instanceof FileBackupError) {
      record.fileFailures = err.failures
        .slice(0, 200)
        .map(f => ({ source: f.source, key: f.key, name: f.name, refs: (f.refs || []).map(r => r.label || `${r.collection} ${r.id}`), error: f.error }));
    }
    record.completedAt = new Date();
    await record.save().catch(() => {});
    console.error(`[Backup] ${kind} ${scope} backup failed: ${record.error}`);
    if (err instanceof ApiError) throw err;
    const failed = new ApiError(
      err instanceof FileBackupError ? `The full backup failed - ${record.error}` : `Backup failed: ${record.error}`,
      err instanceof FileBackupError ? 422 : 500
    );
    failed.backupId = record._id;
    throw failed;
  }
}

/**
 * The scheduled run (backup.scheduler.js and the cron endpoint): a full backup, retention, and an
 * alert on failure. If the full backup fails because stored files cannot be read, the database is
 * still protected by a database-only backup - recorded as such, never as a full one - and the alert
 * names the files.
 */
async function runBackup() {
  try {
    const record = await createBackup({ kind: 'scheduled', scope: 'full' });
    await pruneScheduled(getSettings().maxFiles);
    return record;
  } catch (err) {
    await notifyFailure(err);
    if (err.statusCode !== 422) throw err;
    const fallback = await createBackup({ kind: 'scheduled', scope: 'database', skipIdleCheck: true });
    await pruneScheduled(getSettings().maxFiles);
    return { ...fallback, fallbackFrom: err.message };
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

// Records written before files were included have no scope / format version 2: database only.
const withScope = b => (b.status === 'completed' || b.manifest?.formatVersion ? { ...b, scope: b.manifest?.formatVersion >= 2 ? b.scope || 'full' : 'database' } : b);
const listBackups = async () =>
  (
    await Backup.find({ status: { $ne: 'deleted' } })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate({ path: 'createdBy', select: 'name' })
      .lean()
  ).map(withScope);
const listRestores = () =>
  RestoreLog.find({})
    .sort({ createdAt: -1 })
    .limit(100)
    .populate({ path: 'startedBy', select: 'name' })
    .populate({ path: 'backup', select: 'fileName kind scope createdAt' })
    .populate({ path: 'recoveryBackup', select: 'fileName createdAt' })
    .lean();

async function getUsable(id) {
  if (!mongoose.Types.ObjectId.isValid(String(id))) throw new ApiError('Invalid backup id.', 400);
  const record = await Backup.findById(id).lean();
  if (!record || record.status === 'deleted') throw new ApiError('Backup not found.', 404);
  if (record.status !== 'completed') throw new ApiError('This backup is not complete.', 400);
  return withScope(record);
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
  const received =
    (
      await chunks()
        .aggregate([{ $match: { upload: upload._id } }, { $group: { _id: null, bytes: { $sum: { $binarySize: '$data' } } } }])
        .toArray()
    )[0]?.bytes || 0;
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
  const record = await Backup.create({ kind: 'uploaded', scope: 'database', status: 'running', fileName, storage: target.storage, createdBy: userId });
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
    if (result.manifest) {
      record.manifest = manifestSummary(result.manifest);
      record.files = fileSummary(result.manifest);
      record.scope = scopeOf(result.manifest);
    }
    await record.save();
    if (!result.ok) await store.remove(record);
    return { backup: withScope(record.toObject()), verification: result };
  } finally {
    await chunks().deleteMany({ upload: id });
    await uploads().deleteOne({ _id: id });
  }
}

// ---------------------------------------------------------------- restore

/** The name a restored copy of a Cloudinary document gets - beside the original, never over it. */
function restoredPublicId(file, token) {
  const base = String(file.meta.publicId || file.key || 'document')
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/[^A-Za-z0-9_\-./]/g, '_');
  const ext = path.posix.extname(base) || (file.contentType === 'application/pdf' ? '.pdf' : '');
  const stem = path.posix.extname(base) ? base.slice(0, -ext.length) : base;
  return `${stem}-restored-${token}${ext}`;
}

const notWritable = err => ['EROFS', 'EACCES', 'EPERM'].includes(err?.code);

/**
 * Replaces the database's business collections and the stored files with the backup's. `confirm`
 * must be "RESTORE". `hooks` are for tests only (failure injection) - never reachable from the API.
 */
async function restoreBackup({ backupId, confirm, userId, hooks = {} }) {
  if (confirm !== 'RESTORE') throw new ApiError('Type RESTORE to confirm replacing all current data with this backup.', 400);
  const backup = await getUsable(backupId);
  const database = db();
  await assertIdle();

  const log = await RestoreLog.create({ backup: backup._id, startedBy: userId, scope: backup.scope });
  const token = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const staging = name => `${store.STAGING_PREFIX}${token}_${name}`;
  const parked = name => `${store.OLD_PREFIX}${token}_${name}`;
  const staged = [];
  const root = uploadsDir();
  const localStage = path.join(root, `.rsrestore-${token}`);
  const localOld = path.join(root, `.rsold-${token}`);
  let tmpDir = null;
  const counts = { total: 0, gridfs: 0, cloudinaryRestored: 0, cloudinaryUnchanged: 0, localRestored: 0, localUnchanged: 0 };
  const warnings = [];
  const cloudinaryUploads = []; // new assets this restore created (removed again if it fails)
  const cloudinaryKeys = new Set(); // documents that will resolve after the restore
  const gridfsIds = new Set();
  const localPlan = []; // { staged, target, parkedAt, done }
  let gridfsStaged = false;
  const fail = async (status, err) => {
    await RestoreLog.updateOne({ _id: log._id }, { $set: { status, error: String(err.message || err).slice(0, 2000), files: counts, warnings, completedAt: new Date() } });
  };

  const stageGridfsBucket = async () => {
    if (gridfsStaged) return;
    gridfsStaged = true;
    for (const [name, indexes] of [
      [`${GRIDFS_BUCKET}.files`, [{ key: { filename: 1, uploadDate: 1 }, name: 'filename_1_uploadDate_1' }]],
      [`${GRIDFS_BUCKET}.chunks`, [{ key: { files_id: 1, n: 1 }, name: 'files_id_1_n_1', unique: true }]],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await database
        .collection(staging(name))
        .drop()
        .catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await database.createCollection(staging(name));
      // eslint-disable-next-line no-await-in-loop
      await database.collection(staging(name)).createIndexes(indexes);
      staged.push({ name, indexes });
    }
  };

  try {
    // 1. The file, again, right before using it.
    const check = await verifyStored(backup);
    if (!check.ok) throw new ApiError(`The backup failed verification: ${check.problems.join('; ')}`, 400);
    const scope = check.scope;
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rsv-restore-'));

    // 2. The way back: a verified full backup of the data and files about to be replaced. A stored file
    // that is already unreadable (the reason for many restores) cannot be in it - and cannot be lost by
    // the restore either, which never deletes or overwrites a stored document - so it is listed and the
    // recovery backup is marked partial instead of blocking the restore.
    const recovery = await createBackup({ kind: 'pre-restore', scope: 'full', userId, skipIdleCheck: true, allowMissing: true });
    if (recovery.fileFailures?.length)
      warnings.push(
        `${recovery.fileFailures.length} stored file(s) were already unreadable before this restore and are not in the recovery backup: ${recovery.fileFailures
          .slice(0, 5)
          .map(f => `${f.name || f.key}${f.refs?.length ? ` (${f.refs.join(', ')})` : ''}`)
          .join('; ')}`
      );
    await RestoreLog.updateOne({ _id: log._id }, { $set: { recoveryBackup: recovery._id } });

    // 3. Stage every collection and every file, checking each.
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
        if (!store.isBusinessCollection(name) || FILE_COLLECTIONS.has(name)) throw new Error(`The backup contains a reserved collection "${name}".`);
        current = name;
        await database
          .collection(staging(name))
          .drop()
          .catch(() => {});
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

      onFileStart: async file => {
        counts.total += 1;
        if (file.source === 'gridfs') {
          await stageGridfsBucket();
          const fileDoc = file.meta.fileDoc;
          if (!fileDoc?._id || !fileDoc.chunkSize) throw new Error(`Attachment "${file.name}" has no file record in the backup.`);
          file.ctx = { fileDoc, chunkSize: Number(fileDoc.chunkSize), n: 0, pending: Buffer.alloc(0) };
        } else if (file.source === 'cloudinary' || file.source === 'local') {
          const tmp = path.join(tmpDir, String(file.n));
          file.ctx = { tmp, out: fs.createWriteStream(tmp) };
        } else {
          throw new Error(`The backup contains a file from an unknown storage "${file.source}".`);
        }
      },
      onFileData: async (file, buf) => {
        const { ctx } = file;
        if (file.source === 'gridfs') {
          ctx.pending = ctx.pending.length ? Buffer.concat([ctx.pending, buf]) : buf;
          while (ctx.pending.length >= ctx.chunkSize) {
            // eslint-disable-next-line no-await-in-loop
            await database
              .collection(staging(`${GRIDFS_BUCKET}.chunks`))
              .insertOne({ files_id: ctx.fileDoc._id, n: ctx.n, data: new mongoose.mongo.Binary(Buffer.from(ctx.pending.subarray(0, ctx.chunkSize))) });
            ctx.n += 1;
            ctx.pending = ctx.pending.subarray(ctx.chunkSize);
          }
        } else if (!ctx.out.write(buf)) {
          await new Promise(resolve => ctx.out.once('drain', resolve));
        }
      },
      onFileEnd: async (file, { size, sha256 }) => {
        const { ctx } = file;
        if (file.source === 'gridfs') {
          if (ctx.pending.length) {
            await database
              .collection(staging(`${GRIDFS_BUCKET}.chunks`))
              .insertOne({ files_id: ctx.fileDoc._id, n: ctx.n, data: new mongoose.mongo.Binary(Buffer.from(ctx.pending)) });
          }
          if (Number(ctx.fileDoc.length) !== size) throw new Error(`Attachment "${file.name}": ${size} bytes in the backup, ${Number(ctx.fileDoc.length)} recorded.`);
          await database.collection(staging(`${GRIDFS_BUCKET}.files`)).insertOne(ctx.fileDoc);
          // Read the staged copy back: it must be the backed-up bytes exactly.
          const stagedBucket = new mongoose.mongo.GridFSBucket(database, { bucketName: staging(GRIDFS_BUCKET) });
          const readBack = await sha256Of(stagedBucket.openDownloadStream(ctx.fileDoc._id));
          if (readBack !== sha256) throw new Error(`Attachment "${file.name}" did not stage correctly.`);
          gridfsIds.add(String(ctx.fileDoc._id));
          counts.gridfs += 1;
          return;
        }
        ctx.out.end();
        await new Promise((resolve, reject) => {
          ctx.out.once('close', resolve);
          ctx.out.once('error', reject);
        });

        if (file.source === 'cloudinary') {
          // Already there with the same content (the usual case): nothing to write.
          let currentSha = null;
          try {
            currentSha = await sha256Of((await cloudinaryFiles.openRead({ url: file.meta.url, publicId: file.meta.publicId })).stream);
          } catch {
            currentSha = null;
          }
          if (currentSha === sha256) {
            cloudinaryKeys.add(file.key);
            counts.cloudinaryUnchanged += 1;
          } else {
            // Missing or different: put the backed-up bytes back as a new asset and point the staged
            // records at it. The asset currently there (if any) is left alone.
            if (!cloudinaryFiles.isConfigured())
              throw new Error(`Document "${file.name}" is missing from Cloudinary (or differs from the backup) and cannot be put back because CLOUDINARY_URL is not configured.`);
            const uploaded = await cloudinaryFiles.upload(fs.createReadStream(ctx.tmp), { publicId: restoredPublicId(file, token) });
            cloudinaryUploads.push(uploaded.publicId);
            const readBack = await sha256Of((await cloudinaryFiles.openRead(uploaded)).stream);
            if (readBack !== sha256) throw new Error(`The restored copy of "${file.name}" on Cloudinary does not match the backup.`);
            for (const ref of file.refs) {
              // eslint-disable-next-line no-await-in-loop
              const res = await database
                .collection(staging(ref.collection))
                .updateOne({ _id: new mongoose.Types.ObjectId(ref.id) }, { $set: { [`${ref.path}.url`]: uploaded.url, [`${ref.path}.publicId`]: uploaded.publicId } });
              if (!res.matchedCount) throw new Error(`Document "${file.name}" belongs to ${ref.label || ref.collection}, which is not in the backup.`);
            }
            cloudinaryKeys.add(uploaded.publicId);
            counts.cloudinaryRestored += 1;
          }
        } else {
          const target = localPath(root, file.key);
          let currentSha = null;
          try {
            currentSha = await sha256Of(fs.createReadStream(target));
          } catch {
            currentSha = null;
          }
          if (currentSha === sha256) {
            counts.localUnchanged += 1;
          } else {
            const stagedPath = localPath(localStage, file.key);
            try {
              await fsp.mkdir(path.dirname(stagedPath), { recursive: true });
              await pipeline(fs.createReadStream(ctx.tmp), fs.createWriteStream(stagedPath));
            } catch (err) {
              if (notWritable(err))
                throw new Error(
                  `The server's uploads folder is not writable, so "${file.key}" cannot be put back. Restore this backup on a server with a writable uploads folder, or use a database-only backup.`
                );
              throw err;
            }
            if ((await sha256Of(fs.createReadStream(stagedPath))) !== sha256) throw new Error(`Image "${file.key}" did not stage correctly.`);
            localPlan.push({ key: file.key, staged: stagedPath, target, existed: currentSha !== null });
          }
        }
        await fsp.rm(ctx.tmp, { force: true });
      },
    });
    if (!loaded.ok) throw new ApiError(`The backup could not be loaded: ${loaded.problems.join('; ')}`, 400);
    if (hooks.afterFilesStaged) await hooks.afterFilesStaged();

    // 3b. Every reference in the staged records must resolve - no attachment or document without its file.
    const stagedNames = new Set(staged.map(s => s.name));
    if (stagedNames.has('attachments')) {
      const missing = [];
      // eslint-disable-next-line no-restricted-syntax
      for await (const a of database.collection(staging('attachments')).find({}, { projection: { file: 1, originalName: 1, ownerType: 1, owner: 1 } })) {
        if (!gridfsIds.has(String(a.file))) missing.push(`${a.originalName} (${a.ownerType} ${a.owner})`);
      }
      if (missing.length) throw new Error(`${missing.length} attachment record(s) in the backup have no file: ${missing.slice(0, 5).join(', ')}`);
    }
    if (scope === 'full' || scope === 'partial') {
      // A partial backup's missing files were already unreadable when it was taken: their references
      // stay as they were (reported), everything else must resolve.
      const known = new Set((check.manifest.files?.missing || []).filter(f => f.source === 'cloudinary').map(f => f.key));
      const stagedDb = { collection: name => database.collection(stagedNames.has(name) ? staging(name) : `${store.STAGING_PREFIX}${token}_absent_${name}`) };
      const refs = await cloudinaryRefs(stagedDb);
      const stillMissing = refs.filter(f => !cloudinaryKeys.has(f.key) && known.has(f.key));
      if (stillMissing.length)
        warnings.push(
          `${stillMissing.length} document(s) were already missing when this backup was taken and could not be restored: ${stillMissing
            .slice(0, 5)
            .map(f => f.refs.map(r => r.label).join(', '))
            .join('; ')}`
        );
      const broken = refs.filter(f => !cloudinaryKeys.has(f.key) && !known.has(f.key));
      if (broken.length)
        throw new Error(
          `${broken.length} document reference(s) in the backup have no file: ${broken
            .slice(0, 5)
            .map(f => f.refs.map(r => r.label).join(', '))
            .join('; ')}`
        );
    } else {
      warnings.push(
        'This backup holds database records only: Cloudinary documents and server images were not part of it and were not restored. Documents of customers, vendors and projects work only if their files still exist in storage.'
      );
    }

    // 4. Swap. Every current business collection is parked (so collections the backup does not have
    // are gone after the restore, as in the backup), then the staged ones take their names; then the
    // staged images move into place (an image they replace is parked beside them).
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
      for (const item of localPlan) {
        if (item.existed) {
          item.parkedAt = localPath(localOld, item.key);
          // eslint-disable-next-line no-await-in-loop
          await fsp.mkdir(path.dirname(item.parkedAt), { recursive: true });
          // eslint-disable-next-line no-await-in-loop
          await fsp.rename(item.target, item.parkedAt);
        }
        // eslint-disable-next-line no-await-in-loop
        await fsp.mkdir(path.dirname(item.target), { recursive: true });
        // eslint-disable-next-line no-await-in-loop
        await fsp.rename(item.staged, item.target);
        item.done = true;
      }
      if (hooks.afterSwap) await hooks.afterSwap();

      // The restored system, checked where it now lives: every attachment's file is in the bucket,
      // every restored image is in place.
      const liveFiles = gridfsStaged ? await database.collection(`${GRIDFS_BUCKET}.files`).countDocuments() : 0;
      if (liveFiles !== counts.gridfs) throw new Error(`${liveFiles} of ${counts.gridfs} attachments are in place after the swap.`);
      if (swappedIn.includes('attachments')) {
        const orphans = await database
          .collection('attachments')
          .aggregate([{ $lookup: { from: `${GRIDFS_BUCKET}.files`, localField: 'file', foreignField: '_id', as: 'f' } }, { $match: { f: { $size: 0 } } }, { $count: 'n' }])
          .toArray();
        if (orphans[0]?.n) throw new Error(`${orphans[0].n} attachments have no file after the swap.`);
      }
      for (const item of localPlan) {
        // eslint-disable-next-line no-await-in-loop
        await fsp.access(item.target);
      }
    } catch (swapErr) {
      // Roll back to the data and files as they were.
      for (const item of [...localPlan].reverse()) {
        // eslint-disable-next-line no-await-in-loop
        if (item.done) await fsp.rm(item.target, { force: true }).catch(() => {});
        // eslint-disable-next-line no-await-in-loop
        if (item.parkedAt) await fsp.rename(item.parkedAt, item.target).catch(() => {});
      }
      for (const name of swappedIn) {
        // eslint-disable-next-line no-await-in-loop
        await database
          .collection(name)
          .drop()
          .catch(() => {});
      }
      for (const name of parkedNames) {
        // eslint-disable-next-line no-await-in-loop
        await database.renameCollection(parked(name), name);
      }
      throw Object.assign(swapErr, { rolledBack: true });
    }

    // 5. The replaced data and images are no longer needed (the recovery backup holds them).
    for (const name of parkedNames) {
      // eslint-disable-next-line no-await-in-loop
      await database
        .collection(parked(name))
        .drop()
        .catch(() => {});
    }
    await fsp.rm(localOld, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(localStage, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    counts.localRestored = localPlan.length;
    await RestoreLog.updateOne({ _id: log._id }, { $set: { status: 'completed', scope, collections: staged.length, documents, files: counts, warnings, completedAt: new Date() } });
    console.log(`[Backup] Restore completed from ${backup.fileName} (${staged.length} collections, ${documents} documents, ${counts.total} files).`);
    return RestoreLog.findById(log._id).lean();
  } catch (err) {
    // Nothing staged survives a failed restore; the current data and files were never touched (or were put back).
    for (const { name } of staged) {
      // eslint-disable-next-line no-await-in-loop
      await database
        .collection(staging(name))
        .drop()
        .catch(() => {});
    }
    for (const publicId of cloudinaryUploads) {
      // eslint-disable-next-line no-await-in-loop
      await cloudinaryFiles.destroy(publicId).catch(e => warnings.push(`The restored copy ${publicId} could not be removed from Cloudinary: ${e.message}`));
    }
    // The parked-images folder is left as it is: after a rollback it is empty, and if an image could
    // not be moved back it is still there.
    await fsp.rm(localStage, { recursive: true, force: true }).catch(() => {});
    if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await fail(err.rolledBack || staged.length ? 'rolled_back' : 'failed', err);
    console.error(`[Backup] Restore failed and was rolled back: ${err.message}`);
    throw err instanceof ApiError ? err : new ApiError(`The restore failed and was rolled back - the current data and files are unchanged. ${err.message}`, 500);
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
