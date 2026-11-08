const { Schema, model } = require('mongoose');

// Website Management - the Media Library. Cloudinary-backed (resource_type:'image'), the same
// {url, publicId} shape already used by Product.imageCover. "Remove from the library" never hard-
// deletes (isActive:false) - a section may still reference the URL, and a Cloudinary purge is a
// separate, manual maintenance action, out of scope here.
const websiteMediaSchema = new Schema(
  {
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

module.exports = model('WebsiteMedia', websiteMediaSchema);
