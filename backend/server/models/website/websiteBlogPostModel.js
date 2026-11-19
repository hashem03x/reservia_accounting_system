const { Schema, model } = require('mongoose');

// Website Management - a blog post on the public Reservia marketing site (Reservia_Website repo).
// Mirrors websitePageModel.js's draft/publish shape exactly (same status enum, scheduling fields,
// publishedRevision pointer, seo sub-schema) - a blog post is not a sections-based page (it has one
// rich-text body per language, not a WebsiteSection array), so it gets its own sibling model/
// revision/service rather than being squeezed into the page model. `publishedRevision` is the
// single source of truth for "what is actually live": draft edits never reach the public feed
// until an explicit publish creates a new WebsiteBlogPostRevision and moves this pointer (see
// websiteBlogPostRevisionModel.js, services/website/blogPublishingService.js).
const websiteBlogPostSchema = new Schema(
  {
    slug: {
      type: String,
      required: [true, 'Blog post slug is required'],
      trim: true,
      lowercase: true,
      unique: true,
      match: [/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers and hyphens'],
    },
    titleEn: { type: String, trim: true, maxlength: 150, default: '' },
    titleAr: { type: String, trim: true, maxlength: 150, default: '' },
    // Short summary for cards/listings - separate from the SEO meta description, which has its own
    // length limit and purpose (search-result snippets, not on-page copy).
    excerptEn: { type: String, trim: true, maxlength: 300, default: '' },
    excerptAr: { type: String, trim: true, maxlength: 300, default: '' },
    // Rich-text HTML from the CMS's TipTap editor. Sanitized on SAVE, never on read (controller,
    // utils/website/htmlSanitizer.js) - revisions therefore always store already-sanitized HTML.
    bodyEn: { type: String, default: '', maxlength: 200000 },
    bodyAr: { type: String, default: '', maxlength: 200000 },
    // Free text, not a managed taxonomy (deliberate - see the CMS's category autocomplete, which
    // suggests previously-used values instead of offering a fixed list).
    category: { type: String, trim: true, maxlength: 60, default: '' },
    tags: { type: [{ type: String, trim: true, maxlength: 40 }], default: [], validate: { validator: v => !Array.isArray(v) || v.length <= 10, message: 'At most 10 tags.' } },
    author: {
      nameEn: { type: String, trim: true, maxlength: 80, default: '' },
      nameAr: { type: String, trim: true, maxlength: 80, default: '' },
      avatarUrl: { type: String, default: null },
    },
    featuredImage: {
      url: { type: String, default: null },
      publicId: { type: String, default: null },
      altEn: { type: String, trim: true, maxlength: 160, default: '' },
      altAr: { type: String, trim: true, maxlength: 160, default: '' },
    },
    // Per-post control over the "Recent Blogs" aside (section 4.2) - on by default for new posts;
    // when off, the article uses the full content width (public site layout concern, not this model's).
    showRecentSidebar: { type: Boolean, default: true },
    // Which language versions of this post exist - same meaning/shape as websitePageModel.js#locales.
    locales: {
      type: [{ type: String, enum: ['ar', 'en'] }],
      default: ['ar', 'en'],
      validate: { validator: v => Array.isArray(v) && v.length > 0, message: 'A blog post needs at least one language.' },
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
      nofollow: { type: Boolean, default: false },
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
    scheduledPublishAt: { type: Date, default: null },
    scheduledRevision: { type: Schema.Types.ObjectId, ref: 'WebsiteBlogPostRevision', default: null },
    scheduledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    publishedRevision: { type: Schema.Types.ObjectId, ref: 'WebsiteBlogPostRevision', default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

websiteBlogPostSchema.index({ slug: 1 }, { unique: true });
websiteBlogPostSchema.index({ status: 1, isActive: 1 });
websiteBlogPostSchema.index({ scheduledPublishAt: 1 }, { sparse: true });
websiteBlogPostSchema.index({ category: 1 });
websiteBlogPostSchema.index({ publishedAt: -1 });

module.exports = model('WebsiteBlogPost', websiteBlogPostSchema);
