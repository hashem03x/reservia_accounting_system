const { Schema, model } = require('mongoose');
const SalesOrder = require('../sales/salesOrderModel');
const { PaymentMethods } = require('../../utils/appConstant');
const Warehouse = require('../inventory/warehouseModel');
const Expense = require('../expense/expenseModel');
// Explicit require (not just the string `ref:` name) - mirrors salesOrderModel.js's convention for
// every model this schema's hooks look up via `this.model(...)`.
require('../accounting/chartOfAccountModel');

const paymentSchema = Schema(
  {
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true }, // Warehouse where the payment was made
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    salesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder' },
    customerId: { type: Schema.Types.ObjectId, ref: 'User' },
    // Optional link to a Project (see models/project/projectModel.js) - lets a future
    // payment-collection flow record money received against a project's contract amount without
    // any schema change to Project itself. Nothing in the app sets this yet (no project payment
    // UI exists today), but Project.remainingMoney is already wired to recompute from it the
    // moment something does - see the pre('save') branch below and
    // services/project/projectAccountingService.js#recalculateRemainingMoney.
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    type: { type: String, enum: ['in', 'out'], required: true },
    amountPaid: { type: Number, required: true, min: 0 },
    // No longer `required` - a new payment is expected to use `paymentAccount` instead (docs
    // section "Payment Methods Must Come From Chart of Accounts"). Kept, with its original enum of
    // hardcoded values, purely so historical Payment documents remain valid/readable and so the
    // other existing flows noted below keep working unmodified. The pre('save') backstop below
    // requires at least one of `paymentMethod`/`paymentAccount` to be set, so a payment can never
    // be created with neither.
    paymentMethod: { type: String, enum: [...PaymentMethods, null], default: null },
    // The Cash/Cash-Equivalent ChartOfAccount this payment was made from/to - the new primary way
    // to record a payment's method (docs section "Payment Methods Must Come From Chart of
    // Accounts"). Validated for eligibility (type 'asset' + state 'cash'/'cash-equivalent') in the
    // pre('save') hook below, mirroring salesOrderModel.js's identical check.
    paymentAccount: { type: Schema.Types.ObjectId, ref: 'ChartOfAccount', default: null },
    paymentCategory: {
      type: String,
      enum: ['purchase', 'purchase-return', 'sales', 'sales-return', 'expense', 'transfer', 'finance-charges', 'currency-transfer'],
      required: true,
    },
    paidWithPaymob: { type: Boolean, default: false },
    tax: {
      amount: { type: Number, default: 0 },
      percentage: { type: Number, default: 0 },
      paymentId: { type: Schema.Types.ObjectId, ref: 'Payment' }, // Reference to the tax payment
    },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Middleware to update balances before saving
paymentSchema.pre('save', async function (next) {
  // if (this.paymentCategory === 'transfer') return next();

  try {
    const session = this.$session();
    const Payment = this.model('Payment');
    const Warehouse = this.model('Warehouse');
    const Vendor = this.model('Vendor');
    const PurchaseOrder = this.model('PurchaseOrder');
    const salesOrderModel = this.model('SalesOrder');
    const User = this.model('User');

    // Backstop (see controller-level validators) - never trust that `paymentAccount` is actually
    // eligible just because a request validator approved it at some earlier point, and never allow
    // a payment with neither a legacy `paymentMethod` nor a `paymentAccount` set.
    if (this.isNew || this.isModified('paymentMethod') || this.isModified('paymentAccount')) {
      if (!this.paymentMethod && !this.paymentAccount) {
        throw new Error('Either a payment method or a payment account is required.');
      }
      if (this.paymentAccount) {
        const ChartOfAccount = this.model('ChartOfAccount');
        const account = await ChartOfAccount.findById(this.paymentAccount).session(session);
        if (!account) throw new Error('The selected payment account does not exist.');
        if (account.type !== 'asset' || !['cash', 'cash-equivalent'].includes(account.state)) {
          throw new Error('The selected payment account must be a Cash or Cash Equivalent account.');
        }
      }
    }

    // Calculate and create tax payment if applicable
    if (this.type === 'in' && !this.tax.paymentId && this.paymentCategory === 'sales') {
      let taxPercentage = 0;
      let additionalFee = 0;

      if (this.paymentMethod === 'wallet') {
        taxPercentage = 1;
      } else if (this.paymentMethod === 'fawry') {
        taxPercentage = 1.3;
      } else if (this.paidWithPaymob || this.paymentMethod === 'paymob-online' || this.paymentMethod === 'card') {
        taxPercentage = 3.135;
        additionalFee = 3; // 3 EGP additional fee
      } else if (this.paymentMethod === 'paymob-offline') {
        taxPercentage = 1.9;
      }

      if (taxPercentage > 0) {
        let salesOrder = await SalesOrder.findById(this.salesOrderId).session(session);
        const shippingCostForTax = (!salesOrder.taxPaidForShipping && salesOrder.shippingCost) || 0;
        const taxAmount = (this.amountPaid + shippingCostForTax) * (taxPercentage / 100) + additionalFee;

        if (!salesOrder.taxPaidForShipping) {
          salesOrder.taxPaidForShipping = true;
          await salesOrder.save({ session });
        }

        // Create tax payment
        const taxPayment = new Payment({
          warehouseId: this.warehouseId,
          type: 'out',
          amountPaid: taxAmount,
          paymentMethod: this.paymentMethod,
          paymentCategory: 'finance-charges',
          paidWithPaymob: this.paidWithPaymob,
          createdBy: this.createdBy,
        });

        await taxPayment.save({ session });

        const createdExpense = await Expense.create({
          description: `Finance charges payment - ${this.paymentMethod}`,
          expenseCategory: 'finance-charges',
          paymentId: taxPayment._id,
        });

        // Update tax information
        this.tax = {
          amount: taxAmount,
          percentage: taxPercentage,
          paymentId: taxPayment._id,
        };
      }
    }

    // Update warehouse balance
    // console.log('this.warehouseId ====================> ', this.warehouseId);
    const warehouse = await Warehouse.findById(this.warehouseId).session(session);
    // console.log('warehouse ====================> ', warehouse);
    // console.log('this ====================> ', this);
    // console.log('warehouse ====================> ', warehouse);
    if (!warehouse) throw new Error('Warehouse not found');
    if (this.type === 'in') warehouse.balance += this.amountPaid;
    else if (this.type === 'out') warehouse.balance -= this.amountPaid;
    await warehouse.save({ session });

    // Update vendor balance if vendorId exists
    if (this.vendorId) {
      const vendor = await Vendor.findById(this.vendorId).session(session);
      if (!vendor) throw new Error('Vendor not found');
      if (this.type === 'in') vendor.balance += this.amountPaid;
      else if (this.type === 'out') vendor.balance -= this.amountPaid;
      await vendor.save({ session });
    }

    // Update purchase order paid amount if purchaseOrderId exists
    if (this.purchaseOrderId) {
      const purchaseOrder = await PurchaseOrder.findById(this.purchaseOrderId).session(session);
      if (!purchaseOrder) throw new Error('Purchase Order not found');
      if (this.type === 'in') purchaseOrder.paidAmount -= this.amountPaid;
      else if (this.type === 'out') purchaseOrder.paidAmount += this.amountPaid;
      await purchaseOrder.save({ session });
    }

    // Update customer balance if customerId exists
    if (this.customerId) {
      const customer = await User.findById(this.customerId).session(session);
      if (!customer) throw new Error('Customer not found');
      if (this.type === 'in') customer.balance += this.amountPaid;
      else if (this.type === 'out') customer.balance -= this.amountPaid;
      await customer.save({ session });
    }

    // Update sales order paid amount if salesOrderId exists
    if (this.salesOrderId) {
      const salesOrder = await salesOrderModel.findById(this.salesOrderId).session(session);
      if (!salesOrder) throw new Error('Sales Order not found');
      if (this.type === 'in') salesOrder.paidAmount += this.amountPaid;
      else if (this.type === 'out') salesOrder.paidAmount -= this.amountPaid;
      await salesOrder.save({ session });
    }

    // Recompute Project.remainingMoney if projectId exists - see projectModel.js's comment.
    if (this.projectId) {
      // eslint-disable-next-line global-require
      const { recalculateRemainingMoney } = require('../../services/project/projectAccountingService');
      await recalculateRemainingMoney(this.projectId, session);
    }

    next();
  } catch (error) {
    next(error);
  }
});

paymentSchema.pre(/^find/, function (next) {
  this.populate({
    path: 'createdBy',
    select: 'name email',
  });

  this.populate({
    path: 'paymentAccount',
    select: 'code name nameAr',
  });

  next();
});

module.exports = model('Payment', paymentSchema);
