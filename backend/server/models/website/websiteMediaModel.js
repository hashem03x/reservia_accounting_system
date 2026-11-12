const { Schema, model } = require('mongoose');

// Website Management - the Media Library. Cloudinary-backed (resource_type:'image'), the same
// {url, publicId} shape already used by Product.imageCover. "Remove from the library" never hard-
// deletes (isActive:false) - a section may still reference the URL, and a Cloudinary purge is a
// separate, manual maintenance action, out of scope here.
const websiteMediaSchema = new Schema(
  {
    // 'image' | 'video'. The binary lives in Cloudinary (or, in local development only, on disk) -
    // this document holds metadata and the delivery URL, never file bytes.
    kind: { type: String, enum: ['image', 'video'], default: 'image' },
    resourceType: { type: String, enum: ['image', 'video', 'local'], default: 'image' },
    displayName: { type: String, trim: true, maxlength: 120, default: '' },
    originalName: { type: String, trim: true, maxlength: 200, default: '' },
    mimeType: { type: String, default: null },
    duration: { type: Number, default: null },
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    format: { type: String, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    bytes: { type: Number, default: null },
    altEn: { type: String, trim: true, default: '' },
    altAr: { type: String, trim: true, default: '' },
    folder: { type: String, trim: true, default: 'general' },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

websiteMediaSchema.index({ isActive: 1, folder: 1, createdAt: -1 });
websiteMediaSchema.index({ isActive: 1, kind: 1, createdAt: -1 });

module.exports = model('WebsiteMedia', websiteMediaSchema);
