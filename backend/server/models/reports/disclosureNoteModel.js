const { Schema, model } = require('mongoose');

// Manually maintained supplementary disclosures shown in the "Disclosure Notes" report next to the
// figures calculated from the ledger. Text only - never touches any accounting record.
const disclosureNoteSchema = new Schema(
  {
    title: { type: String, required: [true, 'Title is required'], trim: true, maxlength: 200 },
    titleAr: { type: String, trim: true, maxlength: 200 },
    body: { type: String, required: [true, 'Text is required'], trim: true, maxlength: 10000 },
    bodyAr: { type: String, trim: true, maxlength: 10000 },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

disclosureNoteSchema.index({ sortOrder: 1 });

module.exports = model('DisclosureNote', disclosureNoteSchema);
