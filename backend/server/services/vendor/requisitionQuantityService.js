const mongoose = require('mongoose');

// Quantity left to invoice on each line of a Purchase Order (Requisition model), per product:
//
//   remaining = ordered quantity - quantity already invoiced against it
//
// "Already invoiced" is every linked Purchase Invoice's quantity net of what was returned (a return
// releases the Purchase Order's amount the same way - reversalService.js), so several invoices can
// never jointly exceed a line. A Purchase Order listing the same product on several lines is
// treated as one total for that product. Legacy lines without a product (description only) can't
// be matched to an invoice line and are not quantity-checked - only the amount guard applies to
// them (purchaseOrder.js). Purchase Invoices are never edited after creation (returns / reversals
// adjust them), so there is no "own previous quantity" to exclude.

const idOf = ref => String(ref?._id || ref);

/**
 * @returns {Promise<Map<string, { ordered: number, invoiced: number, remaining: number, unitPrice: number, title: string }>>}
 *   keyed by product id; `unitPrice` is the agreed price of the product's first line.
 */
async function getRemainingQuantities(requisition, { session } = {}) {
  const lines = new Map();
  for (const item of requisition.items || []) {
    if (!item.product) continue; // eslint-disable-line no-continue
    const key = idOf(item.product);
    const line = lines.get(key) || { ordered: 0, invoiced: 0, remaining: 0, unitPrice: item.unitPrice, title: item.product?.title?.en || item.description };
    line.ordered += Number(item.quantity) || 0;
    lines.set(key, line);
  }
  if (!lines.size) return lines;

  const PurchaseOrder = mongoose.model('PurchaseOrder');
  const invoiced = await PurchaseOrder.aggregate([
    { $match: { requisition: new mongoose.Types.ObjectId(idOf(requisition._id)) } },
    { $unwind: '$items' },
    { $group: { _id: '$items.productId', quantity: { $sum: { $subtract: ['$items.starterQuantity', { $ifNull: ['$items.returnedQuantity', 0] }] } } } },
  ]).session(session || null);
  for (const row of invoiced) {
    const line = lines.get(idOf(row._id));
    if (line) line.invoiced += row.quantity;
  }
  for (const line of lines.values()) line.remaining = Math.max(0, line.ordered - line.invoiced);
  return lines;
}

/**
 * The error for the first invoice line that is not on the Purchase Order or asks for more than is
 * left on it (quantities of the same product across the invoice's lines are added up), or null.
 * A product not on the Purchase Order is only allowed when the Purchase Order has legacy lines
 * without a product (they can't be matched).
 */
async function checkInvoiceQuantities(invoiceItems, requisition, { session } = {}) {
  const remaining = await getRemainingQuantities(requisition, { session });
  const hasUnmatchableLines = (requisition.items || []).some(item => !item.product);

  const requested = new Map();
  for (const item of invoiceItems || []) {
    const key = idOf(item.productId);
    requested.set(key, (requested.get(key) || 0) + (Number(item.starterQuantity) || 0));
  }
  for (const [productId, quantity] of requested) {
    const line = remaining.get(productId);
    if (!line) {
      if (hasUnmatchableLines) continue; // eslint-disable-line no-continue
      return 'An item on this Purchase Invoice is not on its linked Purchase Order.';
    }
    if (quantity > line.remaining) {
      return `${line.title ? `"${line.title}": ` : ''}Invoice quantity ${quantity} exceeds the quantity remaining on the Purchase Order line (${line.remaining} of ${line.ordered} left; ${line.invoiced} already invoiced).`;
    }
  }
  return null;
}

module.exports = { getRemainingQuantities, checkInvoiceQuantities };
