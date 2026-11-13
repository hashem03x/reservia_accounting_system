const SalesOrder = require('../../models/sales/salesOrderModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');

/**
 * ERP CHG-06 - the 0% VAT review report: every sales and purchase invoice that carries no VAT, with
 * the reason given (invoices saved before the reason was required show none). Read-only.
 * Raw collection reads: the models' find hooks populate far more than this list needs.
 */
async function zeroVatInvoices({ from, to } = {}) {
  const range = {};
  if (from && !Number.isNaN(Date.parse(from))) range.$gte = new Date(from);
  if (to && !Number.isNaN(Date.parse(to))) range.$lte = new Date(`${String(to).slice(0, 10)}T23:59:59.999Z`);
  const match = { $or: [{ vatPercentage: 0 }, { vatPercentage: null }, { vatPercentage: { $exists: false } }], ...(Object.keys(range).length ? { createdAt: range } : {}) };
  const projection = { code: 1, createdAt: 1, totalAmount: 1, grandTotal: 1, vatExemptReason: 1, customer: 1, vendorId: 1, project: 1, orderStatus: 1 };
  const [sales, purchases] = await Promise.all([
    SalesOrder.collection.find({ ...match, orderStatus: { $ne: 'canceled' } }, { projection }).sort({ createdAt: -1 }).limit(2000).toArray(),
    PurchaseOrder.collection.find(match, { projection }).sort({ createdAt: -1 }).limit(2000).toArray(),
  ]);
  const db = SalesOrder.db;
  const ids = (rows, key) => [...new Set(rows.map(r => r[key]).filter(Boolean).map(String))].map(id => rows.find(r => String(r[key]) === id)[key]);
  const [customers, vendors, projects] = await Promise.all([
    db.collection('users').find({ _id: { $in: ids(sales, 'customer') } }, { projection: { name: 1 } }).toArray(),
    db.collection('vendors').find({ _id: { $in: ids(purchases, 'vendorId') } }, { projection: { name: 1 } }).toArray(),
    db.collection('projects').find({ _id: { $in: [...ids(sales, 'project'), ...ids(purchases, 'project')] } }, { projection: { projectNumber: 1, name: 1 } }).toArray(),
  ]);
  const byId = list => new Map(list.map(d => [String(d._id), d]));
  const C = byId(customers);
  const V = byId(vendors);
  const P = byId(projects);
  const row = (type, o, party) => ({
    type,
    _id: o._id,
    code: o.code || null,
    date: o.createdAt || null,
    party: party?.name || null,
    project: o.project ? P.get(String(o.project))?.projectNumber || null : null,
    amount: Number(o.grandTotal ?? o.totalAmount ?? 0),
    reason: o.vatExemptReason || null,
  });
  const rows = [...sales.map(o => row('sales', o, C.get(String(o.customer)))), ...purchases.map(o => row('purchase', o, V.get(String(o.vendorId))))].sort(
    (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
  );
  return {
    rows,
    summary: {
      sales: rows.filter(r => r.type === 'sales').length,
      purchase: rows.filter(r => r.type === 'purchase').length,
      withoutReason: rows.filter(r => !r.reason).length,
      amount: Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100,
    },
  };
}

module.exports = { zeroVatInvoices };
