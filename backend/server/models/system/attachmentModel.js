const { Schema, model } = require('mongoose');

// A PDF attached to a purchase order, sales order or journal entry (services/files/attachmentService.js).
// The bytes live in this database's private `attachmentfiles` GridFS bucket (`file` is the GridFS
// file id) - never in a public URL - and are only ever served through the authenticated
// /api/v1/attachments routes, which check the permission of the record the file belongs to.
//
// Attachments are kept in their own collection instead of on the order / journal entry itself, so
// adding or removing one never saves (or re-validates, or re-posts) the financial record: an
// attachment never creates, changes or reverses a transaction.
const OWNER_TYPES = ['PurchaseOrder', 'SalesOrder', 'JournalEntry'];

const attachmentSchema = new Schema(
  {
    ownerType: { type: String, enum: OWNER_TYPES, required: true },
    owner: { type: Schema.Types.ObjectId, required: true, refPath: 'ownerType' },
    file: { type: Schema.Types.ObjectId, required: true, unique: true },
    // The name it was uploaded with (cleaned - no path parts), used for display and downloads.
    originalName: { type: String, required: true, trim: true, maxlength: 200 },
    contentType: { type: String, required: true, default: 'application/pdf' },
    size: { type: Number, required: true, min: 1 },
    sha256: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

attachmentSchema.index({ ownerType: 1, owner: 1, createdAt: 1 });
// The same file uploaded twice to the same record (a retried request) is stored once.
attachmentSchema.index({ ownerType: 1, owner: 1, sha256: 1 }, { unique: true });

module.exports = model('Attachment', attachmentSchema);
module.exports.OWNER_TYPES = OWNER_TYPES;
