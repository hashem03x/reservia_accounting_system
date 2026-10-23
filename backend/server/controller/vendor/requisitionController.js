const asyncHandler = require('express-async-handler');
const Requisition = require('../../models/vendor/requisitionModel');
const factory = require('../handlersFactory');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const Product = require('../../models/inventory/productModel');
const Vendor = require('../../models/vendor/vendor');
const { normalizeDocumentPaymentTerms, validateDocumentPaymentTerms, termsFromVendorConfig } = require('../../utils/documentPaymentTerms');

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Line items from a request. Every NEW line must name a catalog product (client requirement
 * "Purchase Orders - Product Search Instead of Free-Text Description"); its description becomes
 * optional line notes, defaulting to the product's name. A line without a product is accepted only
 * when it is one of this Purchase Order's existing legacy lines, unchanged - so an old Purchase
 * Order stays editable, but a free-text line can never be added as a substitute for a product.
 */
async function buildItems(items, existingItems = []) {
  const ids = [...new Set(items.filter(i => i.product).map(i => String(i.product)))];
  const products = new Map((await Product.find({ _id: { $in: ids } }).select('title').lean()).map(p => [String(p._id), p]));
  return items.map((item, index) => {
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    if (!item.product) {
      const legacy = existingItems.some(existing => !existing.product && existing.description === description);
      if (!legacy) throw new ApiError(`Line ${index + 1}: select a product or service from the catalog.`, 400);
    }
    const product = item.product ? products.get(String(item.product)) : null;
    if (item.product && !product) throw new ApiError(`Line ${index + 1}: the selected product does not exist.`, 400);
    const title = product?.title;
    return {
      product: item.product || null,
      description: description || (typeof title === 'string' ? title : title?.en || title?.ar || ''),
      quantity: item.quantity,
      unit: item.unit || null,
      unitPrice: item.unitPrice,
    };
  });
}

/** Normalized + validated payment terms for a Purchase Order of value `total`, or a 400. */
function checkedTerms(input, { total, issueDate }) {
  const terms = normalizeDocumentPaymentTerms(input);
  const error = validateDocumentPaymentTerms(terms, { total, issueDate });
  if (error) throw new ApiError(error, 400);
  return terms;
}
const itemsTotal = items => round2(items.reduce((s, i) => s + round2((Number(i.quantity) || 0) * (Number(i.unitPrice) || 0)), 0));

// Purely operational CRUD for the new "Purchase Order" document (see requisitionModel.js's header
// comment for why it's internally named Requisition). Deliberately imports NOTHING from
// services/accounting/accountingEventService.js or journalEntryModel.js - this file must never be
// able to post a journal entry or touch any accounting balance, by construction, not just by
// convention.

const createRequisition = asyncHandler(async (req, res) => {
  const { vendorId, project, items, notes, issueDate, paymentTerms } = req.body;

  const lines = await buildItems(items || []);
  const issuedOn = issueDate ? new Date(issueDate) : new Date();
  // Terms given with the Purchase Order are validated against its value; none given = the vendor's
  // default terms, snapshotted now (a later change to the vendor's defaults never rewrites them).
  let terms;
  if (paymentTerms != null) {
    terms = checkedTerms(paymentTerms, { total: itemsTotal(lines), issueDate: issuedOn });
  } else {
    const vendor = await Vendor.findById(vendorId).select('paymentTermsConfig').lean();
    terms = termsFromVendorConfig(vendor?.paymentTermsConfig, issuedOn);
  }

  const requisition = await Requisition.create({
    vendorId,
    project,
    items: lines,
    issueDate: issuedOn,
    paymentTerms: terms,
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

  const { vendorId, project, items, notes, issueDate, paymentTerms } = req.body;
  if (vendorId !== undefined) requisition.vendorId = vendorId;
  if (project !== undefined) requisition.project = project;
  if (items !== undefined) {
    requisition.items = await buildItems(items, requisition.items.map(i => ({ product: i.product?._id || i.product, description: i.description })));
  }
  if (issueDate !== undefined && issueDate !== null) requisition.issueDate = new Date(issueDate);
  if (paymentTerms !== undefined) {
    requisition.paymentTerms = paymentTerms === null ? null : checkedTerms(paymentTerms, { total: itemsTotal(requisition.items), issueDate: requisition.issueDate || requisition.createdAt });
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
