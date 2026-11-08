const { Schema, model } = require('mongoose');
const { SECTION_TYPES } = require('../../utils/website/sectionTypes');

// Website Management - one content section of a WebsitePage, in display order. `content` is
// intentionally Mixed (shape validated per-`type` against utils/website/sectionTypes.js, never
// re-described here) - the same "Mixed, validated by a side table" pattern as
// commercialRevisionModel.js's engineeringInput/engineeringResult. Every text field inside
// `content` is rendered as a plain React child on the website, never dangerouslySetInnerHTML - a
// compromised editor account can at most inject ugly text, not a script.
const websiteSectionSchema = new Schema(
  {
    page: { type: Schema.Types.ObjectId, ref: 'WebsitePage', required: true },
    type: { type: String, required: true, enum: SECTION_TYPES },
    sortOrder: { type: Number, required: true, default: 0 },
    isVisible: { type: Boolean, default: true },
    content: { type: Schema.Types.Mixed, required: true, default: {} },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

websiteSectionSchema.index({ page: 1, sortOrder: 1 });

module.exports = model('WebsiteSection', websiteSectionSchema);
