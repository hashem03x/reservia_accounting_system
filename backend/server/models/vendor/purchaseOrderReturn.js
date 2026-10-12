const { Schema, model } = require('mongoose');

const purchaseOrderReturnSchema = new Schema(
  {
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
    // items: [{
    //   variant: { type: Schema.Types.ObjectId, ref: 'Variant', required: true },
    //   quantity: { type: Number, required: true },
    //   reason: { type: String, enum: ['defective', 'wrong_item', 'not_needed', 'other'], default: 'other', required: true },
    //   returnAmount: { type: Number, required: true },
    //   notes: String
    // }],
    // Null for a returned service (no stock moves).
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    returnedQuantity: { type: Number, required: true },
    returnedAmount: { type: Number, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // The AccountingReversal (services/accounting/reversalService.js) this return line belongs to.
    reversal: { type: Schema.Types.ObjectId, ref: 'AccountingReversal', default: null },
    notes: String
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

module.exports = model('PurchaseOrderReturn', purchaseOrderReturnSchema);
