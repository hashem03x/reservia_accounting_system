const { Schema, model } = require('mongoose');
const { getNextRequisitionCode } = require('../../services/shared/orderNumberService');
const { documentPaymentTermsSchema } = require('../shared/paymentTermsSchema');
const { validateDocumentPaymentTerms, computeDocumentPaymentSchedule } = require('../../utils/documentPaymentTerms');

// "Purchase Order" (user-facing name) - internally named Requisition because the Mongoose model
// name `PurchaseOrder` is already taken by the EXISTING vendor/purchaseOrder.js model, which a
// prior phase renamed to "Purchase Invoice" in the UI only (its internal model/collection/route
// names are unchanged: `PurchaseOrder`, `purchaseorders`, `/api/v1/purchaseOrder`). Label vs.
// internal-key already differ for that exact model today (`resources.purchaseOrders.label` is
// "Purchase Invoices") - this is the same pattern again, not a new one.
//
// This is a PURELY OPERATIONAL document: a vendor/project-scoped request to purchase, used only to
// track how much of itself has been invoiced. It has NO tax fields, NO payment fields, and -
// critically - posts NO journal entries and touches NO accounting balance, ever. Every accounting
// effect (journal entries, vendor balance, project WIP, inventory) continues to come exclusively
// from the existing Purchase Invoice (`vendor/purchaseOrder.js`) flow, which now requires a
// Requisition to be selected (see that file's `requisition` field) but is otherwise unchanged.
//
// `invoicedAmount` is the ONE cached/mutable field here (everything else - remainingAmount,
// executedPercentage, the effective display status - is derived, never stored, to avoid
// maintaining duplicated totals that could drift). It is updated ONLY via the guarded atomic
// increment in `purchaseOrderController.js#createPO` (and the matching decrement from a return),
// mirroring the same atomic-counter pattern used throughout this codebase
// (services/shared/orderNumberService.js, services/project/projectNumberService.js) - never a
// plain `requisition.invoicedAmount += x; await requisition.save()`, which would not be safe
// under concurrent invoice creation.
const requisitionItemSchema = new Schema(
  {
    // The catalog product/service this line is for. Required for every NEW line by the request
    // validators and controller (client requirement "Purchase Orders - Product Search Instead of
    // Free-Text Description"); not required here because Purchase Orders created before that rule
    // (and CSV-imported description-only lines) have lines without one, and must stay readable.
    product: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    // Line notes / purchase-specific details. For a line with a product it defaults to the product's
    // name; for a legacy line without a product it is the line's only identification.
    description: { type: String, required: [true, 'Each line needs a description'], trim: true },
    quantity: { type: Number, required: [true, 'Each line needs a quantity'], min: [0.0001, 'Quantity must be greater than 0'] },
    unit: { type: String, trim: true, default: null },
    unitPrice: { type: Number, required: [true, 'Each line needs a unit price'], min: [0, 'Unit price cannot be negative'] },
    // = quantity * unitPrice - server-computed, never trusted from the client (see pre('save')
    // below).
    lineTotal: { type: Number, min: 0 },
  },
  { _id: false }
);

const requisitionSchema = new Schema(
  {
    code: { type: String, unique: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: [true, 'Vendor is required'] },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: [true, 'Project is required'] },
    items: {
      type: [requisitionItemSchema],
      validate: { validator: v => Array.isArray(v) && v.length > 0, message: 'A Purchase Order needs at least one line item.' },
    },
    // = sum of items[].lineTotal - server-computed (docs section "Purchase Order fields").
    amount: { type: Number, default: 0, min: 0 },
    // The date the Purchase Order was issued - the date every installment's tenor is counted from.
    // Defaults to the creation date; Purchase Orders created before this field use createdAt.
    issueDate: { type: Date, default: Date.now },
    // Vendor payment terms of THIS Purchase Order (immediate / lump sum / installments) - see
    // utils/documentPaymentTerms.js. Starts from the vendor's default terms when not given at
    // creation. Contractual only: never creates a payment or marks anything paid. null on Purchase
    // Orders created before this field existed.
    paymentTerms: { type: documentPaymentTermsSchema, default: null },
    notes: { type: String, trim: true },
    // 'draft' - still being edited, not yet eligible for invoicing.
    // 'open' - finalized; eligible for Purchase Invoices to reference, until fully invoiced.
    // 'cancelled' - permanently closed; never eligible, blocked once invoicedAmount > 0 (see
    // requisitionController.js#cancelRequisition - a partially/fully invoiced PO cannot be
    // cancelled, since its invoices are separate, already-posted accounting documents).
    // 'partially_invoiced'/'fully_invoiced' are DERIVED display states (see toJSON transform
    // below) from `status==='open'` + `invoicedAmount` - never stored directly, so they can never
    // drift out of sync with the real invoiced total.
    status: { type: String, enum: ['draft', 'open', 'cancelled'], default: 'draft' },
    invoicedAmount: { type: Number, default: 0, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // The CSV's own grouping identifier for a Purchase Order imported via the CSV Import System
    // (docs section "Purchase Order CSV Import") - absent for every manually-created Purchase
    // Order (the create form never sets this). Unique+sparse so re-submitting (or concurrently
    // submitting) the same CSV file can never create a second Purchase Order for the same
    // POReference: the second attempt hits a real E11000 here, which
    // services/csvImport/groupedCsvImportRunner.js already translates into a clean per-row error,
    // rather than a new, independently-maintained idempotency mechanism.
    // Deliberately NO `default: null` - Mongoose would then set the field to `null` on every
    // document (never actually absent), which defeats `sparse` (a sparse index only skips a
    // field that is genuinely MISSING, not one present with value `null`) and made the unique
    // index reject the second Purchase Order ever created, imported or not. Leaving no default
    // keeps the field truly absent unless an importer sets it.
    importReference: { type: String, unique: true, sparse: true, trim: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        const amount = ret.amount || 0;
        const invoiced = ret.invoicedAmount || 0;
        ret.remainingAmount = Math.max(0, Math.round((amount - invoiced) * 100) / 100);
        ret.executedPercentage = amount > 0 ? Math.round((invoiced / amount) * 10000) / 100 : 0;
        ret.effectiveStatus = ret.status === 'cancelled' ? 'cancelled' : invoiced <= 0 ? 'open' : invoiced >= amount ? 'fully_invoiced' : 'partially_invoiced';
        if (ret.status === 'draft') ret.effectiveStatus = 'draft';
        // The concrete schedule (amounts, due dates, allocated / unallocated) is derived from the
        // CURRENT value and issue date on every read, so it can never drift from them.
        ret.paymentSchedule = ret.paymentTerms ? computeDocumentPaymentSchedule(ret.paymentTerms, { total: amount, issueDate: ret.issueDate || ret.createdAt }) : null;
        return ret;
      },
    },
  }
);

requisitionSchema.index({ vendorId: 1 });
requisitionSchema.index({ project: 1 });
requisitionSchema.index({ status: 1 });

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

requisitionSchema.pre('save', async function (next) {
  try {
    if (this.isNew && !this.code) {
      this.code = await getNextRequisitionCode(this.$session());
    }

    for (const item of this.items) {
      item.lineTotal = round2((item.quantity || 0) * (item.unitPrice || 0));
    }
    this.amount = round2(this.items.reduce((sum, item) => sum + (item.lineTotal || 0), 0));

    // Backstop for the payment terms against the (possibly just changed) Purchase Order value: a
    // value change recalculates percentage installments, but fixed amounts can no longer exceed it.
    if (this.paymentTerms && (this.isNew || this.isModified('paymentTerms') || this.isModified('items') || this.isModified('issueDate'))) {
      const terms = typeof this.paymentTerms.toObject === 'function' ? this.paymentTerms.toObject() : this.paymentTerms;
      const error = validateDocumentPaymentTerms(terms, { total: this.amount, issueDate: this.issueDate || this.createdAt || new Date() });
      if (error) throw new Error(error);
    }

    next();
  } catch (error) {
    next(error);
  }
});

requisitionSchema.pre(/^find/, function (next) {
  this.populate({ path: 'vendorId', select: 'name vendorNumber contact.phone contact.email' })
    .populate({ path: 'project', select: 'projectNumber name' })
    .populate({ path: 'items.product', select: 'title type category subcategory brand model specifications sku' })
    .populate({ path: 'createdBy', select: 'name' });
  next();
});

module.exports = model('Requisition', requisitionSchema);
