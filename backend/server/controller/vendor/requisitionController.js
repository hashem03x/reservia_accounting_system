const asyncHandler = require('express-async-handler');
const Requisition = require('../../models/vendor/requisitionModel');
const factory = require('../handlersFactory');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');

// Purely operational CRUD for the new "Purchase Order" document (see requisitionModel.js's header
// comment for why it's internally named Requisition). Deliberately imports NOTHING from
// services/accounting/accountingEventService.js or journalEntryModel.js - this file must never be
// able to post a journal entry or touch any accounting balance, by construction, not just by
// convention.

const createRequisition = asyncHandler(async (req, res) => {
  const { vendorId, project, items, notes } = req.body;

  const requisition = await Requisition.create({
    vendorId,
    project,
    items: (items || []).map(item => ({
      product: item.product || null,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit || null,
      unitPrice: item.unitPrice,
    })),
    notes,
    status: 'draft',
    createdBy: req.user._id,
  });

  res.status(201).json(apiResponse('Purchase Order created successfully', true, requisition));
});

const getAllRequisitions = factory.getAll(Requisition, 'Requisition');

const getRequisition = factory.getOne(Requisition);

// Draft only - once 'open', a Purchase Order's own content is frozen (it may already be visible
// to invoice-creation flows); mirrors the existing Invoice model's "no updation once it matters"
// convention (purchaseOrderController.js's commented-out updatePO) but, unlike that model, this
// one DOES support editing while still in draft.
const updateRequisition = asyncHandler(async (req, res, next) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return next(new ApiError('No Purchase Order found with that id', 404));
  if (requisition.status !== 'draft') {
    return next(new ApiError('Only a draft Purchase Order can be edited. Open or cancelled Purchase Orders are frozen.', 400));
  }

  const { vendorId, project, items, notes } = req.body;
  if (vendorId !== undefined) requisition.vendorId = vendorId;
  if (project !== undefined) requisition.project = project;
  if (items !== undefined) {
    requisition.items = items.map(item => ({
      product: item.product || null,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit || null,
      unitPrice: item.unitPrice,
    }));
  }
  if (notes !== undefined) requisition.notes = notes;

  await requisition.save();
  res.status(200).json(apiResponse('Purchase Order updated successfully', true, requisition));
});

// Finalizes a draft Purchase Order, making it eligible for Purchase Invoices to reference.
const openRequisition = asyncHandler(async (req, res, next) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return next(new ApiError('No Purchase Order found with that id', 404));
  if (requisition.status !== 'draft') {
    return next(new ApiError('Only a draft Purchase Order can be opened.', 400));
  }

  requisition.status = 'open';
  await requisition.save();
  res.status(200).json(apiResponse('Purchase Order opened successfully', true, requisition));
});

// A Purchase Order can be cancelled only while nothing has been invoiced against it yet (docs
// section "Purchase Order Status and Progress Tracking") - once invoicedAmount > 0, its invoices
// are separate, already-posted accounting documents, and "cancelling" the PO underneath them
// would be ambiguous. This never touches any Invoice or accounting record either way.
const cancelRequisition = asyncHandler(async (req, res, next) => {
  const requisition = await Requisition.findById(req.params.id);
  if (!requisition) return next(new ApiError('No Purchase Order found with that id', 404));
  if (requisition.status === 'cancelled') {
    return next(new ApiError('This Purchase Order is already cancelled.', 400));
  }
  if (requisition.invoicedAmount > 0) {
    return next(new ApiError('This Purchase Order has already been partially or fully invoiced and cannot be cancelled.', 400));
  }

  requisition.status = 'cancelled';
  await requisition.save();
  res.status(200).json(apiResponse('Purchase Order cancelled successfully', true, requisition));
});

// GET /requisitions/:id/invoices - every Purchase Invoice linked to this Purchase Order, for the
// PO details page. Read-only; never touches accounting.
const getRequisitionInvoices = asyncHandler(async (req, res) => {
  const PurchaseOrder = require('../../models/vendor/purchaseOrder'); // eslint-disable-line global-require
  const invoices = await PurchaseOrder.find({ requisition: req.params.id }).sort({ createdAt: 1 });
  res.status(200).json(apiResponse('Linked purchase invoices retrieved successfully', true, invoices));
});

module.exports = {
  createRequisition,
  getAllRequisitions,
  getRequisition,
  updateRequisition,
  openRequisition,
  cancelRequisition,
  getRequisitionInvoices,
};
