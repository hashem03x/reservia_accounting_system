const { Schema, model } = require('mongoose');
const { generatePurchaseOrderCode } = require('../../utils/helper');
// Explicit require (not just the string `ref:` name) - mirrors salesOrderModel.js's convention for
// every model this schema's hooks look up via `this.model(...)`.
require('../accounting/chartOfAccountModel');

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

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
    // Optional - mirrors SalesOrder.project's reference pattern (same Project model, same
    // "select by projectNumber" UX). No vendor<->project relationship exists in the data model
    // (unlike SalesOrder.customer, a project has no concept of "its vendor"), so unlike the Sales
    // Order form this is never filtered down to a subset of projects.
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    // Mirrors SalesOrder's 'account' case exactly (docs section "Payment Methods Must Come From
    // Chart of Accounts") - 'advanced_payment' is deliberately NOT a valid value here. Vendor-side
    // Advanced Payment consumption was explicitly deferred as a future enhancement when the
    // Advanced Payment module was first built (see services/payments/advancedPaymentService.js's
    // header comment) - this does not implement that, only the Cash/Cash-Equivalent case.
    paymentMethod: { type: String, enum: { values: ['account', null], message: '{VALUE} is not a valid payment method' }, default: null },
    paymentAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null },
    items: [
      {
        // warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse' }, // Not used so far
        productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
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
    // VAT/Withholding Tax - mirrors salesOrderModel.js's identical fields/comments exactly (docs
    // sections "VAT on Sales Orders and Purchase Orders" / "Withholding Tax") - percentages are the
    // only client input, amounts are always server-computed in pre('save') below.
    vatPercentage: { type: Number, default: 0, min: [0, 'VAT percentage cannot be negative'] },
    vatAmount: { type: Number, default: 0, min: 0 },
    withholdingTaxPercentage: { type: Number, enum: { values: [0, 1, 3, 5], message: '{VALUE} is not a valid withholding tax percentage' }, default: 0 },
    withholdingTaxAmount: { type: Number, default: 0, min: 0 },
    // = totalAmount + vatAmount - withholdingTaxAmount - the real payable figure (remainingAmount/
    // paymentStatus/the vendor-balance adjustment below are all based on this, not the pre-tax
    // totalAmount). Function default so an order predating this field still reports its real total
    // if read before ever being re-saved.
    grandTotal: { type: Number, default: function () { return this.totalAmount || 0; }, min: 0 },
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

    // Backstop (the fast pre-check lives in poValidator.js) - never trust that `paymentAccount` is
    // actually eligible just because a request validator approved it at some earlier point;
    // re-verified here against the live ChartOfAccount document every time this path is taken.
    if (this.isModified('paymentMethod') || this.isModified('paymentAccount')) {
      if (this.paymentMethod === 'account') {
        if (!this.paymentAccount) throw new Error('A payment account is required when paymentMethod is "account".');
        const ChartOfAccount = this.model('ChartOfAccount');
        const account = await ChartOfAccount.findById(this.paymentAccount).session(this.$session());
        if (!account) throw new Error('The selected payment account does not exist.');
        if (account.type !== 'asset' || !['cash', 'cash-equivalent'].includes(account.state)) {
          throw new Error('The selected payment account must be a Cash or Cash Equivalent account.');
        }
      } else if (this.paymentAccount) {
        throw new Error('paymentAccount can only be set when paymentMethod is "account".');
      }
    }

    for (const item of this.items) {
      item.unitPriceAfterDiscount = calculateUnitPriceAfterDiscount(item.itemDiscount.type, item.itemDiscount.value, item.unitPrice);
      item.starterSubtotal = calculateStarterSubtotal(item.unitPriceAfterDiscount, item.starterQuantity);
      item.subtotal = calculateSubtotal(item.unitPriceAfterDiscount, item.starterQuantity, item.returnedQuantity);
    }

    this.starterTotalAmount = calculateStarterTotalAmount(this.items);
    this.totalAmount = calculateTotalAmount(this.items);

    this.vatAmount = round2((this.totalAmount * (this.vatPercentage || 0)) / 100);
    this.withholdingTaxAmount = round2((this.totalAmount * (this.withholdingTaxPercentage || 0)) / 100);
    this.grandTotal = round2(this.totalAmount + this.vatAmount - this.withholdingTaxAmount);

    this.remainingAmount = calculateRemainingAmount(this.grandTotal, this.paidAmount);
    this.paymentStatus = getPaymentStatus(this.paidAmount, this.grandTotal);

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
    path: 'items.productId',
    select: 'title price priceAfterDiscount category subcategory barcode sku', // categories needed for barcode printing
  });

  this.populate({
    path: 'project',
    select: 'projectNumber name customer',
  });

  this.populate({
    path: 'paymentAccount',
    select: 'code name nameAr',
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

    // Iterate through items to rename productId to product
    if (ret.items) {
      ret.items = ret.items.map(item => {
        if (item.productId) {
          item.product = item.productId;
          delete item.productId;
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
