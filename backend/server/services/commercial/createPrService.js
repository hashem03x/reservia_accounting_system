'use strict';

const ApiError = require('../../utils/apiError');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const CommercialProject = require('../../models/commercial/commercialProjectModel');
const CommercialSupplier = require('../../models/commercial/supplierModel');
const Requisition = require('../../models/vendor/requisitionModel');
const { loadMatchingContext, matchLineToProduct } = require('./boqProductMatchingService');

// Feature 3/B4 - "Create PR" on a Deal Engine BOQ line creates a REAL ERP Purchase Order
// (Requisition model - see requisitionModel.js's own header comment on the user-facing/internal
// name split). Deliberately NOT a second procurement system: this calls the exact same model,
// numbering (getNextRequisitionCode via the schema's own pre-save hook) and 'draft' starting
// status every manually-created Purchase Order gets - a human still has to open the real ERP
// Purchase Order screen and press "Open" before it is eligible for a real Purchase Invoice,
// exactly as today.
//
// Only reachable once the deal is Won (CommercialProject.erpProject exists) - before that there
// is no real ERP Project to attach a Purchase Order to, and fabricating one would misrepresent an
// unapproved deal as a real procurement commitment.
const BOQ_VENDOR_ROLES = ['md', 'commercial_director', 'procurement'];
const ELIGIBLE_SUPPLIER_STATUSES = ['Approved', 'Conditional'];

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * How much of a BOQ line has already been put into a (non-cancelled) Purchase Order, and how
 * much is left - the SAME "ordered / remaining" shape requisitionQuantityService.js already uses
 * one level down (Purchase Order -> Purchase Invoice), applied one level up (BOQ -> Purchase
 * Order). `orderedQty`/`remainingQty` come straight from the BOQ line's own atomic counter (the
 * real guard - see createPrFromBoqLine); the linked Purchase Orders list below is informational
 * only, for the Deal Engine UI to show number/status/vendor/quantity without a second round trip.
 */
async function getBoqLineProcurementStatus(revisionId, component) {
  const revision = await CommercialRevision.findById(revisionId).select('boqLines').lean();
  if (!revision) throw new ApiError('Deal Engine revision not found.', 404);
  const line = (revision.boqLines || []).find(l => l.component === component);
  if (!line) throw new ApiError(`BOQ line "${component}" not found on this revision.`, 404);

  const requisitions = await Requisition.find({
    'dealEngineSource.revision': revisionId,
    'dealEngineSource.boqComponent': component,
  }).sort({ createdAt: 1 });

  const boqQty = line.qty || 0;
  const ordered = round2(line.orderedQty || 0);
  return {
    boqQty,
    orderedQty: ordered,
    remainingQty: Math.max(0, round2(boqQty - ordered)),
    requisitions: requisitions.map(r => ({
      _id: r._id,
      code: r.code,
      status: r.status,
      effectiveStatus: r.toJSON().effectiveStatus,
      vendorId: r.vendorId,
      quantity: r.items.reduce((s, i) => s + (i.quantity || 0), 0),
      amount: r.amount,
      createdAt: r.createdAt,
    })),
  };
}

/**
 * Creates a draft ERP Purchase Order (Requisition) from one BOQ line.
 *
 * @param {object} opts
 * @param {string} [opts.supplierId] - overrides the line's own selected vendor (B3); required if
 *   the line has none.
 * @param {number} [opts.quantity] - defaults to the line's FULL remaining quantity (split
 *   procurement when given a smaller amount - Feature 3.3).
 */
async function createPrFromBoqLine(revisionId, component, { supplierId, quantity } = {}, { role } = {}) {
  if (!BOQ_VENDOR_ROLES.includes(role)) {
    throw new ApiError(`Creating a Purchase Order from a BOQ line is for: ${BOQ_VENDOR_ROLES.map(r => r.replace('_', ' ')).join(', ')}. Your Deal Engine role is "${role || 'none'}".`, 403);
  }

  const revision = await CommercialRevision.findById(revisionId);
  if (!revision) throw new ApiError('Deal Engine revision not found.', 404);
  const line = revision.boqLines.find(l => l.component === component);
  if (!line) throw new ApiError(`BOQ line "${component}" not found on this revision.`, 404);
  if (!(line.qty > 0) || !(line.unitPrice > 0)) throw new ApiError('This BOQ line has no priced quantity to procure.', 400);

  const project = await CommercialProject.findById(revision.project).select('erpProject dealNumber');
  if (!project) throw new ApiError('Deal Engine project not found.', 404);
  if (!project.erpProject) {
    throw new ApiError('This deal has not been handed off to the ERP yet (it is not Won) - a Purchase Order needs a real ERP project to attach to.', 400);
  }

  // ---- Vendor: the line's own selection, or an explicit override, resolved to its linked ERP Vendor (B1/B2) ----
  const supplierRef = supplierId || line.vendor;
  if (!supplierRef) throw new ApiError('Select a vendor on this BOQ line first (or pass one explicitly).', 400);
  const supplier = await CommercialSupplier.findById(supplierRef).select('code legalName status erpVendor');
  if (!supplier) throw new ApiError('Supplier not found.', 404);
  if (!ELIGIBLE_SUPPLIER_STATUSES.includes(supplier.status)) {
    throw new ApiError(`Only an Approved or Conditional supplier can be used (this one is ${supplier.status}).`, 400);
  }
  if (!supplier.erpVendor) {
    throw new ApiError(`Supplier ${supplier.code} ("${supplier.legalName}") is not yet linked to an ERP vendor. Link or create one on the Supplier page first.`, 400);
  }

  // ---- Product: the SAME matcher the Won -> ERP BOQ transfer uses - never a guessed product ----
  const context = await loadMatchingContext([line], null);
  const { product, reason } = matchLineToProduct(line, context);
  if (!product) {
    const why = reason === 'ambiguous' ? 'it matches more than one catalog product ambiguously' : reason === 'unlinked' ? "its Price Book item's linked ERP product no longer exists" : 'it has no matching product in the ERP catalog';
    throw new ApiError(`Cannot create a Purchase Order for "${component}" - ${why}. Link the Price Book item to a real product first (Materials page).`, 400);
  }

  // ---- Quantity: never more than what is left of the BOQ line, including concurrently ----
  // A requested amount beyond the CURRENT remaining is rejected up front with a clear message;
  // the atomic increment below is what actually prevents the race (two concurrent requests each
  // passing this pre-check against a stale "remaining" snapshot), not this check by itself.
  const currentRemaining = Math.max(0, round2((line.qty || 0) - (line.orderedQty || 0)));
  const requestedQty = quantity != null ? Number(quantity) : currentRemaining;
  // A fully-procured line defaulting to "the full remaining quantity" lands on 0 - that is a
  // duplicate-click/retry (the line's own remaining is exhausted), not a caller error, so it gets
  // the same "Only N remain" message as an explicit over-request, not "quantity must be > 0".
  if (requestedQty > currentRemaining + 0.0001 || (quantity == null && currentRemaining <= 0)) {
    throw new ApiError(`Only ${currentRemaining} ${line.unit || ''} remain unprocured on this BOQ line (${line.orderedQty || 0} of ${line.qty} already on a Purchase Order).`, 400);
  }
  if (!(requestedQty > 0)) throw new ApiError('Quantity must be greater than 0.', 400);

  // Atomic guard (the real one): increments orderedQty ONLY if doing so still keeps it <= qty,
  // in a single findOneAndUpdate - this is the exact "guarded atomic increment" pattern
  // requisitionModel.js#invoicedAmount already uses one level down (Purchase Order -> Purchase
  // Invoice), and unlike a multi-document transaction, a single-document conditional update is
  // atomic on ANY MongoDB deployment, standalone or replica set - no transaction needed, and
  // nothing for two truly concurrent callers to both "win" (MongoDB serializes writes to the
  // same document; the loser's condition is simply no longer true by the time it is evaluated).
  // $expr only evaluates against the TOP-LEVEL document (can't be nested inside $elemMatch), so
  // the "would this push orderedQty over qty" check is expressed as $map/$anyElementTrue over the
  // whole boqLines array instead - still a single atomic findOneAndUpdate, same guarantee.
  const guarded = await CommercialRevision.findOneAndUpdate(
    {
      _id: revisionId,
      $expr: {
        $anyElementTrue: {
          $map: {
            input: '$boqLines',
            as: 'line',
            in: {
              $and: [{ $eq: ['$$line.component', component] }, { $lte: [{ $add: ['$$line.orderedQty', requestedQty] }, '$$line.qty'] }],
            },
          },
        },
      },
    },
    { $inc: { 'boqLines.$[line].orderedQty': requestedQty } },
    { arrayFilters: [{ 'line.component': component }], new: true }
  );
  if (!guarded) {
    // Someone else's request (or this BOQ line) changed the remaining quantity between the
    // pre-check above and now - re-read the fresh state rather than claim a stale one.
    const fresh = await CommercialRevision.findById(revisionId).select('boqLines').lean();
    const freshLine = (fresh?.boqLines || []).find(l => l.component === component);
    const freshRemaining = freshLine ? Math.max(0, round2((freshLine.qty || 0) - (freshLine.orderedQty || 0))) : 0;
    throw new ApiError(`Only ${freshRemaining} ${line.unit || ''} remain unprocured on this BOQ line - someone else just procured some of it. Refresh and try again.`, 409);
  }

  let created;
  try {
    created = await Requisition.create({
      vendorId: supplier.erpVendor,
      project: project.erpProject,
      items: [{ product: product._id, description: line.description || line.component, quantity: requestedQty, unit: line.unit || null, unitPrice: line.unitPrice }],
      notes: `Created from Deal Engine ${project.dealNumber || ''} BOQ line "${component}".`.trim(),
      dealEngineSource: { commercialProject: project._id, revision: revision._id, boqComponent: component },
    });
  } catch (err) {
    // The Requisition itself failed AFTER the quantity was already reserved - release it, or the
    // line would show less remaining than is actually true with nothing to show for it.
    await releaseOrderedQty(revisionId, component, requestedQty).catch(() => {});
    throw err;
  }

  return Requisition.findById(created._id);
}

/**
 * Releases a previously-reserved quantity back onto a BOQ line - called when the Purchase Order
 * that reserved it is cancelled (requisitionController.js#cancelRequisition), or when creating it
 * failed after the reservation already succeeded. Never throws by itself at the call sites above
 * (both already wrap it) - a failed release must not mask or roll back the action that triggered it.
 */
async function releaseOrderedQty(revisionId, component, qty) {
  await CommercialRevision.updateOne({ _id: revisionId }, { $inc: { 'boqLines.$[line].orderedQty': -qty } }, { arrayFilters: [{ 'line.component': component }] });
}

module.exports = { getBoqLineProcurementStatus, createPrFromBoqLine, releaseOrderedQty, BOQ_VENDOR_ROLES, ELIGIBLE_SUPPLIER_STATUSES };
