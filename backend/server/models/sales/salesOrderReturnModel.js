const { Schema, model } = require('mongoose');

const salesOrderReturnSchema = new Schema(
  {
    salesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder', required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    returnedQuantity: { type: Number, required: true },
    returnedAmount: { type: Number, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: String
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

module.exports = model('SalesOrderReturn', salesOrderReturnSchema);
