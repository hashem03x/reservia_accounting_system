const { Schema, model } = require('mongoose');
const { ProjectStatuses } = require('../../utils/accountingConstants');
const { resolveProjectSector } = require('../../services/project/sectorService');
const { computeProjectExecution } = require('../../utils/projectExecution');
// Explicit require (not just the string `ref:` name) so this model can be used standalone without
// a hard dependency on load order - mirrors journalEntryModel.js's existing convention for the
// same reason.
const ChartOfAccount = require('../accounting/chartOfAccountModel');

// One line of a Project's Average Cost structure (see docs section "Project - Average Cost").
// References a real ChartOfAccount document (never just an account name/label) so the relationship
// is queryable in both directions - see projectModel.js's pre('validate') hook below and
// chartOfAccountController.js#getAccount's `usedInProjectsCount`. `_id: false` matches this
// codebase's existing convention for embedded line items (journalLineSchema, PurchaseOrder.items).
const averageCostLineSchema = new Schema(
  {
    account: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', required: [true, 'Cost account is required'] },
    amount: { type: Number, required: [true, 'Cost amount is required'], min: [0.01, 'Cost amount must be greater than 0'] },
  },
  { _id: false }
);

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
    // Signed contract value. Renamed from `projectAmount` - see docs/entities/projects.md. Plain
    // Number, matching this codebase's existing monetary convention (Product.price,
    // PurchaseOrder.totalAmount, Payment.amountPaid all use Number, not Decimal128).
    // Not `required` at the schema level: the real "Create Project" UI/API independently requires
    // this via createProjectValidators.js (express-validator), so relaxing it here only allows a
    // genuinely partial record (e.g. a project known only by its number, from an external source
    // like an imported journal entry) to be stored honestly instead of forcing a fabricated value
    // to satisfy this constraint.
    contractValue: {
      type: Number,
      min: [0.01, 'Contract value must be greater than 0'],
      default: null,
    },
    // Always derived: contractValue − executed amount (contractValue × executedPercentage / 100),
    // via utils/projectExecution.js - recomputed by the pre('validate') hook below on every save and
    // re-derived again in every API response (toJSON), never accepted from request bodies. Stored
    // (not only virtual) so existing readers/queries of this field keep working.
    remainingMoney: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Renamed from `executor` - see docs/entities/projects.md. A reference to an existing staff
    // User rather than duplicating name/contact info on the Project document, consistent with how
    // PurchaseOrder/Expense reference `createdBy: ref User` instead of embedding staff details.
    // See contractValue above - not `required` at the schema level for the same reason (enforced
    // for real user-submitted projects by createProjectValidators.js instead).
    projectManager: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    startDate: {
      type: Date,
      default: null,
    },
    deliveryDate: {
      type: Date,
      default: null,
    },
    // The project's customer - a real reference into the existing User collection (customers are
    // `role: 'user'` documents, same as SalesOrder.customer - see salesOrderModel.js), never a
    // duplicated/plain-text name. Not `required` at the schema level for the same reason as
    // contractValue/projectManager above (createProjectValidators.js enforces it for real API
    // requests where applicable); left null for records where the source data has no customer.
    customer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Project Average Cost (see docs section "Project - Average Cost"). Each line must reference a
    // `cogs`-type ChartOfAccount (see pre('validate') below) - never an arbitrary account - and the
    // same account can only appear once per project (also enforced below, not just in the
    // frontend). `averageCost` is always derived from these lines, never independently settable.
    averageCostLines: {
      type: [averageCostLineSchema],
      default: [],
    },
    averageCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    // نسبة المنفذ - how much of the project has actually been executed, entered/edited directly by
    // an admin (not derived from contractValue/remainingMoney/averageCost, which track money, not
    // physical/work progress - see docs section "Project - Executed Percentage"). Defaults to 0 for
    // both new projects and any pre-existing project read before this field existed.
    executedPercentage: {
      type: Number,
      default: 0,
      min: [0, 'Executed percentage cannot be less than 0'],
      max: [100, 'Executed percentage cannot be greater than 100'],
    },
    // How much of `executedPercentage` has already had its revenue recognized via the automatic
    // accounting engine's PROJECT_REVENUE_RECOGNITION entry (see
    // services/accounting/accountingEventService.js) - never accepted from a request body, only
    // ever advanced by that posting itself, once it actually commits.
    revenueRecognizedPercentage: { type: Number, default: 0, min: 0, max: 100 },
    // Historical: advanced by the removed PROJECT_COST_RECOGNITION (COGS -> WIP) posting. No longer
    // written; kept so existing project documents keep their stored value.
    costRecognizedPercentage: { type: Number, default: 0, min: 0, max: 100 },
    // Renamed from `department` - see docs/entities/projects.md. Holds the NAME of an admin-managed
    // Sector (models/project/sectorModel.js, Admin -> Sectors) - the field's original string
    // format, so existing projects need no migration. Which names are valid is decided by the
    // Sector collection, never a hardcoded list: the pre('validate') hook below accepts only an
    // existing, active sector whenever this field changes (and stores its canonical name). An
    // unchanged value is never re-checked, so a project keeps a sector that was later deactivated.
    // A sector rename updates this field on every project using it (sectorService.js). `null` (no
    // sector) is a real, settable value; projects created before this field existed simply have it
    // absent, which reads the same as `null`.
    sector: {
      type: String,
      trim: true,
      default: null,
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
  {
    timestamps: true,
    toJSON: {
      // Every Project API response carries the executed and remaining amounts from the same single
      // calculation as the stored value, so a record saved before this rule (stale stored
      // remainingMoney) can never be shown with numbers that contradict its Executed %.
      transform(doc, ret) {
        const execution = computeProjectExecution(ret);
        if (execution) {
          ret.executedAmount = execution.executedAmount;
          ret.remainingMoney = execution.remainingMoney;
        }
        return ret;
      },
    },
  }
);

// Remaining Amount is never independently editable: whenever a project is saved (created, its
// contractValue edited, or its executedPercentage recalculated from Sales Orders), it is
// re-derived from contractValue and executedPercentage. Runs before validation so `min: 0` checks
// the derived value. A project without a usable contractValue keeps its stored value untouched.
// Backstop for `sector` (projectValidators.js is the fast pre-check): a new or changed sector must
// be an existing, active Sector.
projectSchema.pre('validate', async function (next) {
  try {
    if (this.isModified('sector') && this.sector) {
      this.sector = await resolveProjectSector(this.sector, { session: this.$session() });
    }
    next();
  } catch (error) {
    next(error);
  }
});

projectSchema.pre('validate', function (next) {
  const execution = computeProjectExecution(this);
  if (execution) this.remainingMoney = execution.remainingMoney;
  next();
});

projectSchema.index({ projectManager: 1 });
projectSchema.index({ status: 1 });
projectSchema.index({ createdAt: 1 });
projectSchema.index({ sector: 1 });
projectSchema.index({ customer: 1 });
projectSchema.index({ 'averageCostLines.account': 1 });

// Runs before the schema's own `required` checks - only compares when both dates are actually
// present, so a request missing one of them still gets that field's own clear "is required"
// message instead of this check's, and doesn't false-positive on `undefined < undefined`.
projectSchema.pre('validate', function (next) {
  if (this.startDate && this.deliveryDate && this.deliveryDate < this.startDate) {
    return next(new Error('Delivery date cannot be before the start date.'));
  }
  next();
});

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// Backstop for the Average Cost structure - the request validators (projectValidators.js) are only
// a fast pre-check; this is what actually guarantees the invariant no matter which code path
// writes to the document (matches journalEntryModel.js's "validator checks fast, model hook is the
// real backstop" convention):
//   1. no duplicate account across lines (section "Prevent duplicate cost lines")
//   2. every line's account is a real, `cogs`-type account (section "COGS account eligibility") -
//      checked structurally via `type`, never by matching a display name/label
//   3. `averageCost` is always the derived sum, never independently settable
projectSchema.pre('validate', async function (next) {
  if (!this.isModified('averageCostLines')) return next();

  try {
    if (this.averageCostLines.length > 0) {
      const accountIds = this.averageCostLines.map(line => line.account.toString());
      const uniqueIds = new Set(accountIds);
      if (uniqueIds.size !== accountIds.length) {
        throw new Error('Each account can only appear once in a project\'s Average Cost lines.');
      }

      const accounts = await ChartOfAccount.find({ _id: { $in: Array.from(uniqueIds) } }).lean();
      const accountsById = new Map(accounts.map(a => [a._id.toString(), a]));

      for (const id of uniqueIds) {
        const account = accountsById.get(id);
        if (!account) throw new Error('One of the selected Average Cost accounts does not exist.');
        if (account.type !== 'cogs') {
          throw new Error(`Account "${account.code} - ${account.name}" is not eligible for Average Cost (must be a COGS account).`);
        }
      }
    }

    this.averageCost = round2(this.averageCostLines.reduce((sum, line) => sum + (line.amount || 0), 0));
    next();
  } catch (error) {
    next(error);
  }
});

projectSchema.pre(/^find/, function (next) {
  this.where({ isDeleted: { $ne: true } })
    .populate({ path: 'projectManager', select: 'name email role' })
    .populate({ path: 'customer', select: 'name email phone type customerNumber' })
    .populate({ path: 'createdBy', select: 'name' })
    .populate({ path: 'contract.uploadedBy', select: 'name' })
    .populate({ path: 'averageCostLines.account', select: 'code name nameAr type' });
  next();
});

module.exports = model('Project', projectSchema);
