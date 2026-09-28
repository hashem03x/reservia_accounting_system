'use strict';

const path = require('path');
const fsp = require('fs').promises;
const mongoose = require('mongoose');

// Resolve EJSON from the same bson version Mongoose uses (avoids bson version mismatch)
const mongoosePkgDir = path.dirname(require.resolve('mongoose/package.json'));
const { EJSON } = require(require.resolve('bson', { paths: [path.join(mongoosePkgDir, 'node_modules')] }));

/**
 * Exports all non-system collections to individual JSON files inside tmpDir.
 * Each file is a JSON array of documents serialised with MongoDB Extended JSON (relaxed).
 *
 * @param {string} tmpDir - absolute path to the temp directory
 * @returns {Promise<{ stats: Array<{ collection: string, file: string, documentCount: number }>, metadata: Object }>}
 */
async function exportAllCollections(tmpDir) {
  const conn = mongoose.connection;
  if (conn.readyState !== 1 || !conn.db) {
    throw new Error('MongoDB is not connected. Cannot export collections.');
  }

  const db = conn.db;
  const collectionsInfo = await db.listCollections().toArray();
  const sorted = [...collectionsInfo].sort((a, b) => a.name.localeCompare(b.name));

  const exportedAt = new Date().toISOString();
  const stats = [];

  for (const info of sorted) {
    const collName = info.name;
    if (collName.startsWith('system.')) continue;

    const docs = await db.collection(collName).find({}).toArray();
    const json = EJSON.stringify(docs, { relaxed: true });

    const fileName = `${_sanitizeName(collName)}.json`;
    await fsp.writeFile(path.join(tmpDir, fileName), json, 'utf8');

    console.log(`[Backup] Exported ${collName} (${docs.length} docs)`);
    stats.push({
      collection: collName,
      file: fileName,
      documentCount: docs.length,
      type: info.type || 'collection',
    });
  }

  const totalDocuments = stats.reduce((sum, s) => sum + s.documentCount, 0);

  const metadata = {
    exportedAt,
    database: db.databaseName,
    host: conn.host,
    port: conn.port,
    collectionCount: stats.length,
    totalDocuments,
    format: 'mongodb-extended-json-relaxed',
    note: 'Each *.json file is a JSON array of documents. Compatible with mongoimport --jsonArray and MongoDB Compass import.',
    versions: {
      node: process.version,
      mongoose: require('mongoose/package.json').version,
    },
    collections: stats,
  };

  await fsp.writeFile(
    path.join(tmpDir, '_metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf8',
  );

  console.log(`[Backup] Metadata written (_metadata.json)`);

  return stats;
}

/** Strips characters unsafe in filenames. */
function _sanitizeName(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

module.exports = { exportAllCollections };
