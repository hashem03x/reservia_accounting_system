const { Schema, model } = require('mongoose');

// Website Management - a point-in-time snapshot of a blog post's published content, created ONLY
// by an explicit Publish action (services/website/blogPublishingService.js), never by autosave.
// Mirrors websiteRevisionModel.js exactly, with `post`/`snapshot` shaped for a blog post (no
// sections array - the body is one rich-text HTML field per language, already sanitized before it
// was ever saved to the draft). The public feed reads a published post's fields ONLY from here,
// never from the live, possibly-newer WebsiteBlogPost document directly.
const websiteBlogPostRevisionSchema = new Schema(
  {
    post: { type: Schema.Types.ObjectId, ref: 'WebsiteBlogPost', required: true },
    label: { type: String, trim: true, default: null },
    snapshot: {
      seo: { type: Schema.Types.Mixed, required: true },
      titleEn: { type: String, default: '' },
      titleAr: { type: String, default: '' },
      excerptEn: { type: String, default: '' },
      excerptAr: { type: String, default: '' },
      bodyEn: { type: String, default: '' },
      bodyAr: { type: String, default: '' },
      category: { type: String, default: '' },
      tags: { type: [String], default: [] },
      author: { type: Schema.Types.Mixed, default: () => ({}) },
      featuredImage: { type: Schema.Types.Mixed, default: null },
      showRecentSidebar: { type: Boolean, default: true },
      locales: { type: [String], default: undefined },
    },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    publishedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

websiteBlogPostRevisionSchema.index({ post: 1, publishedAt: -1 });

module.exports = model('WebsiteBlogPostRevision', websiteBlogPostRevisionSchema);
