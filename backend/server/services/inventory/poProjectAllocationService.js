const mongoose = require('mongoose');
const PucTransfer = require('../../models/inventory/pucTransferModel');
const Product = require('../../models/inventory/productModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ApiError = require('../../utils/apiError');
const { round2 } = require('../../utils/orderTotals');

// Purchase Order -> project allocation. In Reservia a Purchase Order is received into stock when it
// is created (applyPurchaseToProducts), and for an order with a project its accounting already moves
// the cost on to that project (PO_INVENTORY_RECEIPT, then PO_INVENTORY_TO_WIP: Dr PUC - Raw
// Materials / Cr Materials Inventory). This keeps the quantities in line with that accounting: each
// received stock line's quantity leaves the warehouse and is allocated to the project, so the
// remaining unallocated received quantity is zero. No journal entry is posted - the allocation points
// at the order's existing PO_INVENTORY_TO_WIP entry. Services have no stock and are not allocated.
//
//   received    = the line's quantity (received on creation)
//   returned    = returnedQuantity (returns release the allocation first - releaseAllocationForReturn)
//   allocated   = net quantity allocated to the project (allocations - releases)
//   unallocated = received - returned - allocated   (0 once allocated)
//
// Everything runs in the caller's transaction. A line's allocation record carries a key unique per
// line and allocation number, so a retried or concurrent request cannot allocate the same quantity
// twice, and stock is decremented only while enough is in the warehouse (never below zero).

const idOf = ref => (ref?._id || ref ? String(ref?._id || ref) : null);

async function lineStates(po, session) {
  const productIds = [...new Set(po.items.map(i => idOf(i.productId)))];
  const [products, records, toWip] = await Promise.all([
    Product.find({ _id: { $in: productIds } }).select('type title').session(session || null).lean(),
    PucTransfer.find({ purchaseOrder: po._id }).session(session || null).lean(),
    JournalEntry.findOne({ sourceType: 'PO', sourceId: po._id, accountingAction: 'PO_INVENTORY_TO_WIP' }).select('entryNumber status').session(session || null).lean(),
  ]);
  const typeOf = new Map(products.map(p => [String(p._id), p]));
  return {
    toWip,
    lines: po.items.map(item => {
      const product = typeOf.get(idOf(item.productId));
      const mine = records.filter(r => String(r.poItem) === String(item._id));
      const allocated = round2(mine.filter(r => r.sourceType === 'purchase-order').reduce((s, r) => s + r.quantity, 0) - mine.filter(r => r.sourceType === 'purchase-return').reduce((s, r) => s + r.quantity, 0));
      const received = item.starterQuantity || 0;
      const returned = item.returnedQuantity || 0;
      const stock = product?.type !== 'service';
      return {
        item,
        product,
        stock,
        ordered: received,
        received,
        returned,
        allocated,
        unallocated: stock ? round2(received - returned - allocated) : 0,
        records: mine,
      };
    }),
  };
}

/**
 * Allocates every received, not yet allocated stock quantity of the order to its project. Returns
 * the order's allocation state. Safe to call again: a fully allocated order does nothing.
 */
async function allocatePurchaseOrderToProject(purchaseOrderId, { userId = null, session } = {}) {
  const po = await PurchaseOrder.findById(purchaseOrderId).session(session || null);
  if (!po) throw new ApiError('Purchase Order not found', 404);
  const { lines, toWip } = await lineStates(po, session);
  const stockLines = lines.filter(l => l.stock);
  if (!po.project || stockLines.length === 0) {
    await PurchaseOrder.updateOne({ _id: po._id }, { $set: { 'projectAllocation.status': 'not_applicable', 'projectAllocation.at': new Date() } }, { session });
    return allocationState(po._id, session);
  }

  for (const line of stockLines) {
    if (line.unallocated <= 0) continue;
    const qty = line.unallocated;
    const warehouse = idOf(po.warehouseId);
    // eslint-disable-next-line no-await-in-loop
    const { modifiedCount } = await Product.updateOne(
      { _id: line.product._id, stock: { $elemMatch: { warehouse: new mongoose.Types.ObjectId(warehouse), quantity: { $gte: qty } } } },
      { $inc: { 'stock.$.quantity': -qty } },
      { session }
    );
    if (modifiedCount !== 1) {
      throw new ApiError(`Cannot allocate ${qty} of "${line.product.title?.en || line.product._id}" to the project: the warehouse no longer holds that quantity (it was sold or transferred). Nothing was allocated.`, 400);
    }
    const unitCost = round2(line.item.unitPriceAfterDiscount ?? line.item.unitPrice ?? 0);
    // eslint-disable-next-line no-await-in-loop
    await PucTransfer.create(
      [
        {
          product: line.product._id,
          quantity: qty,
          unitCost,
          amount: round2(qty * unitCost),
          sourceType: 'purchase-order',
          purchaseOrder: po._id,
          poItem: line.item._id,
          warehouse,
          project: po.project._id || po.project,
          date: po.createdAt || new Date(),
          notes: `Received on Purchase Order ${po.code || po._id} and allocated to its project`,
          journalEntry: toWip?._id || null,
          // One key per line and allocation number - a concurrent duplicate collides on the unique index.
          requestKey: `PO:${po._id}:${line.item._id}:${line.records.filter(r => r.sourceType === 'purchase-order').length}`,
          createdBy: userId,
        },
      ],
      { session }
    );
    // eslint-disable-next-line no-await-in-loop
    await PurchaseOrder.updateOne({ _id: po._id, 'items._id': line.item._id }, { $inc: { 'items.$.allocatedQuantity': qty } }, { session });
  }
  await PurchaseOrder.updateOne({ _id: po._id }, { $set: { 'projectAllocation.status': 'allocated', 'projectAllocation.at': new Date() } }, { session });
  return allocationState(po._id, session);
}

/**
 * Before a quantity of `productId` is returned to the supplier: releases up to that quantity from the
 * order's project allocation back into the order's warehouse, so the existing return can take it out
 * of stock. Records a purchase-return release per line. Returns the quantity released.
 */
async function releaseAllocationForReturn(po, productId, quantity, { userId = null, session } = {}) {
  if (!po.project) return 0;
  const { lines } = await lineStates(po, session);
  let remaining = Number(quantity) || 0;
  let released = 0;
  for (const line of lines.filter(l => l.stock && idOf(l.item.productId) === String(productId) && l.allocated > 0)) {
    if (remaining <= 0) break;
    const qty = round2(Math.min(remaining, line.allocated));
    const warehouse = idOf(po.warehouseId);
    // eslint-disable-next-line no-await-in-loop
    const { modifiedCount } = await Product.updateOne({ _id: line.product._id, 'stock.warehouse': new mongoose.Types.ObjectId(warehouse) }, { $inc: { 'stock.$.quantity': qty } }, { session });
    if (modifiedCount !== 1) throw new ApiError('The order\'s warehouse has no stock record for this product, so the project allocation cannot be released for the return.', 400);
    // eslint-disable-next-line no-await-in-loop
    await PucTransfer.create(
      [
        {
          product: line.product._id,
          quantity: qty,
          unitCost: round2(line.item.unitPriceAfterDiscount ?? line.item.unitPrice ?? 0),
          amount: round2(qty * (line.item.unitPriceAfterDiscount ?? line.item.unitPrice ?? 0)),
          sourceType: 'purchase-return',
          purchaseOrder: po._id,
          poItem: line.item._id,
          warehouse,
          project: po.project._id || po.project,
          date: new Date(),
          notes: `Released from the project for a return on Purchase Order ${po.code || po._id}`,
          journalEntry: null,
          requestKey: `PORET:${po._id}:${line.item._id}:${line.records.filter(r => r.sourceType === 'purchase-return').length}`,
          createdBy: userId,
        },
      ],
      { session }
    );
    // eslint-disable-next-line no-await-in-loop
    await PurchaseOrder.updateOne({ _id: po._id, 'items._id': line.item._id }, { $inc: { 'items.$.allocatedQuantity': -qty } }, { session });
    remaining = round2(remaining - qty);
    released = round2(released + qty);
  }
  return released;
}

/** Per line: ordered, received, returned, allocated, unallocated - with the allocation records. */
async function allocationState(purchaseOrderId, session) {
  const po = await PurchaseOrder.findById(purchaseOrderId).session(session || null);
  if (!po) throw new ApiError('Purchase Order not found', 404);
  const { lines, toWip } = await lineStates(po, session);
  return {
    status: po.projectAllocation?.status || null,
    at: po.projectAllocation?.at || null,
    project: po.project ? { _id: idOf(po.project), projectNumber: po.project.projectNumber || null } : null,
    journalEntry: toWip ? { _id: toWip._id, entryNumber: toWip.entryNumber, status: toWip.status } : null,
    lines: lines.map(l => ({
      itemId: l.item._id,
      product: l.product ? { _id: l.product._id, title: l.product.title, type: l.product.type } : null,
      stock: l.stock,
      ordered: l.ordered,
      received: l.received,
      returned: l.returned,
      allocated: l.stock ? l.allocated : 0,
      unallocated: l.unallocated,
      unreceived: 0,
      records: l.records.map(r => ({ _id: r._id, sourceType: r.sourceType, quantity: r.quantity, date: r.date, journalEntry: r.journalEntry })),
    })),
  };
}

module.exports = { allocatePurchaseOrderToProject, releaseAllocationForReturn, allocationState };
