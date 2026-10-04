const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const factory = require('../handlersFactory');
const AdvancedPayment = require('../../models/payments/advancedPaymentModel');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const { getAvailableCustomerAdvancedPayment } = require('../../services/payments/advancedPaymentService');
const { postAdvancedPaymentJournalEntry } = require('../../services/accounting/accountingEventService');

const createAdvancedPayment = asyncHandler(async (req, res) => {
  // remainingAmount/status are always server-derived (advancedPaymentModel.js) - stripped here so
  // a client can never seed them directly, mirroring chartOfAccountController.js's handling of
  // sortOrder.
  const { remainingAmount, status, usageHistory, ...body } = req.body;

  // Transactional so the AdvancedPayment and its automatic journal entry (ADVANCE_PAYMENT_RECEIVED_
  // CUSTOMER/ADVANCE_PAYMENT_PAID_VENDOR, see accountingEventService.js) either both commit or
  // neither does.
  const session = await mongoose.startSession();
  let advancedPayment;
  await session.withTransaction(async () => {
    [advancedPayment] = await AdvancedPayment.create([{ ...body, createdBy: req.user._id }], { session });
    await postAdvancedPaymentJournalEntry(advancedPayment, session);
  });
  session.endSession();

  res.status(201).json(apiResponse('Advanced payment created successfully', true, advancedPayment));
});

const getAdvancedPayments = factory.getAll(AdvancedPayment, 'AdvancedPayment');

const getAdvancedPayment = factory.getOne(AdvancedPayment);

// GET /advanced-payments/available?customer=&project= - read-only lookup the Sales Order creation
// UI calls to show "Available Advanced Payment: X" before submitting. Never consumes anything -
// actual consumption only ever happens inside createSalesOrder's transaction (see
// salesOrderCreation.service.js), so the frontend can poll this freely without side effects.
const getAvailableAdvancedPayment = asyncHandler(async (req, res, next) => {
  const { customer, project } = req.query;
  if (!customer || !project) {
    return next(new ApiError('Both customer and project are required.', 400));
  }

  const advance = await getAvailableCustomerAdvancedPayment(customer, project);
  res.status(200).json(apiResponse('Available advanced payment retrieved successfully', true, advance));
});

// Explicit action, not a generic PATCH /:id - so remainingAmount/status/usageHistory can never be
// edited directly through this route, only ever cancelled.
const cancelAdvancedPayment = asyncHandler(async (req, res, next) => {
  const advancedPayment = await AdvancedPayment.findById(req.params.id);
  if (!advancedPayment) return next(new ApiError('No advanced payment found with that id', 404));

  if (advancedPayment.status === 'cancelled') {
    return next(new ApiError('This advanced payment is already cancelled.', 400));
  }
  if (advancedPayment.usageHistory.some(u => !u.reversed)) {
    return next(new ApiError('This advanced payment has already been consumed and cannot be cancelled.', 400));
  }

  advancedPayment.status = 'cancelled';
  await advancedPayment.save();
  res.status(200).json(apiResponse('Advanced payment cancelled successfully', true, advancedPayment));
});

module.exports = {
  createAdvancedPayment,
  getAdvancedPayments,
  getAdvancedPayment,
  getAvailableAdvancedPayment,
  cancelAdvancedPayment,
};
