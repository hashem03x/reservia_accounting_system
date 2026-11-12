const { Schema, model } = require('mongoose');

// Website Management - raw HTML/script snippets injected into the public website (verification
// tags, Google Tag Manager/Meta Pixel bootstrap scripts, etc). `code` is stored and injected
// VERBATIM - no sanitizer is applied. This is deliberate, not an oversight: this field exists
// specifically to hold <script>/<meta> tags, which no realistic "safe HTML" allowlist would permit
// anyway (no such library exists in this codebase today - see plan doc's research notes). The
// real safety control is access, not content: writing here requires the `integrations.manage`
// capability (admin role only, see middleware/websiteAccess.js), and every write is logged
// (websiteActivityLogModel.js) - the same category of deliberately-privileged, trusted-admin-only
// escape hatch as a WordPress "header/footer scripts" field. Ordinary editorial content (headings,
// body copy, in websiteSectionModel.js) gets the opposite treatment: always rendered as plain
// React children on the website, never via dangerouslySetInnerHTML.
const websiteCustomCodeSchema = new Schema(
  {
    name: { type: String, required: [true, 'A name is required to identify this snippet'], trim: true, maxlength: 120 },
    // html: a raw snippet (meta/script/noscript tags); css: a stylesheet body (wrapped in <style>);
    // js: a script body (wrapped in <script>). Validated in utils/website/customCode.js.
    kind: { type: String, enum: ['html', 'css', 'js'], default: 'html' },
    placement: { type: String, required: true, enum: ['head', 'body_start', 'body_end'] },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    scope: { type: String, required: true, enum: ['global', 'page'], default: 'global' },
    page: { type: Schema.Types.ObjectId, ref: 'WebsitePage', default: null },
    code: { type: String, required: [true, 'Snippet code is required'], maxlength: 100000 },
    isEnabled: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

websiteCustomCodeSchema.pre('validate', function (next) {
  if (this.scope === 'page' && !this.page) {
    return next(new Error('A page must be selected for a page-scoped custom code snippet.'));
  }
  if (this.scope === 'global' && this.page) {
    return next(new Error('A global snippet cannot be tied to a specific page.'));
  }
  next();
});

websiteCustomCodeSchema.index({ placement: 1, scope: 1, isEnabled: 1 });

module.exports = model('WebsiteCustomCode', websiteCustomCodeSchema);
