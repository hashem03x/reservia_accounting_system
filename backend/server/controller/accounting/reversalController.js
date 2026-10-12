const crypto = require('crypto');
const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const reversalService = require('../../services/accounting/reversalService');

// Accounting reversals (services/accounting/reversalService.js): returns, payment reversals and
// settlement reversals. Every rule lives in the service; these handlers only pass the request on.
// A request carries an `idempotencyKey` (the UI generates one per dialog); a retried request with
// the same key gets the first result back (200 instead of 201) and reverses nothing twice.

const keyOf = req => req.body?.idempotencyKey;
const respond = (res, { reversal, replayed }, message) => res.status(replayed ? 200 : 201).json(apiResponse(replayed ? `${message} (already done)` : message, true, reversal));
const refundOf = body => (body?.refund?.paymentAccount ? { paymentAccount: body.refund.paymentAccount } : null);

exports.returnSalesOrder = asyncHandler(async (req, res) => {
  const result = await reversalService.returnSalesOrder({
    salesOrderId: req.params.id,
    items: req.body.items,
    warehouseId: req.body.warehouseId,
    refund: refundOf(req.body),
    reason: req.body.reason,
    date: req.body.date,
    idempotencyKey: keyOf(req),
    userId: req.user._id,
  });
  respond(res, result, 'Sales return recorded');
});

exports.returnPurchaseOrder = asyncHandler(async (req, res) => {
  const result = await reversalService.returnPurchaseOrder({
    purchaseOrderId: req.params.id,
    items: req.body.items,
    warehouseId: req.body.warehouseId,
    refund: refundOf(req.body),
    reason: req.body.reason,
    date: req.body.date,
    idempotencyKey: keyOf(req),
    userId: req.user._id,
  });
  respond(res, result, 'Purchase return recorded');
});

exports.reversePayment = asyncHandler(async (req, res) => {
  const result = await reversalService.reversePayment({ paymentId: req.params.id, reason: req.body.reason, date: req.body.date, idempotencyKey: keyOf(req), userId: req.user._id });
  respond(res, result, 'Payment reversed');
});

exports.reverseSettlement = asyncHandler(async (req, res) => {
  const result = await reversalService.reverseSettlement({
    advancedPaymentId: req.params.id,
    salesOrderId: req.body.salesOrderId,
    purchaseOrderId: req.body.purchaseOrderId,
    paymentId: req.body.paymentId,
    reason: req.body.reason,
    date: req.body.date,
    idempotencyKey: keyOf(req),
    userId: req.user._id,
  });
  respond(res, result, 'Settlement reversed');
});

exports.listReversals = asyncHandler(async (req, res) => {
  const { salesOrder, purchaseOrder, payment, advancedPayment } = req.query;
  const data = await reversalService.listReversals({ salesOrder, purchaseOrder, payment, advancedPayment });
  res.status(200).json({ results: data.length, data });
});

/** A key for the older return endpoints, which send none: unique per request (no retry dedupe). */
exports.legacyKey = prefix => `${prefix}:${crypto.randomUUID()}`;
