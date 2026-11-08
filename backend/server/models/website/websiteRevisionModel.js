const { Schema, model } = require('mongoose');

// Website Management - a point-in-time snapshot of a page's published content, created ONLY by an
// explicit Publish action (controller/website/deployController.js), never by autosave. This bounds
// revision count to real versions worth rolling back to (the same "only a new revision on a
// deliberate action, never on every tweak" philosophy as commercialRevisionModel.js) and keeps
// "a draft never reaches production until explicitly published" true at the data layer: the live
// website is built from WebsitePage.publishedRevision's frozen `snapshot`, never from the live
// (possibly newer, unpublished) WebsiteSection documents directly.
const websiteRevisionSchema = new Schema(
  {
    page: { type: Schema.Types.ObjectId, ref: 'WebsitePage', required: true },
    label: { type: String, trim: true, default: null },
    snapshot: {
      seo: { type: Schema.Types.Mixed, required: true },
      sections: { type: [Schema.Types.Mixed], required: true },
    },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    publishedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

websiteRevisionSchema.index({ page: 1, publishedAt: -1 });

module.exports = model('WebsiteRevision', websiteRevisionSchema);
