const mongoose = require('mongoose');
const Requisition = require('../../models/vendor/requisitionModel');
const { getCompanySettings } = require('../config/companySettingsService');

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * ERP CHG-07 - price variance warning at PO entry. Compares a unit price with the product's last
 * and quantity-weighted average unit price on earlier Purchase Orders (cancelled ones excluded;
 * `excludeId` leaves out the PO being edited). Returns `warn: true` when either difference is above
 * the company's priceVarianceWarnPct. Only a warning: nothing is refused.
 */
async function checkPriceVariance({ productId, unitPrice, excludeId }) {
  const { priceVarianceWarnPct } = await getCompanySettings();
  const price = Number(unitPrice);
  const out = { productId, unitPrice: price, thresholdPct: priceVarianceWarnPct, last: null, average: null, count: 0, vsLastPct: null, vsAveragePct: null, warn: false };
  if (!mongoose.isValidObjectId(productId) || !Number.isFinite(price) || price < 0) return out;

  const match = { status: { $ne: 'cancelled' }, 'items.product': new mongoose.Types.ObjectId(String(productId)) };
  if (excludeId && mongoose.isValidObjectId(excludeId)) match._id = { $ne: new mongoose.Types.ObjectId(String(excludeId)) };
  // The raw collection: only these fields are needed, and the model's find hooks populate references.
  const pos = await Requisition.collection
    .find(match, { projection: { code: 1, issueDate: 1, createdAt: 1, 'items.product': 1, 'items.quantity': 1, 'items.unitPrice': 1 } })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();

  let qty = 0;
  let value = 0;
  for (const po of pos) {
    for (const item of po.items || []) {
      if (String(item.product) !== String(productId)) continue; // eslint-disable-line no-continue
      const q = Number(item.quantity) || 0;
      qty += q;
      value += q * (Number(item.unitPrice) || 0);
      out.count += 1;
      if (!out.last) out.last = { unitPrice: item.unitPrice, code: po.code || null, date: po.issueDate || po.createdAt };
    }
  }
  if (qty > 0) out.average = round2(value / qty);
  const diff = ref => (ref > 0 ? round2(((price - ref) / ref) * 100) : null);
  if (out.last) out.vsLastPct = diff(out.last.unitPrice);
  if (out.average !== null) out.vsAveragePct = diff(out.average);
  out.warn = [out.vsLastPct, out.vsAveragePct].some(p => p !== null && Math.abs(p) > priceVarianceWarnPct);
  return out;
}

module.exports = { checkPriceVariance };
