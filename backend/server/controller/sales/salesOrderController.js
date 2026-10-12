const { default: mongoose } = require('mongoose');
const SalesOrder = require('../../models/sales/salesOrderModel');
const SalesOrderReturn = require('../../models/sales/salesOrderReturnModel');
const Payment = require('../../models/vendor/paymentModel');
const Product = require('../../models/inventory/productModel');
const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const factory = require('../handlersFactory');
const { createSalesOrder } = require('../../services/sales/salesOrderCreation.service');
const { restoreAdvancedPaymentForSalesOrder } = require('../../services/payments/advancedPaymentService');
const { mirrorReverseEntry } = require('../../services/accounting/journalReversalCore');
const { returnSalesOrder } = require('../../services/accounting/reversalService');
const { legacyKey } = require('../accounting/reversalController');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const { recalculateExecutedPercentage } = require('../../services/project/projectAccountingService');

// Create a new sales order
exports.createCashierSalesOrder = asyncHandler(async (req, res, next) => {
  // `vatAmount`/`withholdingTaxAmount`/`grandTotal`/`totalAmount` are deliberately never
  // destructured here - only the percentages are ever accepted from a client (docs section "Do not
  // allow clients to manipulate the final total").
  const { customer, warehouse, items, isPrepaid, shippingCost, isCodOrder, paidAmount, paymentMethod, paymentAccount, project, vatPercentage, withholdingTaxPercentage } = req.body;

  try {
    const salesOrder = await createSalesOrder({
      customer,
      warehouse,
      items,
      isPrepaid,
      shippingCost,
      orderSource: 'cashier',
      isCodOrder,
      paidAmount,
      paymentMethod,
      paymentAccount,
      project,
      vatPercentage,
      withholdingTaxPercentage,
      createdBy: req.user._id,
      employee: req.user._id,
    });

    res.status(201).json({
      status: 'success',
      message: 'Sales order created successfully',
      data: salesOrder,
    });
  } catch (error) {
    console.error('Sales order creation rolled back due to an error:', error);
    next(new ApiError(error.message || 'Failed to create Sales Order'));
  }
});

exports.getAllSalesOrders = factory.getAll(SalesOrder);

exports.getSalesOrder = factory.getOne(SalesOrder);

// Get sales order by code
exports.getSalesOrderByCode = asyncHandler(async (req, res, next) => {
  const { code } = req.params;

  const doc = await SalesOrder.findOne({ code });

  if (!doc) {
    return next(new ApiError('No sales order found with that code', 404));
  }

  res.status(200).json({
    status: 'success',
    data: doc,
  });
});

// Pay shipping cost
exports.payShippingCost = asyncHandler(async (req, res, next) => {
  const { id: orderId } = req.params;

  const salesOrder = await SalesOrder.findByIdAndUpdate(orderId, { $set: { shippingCostPaid: true } }, { new: true });

  if (!salesOrder) {
    return next(new ApiError('No sales order found with that ID', 404));
  }

  res.status(200).json({
    status: 'success',
    message: 'Shipping cost paid successfully',
    data: salesOrder,
  });
});

/**
 *  @description    Cancel order (set orderStatus to 'canceled')
 *  @route          PUT /api/v1/sale-orders/:id/cancel
 *  @access         Protected/admin-manager-moderator
 */
exports.cancelOrder = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const salesOrder = await SalesOrder.findById(id);
  if (!salesOrder) {
    return next(new ApiError(`Sales order not found with id ${id}`, 404));
  }
  if (salesOrder.orderStatus === 'canceled') {
    return next(new ApiError('Order is already canceled', 400));
  }

  // An order that consumed an Advanced Payment must restore it on cancellation (docs section
  // "Sales Order edit/cancel/return") - the customer's advance must never be silently lost. Only
  // this path (not the plain-save path below) needs a transaction, since it now touches two
  // documents.
  if (salesOrder.advancedPayment) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const freshOrder = await SalesOrder.findById(id).session(session);
        freshOrder.orderStatus = 'canceled';
        await freshOrder.save({ session });
        await restoreAdvancedPaymentForSalesOrder({ advancedPaymentId: freshOrder.advancedPayment, salesOrderId: freshOrder._id, session });
        // ...and the entry that applied it is reversed too, so the ledger agrees with the advance
        // (Dr Customer Advances / Cr Accounts Receivable is mirrored).
        const applied = await JournalEntry.findOne({ sourceType: 'SO', sourceId: freshOrder._id, accountingAction: 'SO_CUSTOMER_ADVANCE_APPLIED', status: 'posted' }).session(session);
        if (applied) await mirrorReverseEntry({ entryId: applied._id, date: new Date(), reason: 'Sales order cancelled', userId: req.user?._id || null, session });
        // Canceling removes this order's amount from the project's Executed % numerator (docs
        // section "Project Executed % Calculation").
        if (freshOrder.project) {
          await recalculateExecutedPercentage(freshOrder.project._id || freshOrder.project, session, freshOrder._id);
        }
      });
    } finally {
      session.endSession();
    }
    const updated = await SalesOrder.findById(id);
    return res.status(200).json({ status: 'success', data: updated });
  }

  salesOrder.orderStatus = 'canceled';
  await salesOrder.save();
  if (salesOrder.project) {
    await recalculateExecutedPercentage(salesOrder.project._id || salesOrder.project, undefined, salesOrder._id);
  }
  res.status(200).json({ status: 'success', data: salesOrder });
});

/**
 *  @description    Confirm COD order (set isCodOrderConfirmed to true)
 *  @route          PUT /api/v1/sale-orders/:id/confirm-cod
 *  @access         Protected/admin-manager-moderator
 */
exports.confirmCodOrder = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const salesOrder = await SalesOrder.findById(id);
  if (!salesOrder) {
    return next(new ApiError(`Sales order not found with id ${id}`, 404));
  }
  if (!salesOrder.isCodOrder) {
    return next(new ApiError('Order is not a COD order', 400));
  }
  if (salesOrder.isCodOrderConfirmed) {
    return next(new ApiError('COD order is already confirmed', 400));
  }
  salesOrder.isCodOrderConfirmed = true;
  await salesOrder.save();
  res.status(200).json({ status: 'success', data: salesOrder });
});

/**
 *  @description    Update order to delivered
 *  @route          PUT /api/v1/sale-orders/:id/deliver
 *  @access         Protected/manager-admin
 */
exports.updateOrderToDelivered = asyncHandler(async (req, res, next) => {
  const salesOrder = await SalesOrder.findById(req.params.id);
  if (!salesOrder) {
    return next(new ApiError(`There is no sales order with id ${req.params.id}`, 404));
  }

  if (salesOrder.orderStatus === 'delivered') {
    return next(new ApiError('This order is already delivered', 400));
  }

  if (salesOrder.orderStatus === 'cancelled') {
    return next(new ApiError('Cannot deliver a cancelled order', 400));
  }

  // Update order status to delivered
  salesOrder.orderStatus = 'delivered';
  salesOrder.deliveryDate = Date.now();

  await salesOrder.save();

  res.status(200).json({ status: 'success', data: salesOrder });
});

/**
 *  @description    Process returned items on a sales order (restock + refund payment)
 *  @route          PUT /api/v1/sale-orders/:salesOrderId/cancel-items-admin
 *  @access         Protected/admin
 */
exports.returnSalesOrderItemAdmin = asyncHandler(async (req, res, next) => {
  const { salesOrderId } = req.params;
  const order = await SalesOrder.findById(salesOrderId).lean();
  if (!order) return next(new ApiError(`Sales order not found with id ${salesOrderId}`, 404));
  const items = order.items.filter(i => i.quantityToBeReturned > 0).map(i => ({ productId: String(i.product?._id || i.product), quantity: i.quantityToBeReturned }));
  if (!items.length) return next(new ApiError('No items are waiting to be returned on this order.', 400));

  // Recorded by the accounting reversal engine (services/accounting/reversalService.js), so the
  // return posts its ledger reversal. The website order's online refund (a payment-gateway method
  // with no ledger account, like the online payment it refunds) is made in the same transaction.
  await returnSalesOrder({
    salesOrderId,
    items,
    warehouseId: order.warehouse?._id || order.warehouse,
    reason: (typeof req.body?.reason === 'string' && req.body.reason.trim()) || 'Website order return',
    idempotencyKey: req.body?.idempotencyKey || legacyKey('so-website-return'),
    userId: req.user._id,
    afterReturn: async ({ lines, session }) => {
      for (const line of lines) {
        // eslint-disable-next-line no-await-in-loop
        await new Payment({
          warehouseId: order.warehouse?._id || order.warehouse,
          salesOrderId,
          customerId: order.customer?._id || order.customer,
          type: 'out',
          amountPaid: line.amount,
          paymentMethod: 'paymob-online',
          paymentCategory: 'sales-return',
          notes: `Return payment for ${line.quantity} items`,
          createdBy: req.user._id,
        }).save({ session });
      }
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Sales order items returned successfully',
  });
});
