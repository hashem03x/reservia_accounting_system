const PucTransfer = require('../../models/inventory/pucTransferModel');
const Product = require('../../models/inventory/productModel');
const { round2 } = require('../../utils/orderTotals');
const { AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');
const { postAutomaticJournalEntry, getAccountIdByCode, deterministicSourceId } = require('../accounting/accountingEventService');
const { loadMovements, emptyBalance, addMovement, finishBalance } = require('./pucMaterialBalanceService');

// A Sales Order's materials must come from the SOLD PRODUCT's PROJECT's PUC balance, never from
// ordinary warehouse inventory (every new Sales Order requires a project - salesOrderModel.js -
// and anything it bought into that project arrived via a Purchase Order that was itself fully,
// synchronously allocated to the SAME project's PUC on receipt - poProjectAllocationService.js -
// so it was never really "available warehouse stock" in the first place).
//
// For each physical-product line (services have no PUC/stock concept), this consumes up to the
// line's quantity from the line's product's PUC balance in the order's project - never more than
// what pucMaterialBalanceService.js's own balance calculation (the SAME figures the Warehouses ->
// PUC Raw Materials report shows) says is actually there - at that balance's weighted average
// unit cost (the existing, single Average Cost mechanism; this module introduces no second one).
// A product never purchased into this project's PUC (no balance at all) is skipped, not fabricated
// a cost of 0 or 1 - this precise, per-product mechanism simply does not apply to it; that
// product's cost continues to be covered, if at all, only by the project-level, percentage-of-
// contract-value PROJECT_COST_RECOGNITION entry (JV0011) that already runs alongside every Sales
// Order (projectAccountingService.js#recalculateExecutedPercentage). The two mechanisms can never
// double-count: JV0011's own recognizable amount is capped at the project's REAL, live PUC ledger
// balance (accountingEventService.js#postProjectCostRecognitionJE), which this module's entries
// reduce exactly like any other credit to that account.
//
// Posts ONE balanced entry per Sales Order (Dr Cost of Goods Sold - Raw Materials / Cr PUC - Raw
// Materials) covering every consumable line, and one PucTransfer ('sale') per line consumed - the
// same "it never happened" exclusion from pucMaterialBalanceService.js#loadMovements, no additive
// cleanup needed, no PucTransfer deleted or mutated after the fact (same rule as every other PUC
// record in this codebase).

const idOf = ref => (ref?._id || ref ? String(ref?._id || ref) : null);

/**
 * Consumes PUC for every physical-product line of a just-created Sales Order. Call once, after
 * `salesOrder.save()`, in the same transaction. Idempotent: a Sales Order that already has a
 * 'sale' PucTransfer is left untouched (same "safe to call again" convention as
 * poProjectAllocationService.js#allocatePurchaseOrderToProject).
 */
async function consumePucForSale(salesOrder, { userId = null, session } = {}) {
  const projectId = idOf(salesOrder.project);
  if (!projectId || !salesOrder.items?.length) return null;

  const already = await PucTransfer.findOne({ salesOrder: salesOrder._id, sourceType: 'sale' }).session(session || null).lean();
  if (already) return null;

  const productIds = [...new Set(salesOrder.items.map(i => idOf(i.product)))];
  const products = await Product.find({ _id: { $in: productIds } }).select('type title').session(session || null).lean();
  const typeOf = new Map(products.map(p => [String(p._id), p]));

  const consumptionRecords = [];
  for (const item of salesOrder.items) {
    const productId = idOf(item.product);
    if (typeOf.get(productId)?.type === 'service') continue; // eslint-disable-line no-continue

    // eslint-disable-next-line no-await-in-loop
    const movements = await loadMovements({ projectIds: [projectId], productId });
    const balance = emptyBalance();
    for (const m of movements) addMovement(balance, m, false);
    const finished = finishBalance(balance);
    const available = finished.closingQuantity;
    if (!(available > 0) || finished.averageUnitCost == null) continue; // eslint-disable-line no-continue

    const qty = round2(Math.min(Number(item.starterQuantity) || 0, available));
    if (!(qty > 0)) continue; // eslint-disable-line no-continue
    const amount = round2(qty * finished.averageUnitCost);
    if (!(amount > 0)) continue; // eslint-disable-line no-continue

    consumptionRecords.push({ product: productId, quantity: qty, unitCost: finished.averageUnitCost, amount, itemId: item._id });
  }
  if (consumptionRecords.length === 0) return null;

  const totalAmount = round2(consumptionRecords.reduce((s, r) => s + r.amount, 0));
  const [costAccountId, pucAccountId] = await Promise.all([
    getAccountIdByCode(AutomaticJournalAccountCodes.costRawMaterials, session),
    getAccountIdByCode(AutomaticJournalAccountCodes.wipRawMaterials, session),
  ]);

  const entry = await postAutomaticJournalEntry({
    accountingAction: 'SALES_PUC_CONSUMPTION',
    sourceType: 'SO',
    sourceId: salesOrder._id,
    date: salesOrder.createdAt || new Date(),
    description: `Cost of materials sold - Sales Order ${salesOrder.code || salesOrder._id}`,
    project: projectId,
    lines: [
      { account: costAccountId, debit: totalAmount, credit: 0, project: projectId },
      { account: pucAccountId, debit: 0, credit: totalAmount, project: projectId },
    ],
    session,
  });

  await PucTransfer.create(
    consumptionRecords.map(r => ({
      product: r.product,
      quantity: r.quantity,
      unitCost: r.unitCost,
      amount: r.amount,
      sourceType: 'sale',
      salesOrder: salesOrder._id,
      soItem: r.itemId,
      project: projectId,
      date: salesOrder.createdAt || new Date(),
      notes: `Consumed by Sales Order ${salesOrder.code || salesOrder._id}`,
      journalEntry: entry._id,
      createdBy: userId,
    })),
    { session }
  );

  return entry;
}

/**
 * Releases up to `quantity` of a returned product's PUC consumption for ONE Sales Order back into
 * its project's PUC - the symmetric counterpart of poProjectAllocationService.js#
 * releaseAllocationForReturn on the purchase side. Caps the release at what this SAME sales order
 * actually consumed for this product (net of any earlier releases) - never releases more than was
 * really taken, and never touches another order's consumption of the same product. Posts the
 * reversing entry at the ORIGINAL consumption's own unit cost (never today's average), so the
 * project's PUC balance is restored to exactly what it would have been had this portion never
 * been sold. A product this mechanism never consumed in the first place (e.g. it had no PUC
 * balance at sale time) is a silent no-op - there is nothing to release.
 */
async function releasePucConsumptionForReturn(salesOrder, productId, quantity, { userId = null, session } = {}) {
  const projectId = idOf(salesOrder.project);
  if (!projectId) return null;

  const records = await PucTransfer.find({ salesOrder: salesOrder._id, product: productId, sourceType: { $in: ['sale', 'sale-return'] } })
    .session(session || null)
    .lean();
  const saleRecords = records.filter(r => r.sourceType === 'sale');
  if (saleRecords.length === 0) return null; // this order never consumed PUC for this product

  const totalConsumedQty = round2(saleRecords.reduce((s, r) => s + r.quantity, 0));
  const totalReleasedQty = round2(records.filter(r => r.sourceType === 'sale-return').reduce((s, r) => s + r.quantity, 0));
  const stillConsumed = round2(totalConsumedQty - totalReleasedQty);
  if (!(stillConsumed > 0)) return null;

  const qty = round2(Math.min(Number(quantity) || 0, stillConsumed));
  if (!(qty > 0)) return null;

  const totalConsumedValue = round2(saleRecords.reduce((s, r) => s + r.amount, 0));
  const unitCost = totalConsumedQty > 0 ? round2(totalConsumedValue / totalConsumedQty) : 0;
  const amount = round2(qty * unitCost);
  if (!(amount > 0)) return null;

  const [costAccountId, pucAccountId] = await Promise.all([
    getAccountIdByCode(AutomaticJournalAccountCodes.costRawMaterials, session),
    getAccountIdByCode(AutomaticJournalAccountCodes.wipRawMaterials, session),
  ]);
  const product = await Product.findById(productId).select('title').session(session || null).lean();

  const entry = await postAutomaticJournalEntry({
    accountingAction: 'SALES_PUC_CONSUMPTION_RETURN',
    sourceType: 'SO',
    sourceId: deterministicSourceId(`SALES_PUC_RETURN:${salesOrder._id}:${productId}:${records.filter(r => r.sourceType === 'sale-return').length}`),
    date: new Date(),
    description: `Return - materials released back to PUC - ${product?.title?.en || product?.title?.ar || productId} (Sales Order ${salesOrder.code || salesOrder._id})`,
    project: projectId,
    lines: [
      { account: pucAccountId, debit: amount, credit: 0, project: projectId },
      { account: costAccountId, debit: 0, credit: amount, project: projectId },
    ],
    session,
  });

  await PucTransfer.create(
    [
      {
        product: productId,
        quantity: qty,
        unitCost,
        amount,
        sourceType: 'sale-return',
        salesOrder: salesOrder._id,
        project: projectId,
        date: new Date(),
        notes: `Released back to PUC - return on Sales Order ${salesOrder.code || salesOrder._id}`,
        journalEntry: entry._id,
        createdBy: userId,
      },
    ],
    { session }
  );

  return entry;
}

/** What this project's PUC consumption looks like for one product (used by tests/diagnostics). */
async function consumedBalance(projectId, productId, session) {
  const records = await PucTransfer.find({ project: projectId, product: productId, sourceType: { $in: ['sale', 'sale-return'] } })
    .session(session || null)
    .lean();
  const consumed = round2(records.filter(r => r.sourceType === 'sale').reduce((s, r) => s + r.quantity, 0));
  const released = round2(records.filter(r => r.sourceType === 'sale-return').reduce((s, r) => s + r.quantity, 0));
  return { consumed, released, net: round2(consumed - released) };
}

module.exports = { consumePucForSale, releasePucConsumptionForReturn, consumedBalance };
