const { Schema, model } = require('mongoose');
const generateBarcode = require('../../utils/generateBarcode');

const variantSchema = Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    color: { type: String, required: true },
    size: { type: String, required: true },
    variantCode: { type: String, default: () => generateBarcode().toString(), unique: true },
    sku: { type: String },

    stock: [
      {
        warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
        quantity: { type: Number, required: true },
        starterQuantity: { type: Number, default: this.quantity },
      },
    ],

    isDeleted: { type: Boolean, default: false },

    // Not used
    stockStatus: { type: String, enum: ['in_stock', 'out_of_stock', 'running_low'], default: 'in_stock' },
    stockLevel: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

variantSchema.index({ _id: 1, sku: 1, color: 1, size: 1 }, { unique: true });

module.exports = model('Variant', variantSchema);
