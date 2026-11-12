const { Schema, model } = require('mongoose');

// Website Management - the Visual Editor's configuration of the REAL website (element overrides,
// added elements, design tokens, global component styles, custom CSS). Two documents:
//   _id 'draft'     - what editors are working on (autosaved); never served publicly except through
//                     a signed preview token;
//   _id 'published' - what the live website is built with (public feed `visual`).
// `rev` increases on every write of the draft, so two editors cannot silently overwrite each other
// (a save names the rev it was based on). The configuration shape is validated by
// utils/website/visualConfig.js; it is plain JSON, a few hundred KB at most - no files in here
// (images are Media Library URLs).
const websiteVisualSchema = new Schema(
  {
    _id: { type: String, enum: ['draft', 'published'] },
    // Stored as a JSON STRING: element ids contain '.' and '/', which must never become MongoDB field
    // names (request bodies are mongo-sanitized too, so the dashboard sends it as a string).
    configJson: { type: String, default: '{"v":1,"tokens":{},"rules":{},"css":"","routes":{},"nodes":{}}' },
    rev: { type: Number, default: 0 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // published only: the revision that is live
    revision: { type: Schema.Types.ObjectId, ref: 'WebsiteVisualRevision', default: null },
  },
  { timestamps: true, minimize: false }
);

const WebsiteVisual = model('WebsiteVisual', websiteVisualSchema);

// Version history: every manual save, publish, restore and rollback, plus recent autosaves.
const websiteVisualRevisionSchema = new Schema(
  {
    kind: { type: String, enum: ['autosave', 'save', 'publish', 'restore', 'rollback'], required: true },
    label: { type: String, trim: true, maxlength: 120, default: '' },
    configJson: { type: String, required: true },
    rev: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, minimize: false }
);
websiteVisualRevisionSchema.index({ createdAt: -1 });
websiteVisualRevisionSchema.index({ kind: 1, createdAt: -1 });

const WebsiteVisualRevision = model('WebsiteVisualRevision', websiteVisualRevisionSchema);

module.exports = { WebsiteVisual, WebsiteVisualRevision };
