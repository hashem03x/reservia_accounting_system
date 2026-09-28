const mongoose = require('mongoose');
const { Schema, model } = require('mongoose');
const {
  calculateUnitPriceAfterDiscount,
  calculateStarterSubtotal,
  calculateSubtotal,
  calculateStarterTotalAmount,
  calculateTotalAmount,
  calculateRemainingAmount,
  getPaymentStatus,
} = require('../../utils/helper');
const { generateSalesOrderCode } = require('../../utils/helper');

const salesOrderSchema = mongoose.Schema(
  {
    code: {
      type: String,
      unique: true,
    },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse' },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // 'website' and 'shopify' are legacy values from the old storefront/Shopify-integration order
    // paths (both removed) - kept in the enum only so historical orders remain valid/readable.
    // 'cashier' (POS) is the only source new orders are created with.
    orderSource: { type: String, enum: ['website', 'cashier', 'shopify'], required: true },
    isPrepaid: { type: Boolean, default: false }, // Always with cashier orders
    items: [
      {
        // warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse' }, // Not used so far
        variant: { type: Schema.Types.ObjectId, ref: 'Variant', required: true },
        unitPrice: { type: Number, required: true, min: 0 },
        itemDiscount: {
          type: { type: String, enum: ['percentage', 'fixed'], default: 'fixed' },
          value: { type: Number, default: 0, min: 0 },
        },
        unitPriceAfterDiscount: { type: Number, min: 0 },
        starterQuantity: { type: Number, required: true, min: 0 },
        starterSubtotal: { type: Number, min: 0 },
        returnedQuantity: { type: Number, default: 0, min: 0 },
        subtotal: { type: Number, min: 0 }, // Final Subtotal After calculating returned quantity

        costWhenSold: { type: Number }, // To calculate profit later

        // For website orders (Online customers can request to return a specific quantity for a specific item)
        quantityToBeReturned: { type: Number, default: 0, min: 0 },
      },
    ],
    starterTotalAmount: { type: Number, min: 0 },
    totalAmount: { type: Number, min: 0 },
    paidAmount: { type: Number, min: 0, default: 0 },
    remainingAmount: { type: Number },
    paymentStatus: { type: String, enum: ['unpaid', 'partial', 'paid', 'unknown'], default: 'unpaid' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    employee: { type: Schema.Types.ObjectId, ref: 'User', required: () => this.orderSource === 'cashier' },
    notes: { type: String },
    isOnlineOrder: { type: Boolean, default: false },
    shippingCost: { type: Number, default: 0, min: 0 },
    shippingCostPaid: { type: Boolean, default: false },
    starterTotalAmountPlusShipping: { type: Number, min: 0 },
    totalAmountPlusShipping: { type: Number, min: 0 },
    orderStatus: { type: String, enum: ['pending', 'delivered', 'canceled'] },
    deliveryDate: { type: Date },
    taxPaidForShipping: { type: Boolean, default: false },
    // For website orders
    isGuestOrder: { type: Boolean, default: false }, // true if the order is placed by a guest user (not logged in user) // not used
    isCodOrder: { type: Boolean, default: false }, // true if the order is Cash on Delivery
    isCodOrderConfirmed: { type: Boolean, default: false }, // true if the customer confirm it with a deposit
    needCardReader: { type: Boolean, default: false }, // true if the order needs card reader machine for payment for COD orders
    shippingAddress: {
      governorate: { type: mongoose.Schema.ObjectId, ref: 'Governorate', required: () => this.orderSource === 'website' },
      city: String,
      street: String,
      details: String,
      landmark: String,
      phone: String,
      postalCode: String,
    },
    couponDiscount: { type: Number, default: null },
    needsCancellation: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// =============================================================
// Middleware
// =============================================================

// Pre-save middleware
salesOrderSchema.pre('save', async function (next) {
  try {
    // Generate unique code for new sales orders if not provided
    if (this.isNew && !this.code) {
      this.code = await generateSalesOrderCode();
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

    this.starterTotalAmountPlusShipping = this.starterTotalAmount + (this.shippingCost || 0);
    this.totalAmountPlusShipping = this.totalAmount + (this.shippingCost || 0);
    if (this.isNew) this.orderStatus = this.shippingCost > 0 ? 'pending' : 'delivered';

    // Only update customer balance on creation (not on update).
    if (this.isNew) {
      const customer = await this.model('User').findById(this.customer).session(this.$session());
      if (customer) {
        customer.balance -= this.remainingAmount;
        await customer.save({ session: this.$session() });
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Populate fields
salesOrderSchema.pre(/^find/, function () {
  this.populate({
    path: 'customer',
    // select: 'name phone email offlineAddress',
  });

  this.populate({
    path: 'employee',
    select: 'name',
  });

  this.populate({
    path: 'createdBy',
    select: 'name',
  });

  this.populate({
    path: 'items.variant',
    select: '-stock',
    populate: {
      path: 'productId',
      select: 'title price priceAfterDiscount colors',
      options: { populateVariants: false },
    },
  });
});

// Transform response format
salesOrderSchema.set('toJSON', {
  transform: function (doc, ret) {
    // Iterate through items to rename productId to product inside variant
    if (ret.items) {
      ret.items = ret.items.map(item => {
        if (item.variant?.productId) {
          item.variant.product = item.variant.productId;
          delete item.variant.productId;
        }
        return item;
      });
    }
    return ret;
  },
});

// Index for better query performance
salesOrderSchema.index({ orderSource: 1 });
salesOrderSchema.index({ customer: 1 });
salesOrderSchema.index({ employee: 1 });
salesOrderSchema.index({ createdAt: 1 });
salesOrderSchema.index({ paymentStatus: 1 });
salesOrderSchema.index({ orderStatus: 1 });

module.exports = mongoose.model('SalesOrder', salesOrderSchema);
