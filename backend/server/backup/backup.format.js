'use strict';

const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const readline = require('readline');
const { once } = require('events');
const { finished } = require('stream/promises');

// Resolve EJSON from the same bson version Mongoose uses (avoids a bson version mismatch).
const mongoosePkgDir = path.dirname(require.resolve('mongoose/package.json'));
const { EJSON } = require(require.resolve('bson', { paths: [path.join(mongoosePkgDir, 'node_modules')] }));

// The Reservia backup file (.rsvbak): a gzip-compressed stream of JSON lines -
//
//   {"t":"header","format":"reservia-backup","formatVersion":1,"appVersion":"…","createdAt":"…"}
//   {"t":"collection","name":"journalentries","indexes":[…]}          one per collection, then
//   {"t":"d","c":"journalentries","d":{…canonical Extended JSON…}}     one line per document
//   {"t":"end","name":"journalentries","count":123,"sha256":"…"}       count + hash of its d-lines
//   {"t":"manifest","collections":[{name,count,sha256}],"totalDocuments":…}    last line
//
// Canonical Extended JSON keeps every BSON type exactly (ObjectId, Date, Decimal128, Int32 vs
// Double, Long), so a restored document is the same document. Written and read as streams -
// a collection is never loaded into memory whole. Readable with any gzip + JSON-lines tool.

const FORMAT = 'reservia-backup';
const FORMAT_VERSION = 1;
// Collections a restore needs to make sense of the rest (a file without them is not a backup of
// this application).
const REQUIRED_COLLECTIONS = ['chartofaccounts', 'journalentries', 'users'];

let APP_VERSION = '0.0.0';
try {
  // eslint-disable-next-line global-require
  APP_VERSION = require('../../package.json').version || APP_VERSION;
} catch {
  // package.json not bundled - the version stays unknown, the format version still applies.
}

const indexSpec = ({ v, ns, ...spec }) => spec; // eslint-disable-line no-unused-vars

/**
 * Writes a full backup of every collection `include(name)` admits to `out` (a writable stream).
 * Resolves with { manifest, sizeBytes, sha256 } of the compressed file once `out` has finished.
 */
async function writeBackup(db, out, { include, onCollection } = {}) {
  const gzip = zlib.createGzip({ level: 6 });
  const fileHash = crypto.createHash('sha256');
  let sizeBytes = 0;
  gzip.on('data', chunk => {
    fileHash.update(chunk);
    sizeBytes += chunk.length;
  });
  gzip.pipe(out);
  const done = finished(out);
  const write = async line => {
    if (!gzip.write(`${line}\n`)) await once(gzip, 'drain');
  };

  const createdAt = new Date().toISOString();
  await write(JSON.stringify({ t: 'header', format: FORMAT, formatVersion: FORMAT_VERSION, appVersion: APP_VERSION, createdAt }));
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .filter(c => (c.type || 'collection') === 'collection')
    .map(c => c.name)
    .filter(name => !include || include(name))
    .sort();

  const collections = [];
  for (const name of names) {
    const coll = db.collection(name);
    // eslint-disable-next-line no-await-in-loop
    const indexes = (await coll.listIndexes().toArray()).filter(i => i.name !== '_id_').map(indexSpec);
    // eslint-disable-next-line no-await-in-loop
    await write(JSON.stringify({ t: 'collection', name, indexes }));
    const hash = crypto.createHash('sha256');
    let count = 0;
    // eslint-disable-next-line no-restricted-syntax, no-await-in-loop
    for await (const doc of coll.find({}, { batchSize: 500 })) {
      const line = `{"t":"d","c":${JSON.stringify(name)},"d":${EJSON.stringify(doc, { relaxed: false })}}`;
      hash.update(line);
      count += 1;
      // eslint-disable-next-line no-await-in-loop
      await write(line);
    }
    const entry = { name, count, sha256: hash.digest('hex') };
    collections.push(entry);
    // eslint-disable-next-line no-await-in-loop
    await write(JSON.stringify({ t: 'end', ...entry }));
    if (onCollection) onCollection(entry);
  }

  const manifest = { format: FORMAT, formatVersion: FORMAT_VERSION, appVersion: APP_VERSION, createdAt, totalDocuments: collections.reduce((s, c) => s + c.count, 0), collections };
  await write(JSON.stringify({ t: 'manifest', ...manifest }));
  gzip.end();
  await done;
  return { manifest, sizeBytes, sha256: fileHash.digest('hex') };
}

/** The lines of a backup file, as { raw, record } in file order (gunzipped, streamed). */
async function* readLines(input) {
  const gunzip = zlib.createGunzip();
  input.on('error', err => gunzip.destroy(err));
  const rl = readline.createInterface({ input: input.pipe(gunzip), crlfDelay: Infinity });
  // eslint-disable-next-line no-restricted-syntax
  for await (const raw of rl) {
    if (!raw) continue;
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      throw new Error('The backup file contains a damaged line.');
    }
    yield { raw, record };
  }
}

/**
 * Reads a whole backup file and checks it: format and version, every collection's document count
 * and SHA-256 against its own end-marker and the trailing manifest, and the required collections.
 * Never throws for a bad file - returns { ok: false, problems } instead. `onDocument(name, doc)`
 * (optional) receives every document, deserialized, as it is read (the restore loader).
 */
async function verifyBackup(input, { onCollectionStart, onDocument, onCollectionEnd } = {}) {
  const problems = [];
  let header = null;
  let manifest = null;
  let current = null;
  const seen = [];
  try {
    // eslint-disable-next-line no-restricted-syntax
    for await (const { raw, record } of readLines(input)) {
      if (!header) {
        if (record.t !== 'header' || record.format !== FORMAT) throw new Error('This is not a Reservia backup file.');
        if (!Number.isInteger(record.formatVersion) || record.formatVersion > FORMAT_VERSION) throw new Error(`This backup uses format version ${record.formatVersion}, which this version of Reservia cannot read.`);
        header = record;
        continue;
      }
      if (manifest) throw new Error('The backup file has data after its manifest.');
      if (record.t === 'collection') {
        if (current) throw new Error(`Collection "${current.name}" is not closed in the backup file.`);
        current = { name: record.name, indexes: record.indexes || [], count: 0, hash: crypto.createHash('sha256') };
        if (onCollectionStart) await onCollectionStart(current.name, current.indexes);
      } else if (record.t === 'd') {
        if (!current || record.c !== current.name) throw new Error('A document in the backup file is outside its collection.');
        current.hash.update(raw);
        current.count += 1;
        if (onDocument) await onDocument(current.name, EJSON.deserialize(record.d, { relaxed: false }));
      } else if (record.t === 'end') {
        if (!current || record.name !== current.name) throw new Error('The backup file has an unexpected collection end.');
        const sha256 = current.hash.digest('hex');
        if (record.count !== current.count) problems.push(`${current.name}: ${current.count} documents read, ${record.count} expected`);
        if (record.sha256 !== sha256) problems.push(`${current.name}: content does not match its checksum`);
        seen.push({ name: current.name, count: current.count, sha256 });
        if (onCollectionEnd) await onCollectionEnd(current.name, current.count);
        current = null;
      } else if (record.t === 'manifest') {
        manifest = record;
      } else {
        throw new Error(`Unknown record "${record.t}" in the backup file.`);
      }
    }
  } catch (err) {
    problems.push(/incorrect header|unexpected end|invalid|Z_|zlib/i.test(String(err.code || err.message)) ? 'The file is not a valid backup (damaged or not gzip-compressed).' : err.message);
    return { ok: false, header, manifest: null, problems };
  }
  if (!header) problems.push('The file is empty.');
  if (current) problems.push(`Collection "${current.name}" is incomplete - the file was cut short.`);
  if (header && !manifest) problems.push('The backup file has no manifest - it was cut short.');
  if (manifest) {
    const listed = new Map((manifest.collections || []).map(c => [c.name, c]));
    for (const c of seen) {
      const m = listed.get(c.name);
      if (!m) problems.push(`${c.name}: not listed in the manifest`);
      else if (m.count !== c.count || m.sha256 !== c.sha256) problems.push(`${c.name}: does not match the manifest`);
    }
    if (listed.size !== seen.length) problems.push('The manifest lists collections the file does not contain.');
    for (const name of REQUIRED_COLLECTIONS) if (!listed.has(name)) problems.push(`Required collection "${name}" is missing.`);
  }
  return { ok: problems.length === 0, header, manifest, problems };
}

module.exports = { writeBackup, verifyBackup, readLines, FORMAT, FORMAT_VERSION, REQUIRED_COLLECTIONS, APP_VERSION };
