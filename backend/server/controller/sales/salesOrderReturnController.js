const asyncHandler = require('express-async-handler');
const SalesOrderModel = require('../../models/sales/salesOrderModel');
const SalesOrderReturnModel = require('../../models/sales/salesOrderReturnModel');
const ApiError = require('../../utils/apiError');
const factory = require('../handlersFactory');
const { returnSalesOrder } = require('../../services/accounting/reversalService');
const { legacyKey } = require('../accounting/reversalController');

// The older return endpoints (POST /sale-orders/returns and /returns/return-all) - kept for existing
// clients, now recorded by the accounting reversal engine (services/accounting/reversalService.js),
// so a return always posts its ledger reversal. A refund is made through a cash / bank account
// (refund.paymentAccount); the legacy `paymentMethod` has no ledger account, so it no longer moves
// cash on its own - the excess stays as the customer's credit until refunded.
const reasonOf = body => (typeof body.reason === 'string' && body.reason.trim()) || (typeof body.notes === 'string' && body.notes.trim()) || 'Customer return';
const refundOf = body => (body.refund?.paymentAccount ? { paymentAccount: body.refund.paymentAccount } : null);

exports.returnSalesOrderItem = asyncHandler(async (req, res) => {
  const { salesOrderId, warehouseId, productId, returnedQuantity } = req.body;
  const { reversal } = await returnSalesOrder({
    salesOrderId,
    items: [{ productId, quantity: Number(returnedQuantity) }],
    warehouseId,
    refund: refundOf(req.body),
    reason: reasonOf(req.body),
    idempotencyKey: req.body.idempotencyKey || legacyKey('so-return'),
    userId: req.user._id,
  });
  res.status(201).json({ message: 'Item Returned Successfully', data: { reversal, salesOrder: await SalesOrderModel.findById(salesOrderId) } });
});

exports.returnAllSalesOrderItems = asyncHandler(async (req, res, next) => {
  const { salesOrderId, warehouseId } = req.body;
  const order = await SalesOrderModel.findById(salesOrderId).lean();
  if (!order) return next(new ApiError('Sales order not found', 404));
  const items = order.items
    .map(i => ({ productId: String(i.product?._id || i.product), quantity: (i.starterQuantity || 0) - (i.returnedQuantity || 0) }))
    .filter(i => i.quantity > 0);
  if (!items.length) return next(new ApiError('No items available to return', 400));
  const { reversal } = await returnSalesOrder({
    salesOrderId,
    items,
    warehouseId,
    refund: refundOf(req.body),
    reason: reasonOf(req.body),
    idempotencyKey: req.body.idempotencyKey || legacyKey('so-return-all'),
    userId: req.user._id,
  });
  res.status(201).json({ message: 'All items returned successfully', data: { reversal, salesOrder: await SalesOrderModel.findById(salesOrderId) } });
});

// Get all returns
exports.getAllReturns = factory.getAll(SalesOrderReturnModel);

// Get single return
exports.getReturn = factory.getOne(SalesOrderReturnModel);
