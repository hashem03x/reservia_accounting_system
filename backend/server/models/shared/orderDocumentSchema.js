const { Schema } = require('mongoose');

// A PDF document attached to a Sales Order or Purchase Order after it was created (contracts,
// delivery notes, invoices...). Uploaded through the same PDF-only Cloudinary pipeline as
// Customer/Vendor business documents (middleware/documentUploadMiddleware.js); unlike those, an
// order can hold any number of documents, so each has its own _id instead of a fixed type.
const orderDocumentSchema = new Schema({
  url: { type: String, required: true },
  publicId: { type: String, required: true },
  filename: { type: String, trim: true },
  mimeType: { type: String },
  uploadedAt: { type: Date, default: Date.now },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
});

module.exports = { orderDocumentSchema };
