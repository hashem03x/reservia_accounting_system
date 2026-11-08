const { Schema, model } = require('mongoose');

// A PUC Transfer - a quantity of a stock product moved into (or, for 'sale'/'purchase-return', out
// of) a project's PUC (Projects Under Construction), the audit record of
// services/inventory/pucTransferService.js:
//   - from warehouse stock: the quantity leaves the warehouse and its cost moves from Materials
//     Inventory to the project's PUC - Raw Materials (the existing PO_INVENTORY_TO_WIP treatment);
//   - from another project's PUC: a reallocation between projects (PUC - Raw Materials of the
//     destination debited, of the source credited) - total PUC is unchanged.
//   - 'sale' (services/inventory/pucSalesConsumptionService.js): a Sales Order consumed this
//     quantity from the project's PUC (Dr COGS / Cr PUC - Raw Materials) - the quantity/cost a
//     sale actually comes from, never ordinary warehouse stock.
//   - 'sale-return': the reverse of a 'sale' - a Sales Order return released this quantity back
//     into the project's PUC (Dr PUC - Raw Materials / Cr COGS), at the SAME unit cost the
//     original sale consumed, never today's average.
// Each transfer has exactly one journal entry (none for 'purchase-return', which has always been
// un-posted - see poProjectAllocationService.js). Records are never edited or deleted; a transfer
// is undone by reversing its journal entry (or, for a partial release, by a new 'sale-return'
// record - never by mutating the original 'sale' record).
const pucTransferSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: [0.001, 'Quantity must be greater than 0'] },
    // The product's cost per unit at the time of the transfer, and quantity x cost.
    unitCost: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    // warehouse / project: a PUC Transfer made by a user. purchase-order: the automatic allocation of
    // a Purchase Order line's received quantity to its project (no entry of its own - the PO's
    // PO_INVENTORY_TO_WIP entry already moved its cost). purchase-return: an allocation released
    // because the quantity was returned to the supplier. sale / sale-return: see the header comment.
    sourceType: { type: String, enum: ['warehouse', 'project', 'purchase-order', 'purchase-return', 'sale', 'sale-return'], required: true },
    purchaseOrder: { type: Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
    poItem: { type: Schema.Types.ObjectId, default: null },
    // The Sales Order a 'sale'/'sale-return' record belongs to (mirrors purchaseOrder/poItem above
    // for the purchase side) - null for every other sourceType.
    salesOrder: { type: Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
    soItem: { type: Schema.Types.ObjectId, default: null },
    warehouse: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    sourceProject: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    date: { type: Date, required: true },
    notes: { type: String, trim: true, maxlength: 500 },
    // The transfer's journal entry (purchase-order: the PO's PO_INVENTORY_TO_WIP entry; none for a
    // purchase-return - Reservia posts no entry for purchase returns).
    journalEntry: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    // The client's submission key - a repeated request with the same key returns this transfer.
    requestKey: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

pucTransferSchema.index({ product: 1, date: -1 });
pucTransferSchema.index({ project: 1 });
pucTransferSchema.index({ sourceProject: 1 });
pucTransferSchema.index({ purchaseOrder: 1, poItem: 1 });
pucTransferSchema.index({ salesOrder: 1, product: 1 });
pucTransferSchema.index({ requestKey: 1 }, { unique: true, partialFilterExpression: { requestKey: { $type: 'string' } } });

module.exports = model('PucTransfer', pucTransferSchema);
