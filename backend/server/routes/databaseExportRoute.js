const path = require('path');
const express = require('express');
const archiver = require('archiver');
const mongoose = require('mongoose');

// Mongoose uses mongodb@5 / bson@5; direct mongodb@6 hoists bson@6 at the repo root.
// EJSON must match the BSON types returned by the driver's find().toArray().
const mongoosePkgDir = path.dirname(require.resolve('mongoose/package.json'));
const { EJSON } = require(require.resolve('bson', { paths: [path.join(mongoosePkgDir, 'node_modules')] }));

const asyncHandler = require('express-async-handler');

const authController = require('../controller/user/authController');
const { checkUserPermissions } = require('../middleware/hasPermission');
const { Resources, Actions } = require('../utils/appConstant');

const router = express.Router();

/** Safe entry path inside the ZIP (Windows + zip rules). */
function sanitizeZipEntryName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

function uniqueFilename(base, used) {
  let candidate = `${base}.json`;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${n}.json`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

/**
 * GET /
 * Streams a ZIP of one JSON array file per collection (MongoDB Extended JSON, relaxed).
 * Admin-only.
 */
const downloadDatabaseExport = asyncHandler(async (req, res, next) => {
  const conn = mongoose.connection;
  if (conn.readyState !== 1 || !conn.db) {
    return res.status(503).json({
      success: false,
      message: 'Database is not connected yet. Try again in a moment.',
    });
  }

  const db = conn.db;
  const collectionsInfo = await db.listCollections().toArray();

  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', err => {
    if (res.headersSent) {
      res.destroy(err);
    } else {
      next(err);
    }
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const zipFilename = `database-export-${stamp}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

  archive.pipe(res);

  const collectionStats = [];
  let totalDocuments = 0;
  const usedFilenames = new Set();

  const sorted = [...collectionsInfo].sort((a, b) => a.name.localeCompare(b.name));

  for (const info of sorted) {
    const collName = info.name;
    if (collName.startsWith('system.')) continue;

    const safeBase = sanitizeZipEntryName(collName);
    const entryName = uniqueFilename(safeBase, usedFilenames);

    const docs = await db.collection(collName).find({}).toArray();
    totalDocuments += docs.length;

    const json = EJSON.stringify(docs, { relaxed: true });
    archive.append(Buffer.from(json, 'utf8'), { name: entryName });

    collectionStats.push({
      collection: collName,
      file: entryName,
      documentCount: docs.length,
      type: info.type || 'collection',
    });
  }

  const metadata = {
    exportedAt: new Date().toISOString(),
    database: db.databaseName,
    collectionCount: collectionStats.length,
    totalDocuments,
    collections: collectionStats,
    format: 'mongodb-extended-json-relaxed-json-array-per-file',
    note: 'Each *.json file is a JSON array of documents. Suitable for mongoimport --jsonArray or Compass import.',
    version: 1,
  };

  archive.append(Buffer.from(JSON.stringify(metadata, null, 2), 'utf8'), { name: '_metadata.json' });

  await archive.finalize();
});

router.use(authController.protect);

router.get('/', checkUserPermissions({ resource: Resources.databaseExport, action: Actions.read }), downloadDatabaseExport);

module.exports = router;
