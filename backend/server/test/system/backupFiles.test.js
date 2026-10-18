const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Readable } = require('stream');

// PDF attachments of purchase orders, sales orders and journal entries, document downloads, and
// full system backups that carry the files themselves (server/backup/backup.files.js):
//   - attachments: validation (signature, type, extension, size, count), storage, authorization,
//     downloads with the right Content-Type / Content-Disposition (Arabic names included), and no
//     effect on the accounting;
//   - business documents on Cloudinary (customers, vendors, project contracts) served through the
//     API with their real name and .pdf extension;
//   - a full backup holds the database AND every stored file's bytes with checksums; a file that
//     cannot be read fails it; a restore puts back attachments, documents and images with working
//     references, and a failed restore rolls the files back with the data.
// Cloudinary is played by a local HTTP server (reads go over real HTTP through the app's own code;
// uploads and deletions are recorded in memory) - no Cloudinary account is contacted.

const DB_URI = process.env.TEST_DB_URI_BACKUP_FILES || 'mongodb://127.0.0.1:27017/reversia_test_backup_files';
process.env.BACKUP_STORAGE = 'gridfs';
process.env.JWT_SECRET_KEY = 'test-only-jwt-secret-for-backup-files';
delete process.env.ATTACHMENT_MAX_MB;
delete process.env.ATTACHMENT_MAX_FILES;
delete process.env.CLOUDINARY_URL;
const UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'rsv-uploads-'));
process.env.BACKUP_UPLOADS_DIR = UPLOADS;

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const id = () => new mongoose.Types.ObjectId();
const coll = name => mongoose.connection.collection(name);
const readAll = async stream => {
  const parts = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const chunk of stream) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
};
/** A real (minimal) PDF: header, `size` bytes of content, trailer - unique per label. */
const pdf = (label, size = 64) => Buffer.concat([Buffer.from(`%PDF-1.7\n%${label}\n`), crypto.randomBytes(size), Buffer.from('\n%%EOF\n')]);
const file = (name, buffer, mimetype = 'application/pdf') => ({ originalname: name, mimetype, buffer });

// ---------------------------------------------------------------- fake Cloudinary
const assets = new Map(); // URL path -> bytes
const cloudUploads = [];
const cloudDestroyed = [];
let cloudServer;
let cloudBase;
const assetPath = publicId => `/demo/raw/upload/v1/${publicId}`;

// ---------------------------------------------------------------- app
let appServer;
let base;
let service, attachments, cloudinaryFiles, Backup, RestoreLog, store, format;
let admin, reader, outsider, adminToken, readerToken, outsiderToken;
let po, so, je, customer, vendor, project;
const notified = [];

const api = async (method, url, { token = adminToken, body, form } = {}) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let payload;
  if (form) payload = form;
  else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${url}`, { method, headers, body: payload });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, data };
};
const formWith = (...files) => {
  const form = new FormData();
  for (const f of files) form.append('files', new Blob([f.buffer], { type: f.mimetype }), f.originalname);
  return form;
};

/** Every business collection's documents in canonical EJSON, and the server images by path. */
const { EJSON } = require(require.resolve('bson', { paths: [path.join(path.dirname(require.resolve('mongoose/package.json')), 'node_modules')] }));
async function snapshot() {
  const names = (await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray())
    .map(c => c.name)
    .filter(store.isBusinessCollection)
    .sort();
  const out = {};
  for (const name of names) out[name] = EJSON.stringify(await coll(name).find({}).sort({ _id: 1 }).toArray(), { relaxed: false });
  return out;
}
function localSnapshot(dir = UPLOADS, rel = '') {
  const out = {};
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, localSnapshot(dir, childRel));
    else out[childRel] = sha(fs.readFileSync(path.join(dir, childRel)));
  }
  return out;
}
const writeLocal = (rel, buf) => {
  fs.mkdirSync(path.dirname(path.join(UPLOADS, rel)), { recursive: true });
  fs.writeFileSync(path.join(UPLOADS, rel), buf);
};

before(async () => {
  cloudServer = http.createServer((req, res) => {
    const buf = assets.get(decodeURIComponent(req.url.split('?')[0]));
    if (!buf) {
      res.statusCode = 404;
      return res.end('Resource not found');
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(buf.length));
    return res.end(buf);
  });
  await new Promise(resolve => cloudServer.listen(0, '127.0.0.1', resolve));
  cloudBase = `http://127.0.0.1:${cloudServer.address().port}`;

  await mongoose.connect(DB_URI);
  await mongoose.connection.dropDatabase();

  // The failure alert is recorded instead of emailed.
  require('../../backup/backup.notifier').notifyFailure = async err => {
    notified.push(err.message);
  };
  cloudinaryFiles = require('../../services/files/cloudinaryFiles');
  cloudinaryFiles.isConfigured = () => true;
  cloudinaryFiles.upload = async (readable, { publicId }) => {
    const buf = await readAll(readable);
    assets.set(assetPath(publicId), buf);
    cloudUploads.push(publicId);
    return { url: `${cloudBase}${assetPath(publicId)}`, publicId };
  };
  cloudinaryFiles.destroy = async publicId => {
    assets.delete(assetPath(publicId));
    cloudDestroyed.push(publicId);
  };

  require('../../models/inventory/warehouseModel');
  require('../../models/vendor/paymentModel');
  require('../../models/vendor/purchaseOrder');
  require('../../models/sales/salesOrderModel');
  require('../../models/accounting/journalEntryModel');
  const User = require('../../models/userModel');
  Backup = require('../../models/system/backupModel');
  RestoreLog = require('../../models/system/restoreLogModel');
  attachments = require('../../services/files/attachmentService');
  service = require('../../backup/backup.service');
  store = require('../../backup/backup.store');
  format = require('../../backup/backup.format');
  await Promise.all([User.init(), require('../../models/system/attachmentModel').init()]);

  // Central Business Portal: every real HTTP call below goes through the full auth chain
  // (authController.protect -> checkUserPermissions/allowedTo), which now also requires active
  // ERP system membership (see utils/systemAccess.js) - each of these three real users needs one.
  const erpMembership = role => [{ system: 'ERP', role, isActive: true }];
  admin = await User.create({ name: 'Admin', email: `admin-${Date.now()}@example.com`, role: 'admin', type: 'online', systemMemberships: erpMembership('admin') });
  reader = await User.create({ name: 'Reader', email: `reader-${Date.now()}@example.com`, role: 'operator', type: 'online', systemMemberships: erpMembership('operator') });
  outsider = await User.create({ name: 'Outsider', email: `outsider-${Date.now()}@example.com`, role: 'operator', type: 'online', systemMemberships: erpMembership('operator') });
  // Raw updates: the model's save hook resets staff permissions to the role defaults.
  await coll('users').updateOne({ _id: reader._id }, { $set: { permissions: [{ resource: 'purchaseOrders', actions: ['read'] }] } });
  await coll('users').updateOne({ _id: outsider._id }, { $set: { permissions: [{ resource: 'salesOrders', actions: ['read', 'update'] }] } });
  const jwt = require('jsonwebtoken');
  const createToken = userId => jwt.sign({ userId }, process.env.JWT_SECRET_KEY, { expiresIn: '1h' });
  [adminToken, readerToken, outsiderToken] = [createToken(admin._id), createToken(reader._id), createToken(outsider._id)];

  // The records the files belong to (inserted as they are stored - their own rules are tested elsewhere).
  po = id();
  so = id();
  je = id();
  await coll('purchaseorders').insertOne({ _id: po, orderNumber: 'PO-1', items: [], totalNet: 1000, status: 'received' });
  await coll('salesorders').insertOne({ _id: so, orderNumber: 'SO-1', items: [], totalNet: 2000, status: 'delivered' });
  await coll('journalentries').insertOne({ _id: je, entryNumber: 1, date: new Date('2026-05-01'), description: 'Opening', source: 'manual', status: 'posted', lines: [] });
  await coll('chartofaccounts').insertOne({ _id: id(), code: '11000001', name: 'Bank', type: 'asset' });

  // Cloudinary-stored business documents. The customer's is an older upload whose public id (and so
  // its URL) has no extension - the file a browser saved from that URL had none either.
  customer = id();
  vendor = id();
  project = id();
  const doc = (publicId, filename, documentType) => {
    assets.set(assetPath(publicId), pdf(publicId, 2048));
    return { documentType, url: `${cloudBase}${assetPath(publicId)}`, publicId, filename, mimeType: 'application/pdf', uploadedAt: new Date() };
  };
  await coll('users').insertOne({
    _id: customer,
    name: 'Nile Trading',
    role: 'user',
    type: 'offline',
    documents: [doc('uploads/customers/commercial-1712', 'السجل التجاري 2026.pdf', 'commercial_register')],
  });
  await coll('vendors').insertOne({ _id: vendor, name: 'Delta Supplies', documents: [doc('uploads/vendors/tax-card-1713.pdf', 'Tax card.pdf', 'tax_card')] });
  await coll('projects').insertOne({
    _id: project,
    projectNumber: 'P-1',
    name: 'Solar plant',
    contract: doc('uploads/projects/contract-1714.pdf', 'Contract (signed) #1.pdf', 'contract'),
  });

  // Images on the server's disk; uploads/import is temporary and never backed up.
  writeLocal('products/p1.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), crypto.randomBytes(5000)]));
  writeLocal('customization/slides/s1.webp', crypto.randomBytes(3000));
  writeLocal('import/temp-import.xlsx', crypto.randomBytes(100));

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/attachments', require('../../routes/attachmentRoute'));
  app.use('/api/v1/customers', require('../../routes/user/customerRoute'));
  app.use('/api/v1/vendors', require('../../routes/user/vendorRoute'));
  app.use('/api/v1/projects', require('../../routes/project/projectRoute'));
  app.use(require('../../middleware/errorMiddleware'));
  appServer = app.listen(0, '127.0.0.1');
  await new Promise(resolve => appServer.once('listening', resolve));
  base = `http://127.0.0.1:${appServer.address().port}/api/v1`;
});

after(async () => {
  if (appServer) await new Promise(resolve => appServer.close(resolve));
  if (cloudServer) await new Promise(resolve => cloudServer.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(UPLOADS, { recursive: true, force: true });
});

// ================================================================ attachments

const originals = {};
test('valid PDFs attach to purchase orders, sales orders and journal entries; a retry is not stored twice; the accounting is untouched', async () => {
  const jeBefore = await coll('journalentries').find({}).toArray();
  originals.poA = file('فاتورة المورد رقم 1.pdf', pdf('po-a'));
  originals.poBig = file('Big scan.PDF', pdf('po-big', 6 * 1024 * 1024)); // larger than one stored chunk and one backup piece
  originals.so = file('Customer PO (signed).pdf', pdf('so'));
  originals.je = file('bank statement.pdf', pdf('je'));

  let list = await attachments.uploadAttachments({ ownerKey: 'purchase-orders', ownerId: po, files: [originals.poA, originals.poBig], userId: admin._id });
  assert.deepEqual(
    list.map(a => a.originalName),
    ['فاتورة المورد رقم 1.pdf', 'Big scan.PDF']
  );
  assert.equal(list[1].size, originals.poBig.buffer.length);
  list = await attachments.uploadAttachments({ ownerKey: 'purchase-orders', ownerId: po, files: [originals.poA], userId: admin._id });
  assert.equal(list.length, 2, 'the same file again (a retried upload) is not stored twice');
  await attachments.uploadAttachments({ ownerKey: 'sales-orders', ownerId: so, files: [originals.so], userId: admin._id });
  await attachments.uploadAttachments({ ownerKey: 'journal-entries', ownerId: je, files: [originals.je], userId: admin._id });

  assert.equal(await coll('attachmentfiles.files').countDocuments(), 4);
  assert.deepEqual(await coll('journalentries').find({}).toArray(), jeBefore, 'attaching never changes or posts a journal entry');
  assert.equal(await coll('purchaseorders').countDocuments({ attachments: { $exists: true } }), 0, 'the order record itself is not saved');
});

test('invalid, disguised, empty, oversized and too many files are refused before anything is stored', async () => {
  const before1 = await coll('attachmentfiles.files').countDocuments();
  const exe = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(100), Buffer.from('%PDF-1.7')]);
  const cases = [
    [file('invoice.exe', pdf('x')), /only \.pdf/],
    [file('invoice.pdf', pdf('x'), 'image/png'), /not a PDF file \(its type/],
    [file('invoice.pdf', exe), /different format/],
    [file('photo.pdf', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), crypto.randomBytes(200)])), /does not start like a PDF/],
    [file('empty.pdf', Buffer.alloc(0)), /empty/],
  ];
  for (const [f, message] of cases) {
    // eslint-disable-next-line no-await-in-loop
    await assert.rejects(() => attachments.uploadAttachments({ ownerKey: 'sales-orders', ownerId: so, files: [f] }), message);
  }
  // One bad file refuses the whole request - the good one beside it is not stored either.
  await assert.rejects(() => attachments.uploadAttachments({ ownerKey: 'sales-orders', ownerId: so, files: [file('ok.pdf', pdf('ok')), cases[2][0]] }), /different format/);

  process.env.ATTACHMENT_MAX_MB = '0.5';
  await assert.rejects(
    () => attachments.uploadAttachments({ ownerKey: 'sales-orders', ownerId: so, files: [file('large.pdf', pdf('large', 600 * 1024))] }),
    /larger than the 0\.5 MB limit/
  );
  delete process.env.ATTACHMENT_MAX_MB;
  process.env.ATTACHMENT_MAX_FILES = '2';
  await assert.rejects(
    () => attachments.uploadAttachments({ ownerKey: 'sales-orders', ownerId: so, files: [file('one.pdf', pdf('1')), file('two.pdf', pdf('2'))] }),
    /at most 2 attachments/
  );
  delete process.env.ATTACHMENT_MAX_FILES;
  await assert.rejects(() => attachments.uploadAttachments({ ownerKey: 'journal-entries', ownerId: id(), files: [file('x.pdf', pdf('x'))] }), /not found/);
  await assert.rejects(() => attachments.uploadAttachments({ ownerKey: 'expenses', ownerId: so, files: [file('x.pdf', pdf('x'))] }), /not supported/);
  assert.equal(await coll('attachmentfiles.files').countDocuments(), before1, 'nothing was stored');
});

test('over HTTP: permissions on every route, the real file with the right Content-Type / Content-Disposition / length, previews inline, errors are JSON (never a file), removal', async () => {
  // Upload through the real multipart route.
  const upload = await api('POST', `/attachments/journal-entries/${je}`, { form: formWith(file('Receipt #7 & co; "final".pdf', pdf('http'))) });
  assert.equal(upload.status, 201, JSON.stringify(upload.data));
  const added = upload.data.data.find(a => a.originalName.startsWith('Receipt'));
  const disguised = await api('POST', `/attachments/journal-entries/${je}`, { form: formWith(file('virus.pdf', Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(50)]))) });
  assert.equal(disguised.status, 400);
  assert.match(disguised.data.message, /different format/);

  // Listing needs the record's read permission.
  const poList = await api('GET', `/attachments/purchase-orders/${po}`, { token: readerToken });
  assert.equal(poList.status, 200);
  assert.equal(poList.data.results, 2);
  assert.equal((await api('GET', `/attachments/journal-entries/${je}`, { token: readerToken })).status, 403, 'no journal entry permission');
  assert.equal((await api('GET', `/attachments/purchase-orders/${po}`, { token: null })).status, 401, 'signed-in users only');
  assert.equal((await api('POST', `/attachments/purchase-orders/${po}`, { token: readerToken, form: formWith(file('x.pdf', pdf('r'))) })).status, 403, 'read is not update');

  // Download: the exact bytes, the PDF type, the Arabic name kept (RFC 5987) with an ASCII fallback.
  const arabic = poList.data.data.find(a => a.originalName === 'فاتورة المورد رقم 1.pdf');
  const dl = await api('GET', `/attachments/${arabic._id}/download`, { token: readerToken });
  assert.equal(dl.status, 200);
  assert.equal(sha(dl.data), sha(originals.poA.buffer));
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  assert.equal(Number(dl.headers.get('content-length')), originals.poA.buffer.length);
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  const disposition = dl.headers.get('content-disposition');
  assert.match(disposition, /^attachment; filename="[\x20-\x7e]+\.pdf"; filename\*=UTF-8''/);
  assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), 'فاتورة المورد رقم 1.pdf');

  // Spaces and special characters survive; quotes cannot break the header.
  const special = await api('GET', `/attachments/${added._id}/download`);
  const specialDisposition = special.headers.get('content-disposition');
  assert.equal(decodeURIComponent(specialDisposition.split("filename*=UTF-8''")[1]), 'Receipt #7 & co; _final_.pdf');
  assert.ok(!/filename="[^"]*"[^;]/.test(specialDisposition), 'the quoted fallback is well-formed');

  // Preview: same file, opened in the browser instead of saved.
  const preview = await api('GET', `/attachments/${arabic._id}/download?inline=1`);
  assert.match(preview.headers.get('content-disposition'), /^inline; /);
  assert.equal(preview.headers.get('content-type'), 'application/pdf');

  // A guessed id, or one belonging to a record the user cannot read, is refused - as JSON.
  const soAttachment = (await api('GET', `/attachments/sales-orders/${so}`)).data.data[0];
  const denied = await api('GET', `/attachments/${soAttachment._id}/download`, { token: readerToken });
  assert.equal(denied.status, 403);
  assert.match(denied.headers.get('content-type'), /application\/json/);
  assert.ok(!denied.headers.get('content-disposition'), 'an error is never offered as a file');
  const missing = await api('GET', `/attachments/${id()}/download`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /application\/json/);

  // Removal needs update permission on the record; the stored file goes with it.
  assert.equal((await api('DELETE', `/attachments/${arabic._id}`, { token: readerToken })).status, 403);
  const storedBefore = await coll('attachmentfiles.files').countDocuments();
  assert.equal((await api('DELETE', `/attachments/${soAttachment._id}`, { token: outsiderToken })).status, 200, 'sales orders update permission is enough for a sales order file');
  assert.equal(await coll('attachments').countDocuments({ _id: new mongoose.Types.ObjectId(soAttachment._id) }), 0);
  assert.equal(await coll('attachmentfiles.files').countDocuments(), storedBefore - 1, 'the stored file is removed with its record');
  // Put the sales order file back for the backup tests.
  await attachments.uploadAttachments({ ownerKey: 'sales-orders', ownerId: so, files: [originals.so], userId: admin._id });
});

test('customer, vendor and project documents download through the API with their real name and .pdf extension (even when the stored URL has none)', async () => {
  const c = await api('GET', `/customers/${customer}/documents/commercial_register/download`);
  assert.equal(c.status, 200);
  assert.equal(c.headers.get('content-type'), 'application/pdf', 'not the octet-stream the storage URL is served with');
  assert.equal(decodeURIComponent(c.headers.get('content-disposition').split("filename*=UTF-8''")[1]), 'السجل التجاري 2026.pdf');
  assert.equal(sha(c.data), sha(assets.get(assetPath('uploads/customers/commercial-1712'))));

  const p = await api('GET', `/projects/${project}/contract/download?inline=1`);
  assert.equal(p.status, 200);
  assert.match(p.headers.get('content-disposition'), /^inline; filename="Contract \(signed\) #1\.pdf"/);

  // A document whose stored name has no extension still downloads as .pdf.
  await coll('vendors').updateOne({ _id: vendor }, { $set: { 'documents.0.filename': 'tax-card-1713' } });
  const v = await api('GET', `/vendors/${vendor}/documents/tax_card/download`);
  assert.match(v.headers.get('content-disposition'), /filename="tax-card-1713\.pdf"/);
  await coll('vendors').updateOne({ _id: vendor }, { $set: { 'documents.0.filename': 'Tax card.pdf' } });

  assert.equal((await api('GET', `/customers/${customer}/documents/commercial_register/download`, { token: readerToken })).status, 403);
  const none = await api('GET', `/customers/${customer}/documents/tax_card/download`);
  assert.equal(none.status, 404);
  assert.match(none.headers.get('content-type'), /application\/json/);
});

// ================================================================ backups with files

let full;
const at = {};
test('a full backup holds the database records AND the real bytes of every stored file, listed in its manifest with checksums; large files are streamed in pieces', async () => {
  at.db = await snapshot();
  at.local = localSnapshot();
  at.assets = new Map(assets);
  at.attachments = await coll('attachments').find({}).sort({ _id: 1 }).toArray();
  at.chunks = (await coll('attachmentfiles.chunks').find({}).toArray()).map(c => `${c.files_id}:${c.n}:${sha(c.data.buffer)}`).sort();

  full = await service.createBackup({ kind: 'manual', userId: admin._id });
  assert.deepEqual([full.status, full.scope, full.verification.ok], ['completed', 'full', true]);
  assert.deepEqual(
    { count: full.files.count, gridfs: full.files.sources.gridfs.count, cloudinary: full.files.sources.cloudinary.count, local: full.files.sources.local.count },
    { count: 10, gridfs: 5, cloudinary: 3, local: 2 }
  );
  assert.equal(full.verification.files, 10);
  assert.ok(!full.manifest.collections.some(c => c.name.startsWith('attachmentfiles.')), 'the attachment bucket goes in as files, not as raw chunks');

  // Inside the file: every file's bytes, identical to the stored ones.
  const got = {};
  const result = await format.verifyBackup(store.openRead(full), {
    onFileStart: f => {
      got[`${f.source}:${f.key}`] = { parts: [], pieces: 0, refs: f.refs, name: f.name };
    },
    onFileData: (f, buf) => {
      got[`${f.source}:${f.key}`].parts.push(buf);
      got[`${f.source}:${f.key}`].pieces += 1;
    },
  });
  assert.equal(result.ok, true, result.problems.join('; '));
  assert.equal(result.manifest.files.list.length, 10);
  const big = at.attachments.find(a => a.originalName === 'Big scan.PDF');
  const bigEntry = got[`gridfs:${big.file}`];
  assert.equal(sha(Buffer.concat(bigEntry.parts)), sha(originals.poBig.buffer), 'exact checksum');
  assert.ok(bigEntry.pieces > 20, 'a large file is written in pieces, never as one block');
  assert.deepEqual(
    bigEntry.refs.map(r => r.collection),
    ['attachments'],
    'linked to its attachment record'
  );
  const customerDoc = got['cloudinary:uploads/customers/commercial-1712'];
  assert.equal(sha(Buffer.concat(customerDoc.parts)), sha(at.assets.get(assetPath('uploads/customers/commercial-1712'))), 'the Cloudinary bytes, not just the URL');
  assert.match(customerDoc.refs[0].label, /Customer Nile Trading - commercial_register/);
  assert.equal(sha(Buffer.concat(got['local:products/p1.png'].parts)), at.local['products/p1.png']);
  assert.ok(!Object.keys(got).some(k => k.includes('import/')), 'temporary import spreadsheets are not included');
  for (const entry of result.manifest.files.list) assert.ok(/^[0-9a-f]{64}$/.test(entry.sha256) && entry.size >= 0 && entry.source, 'manifest lists storage, size and checksum');
});

test('an unreadable file fails the full backup, naming the file and its record; a database-only backup says so; the scheduled run falls back to one, labelled', async () => {
  const contract = assetPath('uploads/projects/contract-1714.pdf');
  const saved = assets.get(contract);
  assets.delete(contract);
  const storedBefore = await coll('backupfiles.files').countDocuments();
  await assert.rejects(
    () => service.createBackup({ kind: 'manual', userId: admin._id }),
    err => err.statusCode === 422 && /could not be backed up/.test(err.message) && /Project P-1 - contract/.test(err.message) && /HTTP 404/.test(err.message)
  );
  const failed = await Backup.findOne({ status: 'failed' }).sort({ createdAt: -1 }).lean();
  assert.equal(failed.scope, 'full');
  assert.deepEqual(
    failed.fileFailures.map(f => [f.source, f.key, f.refs[0]]),
    [['cloudinary', 'uploads/projects/contract-1714.pdf', 'Project P-1 - contract']]
  );
  assert.equal(await coll('backupfiles.files').countDocuments(), storedBefore, 'the partial file was removed');

  const dbOnly = await service.createBackup({ kind: 'manual', scope: 'database', userId: admin._id });
  assert.deepEqual(
    [dbOnly.status, dbOnly.scope, dbOnly.files.count, dbOnly.files.sources.cloudinary.count],
    ['completed', 'database', 5, 0],
    'attachments live in the database and stay in; external files are out'
  );

  notified.length = 0;
  const scheduled = await service.runBackup();
  assert.equal(scheduled.scope, 'database');
  assert.match(scheduled.fallbackFrom, /contract/);
  assert.equal(notified.length, 1, 'the failure is still alerted');
  const listed = await service.listBackups();
  assert.deepEqual(
    listed.filter(b => b.kind === 'scheduled').map(b => [b.status, b.scope]),
    [
      ['completed', 'database'],
      ['failed', 'full'],
    ]
  );
  assets.set(contract, saved);
});

test('restore puts back the attachments, the Cloudinary documents and the server images with working references and identical checksums', async () => {
  // After the backup: an attachment removed, another added; a document deleted from Cloudinary (as a
  // "replace" does) and another changed; an image edited, one deleted, a new one added.
  const soAttachment = at.attachments.find(a => String(a.owner) === String(so));
  await attachments.deleteAttachment(soAttachment);
  await attachments.uploadAttachments({ ownerKey: 'journal-entries', ownerId: je, files: [file('later.pdf', pdf('later'))], userId: admin._id });
  assets.delete(assetPath('uploads/customers/commercial-1712'));
  assets.set(assetPath('uploads/vendors/tax-card-1713.pdf'), pdf('changed'));
  writeLocal('products/p1.png', crypto.randomBytes(10));
  fs.rmSync(path.join(UPLOADS, 'customization/slides/s1.webp'));
  writeLocal('products/new.png', crypto.randomBytes(10));
  cloudUploads.length = 0;

  const log = await service.restoreBackup({ backupId: full._id, confirm: 'RESTORE', userId: admin._id });
  assert.equal(log.status, 'completed', log.error);
  assert.equal(log.scope, 'full');
  assert.deepEqual(log.files, { total: 10, gridfs: 5, cloudinaryRestored: 2, cloudinaryUnchanged: 1, localRestored: 2, localUnchanged: 0 });
  // The document deleted from Cloudinary could not be in the recovery backup taken first (partial,
  // and said so) - the restore went ahead, since it never deletes a stored document.
  assert.equal(log.warnings.length, 1);
  assert.match(log.warnings[0], /already unreadable before this restore.*Customer Nile Trading - commercial_register/);
  const recovery = await Backup.findById(log.recoveryBackup).lean();
  assert.deepEqual([recovery.status, recovery.scope, recovery.verification.ok, recovery.fileFailures.length], ['completed', 'partial', true, 1]);

  // Attachments: exactly the backed-up records and bytes.
  assert.deepEqual(await coll('attachments').find({}).sort({ _id: 1 }).toArray(), at.attachments);
  for (const a of at.attachments) {
    // eslint-disable-next-line no-await-in-loop
    const res = await api('GET', `/attachments/${a._id}/download`);
    assert.equal(res.status, 200);
    assert.equal(sha(res.data), a.sha256, `${a.originalName} downloads with its original bytes`);
  }

  // Cloudinary: the missing and the changed documents were put back as NEW assets (the current asset
  // is never overwritten) and their records point at them; the untouched contract kept its reference.
  assert.equal(cloudUploads.length, 2);
  assert.ok(
    cloudUploads.every(p => /-restored-[a-z0-9]+\.pdf$/.test(p)),
    cloudUploads.join()
  );
  const cust = await coll('users').findOne({ _id: customer });
  assert.match(cust.documents[0].publicId, /^uploads\/customers\/commercial-1712-restored-[a-z0-9]+\.pdf$/);
  const c = await api('GET', `/customers/${customer}/documents/commercial_register/download`);
  assert.equal(sha(c.data), sha(at.assets.get(assetPath('uploads/customers/commercial-1712'))), 'the restored document opens with its original content');
  const v = await api('GET', `/vendors/${vendor}/documents/tax_card/download`);
  assert.equal(sha(v.data), sha(at.assets.get(assetPath('uploads/vendors/tax-card-1713.pdf'))));
  assert.equal((await coll('projects').findOne({ _id: project })).contract.publicId, 'uploads/projects/contract-1714.pdf');

  // Images: the backed-up ones are back exactly; a file the backup never had is left alone.
  const local = localSnapshot();
  for (const [rel, hash] of Object.entries(at.local)) assert.equal(local[rel], hash, rel);
  assert.ok(local['products/new.png'], 'files added after the backup are not deleted');
  assert.ok(!Object.keys(local).some(k => k.startsWith('.rs')), 'no staging or parking folder is left behind');

  // The rest of the database: exactly the backup (apart from the document references re-pointed above).
  const now = await snapshot();
  for (const name of Object.keys(at.db).filter(n => !['users', 'vendors', 'attachmentfiles.chunks'].includes(n))) assert.equal(now[name], at.db[name], name);
  // Stored chunks are rebuilt from the file's bytes (their own ids are new; nothing refers to them).
  const chunkKey = c => `${c.files_id}:${c.n}:${sha(c.data.buffer)}`;
  assert.deepEqual((await coll('attachmentfiles.chunks').find({}).toArray()).map(chunkKey).sort(), at.chunks);
});

test('a restore that fails after the swap rolls back the database AND the files, and removes the copies it put on Cloudinary', async () => {
  // Work for the restore to do: a changed document and a changed image.
  assets.set(assetPath('uploads/vendors/tax-card-1713.pdf'), pdf('changed-again'));
  const vendorNow = await coll('vendors').findOne({ _id: vendor });
  assets.set(assetPath(vendorNow.documents[0].publicId), pdf('changed-again-2'));
  writeLocal('products/p1.png', crypto.randomBytes(12));
  const dbBefore = await snapshot();
  const localBefore = localSnapshot();
  cloudUploads.length = 0;
  cloudDestroyed.length = 0;

  await assert.rejects(
    () =>
      service.restoreBackup({
        backupId: full._id,
        confirm: 'RESTORE',
        userId: admin._id,
        hooks: {
          afterSwap: () => {
            throw new Error('disk failure after the swap');
          },
        },
      }),
    /rolled back/
  );
  const log = await RestoreLog.findOne({}).sort({ createdAt: -1 }).lean();
  assert.equal(log.status, 'rolled_back');
  assert.deepEqual(await snapshot(), dbBefore, 'database exactly as before');
  assert.deepEqual(localSnapshot(), localBefore, 'images exactly as before (the replaced one is back)');
  assert.ok(cloudUploads.length >= 1);
  assert.deepEqual(cloudDestroyed.sort(), [...cloudUploads].sort(), 'every copy the failed restore uploaded is removed again');
  assert.equal((await api('GET', `/attachments/journal-entries/${je}`)).data.results, at.attachments.filter(a => String(a.owner) === String(je)).length);
});

test('a restore that cannot put a document back (no Cloudinary credentials) stops before touching anything', async () => {
  cloudinaryFiles.isConfigured = () => false;
  const dbBefore = await snapshot();
  const localBefore = localSnapshot();
  try {
    await assert.rejects(() => service.restoreBackup({ backupId: full._id, confirm: 'RESTORE', userId: admin._id }), /CLOUDINARY_URL is not configured/);
  } finally {
    cloudinaryFiles.isConfigured = () => true;
  }
  assert.deepEqual(await snapshot(), dbBefore);
  assert.deepEqual(localSnapshot(), localBefore);
});

/** The stored backup's lines, changed by `edit`, gzipped again - an altered copy of the file. */
async function alteredCopy(record, edit) {
  const lines = (await readAll(store.openRead(record).pipe(zlib.createGunzip()))).toString('utf8').split('\n').filter(Boolean);
  return zlib.gzipSync(Buffer.from(`${edit(lines).join('\n')}\n`));
}
async function uploadBackup(buf) {
  const started = await service.startUpload({ fileName: 'copy.rsvbak', sizeBytes: buf.length, userId: admin._id });
  for (let i = 0; i * service.CHUNK_MAX_BYTES < buf.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await service.putChunk(started.uploadId, i, buf.subarray(i * service.CHUNK_MAX_BYTES, (i + 1) * service.CHUNK_MAX_BYTES));
  }
  return service.completeUpload(started.uploadId, admin._id);
}

test('a backup whose file content was corrupted, tampered with or cut short is refused - nothing can be restored from it', async () => {
  const flip = lines =>
    lines.map(l => {
      if (!l.startsWith('{"t":"fd"')) return l;
      const rec = JSON.parse(l);
      const buf = Buffer.from(rec.b, 'base64');
      buf[10] ^= 0xff;
      return JSON.stringify({ ...rec, b: buf.toString('base64') });
    });
  const corrupted = await uploadBackup(await alteredCopy(full, flip));
  assert.equal(corrupted.verification.ok, false);
  assert.ok(
    corrupted.verification.problems.some(p => /content does not match its checksum/.test(p)),
    corrupted.verification.problems.join('; ')
  );
  assert.equal(corrupted.backup.status, 'failed');

  // A file's bytes AND its end-marker replaced consistently: the manifest still catches it.
  let replaced = false;
  const swapFile = lines => {
    const out = [];
    let n = null;
    for (const l of lines) {
      const rec = JSON.parse(l);
      if (!replaced && rec.t === 'file' && rec.source === 'local') n = rec.n;
      if (n !== null && rec.n === n && rec.t === 'fd') continue;
      if (n !== null && rec.n === n && rec.t === 'fend') {
        const fake = Buffer.from('not the image');
        out.push(JSON.stringify({ t: 'fd', n, b: fake.toString('base64') }));
        out.push(JSON.stringify({ t: 'fend', n, size: fake.length, sha256: sha(fake) }));
        replaced = true;
        n = null;
        continue;
      }
      out.push(l);
    }
    return out;
  };
  const tampered = await uploadBackup(await alteredCopy(full, swapFile));
  assert.equal(tampered.verification.ok, false);
  assert.ok(
    tampered.verification.problems.some(p => /does not match the manifest/.test(p)),
    tampered.verification.problems.join('; ')
  );

  const cut = await uploadBackup(await alteredCopy(full, lines => lines.slice(0, lines.findIndex(l => l.startsWith('{"t":"fd"')) + 1)));
  assert.equal(cut.verification.ok, false);
  assert.ok(
    cut.verification.problems.some(p => /incomplete|cut short/.test(p)),
    cut.verification.problems.join('; ')
  );
});

/** The database part of the full backup, as format 1 wrote it (no files); keep(name) picks the collections. */
const asFormat1 = keep =>
  alteredCopy(full, lines => {
    const out = [];
    const collections = [];
    for (const l of lines) {
      const rec = JSON.parse(l);
      if ((rec.t === 'collection' || rec.t === 'end') && !keep(rec.name)) continue;
      if (rec.t === 'd' && !keep(rec.c)) continue;
      if (rec.t === 'header') out.push(JSON.stringify({ t: 'header', format: rec.format, formatVersion: 1, appVersion: rec.appVersion, createdAt: rec.createdAt }));
      else if (rec.t === 'collection' || rec.t === 'd') out.push(l);
      else if (rec.t === 'end') {
        collections.push({ name: rec.name, count: rec.count, sha256: rec.sha256 });
        out.push(l);
      } else if (rec.t === 'manifest')
        out.push(
          JSON.stringify({
            t: 'manifest',
            format: rec.format,
            formatVersion: 1,
            appVersion: rec.appVersion,
            createdAt: rec.createdAt,
            totalDocuments: collections.reduce((s, c) => s + c.count, 0),
            collections,
          })
        );
    }
    return out;
  });

test('a backup whose attachment records have no files is refused at restore - no record is left pointing nowhere', async () => {
  const broken = await uploadBackup(await asFormat1(() => true));
  assert.equal(broken.verification.ok, true, 'a valid file in itself');
  const dbBefore = await snapshot();
  await assert.rejects(() => service.restoreBackup({ backupId: broken.backup._id, confirm: 'RESTORE', userId: admin._id }), /attachment record\(s\) in the backup have no file/);
  assert.deepEqual(await snapshot(), dbBefore, 'nothing changed');
});

test('a backup made before files were included (format 1) is still verified and restorable, and is reported as database only', async () => {
  // Format 1 predates attachments, so such a file has no attachment records.
  const v1 = await asFormat1(name => name !== 'attachments');
  const uploaded = await uploadBackup(v1);
  assert.equal(uploaded.verification.ok, true, uploaded.verification.problems.join('; '));
  assert.deepEqual([uploaded.backup.scope, uploaded.backup.files.count], ['database', 0]);
  const log = await service.restoreBackup({ backupId: uploaded.backup._id, confirm: 'RESTORE', userId: admin._id });
  assert.equal(log.status, 'completed', log.error);
  assert.equal(log.scope, 'database');
  assert.match(log.warnings[0], /database records only/);
  assert.equal(await coll('attachments').countDocuments(), 0);
  assert.equal(await coll('attachmentfiles.files').countDocuments(), 0, 'no attachment file is left without its record either');
  const list = await service.listBackups();
  assert.equal(list.find(b => String(b._id) === String(uploaded.backup._id)).scope, 'database');
});
