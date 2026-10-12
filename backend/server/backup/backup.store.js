'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');

// Where backup files are kept. Never public / frontend storage - every read goes through the
// admin-only backup routes.
//
//   gridfs      (default on Vercel) - in this database's `backupfiles` GridFS bucket. Works on a
//               serverless deployment (no writable disk). Protects against mistakes and bad data,
//               not against losing the database itself - keep downloaded copies off-site.
//   filesystem  (default elsewhere) - in BACKUP_DIR (default backend/backups, git-ignored). On
//               Docker, mount it as a volume so backups survive a redeploy.
//
// BACKUP_STORAGE=gridfs|filesystem overrides the default.

const BUCKET = 'backupfiles';
const DEFAULT_DIR = path.resolve(__dirname, '../../backups');

const mode = () => {
  const configured = String(process.env.BACKUP_STORAGE || '').toLowerCase();
  if (configured === 'gridfs' || configured === 'filesystem') return configured;
  return process.env.VERCEL ? 'gridfs' : 'filesystem';
};
const dir = () => path.resolve(process.env.BACKUP_DIR || DEFAULT_DIR);
const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET });
const safeName = name => {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('Invalid backup file name.');
  return name;
};

/** { storage, stream, ref() } - write the file to `stream`; `ref()` (after it finished) locates it. */
async function openWrite(fileName) {
  const storage = mode();
  if (storage === 'gridfs') {
    const stream = bucket().openUploadStream(safeName(fileName), { contentType: 'application/gzip' });
    return { storage, stream, ref: () => String(stream.id) };
  }
  await fsp.mkdir(dir(), { recursive: true });
  const stream = fs.createWriteStream(path.join(dir(), safeName(fileName)), { flags: 'wx' });
  return { storage, stream, ref: () => fileName };
}

function openRead({ storage, fileRef }) {
  if (storage === 'gridfs') return bucket().openDownloadStream(new mongoose.Types.ObjectId(fileRef));
  const file = path.join(dir(), safeName(fileRef));
  if (!file.startsWith(dir() + path.sep)) throw new Error('Invalid backup path.');
  return fs.createReadStream(file);
}

async function remove({ storage, fileRef }) {
  if (!fileRef) return;
  try {
    if (storage === 'gridfs') await bucket().delete(new mongoose.Types.ObjectId(fileRef));
    else await fsp.rm(path.join(dir(), safeName(fileRef)), { force: true });
  } catch (err) {
    if (!/not found|ENOENT|FileNotFound/i.test(String(err.code || err.message))) throw err;
  }
}

// The collections that hold backup bookkeeping and files: never backed up, never replaced by a
// restore (a restore must not erase the history of backups and restores, or the files themselves).
const BOOKKEEPING = new Set(['backups', 'restorelogs', `${BUCKET}.files`, `${BUCKET}.chunks`, 'backupuploads', 'backupuploadchunks']);
const STAGING_PREFIX = '__rs_';
const OLD_PREFIX = '__old_';
const isBusinessCollection = name => !BOOKKEEPING.has(name) && !name.startsWith('system.') && !name.startsWith(STAGING_PREFIX) && !name.startsWith(OLD_PREFIX) && name !== '__txn_probe';

module.exports = { mode, openWrite, openRead, remove, isBusinessCollection, BOOKKEEPING, STAGING_PREFIX, OLD_PREFIX, BUCKET };
