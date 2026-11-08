const { Schema, model } = require('mongoose');

// Website Management - a page of the public Reservia marketing site (Reservia_Website repo).
// `pageType: 'managed'` pages are section-driven (their body lives in WebsiteSection documents);
// `pageType: 'legacy'` pages keep their existing hardcoded JSX on the website but still get a
// CMS-managed SEO override here (see plan doc section 1/4.3). `publishedRevision` is the single
// source of truth for "what is actually live" - draft edits to a page's own fields/sections never
// change what the live site shows until an explicit publish creates a new WebsiteRevision and
// moves this pointer (see websiteRevisionModel.js, controller/website/deployController.js).
const websitePageSchema = new Schema(
  {
    slug: {
      type: String,
      required: [true, 'Page slug is required'],
      trim: true,
      lowercase: true,
      unique: true,
      match: [/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers and hyphens'],
    },
    path: { type: String, required: [true, 'Page path is required'], trim: true },
    isHomePage: { type: Boolean, default: false },
    pageType: { type: String, enum: ['managed', 'legacy'], default: 'managed' },
    parentSlug: { type: String, default: null, trim: true },
    sortOrder: { type: Number, default: 0 },
    seo: {
      titleEn: { type: String, trim: true, maxlength: 70, default: '' },
      titleAr: { type: String, trim: true, maxlength: 70, default: '' },
      descriptionEn: { type: String, trim: true, maxlength: 160, default: '' },
      descriptionAr: { type: String, trim: true, maxlength: 160, default: '' },
      ogImage: {
        url: { type: String, default: null },
        publicId: { type: String, default: null },
      },
      noindex: { type: Boolean, default: false },
    },
    status: { type: String, enum: ['never_published', 'published', 'unpublished'], default: 'never_published' },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    publishedRevision: { type: Schema.Types.ObjectId, ref: 'WebsiteRevision', default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

websitePageSchema.index({ slug: 1 }, { unique: true });
websitePageSchema.index({ status: 1, isActive: 1 });

module.exports = model('WebsitePage', websitePageSchema);
