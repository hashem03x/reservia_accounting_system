'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const { Readable } = require('stream');
const { finished } = require('stream/promises');
const ApiError = require('../../utils/apiError');
const Attachment = require('../../models/system/attachmentModel');
const { Resources } = require('../../utils/appConstant');
const { safeFileName } = require('../../utils/contentDisposition');

// PDF attachments of purchase orders, sales orders and journal entries.
//
// Storage: the private `attachmentfiles` GridFS bucket in this database - the same storage the
// backups already use, private by construction (no public URL exists), available on every
// deployment including Vercel, and part of the database, so a backup and a restore carry the files
// and their records together (server/backup/backup.files.js).
//
// Every file is checked before anything is stored: a .pdf name, a PDF content type, the PDF
// signature in its first bytes (a renamed executable or image is refused whatever its name and
// type say), the size limit and the per-record count limit. The stored name is generated; the
// uploaded name is only kept (cleaned) for display and downloads.

const BUCKET = 'attachmentfiles';
const PDF_TYPES = ['application/pdf', 'application/x-pdf'];
// Vercel functions accept at most ~4.5 MB per request, so the default there is 4 MB per file.
const maxBytes = () => Math.max(0.1, Number(process.env.ATTACHMENT_MAX_MB) || (process.env.VERCEL ? 4 : 10)) * 1024 * 1024;
const maxFiles = () => Math.max(1, Math.floor(Number(process.env.ATTACHMENT_MAX_FILES) || 20));

// The records that take attachments, by the URL segment the API uses for them.
const OWNERS = {
  'purchase-orders': { ownerType: 'PurchaseOrder', model: 'PurchaseOrder', resource: Resources.purchaseOrders },
  'sales-orders': { ownerType: 'SalesOrder', model: 'SalesOrder', resource: Resources.salesOrders },
  'journal-entries': { ownerType: 'JournalEntry', model: 'JournalEntry', resource: Resources.journalEntries },
};
const OWNER_BY_TYPE = Object.fromEntries(Object.values(OWNERS).map(o => [o.ownerType, o]));

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET });

function ownerOf(ownerKey) {
  const owner = OWNERS[ownerKey];
  if (!owner) throw new ApiError('Attachments are not supported for this kind of record.', 400);
  return owner;
}

// Executables, archives and scripts by their first bytes - refused even if a PDF signature follows.
const FORBIDDEN_MAGIC = [
  Buffer.from('MZ'),
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  Buffer.from('PK\u0003\u0004'),
  Buffer.from('#!'),
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
];

/** Checks one uploaded file ({ originalname, mimetype, buffer }); returns its cleaned display name. */
function validatePdf(file) {
  const label = `"${String(file?.originalname || 'file').slice(0, 120)}"`;
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) throw new ApiError(`${label} is empty.`, 400);
  if (!/\.pdf$/i.test(String(file.originalname || '').trim())) throw new ApiError(`${label} is not a PDF file (only .pdf files can be attached).`, 400);
  if (!PDF_TYPES.includes(String(file.mimetype || '').toLowerCase())) throw new ApiError(`${label} is not a PDF file (its type is ${file.mimetype || 'unknown'}).`, 400);
  if (file.buffer.length > maxBytes()) throw new ApiError(`${label} is larger than the ${Math.round((maxBytes() / 1048576) * 10) / 10} MB limit.`, 413);
  const head = file.buffer.subarray(0, 1024);
  if (FORBIDDEN_MAGIC.some(magic => head.subarray(0, magic.length).equals(magic))) throw new ApiError(`${label} is not a PDF file (its content is a different format).`, 400);
  if (head.indexOf('%PDF-') === -1) throw new ApiError(`${label} is not a valid PDF file (its content does not start like a PDF).`, 400);
  return safeFileName(file.originalname, 'application/pdf', 'attachment.pdf');
}

async function loadOwner(owner, ownerId) {
  if (!mongoose.Types.ObjectId.isValid(String(ownerId))) throw new ApiError('Invalid record id.', 400);
  // Straight from the collection: the order models populate their items on every find.
  const exists = await mongoose.model(owner.model).collection.findOne({ _id: new mongoose.Types.ObjectId(String(ownerId)) }, { projection: { _id: 1 } });
  if (!exists) throw new ApiError('The record was not found.', 404);
  return new mongoose.Types.ObjectId(String(ownerId));
}

const shape = a => ({
  _id: a._id,
  ownerType: a.ownerType,
  owner: a.owner,
  originalName: a.originalName,
  contentType: a.contentType,
  size: a.size,
  sha256: a.sha256,
  uploadedBy: a.uploadedBy,
  createdAt: a.createdAt,
});

async function listAttachments(ownerKey, ownerId) {
  const owner = ownerOf(ownerKey);
  const id = await loadOwner(owner, ownerId);
  const rows = await Attachment.find({ ownerType: owner.ownerType, owner: id }).sort({ createdAt: 1 }).populate({ path: 'uploadedBy', select: 'name' }).lean();
  return rows.map(shape);
}

async function writeFile(buffer, { ownerType, owner, name }) {
  const fileId = new mongoose.Types.ObjectId();
  const upload = bucket().openUploadStreamWithId(fileId, `${fileId}.pdf`, { contentType: 'application/pdf', metadata: { ownerType, owner, originalName: name } });
  try {
    Readable.from([buffer]).pipe(upload);
    await finished(upload);
  } catch (err) {
    await Promise.resolve(upload.abort()).catch(() => {});
    throw err;
  }
  return fileId;
}

const removeFile = fileId =>
  bucket()
    .delete(fileId)
    .catch(err => {
      if (!/not found|FileNotFound/i.test(String(err.code || err.message))) throw err;
    });

/**
 * Stores the uploaded PDFs on a record. All files are validated first; if storing any of them fails,
 * the ones stored by this request are removed again (no orphaned files, no half-done request). A file
 * already attached to the record (same content) is not stored twice - a retried upload is harmless.
 */
async function uploadAttachments({ ownerKey, ownerId, files, userId }) {
  const owner = ownerOf(ownerKey);
  if (!Array.isArray(files) || !files.length) throw new ApiError('Choose at least one PDF file to attach.', 400);
  const ownerObjectId = await loadOwner(owner, ownerId);
  const checked = files.map(file => ({ name: validatePdf(file), buffer: file.buffer, sha256: crypto.createHash('sha256').update(file.buffer).digest('hex') }));

  const existing = await Attachment.find({ ownerType: owner.ownerType, owner: ownerObjectId }).select('sha256').lean();
  const known = new Set(existing.map(a => a.sha256));
  const fresh = [];
  for (const file of checked) {
    if (!known.has(file.sha256)) {
      known.add(file.sha256);
      fresh.push(file);
    }
  }
  if (existing.length + fresh.length > maxFiles()) throw new ApiError(`A record can have at most ${maxFiles()} attachments (this one has ${existing.length}).`, 400);

  const created = [];
  const written = [];
  try {
    for (const file of fresh) {
      // eslint-disable-next-line no-await-in-loop
      const fileId = await writeFile(file.buffer, { ownerType: owner.ownerType, owner: ownerObjectId, name: file.name });
      written.push(fileId);
      // eslint-disable-next-line no-await-in-loop
      const doc = await Attachment.create({
        ownerType: owner.ownerType,
        owner: ownerObjectId,
        file: fileId,
        originalName: file.name,
        contentType: 'application/pdf',
        size: file.buffer.length,
        sha256: file.sha256,
        uploadedBy: userId || null,
      });
      created.push(doc);
    }
  } catch (err) {
    await Attachment.deleteMany({ _id: { $in: created.map(d => d._id) } }).catch(() => {});
    await Promise.all(written.map(fileId => removeFile(fileId).catch(() => {})));
    // A concurrent retry of the same upload won the race: the file is attached - not an error.
    if (err?.code === 11000) return listAttachments(ownerKey, ownerId);
    throw err instanceof ApiError ? err : new ApiError(`The attachment could not be stored: ${err.message}`, 500);
  }
  return listAttachments(ownerKey, ownerId);
}

/** The attachment record (lean) and which owner it belongs to - for the permission check. */
async function getAttachment(id) {
  if (!mongoose.Types.ObjectId.isValid(String(id))) throw new ApiError('Invalid attachment id.', 400);
  const attachment = await Attachment.findById(id).lean();
  if (!attachment) throw new ApiError('Attachment not found.', 404);
  return { attachment, owner: OWNER_BY_TYPE[attachment.ownerType] };
}

/** A read stream of the stored file; rejects (404) if the stored file itself is missing. */
async function openFile(attachment) {
  const file = await mongoose.connection.db.collection(`${BUCKET}.files`).findOne({ _id: attachment.file }, { projection: { length: 1 } });
  if (!file) throw new ApiError('The attached file is missing from storage.', 404);
  return { stream: bucket().openDownloadStream(attachment.file), size: file.length };
}

async function deleteAttachment(attachment) {
  await Attachment.deleteOne({ _id: attachment._id });
  await removeFile(attachment.file);
}

module.exports = { listAttachments, uploadAttachments, getAttachment, openFile, deleteAttachment, validatePdf, ownerOf, OWNERS, BUCKET, maxBytes, maxFiles };
