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
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'Variant', required: true },
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

module.exports = model('PurchaseOrderReturn', purchaseOrderReturnSchema);
