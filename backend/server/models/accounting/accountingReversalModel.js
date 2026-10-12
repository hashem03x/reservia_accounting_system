const { Schema, model } = require('mongoose');

// One record per reversal operation (services/accounting/reversalService.js): a sales or purchase
// return, a payment reversal or a settlement (advance application) reversal. It links the business
// document, the original journal entries, the compensating entries the reversal posted, the
// return / refund records it created, who did it, when and why. Original documents and entries are
// never deleted or edited to hide an operation - this record and the reversal entries are the trail.
//
// `idempotencyKey` is unique: a retried or concurrent request with the same key returns the first
// result instead of reversing twice.
const REVERSAL_TYPES = ['sales_return', 'purchase_return', 'payment', 'settlement'];

const reversedItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const accountingReversalSchema = new Schema(
  {
    type: { type: String, enum: REVERSAL_TYPES, required: true },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 200 },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    date: { type: Date, required: true },
    // Full or partial (returns); a payment / settlement reversal is always full.
    scope: { type: String, enum: ['full', 'partial'], required: true },

    salesOrder: { type: Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    advancedPayment: { type: Schema.Types.ObjectId, ref: 'AdvancedPayment', default: null },
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },

    items: { type: [reversedItemSchema], default: [] },
    // Document amount reversed: the order total given back by a return (incl. VAT, less WHT), or the
    // payment / settlement amount.
    amount: { type: Number, required: true, min: 0 },
    returnRecords: [{ type: Schema.Types.ObjectId }],
    refundPayment: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    refundAmount: { type: Number, default: 0, min: 0 },

    originalEntries: [{ type: Schema.Types.ObjectId, ref: 'JournalEntry' }],
    reversalEntries: [{ type: Schema.Types.ObjectId, ref: 'JournalEntry' }],
    // Anything the reader should know (e.g. a legacy payment that never had a journal entry).
    notes: [{ type: String }],

    status: { type: String, enum: ['completed'], default: 'completed' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

accountingReversalSchema.index({ idempotencyKey: 1 }, { unique: true });
accountingReversalSchema.index({ salesOrder: 1, createdAt: -1 });
accountingReversalSchema.index({ purchaseOrder: 1, createdAt: -1 });
accountingReversalSchema.index({ payment: 1 });
accountingReversalSchema.index({ advancedPayment: 1, createdAt: -1 });

module.exports = model('AccountingReversal', accountingReversalSchema);
module.exports.REVERSAL_TYPES = REVERSAL_TYPES;
