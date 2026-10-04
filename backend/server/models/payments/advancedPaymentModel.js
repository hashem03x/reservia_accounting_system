const { Schema, model } = require('mongoose');
// Explicit requires (not just the string `ref:` names) - mirrors journalEntryModel.js/
// projectModel.js's existing convention for every model this schema's hooks populate or
// cross-validate against.
const Project = require('../project/projectModel');
const { isPaymentAccountEligible } = require('../../utils/accountingConstants');
require('../accounting/chartOfAccountModel');

// A single consumption (or reversal of a consumption) of an Advanced Payment - this is the audit
// trail required by docs section "Advanced Payment - Audit/History": `remainingAmount` alone
// can't answer "why did this become zero", so every state change is recorded here instead of only
// being inferable from the current balance. `_id: false` matches this codebase's existing
// convention for embedded line items (journalLineSchema, PurchaseOrder.items).
const usageEntrySchema = new Schema(
  {
    salesOrder: { type: Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
    // Reserved for the future vendor-side consumption path (Purchase Orders) - see docs section
    // "Vendor Advanced Payments". Nothing sets this yet.
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
    amountConsumed: { type: Number, required: true },
    // Set true when a later reversal (e.g. a cancelled Sales Order) restores the amount this entry
    // consumed - the original entry is kept (never deleted/mutated otherwise), and `reversed: true`
    // is what tells a reader the restoration already happened for it.
    reversed: { type: Boolean, default: false },
    note: { type: String, trim: true, default: null },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

const advancedPaymentSchema = new Schema(
  {
    type: {
      type: String,
      enum: { values: ['customer', 'vendor'], message: '{VALUE} is not a valid advanced payment type' },
      required: [true, 'Advanced payment type is required'],
    },
    // Customers are User documents with role 'user' (see docs/entities/customers.md) - same
    // reference convention as SalesOrder.customer/Payment.customerId, never a separate Customer
    // collection.
    customer: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null },
    // Required for `type: 'customer'` (the core "Customer + Project -> available advance" flow this
    // feature exists for) - optional for `type: 'vendor'`, since a vendor advance is not always tied
    // to a specific project. See the pre('validate') hook below for the actual enforcement.
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0.01, 'Amount must be greater than 0'],
    },
    // Never accepted from a request body - always set to `amount` on creation, then only ever
    // decreased by consumeAdvancedPayment()/increased by restoreAdvancedPayment() (see
    // services/payments/advancedPaymentService.js). The controller strips any client-supplied value
    // the same way chartOfAccountController.js strips a client-supplied sortOrder.
    remainingAmount: { type: Number, default: 0, min: 0 },
    // Free-text, matching this codebase's existing currency convention (JournalEntry line's
    // `currency` field is also a plain string, not a dedicated Currency collection/enum - no such
    // collection exists in Reservia today) - not hardcoded to a single currency.
    currency: { type: String, trim: true, default: null },
    // The Cash/Cash-Equivalent ChartOfAccount this advance was actually received into/paid from -
    // mirrors salesOrderModel.js/purchaseOrder.js/paymentModel.js's identical `paymentAccount`
    // field+validation convention. Required for every NEW advance (docs section "Advanced Payment
    // Payment Method") - the automatic accounting engine's ADVANCE_PAYMENT_RECEIVED_CUSTOMER/
    // ADVANCE_PAYMENT_PAID_VENDOR journal entries need a real account to post the cash/bank side of
    // the entry against (see services/accounting/accountingEventService.js). Not required at the
    // schema level with Mongoose's own `required: true` (which would also reject `null` on legacy
    // documents being re-saved for an unrelated reason) - enforced instead in the pre('validate')
    // hook below, scoped to `this.isNew`, so advances created before this field existed stay valid.
    paymentAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null },
    reference: { type: String, trim: true, default: null },
    notes: { type: String, trim: true, default: null },
    status: {
      type: String,
      enum: { values: ['available', 'partially_used', 'fully_used', 'cancelled'], message: '{VALUE} is not a valid advanced payment status' },
      default: 'available',
    },
    usageHistory: { type: [usageEntrySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Matches the two real lookup shapes this feature needs (docs section "Database indexes"):
// "available Customer Advanced Payment for this Project" and the vendor equivalent - avoids a
// full-collection scan on the exact query consumeAdvancedPayment()/getAvailableAdvancedPayment()
// run on every applicable Sales Order creation.
advancedPaymentSchema.index({ customer: 1, project: 1, type: 1, status: 1 });
advancedPaymentSchema.index({ vendor: 1, project: 1, type: 1, status: 1 });

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// Backstop validation - the request validators (advancedPaymentValidators.js) are only a fast
// pre-check; this runs no matter which code path writes to the document (matches
// projectModel.js's/journalEntryModel.js's established "validator checks fast, model hook is the
// real backstop" convention).
advancedPaymentSchema.pre('validate', async function (next) {
  try {
    if (this.type === 'customer') {
      if (!this.customer) throw new Error('A customer is required for a customer advanced payment.');
      this.vendor = null;
      if (!this.project) throw new Error('A project is required for a customer advanced payment.');
    } else if (this.type === 'vendor') {
      if (!this.vendor) throw new Error('A vendor is required for a vendor advanced payment.');
      this.customer = null;
    }

    // The single most important rule this whole feature depends on: an Advanced Payment can never
    // be attached to a project belonging to a different customer than the one it was created for
    // (docs section "Project Customer Validation") - checked here against the live Project
    // document, never trusted from the request body alone.
    if (this.project && this.type === 'customer') {
      // This document's own `project`/`customer` paths are populated objects (not raw ObjectIds)
      // whenever this hook re-runs on `.save()` of a document that was `find()`-fetched - this
      // schema's own pre(/^find/) hook populates both. Normalize before using either as an id.
      const thisProjectId = this.project?._id || this.project;
      const thisCustomerId = this.customer?._id || this.customer;

      const project = await Project.findById(thisProjectId).lean();
      if (!project) throw new Error('Project not found.');
      // Project.findById() runs Project's OWN pre(/^find/) hook, which populates `customer` into
      // `{_id, name, ...}` - comparing `.toString()` directly on that would always mismatch (it
      // stringifies to "[object Object]", not the hex id), so the populated doc's `_id` is used
      // when present.
      const projectCustomerId = project.customer?._id || project.customer;
      if (!projectCustomerId || projectCustomerId.toString() !== thisCustomerId.toString()) {
        throw new Error('This project does not belong to the selected customer.');
      }
    }

    if (this.isNew) {
      // Ignore any client-supplied remainingAmount entirely - always starts equal to the full
      // amount, regardless of what (if anything) was sent.
      this.remainingAmount = this.amount;
    }

    // Required for every new advance (see the field's own comment above) - checked here, not just
    // via Mongoose's `required`, so a legacy document re-saved for an unrelated reason is never
    // retroactively rejected for a field it predates.
    if (this.isNew && !this.paymentAccount) {
      throw new Error('A payment method (Cash or Cash Equivalent account) is required.');
    }

    // Backstop (mirrors salesOrderModel.js/purchaseOrder.js/paymentModel.js's identical check) -
    // never trust that `paymentAccount` is actually eligible just because a request validator
    // approved it at some earlier point.
    if (this.paymentAccount) {
      const ChartOfAccount = this.model('ChartOfAccount');
      const accountId = this.paymentAccount?._id || this.paymentAccount;
      const account = await ChartOfAccount.findById(accountId).session(this.$session());
      if (!account) throw new Error('The selected payment account does not exist.');
      if (!isPaymentAccountEligible(account)) {
        throw new Error('The selected payment account must be a Cash or Cash Equivalent account.');
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Keeps `status` always consistent with `remainingAmount` - an explicit cancellation (status set to
// 'cancelled' by the dedicated cancel action, see advancedPaymentController.js) is the one state
// this never overrides, since a cancelled advance must stay cancelled regardless of what its
// remainingAmount happens to be.
advancedPaymentSchema.pre('save', function (next) {
  if (this.status !== 'cancelled') {
    if (this.remainingAmount <= 0) this.status = 'fully_used';
    else if (round2(this.remainingAmount) < round2(this.amount)) this.status = 'partially_used';
    else this.status = 'available';
  }
  next();
});

advancedPaymentSchema.pre(/^find/, function (next) {
  this.populate({ path: 'customer', select: 'name email phone type customerNumber' })
    .populate({ path: 'vendor', select: 'name contact' })
    .populate({ path: 'project', select: 'projectNumber name customer' })
    .populate({ path: 'paymentAccount', select: 'code name nameAr' })
    .populate({ path: 'createdBy', select: 'name' })
    .populate({ path: 'usageHistory.salesOrder', select: 'code totalAmount paidAmount' });
  next();
});

module.exports = model('AdvancedPayment', advancedPaymentSchema);
