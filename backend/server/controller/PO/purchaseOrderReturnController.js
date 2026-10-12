const asyncHandler = require('express-async-handler');

const PO = require('../../models/vendor/purchaseOrder');
const POReturn = require('../../models/vendor/purchaseOrderReturn');
const ApiError = require('../../utils/apiError');
const factory = require('../handlersFactory');
const { returnPurchaseOrder } = require('../../services/accounting/reversalService');
const { legacyKey } = require('../accounting/reversalController');

// POST /purchase-orders/returns - kept for existing clients, now recorded by the accounting reversal
// engine (services/accounting/reversalService.js): stock and project allocation are given back and
// the returned slice of the receipt is reversed in the ledger. A vendor refund is recorded through a
// cash / bank account (refund.paymentAccount); the legacy `paymentMethod` no longer moves cash alone.
exports.returnPurchaseOrderItem = asyncHandler(async (req, res) => {
  const { purchaseOrderId, warehouseId, productId, returnedQuantity } = req.body;
  const { reversal } = await returnPurchaseOrder({
    purchaseOrderId,
    items: [{ productId, quantity: Number(returnedQuantity) }],
    warehouseId,
    refund: req.body.refund?.paymentAccount ? { paymentAccount: req.body.refund.paymentAccount } : null,
    reason: (typeof req.body.reason === 'string' && req.body.reason.trim()) || (typeof req.body.notes === 'string' && req.body.notes.trim()) || 'Return to vendor',
    idempotencyKey: req.body.idempotencyKey || legacyKey('po-return'),
    userId: req.user._id,
  });
  res.status(201).json({ message: 'Item Returned Successfully', data: { reversal, purchaseOrder: await PO.findById(purchaseOrderId) } });
});

// Get all returns
exports.getAllReturns = factory.getAll(POReturn);

// Get single return
exports.getReturn = asyncHandler(async (req, res, next) => {
  const returnRecord = await POReturn.findById(req.params.id).populate('purchaseOrderId', 'code').populate('productId', 'title sku').populate('createdBy', 'name');

  if (!returnRecord) {
    return next(new ApiError('Return not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: returnRecord,
  });
});
