const { Schema, model } = require('mongoose');
const { AccountTypes } = require('../../utils/accountingConstants');
const { normalizeGroupName } = require('../../utils/accountGroupName');

// A Chart of Accounts parent group (Accounting -> Parent Account Groups): a logical classification
// such as "Cash & Cash Equivalents" or "Accounts Receivable". It is NOT a posting account and has
// nothing to do with an account's `parentAccount` link to another ChartOfAccount document.
//
// Accounts keep carrying the group's names in their own `parentGroupNameEn` / `parentGroupNameAr`
// fields (see chartOfAccountModel.js) - every report and business rule already reads those, so
// they stay the stored classification. This collection is the managed list those values are picked
// from; services/accounting/accountParentGroupService.js keeps the two in step (an account's group
// is matched by normalized English name, and renaming a group renames it on its accounts too).
// All rules live in that service; this schema backs up the invariants every write must respect.
const accountParentGroupSchema = new Schema(
  {
    nameEn: {
      type: String,
      required: [true, 'English group name is required'],
      trim: true,
      maxlength: [100, 'English group name cannot exceed 100 characters'],
    },
    nameAr: {
      type: String,
      required: [true, 'Arabic group name is required'],
      trim: true,
      maxlength: [100, 'Arabic group name cannot exceed 100 characters'],
    },
    // Normalized copies (utils/accountGroupName.js) - what uniqueness is decided on, so
    // "Cash  &  cash equivalents" can never be created next to "Cash & Cash Equivalents".
    nameEnKey: { type: String, select: false },
    nameArKey: { type: String, select: false },
    // Every account classified under the group must have this same type.
    type: {
      type: String,
      enum: { values: AccountTypes, message: '{VALUE} is not a valid account type' },
      required: [true, 'Account type is required'],
    },
    description: { type: String, trim: true, maxlength: [500, 'Description cannot exceed 500 characters'], default: '' },
    sortOrder: { type: Number, default: 0 },
    // Inactive: kept on the accounts already classified under it, but not offered for new ones.
    isActive: { type: Boolean, default: true },
    // A group an automatic business rule reads by name (e.g. Cash & Cash Equivalents decides which
    // accounts are payment methods) - it cannot be renamed, retyped, deactivated or deleted.
    isSystemDefault: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

accountParentGroupSchema.index({ nameEnKey: 1 }, { unique: true });
accountParentGroupSchema.index({ nameArKey: 1 }, { unique: true });
accountParentGroupSchema.index({ type: 1, sortOrder: 1 });
accountParentGroupSchema.index({ isActive: 1 });

accountParentGroupSchema.pre('validate', function (next) {
  this.nameEnKey = normalizeGroupName(this.nameEn);
  this.nameArKey = normalizeGroupName(this.nameAr);
  next();
});

module.exports = model('AccountParentGroup', accountParentGroupSchema);
