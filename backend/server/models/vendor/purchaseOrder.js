const { Schema, model } = require('mongoose');
const { generatePurchaseOrderCode } = require('../../utils/helper');
const { isPaymentAccountEligible } = require('../../utils/accountingConstants');
// Explicit requires (not just the string `ref:` names) - mirrors salesOrderModel.js's convention
// for every model this schema's hooks look up via `this.model(...)` or populate.
require('../accounting/chartOfAccountModel');
require('../payments/advancedPaymentModel');
const { computeOrderTotals } = require('../../utils/orderTotals');

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
    // Mandatory for every NEW order (docs section "Purchase Orders - Project is Required") -
    // enforced in the pre('save') hook below, scoped to `isNew`. Mirrors SalesOrder.project's
    // reference pattern (same Project model, same "select by projectNumber" UX). No vendor<->
    // project relationship exists in the data model (unlike SalesOrder.customer, a project has no
    // concept of "its vendor"), so unlike the Sales Order form this is never filtered down to a
    // subset of projects.
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    // Mirrors SalesOrder's 'account'/'advanced_payment' cases (docs section "Payment Methods Must
    // Come From Chart of Accounts" / "Vendor Advanced Payments"). 'advanced_payment' consumes the
    // vendor's existing AdvancedPayment balance (see services/payments/advancedPaymentService.js#
    // consumeVendorAdvancedPayment) and posts PO_SUPPLIER_ADVANCE_APPLIED instead of requiring a
    // paymentAccount.
    paymentMethod: { type: String, enum: { values: ['account', 'advanced_payment', null], message: '{VALUE} is not a valid payment method' }, default: null },
    paymentAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null },
    // Set only when paymentMethod === 'advanced_payment' - the specific vendor AdvancedPayment this
    // order consumed, mirroring SalesOrder.advancedPayment's identical reversal-support purpose.
    advancedPayment: { type: Schema.Types.ObjectId, ref: 'AdvancedPayment', default: null },
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
        // Quantity of this received line moved from the warehouse to the PO's project (PUC) - net of
        // allocations released by returns (services/inventory/poProjectAllocationService.js).
        allocatedQuantity: { type: Number, default: 0, min: 0 },
        // LEGACY - no longer used for accounting. Service purchases now always post to the
        // Service's own PUC Account (Product.pucAccount, see accountingEventService.js#
        // postPurchaseOrderJournalEntries, PO_SERVICE_TO_WIP). Kept on the schema only so existing
        // orders that carry it stay readable/valid.
        costAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null },
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
    // = totalAmount + vatAmount - withholdingTaxAmount - the canonical ORDER TOTAL AMOUNT
    // (utils/orderTotals.js) and the real payable figure (remainingAmount/
    // paymentStatus/the vendor-balance adjustment below are all based on this, not the pre-tax
    // totalAmount). Function default so an order predating this field still reports its real total
    // if read before ever being re-saved.
    grandTotal: { type: Number, default: function () { return this.totalAmount || 0; }, min: 0 },
    paidAmount: { type: Number, min: 0, default: 0 },
    remainingAmount: { type: Number },
    paymentStatus: { type: String, enum: ['unpaid', 'partial', 'paid', 'unknown'], default: 'unpaid' },
    // Automatic allocation of the received stock lines to the PO's project (PUC): 'allocated' once
    // every received quantity is on the project; 'not_applicable' for an order with no project or
    // no stock lines; null for an order created before automatic allocation existed.
    projectAllocation: {
      status: { type: String, enum: ['allocated', 'not_applicable', null], default: null },
      at: { type: Date, default: null },
    },
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

    // Project is mandatory for every NEW Purchase Order (docs section "Purchase Orders - Project is
    // Required") - the fast pre-check lives in poValidator.js; this is the real backstop so a
    // direct API call can never bypass it. Scoped to `isNew` (not a plain schema-level `required`)
    // so a historical order created before this rule existed stays valid when re-saved (e.g. a
    // Payment recording against it, see paymentModel.js).
    if (this.isNew && !this.project) {
      throw new Error('A project is required to create a Purchase Order.');
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
        if (!isPaymentAccountEligible(account)) {
          throw new Error('The selected payment account must be a Cash or Cash Equivalent account.');
        }
      } else if (this.paymentAccount) {
        throw new Error('paymentAccount can only be set when paymentMethod is "account".');
      }

      if (this.paymentMethod !== 'advanced_payment' && this.advancedPayment) {
        throw new Error('advancedPayment can only be set when paymentMethod is "advanced_payment".');
      }
    }

    for (const item of this.items) {
      item.unitPriceAfterDiscount = calculateUnitPriceAfterDiscount(item.itemDiscount.type, item.itemDiscount.value, item.unitPrice);
      item.starterSubtotal = calculateStarterSubtotal(item.unitPriceAfterDiscount, item.starterQuantity);
      item.subtotal = calculateSubtotal(item.unitPriceAfterDiscount, item.starterQuantity, item.returnedQuantity);
    }

    // Backstop (fast pre-check lives in poValidator.js) - every service item's costAccount, if set,
    // must be a real `cogs`-type ChartOfAccount (see accountingEventService.js#
    // postPurchaseOrderJournalEntries, PO_SERVICE_TO_WIP) - never trusted from the request alone.
    if (this.isNew || this.isModified('items')) {
      const costAccountIds = [...new Set(this.items.filter(i => i.costAccount).map(i => (i.costAccount?._id || i.costAccount).toString()))];
      if (costAccountIds.length > 0) {
        const ChartOfAccount = this.model('ChartOfAccount');
        const accounts = await ChartOfAccount.find({ _id: { $in: costAccountIds } }).session(this.$session());
        const accountsById = new Map(accounts.map(a => [a._id.toString(), a]));
        for (const id of costAccountIds) {
          const account = accountsById.get(id);
          if (!account) throw new Error('One of the selected item cost accounts does not exist.');
          if (account.type !== 'cogs') {
            throw new Error(`Account "${account.code} - ${account.name}" is not eligible as an item cost account (must be a COGS account).`);
          }
        }
      }
    }

    this.starterTotalAmount = calculateStarterTotalAmount(this.items);
    this.totalAmount = calculateTotalAmount(this.items);

    // Same canonical formula as SalesOrder (utils/orderTotals.js).
    const totals = computeOrderTotals({
      subtotal: this.totalAmount,
      vatPercentage: this.vatPercentage,
      withholdingTaxPercentage: this.withholdingTaxPercentage,
    });
    this.vatAmount = totals.vatAmount;
    this.withholdingTaxAmount = totals.withholdingTaxAmount;
    this.grandTotal = totals.total;

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
  // The Purchase Order "Supplier" IS a Vendor - `vendorNumber` is that vendor's Sub Account (the
  // same number the automatic JE stamps on the Suppliers control-account line, see
  // accountingEventService.js#resolveVendorNumber), exposed here so every PO view can show it
  // without a second lookup.
  this.populate({
    path: 'vendorId',
    select: 'name contact vendorNumber',
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

  this.populate({
    path: 'items.costAccount',
    select: 'code name nameAr type',
  });

  this.populate({
    path: 'advancedPayment',
  });
});

// Transform response format
purchaseOrderSchema.set('toJSON', {
  transform: function (doc, ret) {
    // Rename vendorId to vendor - using `'vendorId' in ret` (not `if (ret.vendorId)`) and always
    // normalizing to `null` is deliberate: the old `if (ret.vendorId)` truthiness check meant a
    // dangling vendor reference (populate resolves it to `null`) silently left the `vendor` key
    // OFF the response entirely instead of `vendor: null` - the frontend then read `undefined`
    // where it expected an object and crashed on `.name`. Every response must carry a `vendor` key
    // (object or null), never omit it.
    if ('vendorId' in ret) {
      ret.vendor = ret.vendorId ?? null;
      delete ret.vendorId;
    }

    // Iterate through items to rename productId to product - same fix, same reasoning, for a
    // dangling product reference on a line item.
    if (ret.items) {
      ret.items = ret.items.map(item => {
        if ('productId' in item) {
          item.product = item.productId ?? null;
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
