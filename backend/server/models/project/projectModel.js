const { Schema, model } = require('mongoose');
const { ProjectStatuses } = require('../../utils/accountingConstants');

// Contract attachment - a single optional document, not the `documents[]` array shape used by
// Customer/Vendor (businessPartnerSchemas.js's businessDocumentSchema), since a project has at
// most one current contract file (replace semantics, not multiple typed documents). Reuses the
// same Cloudinary `resource_type: 'raw'` PDF pipeline (middleware/documentUploadMiddleware.js).
const projectContractSchema = new Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    filename: { type: String },
    mimeType: { type: String },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const projectSchema = new Schema(
  {
    // Business key / display identifier. Deliberately NOT the Mongo _id (see master spec's
    // "PROJECT NUMBER" section) - other modules (JournalEntry.project) reference the project by
    // its ObjectId and denormalize this string only for display.
    projectNumber: {
      type: String,
      required: [true, 'Project number is required'],
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    // Contract/project value. Plain Number, matching this codebase's existing monetary convention
    // (Product.price, PurchaseOrder.totalAmount, Payment.amountPaid all use Number, not
    // Decimal128 - see reversia-business-logic.md) - introducing a different money representation
    // only for Project would make it the one field that can't be arithmetic'd against the rest of
    // the app's money fields without a conversion step.
    projectAmount: {
      type: Number,
      required: [true, 'Project amount is required'],
      min: [0.01, 'Project amount must be greater than 0'],
    },
    // Automatically derived (projectAmount minus confirmed Payment receipts linked to this
    // project via Payment.projectId - see paymentModel.js) - never accepted from request bodies.
    // Defaults to the full projectAmount at creation since no payments exist yet. See
    // services/project/projectAccountingService.js#recalculateRemainingMoney.
    remainingMoney: {
      type: Number,
      default: 0,
      min: 0,
    },
    // المنفذ (executor) - a reference to an existing staff User rather than duplicating
    // name/contact info on the Project document, consistent with how PurchaseOrder/Expense
    // reference `createdBy: ref User` instead of embedding staff details.
    executor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Executor is required'],
    },
    status: {
      type: String,
      enum: { values: ProjectStatuses, message: '{VALUE} is not a valid project status' },
      default: 'active',
    },
    contract: {
      type: projectContractSchema,
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

projectSchema.index({ executor: 1 });
projectSchema.index({ status: 1 });
projectSchema.index({ createdAt: 1 });

projectSchema.pre(/^find/, function (next) {
  this.where({ isDeleted: { $ne: true } })
    .populate({ path: 'executor', select: 'name email role' })
    .populate({ path: 'createdBy', select: 'name' })
    .populate({ path: 'contract.uploadedBy', select: 'name' });
  next();
});

module.exports = model('Project', projectSchema);
