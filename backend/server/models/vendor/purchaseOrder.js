const { Schema, model } = require('mongoose');
const { generatePurchaseOrderCode } = require('../../utils/helper');

// const { createCanvas } = require('canvas');
// const JsBarcode = require('jsbarcode');
// const fs = require('fs/promises');
// const BASE_URL = process.env.PROD_URL || 'http://localhost:3000/api/v1';

const purchaseOrderSchema = new Schema(
  {
    code: {
      type: String,
      unique: true,
    },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    items: [
      {
        // warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse' }, // Not used so far
        variantId: { type: Schema.Types.ObjectId, ref: 'Variant', required: true },
        unitPrice: { type: Number, required: true, min: 0 },
        itemDiscount: {
          type: { type: String, enum: ['percentage', 'fixed'], default: 'fixed' },
          value: { type: Number, default: 0, min: 0 },
        },
        // costPrice: { type: Number, required: true, min: 0 }, // Not used so far
        unitPriceAfterDiscount: { type: Number, min: 0 },
        starterQuantity: { type: Number, required: true, min: 0 },
        starterSubtotal: { type: Number, min: 0 },
        returnedQuantity: { type: Number, default: 0, min: 0 },
        subtotal: { type: Number, min: 0 }, // Final Subtotal After calculating returned quantity
      },
    ],
    starterTotalAmount: { type: Number, min: 0 },
    totalAmount: { type: Number, min: 0 },
    paidAmount: { type: Number, min: 0, default: 0 },
    remainingAmount: { type: Number },
    paymentStatus: { type: String, enum: ['unpaid', 'partial', 'paid', 'unknown'], default: 'unpaid' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// =============================================================
// Utility functions
// =============================================================

// calc unitPriceAfterDiscount
const calculateUnitPriceAfterDiscount = (type, value, unitPrice) => {
  const discount = type === 'percentage' ? (unitPrice * value) / 100 : value;
  return unitPrice - discount;
};

// calc starterSubtotal
const calculateStarterSubtotal = (unitPriceAfterDiscount, quantity) => {
  return unitPriceAfterDiscount * quantity;
};

// calc subtotal
const calculateSubtotal = (unitPriceAfterDiscount, quantity, returnedQuantity) => {
  return unitPriceAfterDiscount * (quantity - returnedQuantity);
};

// calc starterTotalAmount
const calculateStarterTotalAmount = items => {
  return items.reduce((acc, item) => acc + item.starterSubtotal, 0);
};

// calc totalAmount
const calculateTotalAmount = items => {
  return items.reduce((acc, item) => acc + item.subtotal, 0);
};

// calc remainingAmount
const calculateRemainingAmount = (totalAmount, paidAmount) => {
  return totalAmount - paidAmount;
};

const getPaymentStatus = (paidAmount, totalAmount) => {
  if (paidAmount === totalAmount) return 'paid';
  if (paidAmount > 0 && paidAmount < totalAmount) return 'partial';
  if (paidAmount === 0) return 'unpaid';
  return 'unknown';
};

// =============================================================
// Middleware
// =============================================================

// Pre-save middleware
purchaseOrderSchema.pre('save', async function (next) {
  try {
    // Generate unique code for new purchase orders if not provided
    if (this.isNew && !this.code) {
      this.code = await generatePurchaseOrderCode();
    }

    for (const item of this.items) {
      item.unitPriceAfterDiscount = calculateUnitPriceAfterDiscount(item.itemDiscount.type, item.itemDiscount.value, item.unitPrice);
      item.starterSubtotal = calculateStarterSubtotal(item.unitPriceAfterDiscount, item.starterQuantity);
      item.subtotal = calculateSubtotal(item.unitPriceAfterDiscount, item.starterQuantity, item.returnedQuantity);
    }

    this.starterTotalAmount = calculateStarterTotalAmount(this.items);
    this.totalAmount = calculateTotalAmount(this.items);
    this.remainingAmount = calculateRemainingAmount(this.totalAmount, this.paidAmount);
    this.paymentStatus = getPaymentStatus(this.paidAmount, this.totalAmount);

    // Only update vendor balance on creation (not on update). By the way there is no purchase order updation.
    if (this.isNew) {
      const vendor = await this.model('Vendor').findById(this.vendorId).session(this.$session());
      if (vendor) {
        vendor.balance += this.remainingAmount;
        await vendor.save({ session: this.$session() });
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Populate fields
purchaseOrderSchema.pre(/^find/, function () {
  this.populate({
    path: 'vendorId',
    select: 'name contact',
  });

  this.populate({
    path: 'createdBy',
    select: 'name',
  });

  this.populate({
    path: 'items.variantId',
    select: '-stock',
    populate: {
      path: 'productId',
      select: 'title price priceAfterDiscount category subcategory', // categories needed for barcode printing
      options: { populateVariants: false },
    },
  });
});

// Transform response format
purchaseOrderSchema.set('toJSON', {
  transform: function (doc, ret) {
    // Rename vendorId to vendor
    if (ret.vendorId) {
      ret.vendor = ret.vendorId;
      delete ret.vendorId;
    }

    // Iterate through items to rename variantId to variant and productId to product inside variant
    if (ret.items) {
      ret.items = ret.items.map(item => {
        if (item.variantId) {
          const variant = item.variantId;

          // Rename productId to product inside variant
          if (variant.productId) {
            variant.product = variant.productId;
            delete variant.productId;
          }

          // Assign modified variant back to item
          item.variant = variant;
          delete item.variantId;
        }

        return item;
      });
    }

    return ret;
  },
});

module.exports = model('PurchaseOrder', purchaseOrderSchema);

// =============================================================

// Function to generate barcodes
// const generateBarcode = async (items) => {
//   for (const item of items) {
//     try {
//       const { variantId } = item;
//       // find variant by ids
//       const variant = await Variant.findById(variantId);
//       if (variant) {
//         const barcodeData = `sku:${variant.sku}\nprice:${variant.price}`;
//         // store barcode as image with canva
//         const canvas = createCanvas(400, 100);
//         JsBarcode(canvas, barcodeData, {
//           format: 'CODE128',
//           width: 2,
//           height: 100,
//           displayValue: true,
//         });

//         const buffer = canvas.toBuffer('image/avif');
//         const filePath = `/uploads/barcodes/${variant.sku}.avif`;
//         await fs.writeFile(`./public${filePath}`, buffer);

//         item.barCode = `${BASE_URL}${filePath}`;
//       }
//     } catch (error) {
//       console.error('Error generating barcode:', error);
//       throw new Error(`Failed to generate barcode for item with variant ID: ${item.variantId}`);
//     }
//   }
// };
