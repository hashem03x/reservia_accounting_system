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
    // The page's own name (dashboard lists, navigation defaults) - separate from the SEO title.
    titleEn: { type: String, trim: true, maxlength: 120, default: '' },
    titleAr: { type: String, trim: true, maxlength: 120, default: '' },
    // Page chrome on the public site: 'default' (header + footer), 'landing' (campaign page - no main
    // navigation, sticky CTA), 'full-width' (sections run edge to edge).
    layout: { type: String, enum: ['default', 'landing', 'full-width'], default: 'default' },
    parentSlug: { type: String, default: null, trim: true },
    sortOrder: { type: Number, default: 0 },
    // Which language versions of this page exist (SEO brief 2.2). Arabic is the site's default
    // language; a page without an English version simply omits 'en' - hreflang alternates are
    // only ever generated between languages listed here (utils/website/seoResolver.js), never
    // assumed. Existing pages default to both, which is what the live site has today.
    locales: {
      type: [{ type: String, enum: ['ar', 'en'] }],
      default: ['ar', 'en'],
      validate: { validator: v => Array.isArray(v) && v.length > 0, message: 'A page needs at least one language.' },
    },
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
      // SEO brief 2.1-2.6. Every field below is OPTIONAL and empty by default: an empty field
      // means "use the generated default" (seoResolver.js computes defaults at read time and
      // never writes them back), so a value an editor typed is never overwritten automatically.
      nofollow: { type: Boolean, default: false },
      // '' = self-referencing canonical. Otherwise an absolute https URL or a site path.
      canonicalEn: { type: String, trim: true, maxlength: 500, default: '' },
      canonicalAr: { type: String, trim: true, maxlength: 500, default: '' },
      ogTitleEn: { type: String, trim: true, maxlength: 95, default: '' },
      ogTitleAr: { type: String, trim: true, maxlength: 95, default: '' },
      ogDescriptionEn: { type: String, trim: true, maxlength: 200, default: '' },
      ogDescriptionAr: { type: String, trim: true, maxlength: 200, default: '' },
      twitterCard: { type: String, enum: ['', 'summary', 'summary_large_image'], default: '' },
      breadcrumbLabelEn: { type: String, trim: true, maxlength: 60, default: '' },
      breadcrumbLabelAr: { type: String, trim: true, maxlength: 60, default: '' },
      showBreadcrumbs: { type: Boolean, default: true },
    },
    status: { type: String, enum: ['never_published', 'published', 'unpublished', 'archived'], default: 'never_published' },
    archivedFromStatus: { type: String, default: null },
    // Scheduled publishing (services/website/publishingService.js): the draft is frozen into
    // `scheduledRevision` when scheduled; it becomes `publishedRevision` at `scheduledPublishAt`.
    scheduledPublishAt: { type: Date, default: null },
    scheduledRevision: { type: Schema.Types.ObjectId, ref: 'WebsiteRevision', default: null },
    scheduledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
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
websitePageSchema.index({ scheduledPublishAt: 1 }, { sparse: true });

module.exports = model('WebsitePage', websitePageSchema);
