'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');
const cloudinaryFiles = require('../services/files/cloudinaryFiles');
const { contentTypeFor } = require('../utils/contentDisposition');

// Every stored file a full backup carries, by where the application keeps it. A backup includes
// the files' actual bytes - never only their URLs or storage keys.
//
//   gridfs      PDF attachments of purchase orders, sales orders and journal entries - the
//               `attachmentfiles` GridFS bucket in this database (services/files/attachmentService.js).
//               In the database, so even a database-only backup includes them.
//   cloudinary  Customer and vendor business documents (users / vendors `documents[]`) and project
//               contracts (projects `contract`) - Cloudinary raw assets, found through the records
//               that reference them, and downloaded.
//   local       Images saved on the server's disk under backend/uploads (product, category, brand,
//               warehouse, user and logo images). Excluded: uploads/import (temporary spreadsheets
//               an import reads once).
//
// Not included because nothing is stored: report exports (Excel/PDF/CSV) are generated on request.
// Backup files themselves (the `backupfiles` bucket) are never inside another backup.

const GRIDFS_BUCKET = 'attachmentfiles';
// Collections written as files (with per-file checksums), not as ordinary documents.
const FILE_COLLECTIONS = new Set([`${GRIDFS_BUCKET}.files`, `${GRIDFS_BUCKET}.chunks`]);
const LOCAL_EXCLUDED_DIRS = new Set(['import']);
const LOCAL_WORK_PREFIXES = ['.rsrestore-', '.rsold-'];

const uploadsDir = () => path.resolve(process.env.BACKUP_UPLOADS_DIR || path.resolve(__dirname, '../../uploads'));

// ---------------------------------------------------------------- gridfs

async function* gridfsFiles(db) {
  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: GRIDFS_BUCKET });
  const owners = new Map();
  // eslint-disable-next-line no-restricted-syntax
  for await (const a of db.collection('attachments').find({}, { projection: { file: 1, ownerType: 1, owner: 1, originalName: 1 } })) {
    owners.set(String(a.file), { collection: 'attachments', id: String(a._id), label: `${a.ownerType} ${a.owner}` });
  }
  // eslint-disable-next-line no-restricted-syntax
  for await (const file of db.collection(`${GRIDFS_BUCKET}.files`).find({}).sort({ _id: 1 })) {
    const ref = owners.get(String(file._id));
    yield {
      source: 'gridfs',
      key: String(file._id),
      name: file.metadata?.originalName || file.filename,
      contentType: file.contentType || 'application/pdf',
      size: file.length,
      refs: ref ? [ref] : [],
      meta: { fileDoc: file },
      open: async () => ({ stream: bucket.openDownloadStream(file._id) }),
    };
  }
}

// ---------------------------------------------------------------- cloudinary

/** Every Cloudinary-stored document, with every record field that references it. */
async function cloudinaryRefs(db) {
  const files = new Map();
  const add = (doc, ref) => {
    if (!doc?.url && !doc?.publicId) return;
    const key = doc.publicId || doc.url;
    if (!files.has(key))
      files.set(key, {
        key,
        url: doc.url,
        publicId: doc.publicId || null,
        name: doc.filename || path.basename(String(doc.publicId || doc.url)),
        contentType: doc.mimeType || 'application/pdf',
        refs: [],
      });
    files.get(key).refs.push(ref);
  };
  for (const [collection, label] of [
    ['users', 'Customer'],
    ['vendors', 'Vendor'],
  ]) {
    // eslint-disable-next-line no-restricted-syntax, no-await-in-loop
    for await (const rec of db.collection(collection).find({ 'documents.0': { $exists: true } }, { projection: { documents: 1, name: 1 } })) {
      (rec.documents || []).forEach((doc, i) =>
        add(doc, { collection, id: String(rec._id), path: `documents.${i}`, label: `${label} ${rec.name || rec._id} - ${doc.documentType}` })
      );
    }
  }
  // eslint-disable-next-line no-restricted-syntax
  for await (const rec of db.collection('projects').find({ contract: { $type: 'object' } }, { projection: { contract: 1, projectNumber: 1 } })) {
    add(rec.contract, { collection: 'projects', id: String(rec._id), path: 'contract', label: `Project ${rec.projectNumber || rec._id} - contract` });
  }
  return [...files.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

async function* cloudinaryFilesOf(db) {
  for (const f of await cloudinaryRefs(db)) {
    yield {
      source: 'cloudinary',
      key: f.key,
      name: f.name,
      contentType: f.contentType,
      size: null,
      refs: f.refs,
      meta: { url: f.url, publicId: f.publicId },
      open: () => cloudinaryFiles.openRead({ url: f.url, publicId: f.publicId }),
    };
  }
}

// ---------------------------------------------------------------- local disk

async function* walk(root, rel = '') {
  let entries;
  try {
    entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!rel && LOCAL_EXCLUDED_DIRS.has(entry.name)) continue;
      if (LOCAL_WORK_PREFIXES.some(p => entry.name.startsWith(p))) continue;
      yield* walk(root, childRel);
    } else if (entry.isFile()) {
      yield childRel;
    }
  }
}

async function* localFiles() {
  const root = uploadsDir();
  // eslint-disable-next-line no-restricted-syntax
  for await (const rel of walk(root)) {
    const full = path.join(root, rel);
    // eslint-disable-next-line no-await-in-loop
    const stat = await fsp.stat(full);
    yield {
      source: 'local',
      key: rel,
      name: path.basename(rel),
      contentType: contentTypeFor(rel),
      size: stat.size,
      refs: [],
      meta: {},
      open: async () => ({ stream: fs.createReadStream(full) }),
    };
  }
}

/** Where a restored local file goes (inside the uploads directory - never outside it). */
function localPath(root, key) {
  const normalized = path.posix.normalize(String(key));
  if (!normalized || normalized.startsWith('..') || path.posix.isAbsolute(normalized) || normalized.split('/').some(p => p === '..' || !p))
    throw new Error(`Invalid file path "${key}" in the backup.`);
  const full = path.resolve(root, ...normalized.split('/'));
  if (!full.startsWith(root + path.sep)) throw new Error(`Invalid file path "${key}" in the backup.`);
  return full;
}

/**
 * The files of a backup: `scope` "full" = every source; "database" = the files stored inside the
 * database only (attachments), without Cloudinary documents and server-disk images.
 */
async function* filesFor(db, scope = 'full') {
  yield* gridfsFiles(db);
  if (scope !== 'full') return;
  yield* cloudinaryFilesOf(db);
  yield* localFiles();
}

module.exports = { filesFor, cloudinaryRefs, localPath, uploadsDir, GRIDFS_BUCKET, FILE_COLLECTIONS, LOCAL_WORK_PREFIXES };
