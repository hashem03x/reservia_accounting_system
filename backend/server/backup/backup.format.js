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
//   {"t":"header","format":"reservia-backup","formatVersion":2,"scope":"full","appVersion":"…","createdAt":"…"}
//   {"t":"collection","name":"journalentries","indexes":[…]}          one per collection, then
//   {"t":"d","c":"journalentries","d":{…canonical Extended JSON…}}     one line per document
//   {"t":"end","name":"journalentries","count":123,"sha256":"…"}       count + hash of its d-lines
//   {"t":"file","n":1,"source":"cloudinary","key":"…","name":"…","contentType":"…","refs":[…],"meta":{…}}
//   {"t":"fd","n":1,"b":"<base64>"}                                   the file's bytes, in pieces
//   {"t":"fend","n":1,"size":1234,"sha256":"…"}                        size + hash of the real bytes
//   {"t":"manifest","collections":[…],"totalDocuments":…,"files":{count,totalBytes,sources,list}}   last line
//
// Canonical Extended JSON keeps every BSON type exactly (ObjectId, Date, Decimal128, Int32 vs
// Double, Long), so a restored document is the same document. Files are carried byte for byte with
// a SHA-256 each (backup.files.js lists what is included). Written and read as streams - neither a
// collection nor a file is ever loaded into memory whole. Readable with any gzip + JSON-lines tool.
//
// Version 1 files (before files were included) hold database records only; they are still read and
// restored, and reported as "database only".

const FORMAT = 'reservia-backup';
const FORMAT_VERSION = 2;
const FILE_PIECE_BYTES = 192 * 1024;
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

/** Files that could not be backed up - the backup is not valid without them. */
class FileBackupError extends Error {
  constructor(failures) {
    const shown = failures
      .slice(0, 10)
      .map(f => `[${f.source}] ${f.name || f.key}${f.refs?.length ? ` (${f.refs.map(r => r.label || `${r.collection} ${r.id}`).join(', ')})` : ''}: ${f.error}`);
    super(
      `${failures.length} stored file${failures.length === 1 ? '' : 's'} could not be backed up: ${shown.join('; ')}${failures.length > 10 ? `; and ${failures.length - 10} more` : ''}`
    );
    this.failures = failures;
  }
}

const emptySources = () => ({ gridfs: { count: 0, bytes: 0 }, cloudinary: { count: 0, bytes: 0 }, local: { count: 0, bytes: 0 } });

/**
 * Writes a backup of every collection `include(name)` admits and every file `files` (an async
 * iterable from backup.files.js) yields, to `out` (a writable stream). Resolves with
 * { manifest, sizeBytes, sha256 } of the compressed file once `out` has finished. Rejects with a
 * FileBackupError naming every file that could not be read - a backup missing a file is not valid.
 */
async function writeBackup(db, out, { include, files = null, scope = files ? 'full' : 'database', allowMissing = false, onCollection } = {}) {
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
  await write(JSON.stringify({ t: 'header', format: FORMAT, formatVersion: FORMAT_VERSION, scope, appVersion: APP_VERSION, createdAt }));
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .filter(c => (c.type || 'collection') === 'collection')
    .map(c => c.name)
    .filter(name => !include || include(name))
    .sort();

  const collections = [];
  let databaseBytes = 0;
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
      databaseBytes += Buffer.byteLength(line);
      // eslint-disable-next-line no-await-in-loop
      await write(line);
    }
    const entry = { name, count, sha256: hash.digest('hex') };
    collections.push(entry);
    // eslint-disable-next-line no-await-in-loop
    await write(JSON.stringify({ t: 'end', ...entry }));
    if (onCollection) onCollection(entry);
  }

  // The files, each streamed in pieces with the SHA-256 of its real bytes. A file that cannot be
  // read is recorded and the rest still read, so the error names every missing file at once.
  const list = [];
  const failures = [];
  const missing = []; // allowMissing: files that could not even be opened (already gone)
  const sources = emptySources();
  let n = 0;
  if (files) {
    // eslint-disable-next-line no-restricted-syntax
    for await (const file of files) {
      // Opened before anything about it is written, so a file that is already gone can be left out
      // cleanly when the caller allows it (the recovery backup before a restore - see backup.service.js).
      let opened;
      try {
        opened = await file.open();
      } catch (err) {
        const failure = { source: file.source, key: file.key, name: file.name, refs: file.refs || [], error: String(err.message || err).slice(0, 300) };
        if (allowMissing) missing.push(failure);
        else failures.push(failure);
        continue;
      }
      n += 1;
      const head = {
        t: 'file',
        n,
        source: file.source,
        key: file.key,
        name: file.name,
        contentType: file.contentType,
        refs: file.refs || [],
        meta: EJSON.serialize(file.meta || {}, { relaxed: false }),
      };
      await write(JSON.stringify(head));
      const hash = crypto.createHash('sha256');
      let size = 0;
      try {
        const { stream } = opened;
        let pending = Buffer.alloc(0);
        // eslint-disable-next-line no-restricted-syntax
        for await (const chunk of stream) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          hash.update(buf);
          size += buf.length;
          pending = pending.length ? Buffer.concat([pending, buf]) : buf;
          while (pending.length >= FILE_PIECE_BYTES) {
            // eslint-disable-next-line no-await-in-loop
            await write(JSON.stringify({ t: 'fd', n, b: pending.subarray(0, FILE_PIECE_BYTES).toString('base64') }));
            pending = pending.subarray(FILE_PIECE_BYTES);
          }
        }
        if (pending.length) await write(JSON.stringify({ t: 'fd', n, b: pending.toString('base64') }));
        if (file.size != null && file.size !== size) throw new Error(`${size} bytes read, ${file.size} expected`);
        if (size === 0 && file.source !== 'local') throw new Error('the stored file is empty');
      } catch (err) {
        failures.push({ source: file.source, key: file.key, name: file.name, refs: file.refs || [], error: String(err.message || err).slice(0, 300) });
        await write(JSON.stringify({ t: 'fend', n, failed: true }));
        continue;
      }
      const sha256 = hash.digest('hex');
      await write(JSON.stringify({ t: 'fend', n, size, sha256 }));
      sources[file.source] = sources[file.source] || { count: 0, bytes: 0 };
      sources[file.source].count += 1;
      sources[file.source].bytes += size;
      list.push({ n, source: file.source, key: file.key, name: file.name, contentType: file.contentType, size, sha256, refs: file.refs || [] });
    }
  }
  if (failures.length) {
    gzip.end();
    await done.catch(() => {});
    throw new FileBackupError(failures);
  }

  const manifest = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    scope: missing.length ? 'partial' : scope,
    appVersion: APP_VERSION,
    createdAt,
    totalDocuments: collections.reduce((s, c) => s + c.count, 0),
    databaseBytes,
    collections,
    files: { count: list.length, totalBytes: list.reduce((s, f) => s + f.size, 0), sources, list, missing },
  };
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

// "partial": a recovery backup taken while some stored files were already unreadable (listed in
// manifest.files.missing) - everything else, files included.
const scopeOf = manifestOrHeader => (manifestOrHeader?.formatVersion >= 2 && ['full', 'partial'].includes(manifestOrHeader?.scope) ? manifestOrHeader.scope : 'database');

/**
 * Reads a whole backup file and checks it: format and version; every collection's document count
 * and SHA-256 against its own end-marker and the trailing manifest; every file's size and SHA-256
 * (of its real bytes) against its end-marker and the manifest; the required collections. Never
 * throws for a bad file - returns { ok: false, problems } instead. The optional callbacks receive
 * the content as it is read (the restore loader): onDocument(name, doc) deserialized documents;
 * onFileStart(file), onFileData(file, buffer), onFileEnd(file, { size, sha256 }) the files.
 */
async function verifyBackup(input, { onCollectionStart, onDocument, onCollectionEnd, onFileStart, onFileData, onFileEnd } = {}) {
  const problems = [];
  let header = null;
  let manifest = null;
  let current = null;
  let file = null;
  const seen = [];
  const seenFiles = [];
  try {
    // eslint-disable-next-line no-restricted-syntax
    for await (const { raw, record } of readLines(input)) {
      if (!header) {
        if (record.t !== 'header' || record.format !== FORMAT) throw new Error('This is not a Reservia backup file.');
        if (!Number.isInteger(record.formatVersion) || record.formatVersion > FORMAT_VERSION)
          throw new Error(`This backup uses format version ${record.formatVersion}, which this version of Reservia cannot read.`);
        header = record;
        continue;
      }
      if (manifest) throw new Error('The backup file has data after its manifest.');
      if (record.t === 'collection') {
        if (current || file) throw new Error(`Collection "${current?.name || record.name}" is not where it belongs in the backup file.`);
        if (seenFiles.length) throw new Error('The backup file has a collection after its files.');
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
      } else if (record.t === 'file') {
        if (header.formatVersion < 2) throw new Error('The backup file has a file record its version does not allow.');
        if (current || file) throw new Error('A file in the backup file starts inside another section.');
        file = {
          n: record.n,
          source: record.source,
          key: record.key,
          name: record.name,
          contentType: record.contentType,
          refs: record.refs || [],
          meta: EJSON.deserialize(record.meta || {}, { relaxed: false }),
          size: 0,
          hash: crypto.createHash('sha256'),
        };
        if (onFileStart) await onFileStart(file);
      } else if (record.t === 'fd') {
        if (!file || record.n !== file.n) throw new Error('File data in the backup file is outside its file.');
        const buf = Buffer.from(String(record.b || ''), 'base64');
        file.hash.update(buf);
        file.size += buf.length;
        if (onFileData) await onFileData(file, buf);
      } else if (record.t === 'fend') {
        if (!file || record.n !== file.n) throw new Error('The backup file has an unexpected file end.');
        const sha256 = file.hash.digest('hex');
        const label = `File "${file.name || file.key}" (${file.source})`;
        if (record.failed) problems.push(`${label} was not backed up.`);
        else {
          if (record.size !== file.size) problems.push(`${label}: ${file.size} bytes read, ${record.size} expected`);
          if (record.sha256 !== sha256) problems.push(`${label}: content does not match its checksum`);
        }
        seenFiles.push({ n: file.n, source: file.source, key: file.key, size: file.size, sha256 });
        if (onFileEnd) await onFileEnd(file, { size: file.size, sha256 });
        file = null;
      } else if (record.t === 'manifest') {
        manifest = record;
      } else {
        throw new Error(`Unknown record "${record.t}" in the backup file.`);
      }
    }
  } catch (err) {
    problems.push(
      /incorrect header|unexpected end|invalid|Z_|zlib/i.test(String(err.code || err.message)) ? 'The file is not a valid backup (damaged or not gzip-compressed).' : err.message
    );
    return { ok: false, header, manifest: null, problems };
  }
  if (!header) problems.push('The file is empty.');
  if (current) problems.push(`Collection "${current.name}" is incomplete - the file was cut short.`);
  if (file) problems.push(`File "${file.name || file.key}" is incomplete - the backup was cut short.`);
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
    if (manifest.formatVersion >= 2) {
      const listedFiles = new Map((manifest.files?.list || []).map(f => [f.n, f]));
      for (const f of seenFiles) {
        const m = listedFiles.get(f.n);
        if (!m) problems.push(`File "${f.key}" (${f.source}): not listed in the manifest`);
        else if (m.size !== f.size || m.sha256 !== f.sha256 || m.key !== f.key || m.source !== f.source)
          problems.push(`File "${f.key}" (${f.source}): does not match the manifest`);
      }
      if (listedFiles.size !== seenFiles.length || (manifest.files?.count ?? 0) !== seenFiles.length) problems.push('The manifest lists files the backup does not contain.');
    }
  }
  return {
    ok: problems.length === 0,
    header,
    manifest,
    problems,
    scope: scopeOf(manifest || header),
    files: { count: seenFiles.length, bytes: seenFiles.reduce((s, f) => s + f.size, 0) },
  };
}

module.exports = { writeBackup, verifyBackup, readLines, scopeOf, FileBackupError, FORMAT, FORMAT_VERSION, REQUIRED_COLLECTIONS, APP_VERSION };
