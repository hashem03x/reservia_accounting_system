const { round2 } = require('./orderTotals');

// VAT Accounting Treatment - the one centralized place that decides where a purchase-side
// document's already-computed VAT amount (utils/orderTotals.js#computeOrderTotals - unchanged,
// still the only place vatAmount itself is calculated) ends up: its own recoverable "Input VAT"
// ledger line (today's only behavior, unconditionally preserved), or folded into the expense/
// inventory cost debit as non-recoverable VAT (the new behavior). Reused by every purchase-type
// posting function (Purchase Invoice, Expense, Fixed Asset) so the branch is written once, not
// copy-pasted and risking drift between them.
//
// Deliberately PURCHASE-SIDE ONLY. Sales ("No VAT" on a Sales Order/Invoice) never calls this -
// output VAT is a pass-through liability collected from the customer on behalf of the tax
// authority, not a recoverable asset whose non-recovery becomes a cost, so there is no "fold it
// into revenue" analog here. A Sales Order's "No VAT" is expressed entirely by its own existing
// vatPercentage/vatExemptReason fields (vatPercentage: 0) - see
// services/accounting/accountingEventService.js#postProjectRevenueRecognitionJE, which already
// skips its VAT Payable line whenever vatAmount is 0 and needs no change for this feature.

const VAT_TREATMENTS = ['recoverable', 'non_recoverable'];
const DEFAULT_VAT_TREATMENT = 'recoverable';

function isValidVatTreatment(value) {
  return VAT_TREATMENTS.includes(value);
}

/**
 * Splits an already-computed VAT amount between "its own ledger line" and "folded into the cost
 * debit", for ONE purchase-side cost component (a PO's physical-items subtotal, its service-items
 * subtotal, an Expense's base amount, a Fixed Asset's price - whatever `baseCost`/`vatAmount`
 * pair the caller is currently posting).
 *
 *   recoverable      (today's only existing behavior, byte-for-byte unchanged): the cost debit is
 *                     exactly `baseCost`; the VAT is its own separate `vatLineAmount`, debited to
 *                     Input VAT by the caller exactly as it already does.
 *   non_recoverable  (new): the cost debit absorbs the VAT (`baseCost + vatAmount`); there is
 *                     nothing left for a separate VAT line (`vatLineAmount: 0`), so every existing
 *                     `if (vatLineAmount > 0) { ...debit Input VAT... }` guard in the posting
 *                     functions naturally skips it - no second code path, just a different input.
 *
 * @returns {{ costDebit: number, vatLineAmount: number }}
 */
function splitCostForVatTreatment({ baseCost, vatAmount, vatTreatment }) {
  const base = round2(Number(baseCost) || 0);
  const vat = round2(Number(vatAmount) || 0);
  if (vatTreatment === 'non_recoverable') {
    return { costDebit: round2(base + vat), vatLineAmount: 0 };
  }
  return { costDebit: base, vatLineAmount: vat };
}

/**
 * Splits a Purchase Invoice's own `items` (a mix of physical/stocked products and services) into
 * the two groups `postPurchaseOrderJournalEntries` posts independently, and divides the invoice's
 * total VAT/WHT between them in proportion to each group's subtotal - the service group taking the
 * exact rounding remainder, so the two groups' amounts always sum back to the invoice's own totals
 * to the cent. This is the EXACT formula `postPurchaseOrderJournalEntries` already used inline;
 * moved here (not duplicated) so `applyPurchaseToProducts` (controller/PO/purchaseOrderController.js)
 * can derive the identical `physicalVat`/`physicalSubtotal` for its own per-item allocation (see
 * `allocateVatToItems` below) without risking a second, independently-computed ratio drifting from
 * the posting function's.
 *
 * @param {object} params
 * @param {object[]} params.items - purchaseOrder.items (each with its own `.subtotal`)
 * @param {number} params.vatAmount - the invoice's total vatAmount
 * @param {number} params.withholdingTaxAmount - the invoice's total withholdingTaxAmount
 * @param {(item:object) => boolean} params.isServiceItem
 */
function splitPurchaseVatByGroup({ items, vatAmount, withholdingTaxAmount, isServiceItem }) {
  const physicalItems = items.filter(i => !isServiceItem(i));
  const serviceItems = items.filter(isServiceItem);
  const physicalSubtotal = round2(physicalItems.reduce((s, i) => s + (i.subtotal || 0), 0));
  const serviceSubtotal = round2(serviceItems.reduce((s, i) => s + (i.subtotal || 0), 0));
  const totalForTax = round2(physicalSubtotal + serviceSubtotal);
  const totalVat = round2(Number(vatAmount) || 0);
  const totalWht = round2(Number(withholdingTaxAmount) || 0);
  const physicalShare = totalForTax > 0 ? physicalSubtotal / totalForTax : 0;
  const physicalVat = serviceItems.length === 0 ? totalVat : round2(totalVat * physicalShare);
  const physicalWht = serviceItems.length === 0 ? totalWht : round2(totalWht * physicalShare);
  const serviceVat = round2(totalVat - physicalVat);
  const serviceWht = round2(totalWht - physicalWht);
  return { physicalSubtotal, serviceSubtotal, physicalVat, serviceVat, physicalWht, serviceWht };
}

/**
 * Allocates a group's total VAT across its own line items (or, for the service side's PUC-account
 * groups, pseudo-items `{subtotal: amount}` keyed by account), proportional to each item's share of
 * the group's subtotal - the LAST entry (array order) absorbing the rounding remainder, so the
 * per-item amounts always sum to exactly `round2(groupVat)`, never off by a cent through
 * independent rounding. This is what lets a non-recoverable-VAT invoice fold VAT into
 * `Product.cost`'s moving-average input (and into each PUC-account's service debit) in the exact
 * proportions already reflected in the single aggregate VAT amount posted to the ledger.
 *
 * @param {{subtotal:number}[]} items
 * @param {number} groupSubtotal - e.g. physicalSubtotal/serviceSubtotal from splitPurchaseVatByGroup
 * @param {number} groupVat - e.g. physicalVat/serviceVat from splitPurchaseVatByGroup
 * @returns {number[]} one VAT amount per entry, same order, summing to round2(groupVat)
 */
function allocateVatToItems(items, groupSubtotal, groupVat) {
  const vat = round2(Number(groupVat) || 0);
  if (!items.length || vat === 0 || !groupSubtotal) return items.map(() => 0);
  const shares = items.map(item => round2(vat * ((item.subtotal || 0) / groupSubtotal)));
  const allocated = round2(shares.reduce((s, v) => s + v, 0));
  shares[shares.length - 1] = round2(shares[shares.length - 1] + (vat - allocated));
  return shares;
}

module.exports = {
  VAT_TREATMENTS,
  DEFAULT_VAT_TREATMENT,
  isValidVatTreatment,
  splitCostForVatTreatment,
  splitPurchaseVatByGroup,
  allocateVatToItems,
};
