const mongoose = require('mongoose');
const Product = require('../../models/inventory/productModel');
const ApiError = require('../../utils/apiError');
const { loadMovements, emptyBalance, addMovement, finishBalance } = require('./pucMaterialBalanceService');
const { getCompanySettings } = require('../config/companySettingsService');

// ERP CHG-03 - stock control on sales invoices. A project's materials live in its PUC balance
// (pucMaterialBalanceService.js - the same figures as the Project Inventory screen). A sales invoice
// line may not take more than that balance unless the company setting "Prevent negative project
// stock" is off or the product is allowed to go negative (Product.allowNegativeProjectStock).
//
// A product that was never received into the project (no PUC movement at all) is not stock-tracked
// for it, so this rule does not apply to it: its cost is the project-level cost recognition, the
// path CHG-02's business decision is about.

const idOf = ref => (ref?._id || ref ? String(ref?._id || ref) : null);

/** Per product: whether the project tracks it, the quantity available and its average unit cost. */
async function projectStock(projectId, productIds) {
  const out = new Map();
  if (!projectId || !mongoose.isValidObjectId(String(projectId))) return out;
  for (const productId of [...new Set(productIds.map(String))]) {
    if (!mongoose.isValidObjectId(productId)) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const movements = await loadMovements({ projectIds: [String(projectId)], productId });
    const balance = emptyBalance();
    for (const m of movements) addMovement(balance, m, false);
    const finished = finishBalance(balance);
    out.set(productId, { tracked: movements.length > 0, available: finished.closingQuantity, averageUnitCost: finished.averageUnitCost });
  }
  return out;
}

/** What the sales form shows on each line: available quantity and whether the limit applies. */
async function projectStockForForm(projectId, productIds) {
  const [settings, products, stock] = await Promise.all([
    getCompanySettings(),
    Product.find({ _id: { $in: productIds.filter(id => mongoose.isValidObjectId(String(id))) } })
      .select('type allowNegativeProjectStock')
      .lean(),
    projectStock(projectId, productIds),
  ]);
  const byId = new Map(products.map(p => [String(p._id), p]));
  return productIds.map(id => {
    const p = byId.get(String(id));
    const s = stock.get(String(id)) || { tracked: false, available: 0, averageUnitCost: null };
    const service = p?.type === 'service';
    return {
      product: String(id),
      tracked: !service && s.tracked,
      available: service ? null : s.available,
      enforced: !service && s.tracked && settings.preventNegativeProjectStock && !p?.allowNegativeProjectStock,
    };
  });
}

/**
 * Refuses a sales invoice whose lines (summed per product) exceed the project's stock. Runs on the
 * server for every sales invoice, whatever the client sent. Throws a 400 naming the product and
 * the available quantity, e.g. 'Only 40 available for this project ("Cable 6mm"; 50 requested)'.
 */
async function assertProjectStock({ projectId, items }) {
  const settings = await getCompanySettings();
  if (!settings.preventNegativeProjectStock || !projectId) return;
  const requested = new Map();
  for (const item of items || []) {
    const id = idOf(item.product);
    if (id) requested.set(id, (requested.get(id) || 0) + (Number(item.starterQuantity) || 0));
  }
  if (!requested.size) return;
  const products = await Product.find({ _id: { $in: [...requested.keys()].filter(id => mongoose.isValidObjectId(id)) } })
    .select('type title allowNegativeProjectStock')
    .lean();
  const checked = products.filter(p => p.type !== 'service' && !p.allowNegativeProjectStock).map(p => String(p._id));
  if (!checked.length) return;
  const stock = await projectStock(projectId, checked);
  for (const p of products) {
    const s = stock.get(String(p._id));
    if (!s || !s.tracked) continue; // eslint-disable-line no-continue
    const qty = Math.round(requested.get(String(p._id)) * 10000) / 10000;
    if (qty > s.available + 1e-9) {
      const name = p.title?.en || p.title?.ar || String(p._id);
      throw new ApiError(`Only ${Math.max(0, s.available)} available for this project ("${name}"; ${qty} requested).`, 400);
    }
  }
}

module.exports = { projectStock, projectStockForForm, assertProjectStock };
