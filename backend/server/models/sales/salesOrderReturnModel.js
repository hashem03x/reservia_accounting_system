const { Schema, model } = require('mongoose');

const salesOrderReturnSchema = new Schema(
  {
    salesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder', required: true },
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

module.exports = model('SalesOrderReturn', salesOrderReturnSchema);
