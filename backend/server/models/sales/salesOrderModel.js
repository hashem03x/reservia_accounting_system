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
const { SalesOrderPaymentMethods } = require('../../utils/appConstant');
const { isPaymentAccountEligible } = require('../../utils/accountingConstants');
// Explicit require (not just the string `ref:` name) - mirrors journalEntryModel.js's convention
// for every model this schema's hooks look up via `this.model(...)`.
require('../accounting/chartOfAccountModel');

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

const salesOrderSchema = mongoose.Schema(
  {
    code: {
      type: String,
      unique: true,
    },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse' },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Mandatory for every NEW order (docs section "Sales Orders - Project is Required") - enforced
    // in the pre('save') hook below, scoped to `isNew`, so historical orders created before this
    // rule existed stay valid when re-saved (cancel/deliver/return). `default: null` (not a plain
    // schema-level `required: true`) is deliberate for that same reason.
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    // This order's own "how will this be paid" selection at creation time - a different concept
    // from the separate `Payment` model's `paymentMethod` (a record of an actual payment
    // transaction against an order). Optional/null for every existing order and every new order
    // that doesn't use this field - purely additive, doesn't change any existing behavior.
    // 'account' = paid via a Cash/Cash-Equivalent ChartOfAccount (see `paymentAccount` below).
    // 'advanced_payment' = paid via the customer's AdvancedPayment balance (see `advancedPayment`).
    paymentMethod: { type: String, enum: { values: [...SalesOrderPaymentMethods, null], message: '{VALUE} is not a valid payment method' }, default: null },
    // Set only when paymentMethod === 'account' - the specific Cash/Cash-Equivalent ChartOfAccount
    // this order is paid against (docs section "Payment Methods Must Come From Chart of
    // Accounts"). Never a hardcoded string - a real account reference, validated for eligibility
    // (type 'asset' + state 'cash'/'cash-equivalent') in the pre('validate') hook below.
    paymentAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null },
    // Set only when paymentMethod === 'advanced_payment' - the specific AdvancedPayment document
    // this order consumed, so a later cancellation can restore exactly that balance (see
    // services/payments/advancedPaymentService.js#restoreAdvancedPaymentForSalesOrder).
    advancedPayment: { type: Schema.Types.ObjectId, ref: 'AdvancedPayment', default: null },
    // 'website' and 'shopify' are legacy values from the old storefront/Shopify-integration order
    // paths (both removed) - kept in the enum only so historical orders remain valid/readable.
    // 'cashier' (POS) is the only source new orders are created with.
    orderSource: { type: String, enum: ['website', 'cashier', 'shopify'], required: true },
    isPrepaid: { type: Boolean, default: false }, // Always with cashier orders
    items: [
      {
        // warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse' }, // Not used so far
        product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
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
    // VAT - percentage is the only client input; vatAmount is always server-computed from
    // `totalAmount` (docs section "VAT on Sales Orders and Purchase Orders") - never trusted from
    // the client, recomputed on every save the same way totalAmount itself already is.
    vatPercentage: { type: Number, default: 0, min: [0, 'VAT percentage cannot be negative'] },
    vatAmount: { type: Number, default: 0, min: 0 },
    // Withholding Tax - only these four percentages are valid business values (docs section
    // "Withholding Tax") - not an arbitrary rate like VAT. withholdingTaxAmount is server-computed,
    // same rule as vatAmount.
    withholdingTaxPercentage: { type: Number, enum: { values: [0, 1, 3, 5], message: '{VALUE} is not a valid withholding tax percentage' }, default: 0 },
    withholdingTaxAmount: { type: Number, default: 0, min: 0 },
    // = totalAmount + vatAmount - withholdingTaxAmount - always server-computed (see pre('save')
    // below), never accepted from a request body. This is the real payable/receivable figure
    // (remainingAmount/paymentStatus/the customer-balance deduction below are all based on this,
    // not the pre-tax `totalAmount`) - shipping remains a deliberately separate concern (see
    // `shippingCostPaid`/`payShippingCost` - shipping was never part of paidAmount/remainingAmount
    // even before this change, so it stays out of this figure too for consistency.
    // A function default (not a flat 0) so an existing order that predates this field, read before
    // ever being re-saved, still reports its real total instead of a misleading 0.
    grandTotal: { type: Number, default: function () { return this.totalAmount || 0; }, min: 0 },
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

    // Project is mandatory for every NEW Sales Order (docs section "Sales Orders - Project is
    // Required") - the fast pre-check lives in salesValidator.js; this is the real backstop so a
    // direct API call can never bypass it. Scoped to `isNew` (not a plain schema-level `required`)
    // so a historical order created before this rule existed can still be cancelled/delivered/
    // returned - every one of those re-saves the same document without a project.
    if (this.isNew && !this.project) {
      throw new Error('A project is required to create a Sales Order.');
    }

    // Backstop (the fast pre-check lives in salesValidator.js) - never trust that `paymentAccount`
    // is actually eligible just because a request validator approved it at some earlier point;
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
    path: 'items.product',
    select: 'title price priceAfterDiscount colors barcode sku',
  });

  this.populate({
    path: 'project',
    select: 'projectNumber name customer',
  });

  this.populate({
    path: 'paymentAccount',
    select: 'code name nameAr',
  });

  // Deliberately NOT populated here: AdvancedPayment's own pre(/^find/) hook populates
  // `usageHistory.salesOrder` back into a full SalesOrder document - populating `advancedPayment`
  // from this side too would make every fetch of either model recurse into the other forever
  // (SalesOrder -> AdvancedPayment -> usageHistory.salesOrder -> SalesOrder -> ...). The frontend
  // already has `paymentMethod`/`advancedPayment` (the raw id) to work with; fetch the
  // AdvancedPayment separately (GET /advanced-payments/:id) if its full details are ever needed
  // from a Sales Order page.
});

// Index for better query performance
salesOrderSchema.index({ orderSource: 1 });
salesOrderSchema.index({ customer: 1 });
salesOrderSchema.index({ employee: 1 });
salesOrderSchema.index({ createdAt: 1 });
salesOrderSchema.index({ paymentStatus: 1 });
salesOrderSchema.index({ orderStatus: 1 });
salesOrderSchema.index({ project: 1 });

module.exports = mongoose.model('SalesOrder', salesOrderSchema);
