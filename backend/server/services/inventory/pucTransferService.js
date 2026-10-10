const mongoose = require('mongoose');
const PucTransfer = require('../../models/inventory/pucTransferModel');
const Product = require('../../models/inventory/productModel');
const Project = require('../../models/project/projectModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const Counter = require('../../models/config/counterModel');
const ApiError = require('../../utils/apiError');
const { round2 } = require('../../utils/orderTotals');
const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');
const { postAutomaticJournalEntry, getAccountIdByCode, deterministicSourceId } = require('../accounting/accountingEventService');
const { assertPeriodsOpen } = require('../accounting/accountingPeriodService');
const { resolveProjectNumber } = require('../accounting/journalEntryProjectService');

// PUC Transfer - moves a quantity of a stock product into a project's PUC (Projects Under
// Construction), keeping Reservia's existing meaning of PUC: the per-project WIP accounts that
// Purchase Orders already post materials to (PO_INVENTORY_TO_WIP: Dr PUC - Raw Materials / Cr
// Materials Inventory). Two sources:
//
//   warehouse -> project   the quantity leaves the warehouse (an atomic, conditional decrement - it
//                          can never go below zero) and its cost (quantity x product cost) moves
//                          from Materials Inventory to the project's PUC - Raw Materials. Only cost
//                          still held in Materials Inventory can move: stock bought on a project's
//                          Purchase Order is already in that project's PUC (moving it again would
//                          count it twice), so it is transferred from that project instead.
//   project -> project     a reallocation: Dr PUC - Raw Materials (destination) / Cr PUC - Raw
//                          Materials (source), same amount - company PUC is unchanged. The source
//                          project can give at most the quantity it received for this product
//                          (its Purchase Orders + transfers in - transfers out) and at most its PUC
//                          - Raw Materials balance.
//
// Everything (stock, transfer record, journal entry) is written in the caller's transaction, so a
// failure leaves nothing behind. Transfers are serialized through one lock document, so two
// requests can never move the same quantity or value twice, and a repeated request (same
// requestKey) returns the transfer already recorded.

const LOCK_ID = 'pucTransferLock';
const idOf = ref => (ref?._id || ref ? String(ref?._id || ref) : null);

async function ledgerBalance(accountId, projectId, session) {
  const match = { status: { $in: ['posted', 'reversed'] } };
  const lineMatch = { 'lines.account': new mongoose.Types.ObjectId(String(accountId)), ...(projectId ? { 'lines.project': new mongoose.Types.ObjectId(String(projectId)) } : {}) };
  const [row] = await JournalEntry.aggregate([{ $match: match }, { $unwind: '$lines' }, { $match: lineMatch }, { $group: { _id: null, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } }]).session(session || null);
  return round2((row?.debit || 0) - (row?.credit || 0));
}

/** Quantity of `productId` a project has received into its PUC and not passed on. */
async function projectQuantity(productId, projectId, session) {
  const product = new mongoose.Types.ObjectId(String(productId));
  const project = new mongoose.Types.ObjectId(String(projectId));
  const [[purchased], transfers] = await Promise.all([
    PurchaseOrder.aggregate([
      // Orders allocated automatically are counted through their allocation records below.
      { $match: { project, 'projectAllocation.status': { $ne: 'allocated' } } },
      { $unwind: '$items' },
      { $match: { 'items.productId': product } },
      { $group: { _id: null, quantity: { $sum: { $subtract: [{ $ifNull: ['$items.starterQuantity', 0] }, { $ifNull: ['$items.returnedQuantity', 0] }] } } } },
    ]).session(session || null),
    PucTransfer.find({ product, $or: [{ project }, { sourceProject: project }] }).select('quantity project sourceProject journalEntry sourceType').session(session || null).lean(),
  ]);
  // A transfer whose journal entry was reversed no longer counts.
  const entries = await JournalEntry.collection.find({ _id: { $in: transfers.map(t => t.journalEntry) } }, { projection: { status: 1 }, session: session || undefined }).toArray();
  const live = new Set(entries.filter(e => e.status === 'posted').map(e => String(e._id)));
  let quantity = purchased?.quantity || 0;
  for (const t of transfers) {
    if (t.sourceType === 'purchase-return') {
      if (idOf(t.project) === String(project)) quantity -= t.quantity; // released for a return
    } else if (!t.journalEntry || live.has(String(t.journalEntry))) {
      if (idOf(t.project) === String(project)) quantity += t.quantity;
      if (idOf(t.sourceProject) === String(project)) quantity -= t.quantity;
    }
  }
  return round2(quantity);
}

/** What can be transferred: warehouse stock, and per-project quantities when asked. */
async function transferOptions(productId, { sourceProject } = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(productId))) throw new ApiError('Invalid product id', 400);
  const product = await Product.findById(productId).populate({ path: 'stock.warehouse', select: 'name' }).lean();
  if (!product) throw new ApiError('Product not found', 404);
  const [inventoryId] = await Promise.all([getAccountIdByCode(AutomaticJournalAccountCodes.materialsInventory)]);
  const result = {
    product: { _id: product._id, title: product.title, sku: product.sku || null, type: product.type, cost: product.cost ?? null },
    warehouses: (product.stock || []).map(s => ({ _id: idOf(s.warehouse), name: s.warehouse?.name || null, quantity: s.quantity })),
    materialsInventoryBalance: await ledgerBalance(inventoryId, null),
  };
  if (sourceProject) {
    if (!mongoose.Types.ObjectId.isValid(String(sourceProject))) throw new ApiError('Invalid project id', 400);
    result.sourceProjectQuantity = await projectQuantity(productId, sourceProject);
  }
  return result;
}

async function listTransfers(productId) {
  if (!mongoose.Types.ObjectId.isValid(String(productId))) throw new ApiError('Invalid product id', 400);
  const transfers = await PucTransfer.find({ product: productId })
    .populate({ path: 'project sourceProject', select: 'projectNumber name' })
    .populate({ path: 'warehouse', select: 'name' })
    .populate({ path: 'journalEntry', select: 'entryNumber status' })
    .populate({ path: 'createdBy', select: 'name' })
    .sort({ date: -1, createdAt: -1 })
    .lean();
  return transfers;
}

/**
 * Records a PUC transfer in the caller's transaction. input: { quantity, project, sourceType
 * ('warehouse' | 'project'), warehouse, sourceProject, date, notes, requestKey }.
 */
async function recordPucTransfer(productId, input, userId, session) {
  const { quantity, project: projectId, sourceType, warehouse: warehouseId, sourceProject: sourceProjectId, date, notes, requestKey } = input;

  if (requestKey) {
    const existing = await PucTransfer.findOne({ requestKey }).session(session || null).lean();
    if (existing) {
      if (idOf(existing.product) !== String(productId)) throw new ApiError('This request key was already used for another transfer.', 409);
      return { transfer: existing, duplicate: true };
    }
  }

  // One transfer at a time: every transfer writes this document, so concurrent transactions conflict
  // and the later one re-reads the stock and balances after the first has committed.
  await Counter.updateOne({ _id: LOCK_ID }, { $inc: { seq: 1 }, $setOnInsert: { min: 0, max: Number.MAX_SAFE_INTEGER } }, { upsert: true, session });

  const product = await Product.findById(productId).session(session || null).lean();
  if (!product) throw new ApiError('Product not found', 404);
  if (product.type === 'service') throw new ApiError('A service has no stock to transfer - its cost goes to PUC when it is purchased.', 400);

  const qty = Number(quantity);
  if (!(qty > 0) || !Number.isFinite(qty) || Math.round(qty * 1000) !== qty * 1000) throw new ApiError('Quantity must be a positive number (at most 3 decimals).', 400);

  const project = await Project.findById(projectId).session(session || null).lean();
  if (!project) throw new ApiError('The selected project does not exist.', 400);
  if (project.status === 'cancelled') throw new ApiError(`Project ${project.projectNumber} is cancelled.`, 400);

  const unitCost = round2(Number(product.cost) || 0);
  if (!(unitCost > 0)) throw new ApiError('This product has no cost, so its transfer has no value to post. Set the product cost first.', 400);
  const amount = round2(qty * unitCost);
  if (!(amount > 0)) throw new ApiError('The transfer amount (quantity x cost) must be greater than 0.', 400);

  const transferDate = date ? new Date(date) : new Date();
  if (Number.isNaN(transferDate.getTime())) throw new ApiError('Invalid transfer date.', 400);
  await assertPeriodsOpen(transferDate, session);

  const pucId = await getAccountIdByCode(AutomaticJournalAccountCodes.wipRawMaterials, session);
  const [projectNumber] = await Promise.all([resolveProjectNumber(project._id, session)]);
  const productName = product.title?.en || product.title?.ar || product.sku || String(product._id);
  let lines;
  let sourceProject = null;
  let entryProject = project._id;

  if (sourceType === 'warehouse') {
    if (!warehouseId || !mongoose.Types.ObjectId.isValid(String(warehouseId))) throw new ApiError('Select the warehouse the quantity leaves.', 400);
    const inventoryId = await getAccountIdByCode(AutomaticJournalAccountCodes.materialsInventory, session);
    const inventoryBalance = await ledgerBalance(inventoryId, null, session);
    if (amount > inventoryBalance) {
      throw new ApiError(`Only ${inventoryBalance} of materials cost is held in Materials Inventory, less than this transfer (${amount}). Stock bought on a project's Purchase Order is already in that project's PUC - transfer it from that project instead.`, 400);
    }
    const { modifiedCount } = await Product.updateOne(
      { _id: product._id, stock: { $elemMatch: { warehouse: new mongoose.Types.ObjectId(String(warehouseId)), quantity: { $gte: qty } } } },
      { $inc: { 'stock.$.quantity': -qty } },
      { session }
    );
    if (modifiedCount !== 1) {
      const stock = (product.stock || []).find(s => idOf(s.warehouse) === String(warehouseId));
      throw new ApiError(stock ? `Only ${stock.quantity} in stock in this warehouse - less than ${qty}.` : 'This product has no stock in the selected warehouse.', 400);
    }
    lines = [
      { account: pucId, debit: amount, credit: 0, project: project._id },
      { account: inventoryId, debit: 0, credit: amount, project: project._id },
    ];
  } else if (sourceType === 'project') {
    sourceProject = await Project.findById(sourceProjectId).session(session || null).lean();
    if (!sourceProject) throw new ApiError('The source project does not exist.', 400);
    if (String(sourceProject._id) === String(project._id)) throw new ApiError('The source and destination projects must be different.', 400);
    const available = await projectQuantity(product._id, sourceProject._id, session);
    if (qty > available) throw new ApiError(`Project ${sourceProject.projectNumber} has ${available} of this product in its PUC - less than ${qty}.`, 400);
    const sourceBalance = await ledgerBalance(pucId, sourceProject._id, session);
    if (amount > sourceBalance) throw new ApiError(`Project ${sourceProject.projectNumber}'s PUC - Raw Materials balance (${sourceBalance}) is less than this transfer (${amount}).`, 400);
    const sourceNumber = await resolveProjectNumber(sourceProject._id, session);
    // Lines of two projects: the entry itself carries no single project; each line its own.
    entryProject = null;
    lines = [
      { account: pucId, debit: amount, credit: 0, project: project._id, projectNumber },
      { account: pucId, debit: 0, credit: amount, project: sourceProject._id, projectNumber: sourceNumber },
    ];
  } else {
    throw new ApiError('The transfer source must be a warehouse or a project.', 400);
  }

  const transferId = new mongoose.Types.ObjectId();
  const from = sourceType === 'warehouse' ? 'warehouse stock' : `project ${sourceProject.projectNumber}`;
  const entry = await postAutomaticJournalEntry({
    accountingAction: 'PUC_TRANSFER',
    sourceType: 'PUC_TRANSFER',
    sourceId: deterministicSourceId(`PUC_TRANSFER:${transferId}`),
    date: transferDate,
    description: notes?.trim() || `PUC transfer - ${productName} x ${qty} from ${from} to project ${projectNumber}`,
    project: entryProject,
    lines,
    session,
  });

  const [transfer] = await PucTransfer.create(
    [
      {
        _id: transferId,
        product: product._id,
        quantity: qty,
        unitCost,
        amount,
        sourceType,
        warehouse: sourceType === 'warehouse' ? warehouseId : null,
        sourceProject: sourceProject?._id || null,
        project: project._id,
        date: transferDate,
        notes,
        journalEntry: entry._id,
        requestKey: requestKey || undefined,
        createdBy: userId,
      },
    ],
    { session }
  );
  return { transfer, journalEntry: entry, duplicate: false };
}

module.exports = { recordPucTransfer, transferOptions, listTransfers, projectQuantity };
