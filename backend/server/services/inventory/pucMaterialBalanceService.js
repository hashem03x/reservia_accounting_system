const mongoose = require('mongoose');
const PucTransfer = require('../../models/inventory/pucTransferModel');
const Product = require('../../models/inventory/productModel');
const Project = require('../../models/project/projectModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const Requisition = require('../../models/vendor/requisitionModel');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const ApiError = require('../../utils/apiError');
const { rawMaterialsPucAccount } = require('../project/pucAccountService');
const Currency = require('../../models/accounting/currencyModel');
const { rateForDate } = require('../accounting/currencyService');

// PUC - Raw Materials balances per project and material (client requirements "Warehouses -
// Projectwise PUC Raw Materials Balances" and "Projects - Raw Materials Breakdown and Cost
// Sources"). Read-only: derived from the authoritative records, never a second stored balance.
//
// QUANTITY and its allocated VALUE come from the same records pucTransferService.js#projectQuantity
// counts (the rule PUC transfers are validated against), so the two can never disagree:
//   + purchase       a Purchase Invoice's quantity allocated to the project (PucTransfer
//                    'purchase-order'), or - for an invoice that predates automatic allocation and
//                    was never allocated - the invoice's own line (net of its returns)
//   + transfer in    warehouse -> project, or another project -> this project
//   - transfer out   this project -> another project
//   - return         quantity released from the project for a purchase return
// A transfer whose journal entry was reversed does not count. Each purchase keeps its source
// document (invoice, vendor, unit cost), so every cost is traceable; several invoices for one
// material simply add up, each listed on its own.
//
// Quantity CONSUMED is not recorded anywhere in Reservia (materials are consumed in VALUE, by the
// cost-recognition entry JV0011 crediting PUC - Raw Materials when a Sales Invoice is issued), so a
// quantity "remaining after use" cannot be derived - the quantity shown is what is ALLOCATED to the
// project. The project's VALUE is reconciled separately with the PUC - Raw Materials ledger itself
// (opening / receipts / relief (credits: cost recognition, returns, transfers out) / closing), the
// figure the General Ledger and the balance sheet show.
//
// PLANNED cost is not mixed in: Purchase Order (pre-invoice) quantities are reported separately as
// "ordered" (committed), never added to the purchased quantity.
//
// BOQ PRICE vs PO COST (confirmed business rule - client requirement "Projects - Raw Materials
// Breakdown, BOQ Price, and PO Cost"), per material of the project:
//   BOQ unit price   the project's own BOQ line for that product (Project.boqLines) - never the
//                    catalog price, never the PO cost. A BOQ price in another currency is converted
//                    to EGP with the Currency Manager rate in effect on the project start date (the
//                    contract date - currencyService.js#rateForDate, "1 EGP = X units").
//   unit cost        the ACTUAL purchase cost: the weighted average unit cost of the project's
//                    Purchase Invoice lines for that product (purchased value / purchased quantity,
//                    EGP). Committed cost (open Purchase Order lines) is shown separately and never
//                    used in its place.
//   quantity basis   the BOQ quantity (the contract quantity the BOQ price is earned on); the
//                    purchased / allocated quantity is shown beside it, never mixed in.
//   contribution     (BOQ unit price - unit cost) x BOQ quantity - a price-minus-cost analysis figure,
//                    NOT recognized accounting revenue. Nothing here posts or recognizes anything.
// A missing BOQ price, missing purchase cost or unconfigured currency is reported as such - never
// silently treated as zero. Units are compared as text (Reservia has no unit-of-measure conversion
// rules), and a BOQ unit that differs from the Purchase Order line unit is flagged.

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round4 = n => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
const idOf = ref => (ref?._id || ref ? String(ref?._id || ref) : null);
const oid = v => new mongoose.Types.ObjectId(String(v));

function parseDate(value, label, endOfDay = false) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ApiError(`Invalid ${label}`, 400);
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) d.setUTCHours(23, 59, 59, 999);
  return d;
}

function checkId(value, label) {
  if (value && !mongoose.Types.ObjectId.isValid(String(value))) throw new ApiError(`Invalid ${label} id`, 400);
  return value || null;
}

/**
 * Every material movement into or out of a project's PUC, normalized:
 * { project, product, date, kind: 'purchase'|'transfer_in'|'transfer_out'|'return', quantity (>0),
 *   amount (>0), unitCost, warehouse, invoice: { _id, code, vendor } | null, counterpartProject }
 */
async function loadMovements({ projectIds = null, productId = null, dateTo = null } = {}) {
  const projectFilter = projectIds ? { $in: projectIds.map(oid) } : { $ne: null };
  const transfers = await PucTransfer.find({
    $or: [{ project: projectFilter }, { sourceProject: projectFilter }],
    ...(productId ? { product: oid(productId) } : {}),
    ...(dateTo ? { date: { $lte: dateTo } } : {}),
  })
    .populate({ path: 'purchaseOrder', select: 'code warehouseId vendorId', populate: { path: 'vendorId', select: 'name vendorNumber' } })
    .lean();

  // A transfer whose journal entry was reversed no longer counts (same rule as projectQuantity).
  const entryIds = transfers.map(t => t.journalEntry).filter(Boolean);
  const entries = entryIds.length ? await JournalEntry.collection.find({ _id: { $in: entryIds } }, { projection: { status: 1 } }).toArray() : [];
  const live = new Set(entries.filter(e => e.status === 'posted').map(e => String(e._id)));

  const inScope = id => !projectIds || projectIds.map(String).includes(String(id));
  const movements = [];
  for (const t of transfers) {
    const base = { product: idOf(t.product), date: t.date, unitCost: t.unitCost, quantity: t.quantity, amount: t.amount };
    const invoice = t.purchaseOrder
      ? { _id: t.purchaseOrder._id, code: t.purchaseOrder.code || String(t.purchaseOrder._id), vendor: t.purchaseOrder.vendorId ? { _id: t.purchaseOrder.vendorId._id, name: t.purchaseOrder.vendorId.name, vendorNumber: t.purchaseOrder.vendorId.vendorNumber } : null }
      : null;
    const warehouse = idOf(t.warehouse) || idOf(t.purchaseOrder?.warehouseId);
    if (t.sourceType === 'purchase-return') {
      if (inScope(t.project)) movements.push({ ...base, project: idOf(t.project), kind: 'return', warehouse, invoice });
      continue;
    }
    if (t.journalEntry && !live.has(String(t.journalEntry))) continue;
    if (inScope(t.project)) {
      movements.push({ ...base, project: idOf(t.project), kind: t.sourceType === 'purchase-order' ? 'purchase' : 'transfer_in', warehouse, invoice, counterpartProject: idOf(t.sourceProject) });
    }
    if (t.sourceProject && inScope(t.sourceProject)) {
      movements.push({ ...base, project: idOf(t.sourceProject), kind: 'transfer_out', warehouse: null, invoice: null, counterpartProject: idOf(t.project) });
    }
  }

  // Purchase Invoices on a project that were never allocated automatically (they predate it) -
  // their own lines, net of returns (exactly what projectQuantity counts for them).
  const legacyInvoices = await PurchaseOrder.find({
    project: projectFilter,
    'projectAllocation.status': { $ne: 'allocated' },
    ...(productId ? { 'items.productId': oid(productId) } : {}),
    ...(dateTo ? { createdAt: { $lte: dateTo } } : {}),
  })
    .select('code project warehouseId vendorId items createdAt')
    .populate({ path: 'vendorId', select: 'name vendorNumber' })
    .lean();
  for (const inv of legacyInvoices) {
    for (const item of inv.items || []) {
      const product = idOf(item.productId);
      if (productId && product !== String(productId)) continue;
      const quantity = (item.starterQuantity || 0) - (item.returnedQuantity || 0);
      if (!(quantity > 0)) continue;
      const unitCost = item.unitPriceAfterDiscount ?? item.unitPrice ?? 0;
      movements.push({
        project: idOf(inv.project),
        product,
        date: inv.createdAt,
        kind: 'purchase',
        quantity,
        unitCost,
        amount: round2(quantity * unitCost),
        warehouse: idOf(inv.warehouseId),
        invoice: { _id: inv._id, code: inv.code || String(inv._id), vendor: inv.vendorId ? { _id: inv.vendorId._id, name: inv.vendorId.name, vendorNumber: inv.vendorId.vendorNumber } : null },
      });
    }
  }
  return movements;
}

const SIGN = { purchase: 1, transfer_in: 1, transfer_out: -1, return: -1 };

function emptyBalance() {
  return { openingQuantity: 0, openingValue: 0, purchasedQuantity: 0, purchasedValue: 0, transferredInQuantity: 0, transferredInValue: 0, transferredOutQuantity: 0, transferredOutValue: 0, returnedQuantity: 0, returnedValue: 0 };
}

function addMovement(balance, m, opening) {
  const q = m.quantity;
  const v = m.amount;
  if (opening) {
    balance.openingQuantity += SIGN[m.kind] * q;
    balance.openingValue += SIGN[m.kind] * v;
    return;
  }
  const key = { purchase: 'purchased', transfer_in: 'transferredIn', transfer_out: 'transferredOut', return: 'returned' }[m.kind];
  balance[`${key}Quantity`] += q;
  balance[`${key}Value`] += v;
}

function finishBalance(b) {
  const out = {};
  for (const [k, v] of Object.entries(b)) out[k] = /Quantity$/.test(k) ? round4(v) : round2(v);
  out.closingQuantity = round4(b.openingQuantity + b.purchasedQuantity + b.transferredInQuantity - b.transferredOutQuantity - b.returnedQuantity);
  out.closingValue = round2(b.openingValue + b.purchasedValue + b.transferredInValue - b.transferredOutValue - b.returnedValue);
  // Weighted average of what came in (purchases + transfers in) - the cost the allocated quantity carries.
  const inQty = b.openingQuantity + b.purchasedQuantity + b.transferredInQuantity;
  out.averageUnitCost = inQty > 0 ? round2((b.openingValue + b.purchasedValue + b.transferredInValue) / inQty) : null;
  return out;
}

/** The PUC - Raw Materials ledger of each project: opening, debits, credits, closing (by date). */
async function pucLedgerByProject(projectIds, { dateFrom, dateTo }) {
  const account = await rawMaterialsPucAccount();
  if (!account || !projectIds.length) return { account: account ? { _id: account._id, code: account.code, name: account.name, nameAr: account.nameAr } : null, byProject: new Map() };
  const rows = await JournalEntry.aggregate([
    { $match: { status: { $in: ['posted', 'reversed'] }, ...(dateTo ? { date: { $lte: dateTo } } : {}) } },
    { $unwind: '$lines' },
    { $match: { 'lines.account': account._id, 'lines.project': { $in: projectIds.map(oid) } } },
    {
      $group: {
        _id: '$lines.project',
        openingDebit: { $sum: dateFrom ? { $cond: [{ $lt: ['$date', dateFrom] }, '$lines.debit', 0] } : 0 },
        openingCredit: { $sum: dateFrom ? { $cond: [{ $lt: ['$date', dateFrom] }, '$lines.credit', 0] } : 0 },
        debit: { $sum: dateFrom ? { $cond: [{ $gte: ['$date', dateFrom] }, '$lines.debit', 0] } : '$lines.debit' },
        credit: { $sum: dateFrom ? { $cond: [{ $gte: ['$date', dateFrom] }, '$lines.credit', 0] } : '$lines.credit' },
      },
    },
  ]);
  const byProject = new Map(
    rows.map(r => {
      const opening = round2(r.openingDebit - r.openingCredit);
      return [String(r._id), { opening, debit: round2(r.debit), credit: round2(r.credit), closing: round2(opening + r.debit - r.credit) }];
    })
  );
  return { account: { _id: account._id, code: account.code, name: account.name, nameAr: account.nameAr }, byProject };
}

/**
 * Data-quality findings for the PUC - Raw Materials view - REPORTED, never fixed silently (nothing
 * is assigned to an arbitrary project):
 *   - posted PUC - Raw Materials ledger lines with no project (value the projectwise view cannot show);
 *   - PUC allocation records whose project no longer exists (deleted / missing).
 */
async function pucDataQuality({ dateTo } = {}) {
  const account = await rawMaterialsPucAccount();
  const [ledger] = account
    ? await JournalEntry.aggregate([
        { $match: { status: { $in: ['posted', 'reversed'] }, ...(dateTo ? { date: { $lte: dateTo } } : {}) } },
        { $unwind: '$lines' },
        { $match: { 'lines.account': account._id, $or: [{ 'lines.project': null }, { 'lines.project': { $exists: false } }] } },
        { $group: { _id: null, lines: { $sum: 1 }, entries: { $addToSet: '$entryNumber' }, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
      ])
    : [];
  const projectIds = await PucTransfer.distinct('project');
  const existing = new Set((await Project.collection.find({ _id: { $in: projectIds } }, { projection: { _id: 1 } }).toArray()).map(p => String(p._id)));
  const orphanProjects = projectIds.filter(id => !existing.has(String(id)));
  const orphanTransfers = orphanProjects.length ? await PucTransfer.countDocuments({ project: { $in: orphanProjects } }) : 0;
  return {
    ledgerLinesWithoutProject: ledger ? ledger.lines : 0,
    ledgerAmountWithoutProject: ledger ? round2(ledger.debit - ledger.credit) : 0,
    sampleEntryNumbers: ledger ? ledger.entries.slice(0, 20) : [],
    allocationsWithMissingProject: orphanTransfers,
  };
}

const productSummary = p =>
  p
    ? { _id: p._id, title: p.title, category: p.category || null, subcategory: p.subcategory || null, brand: p.brand || null, model: p.model || null, specifications: p.specifications || null, sku: p.sku || null }
    : null;

/**
 * Balances per project x material for the Warehouses -> PUC - Raw Materials tab.
 * Filters: project, product, warehouse (movements that came through that warehouse - a purchase
 * received into it or a transfer out of it; project-to-project reallocations have no warehouse),
 * dateFrom / dateTo (opening = everything before dateFrom).
 */
async function getPucRawMaterialBalances({ project, product, warehouse, dateFrom, dateTo, keyword } = {}) {
  checkId(project, 'project');
  checkId(product, 'product');
  checkId(warehouse, 'warehouse');
  const from = parseDate(dateFrom, 'start date');
  const to = parseDate(dateTo, 'end date', true);
  if (from && to && from > to) throw new ApiError('The start date must be on or before the end date.', 400);

  let movements = await loadMovements({ projectIds: project ? [project] : null, productId: product, dateTo: to });
  if (warehouse) movements = movements.filter(m => m.warehouse === String(warehouse));

  const groups = new Map();
  for (const m of movements) {
    const key = `${m.project}|${m.product}`;
    if (!groups.has(key)) groups.set(key, { project: m.project, product: m.product, balance: emptyBalance(), warehouses: new Set() });
    const g = groups.get(key);
    addMovement(g.balance, m, from && m.date < from);
    if (m.warehouse) g.warehouses.add(m.warehouse);
  }

  const projectIds = [...new Set([...groups.values()].map(g => g.project))];
  const productIds = [...new Set([...groups.values()].map(g => g.product))];
  const [projects, products, ledger] = await Promise.all([
    Project.find({ _id: { $in: projectIds } }).select('projectNumber name').lean(),
    Product.find({ _id: { $in: productIds } }).select('title category subcategory brand model specifications sku type').lean(),
    pucLedgerByProject(projectIds, { dateFrom: from, dateTo: to }),
  ]);
  const projectById = new Map(projects.map(p => [String(p._id), p]));
  const productById = new Map(products.map(p => [String(p._id), p]));

  const kw = typeof keyword === 'string' ? keyword.trim().toLowerCase() : '';
  let rows = [...groups.values()].map(g => {
    const p = productById.get(g.product);
    const pr = projectById.get(g.project);
    return {
      project: pr ? { _id: pr._id, projectNumber: pr.projectNumber, name: pr.name || null } : { _id: g.project, projectNumber: null, name: null },
      product: productSummary(p),
      warehouses: [...g.warehouses],
      ...finishBalance(g.balance),
    };
  });
  if (kw) rows = rows.filter(r => [r.product?.title?.en, r.product?.title?.ar, r.product?.model, r.product?.sku, r.project.projectNumber].some(t => t && String(t).toLowerCase().includes(kw)));
  rows.sort((a, b) => String(a.project.projectNumber || '').localeCompare(String(b.project.projectNumber || '')) || String(a.product?.title?.en || '').localeCompare(String(b.product?.title?.en || '')));

  // Per project: the allocated value of its materials beside its PUC - Raw Materials ledger.
  const perProject = new Map();
  for (const r of rows) {
    const id = String(r.project._id);
    if (!perProject.has(id)) perProject.set(id, { project: r.project, materials: 0, openingValue: 0, closingValue: 0, closingQuantity: 0 });
    const s = perProject.get(id);
    s.materials += 1;
    s.openingValue = round2(s.openingValue + r.openingValue);
    s.closingValue = round2(s.closingValue + r.closingValue);
  }
  const projectSummaries = [...perProject.values()].map(s => {
    const led = ledger.byProject.get(String(s.project._id)) || { opening: 0, debit: 0, credit: 0, closing: 0 };
    return {
      ...s,
      ledger: led,
      // What the ledger balance is NOT explained by the allocated materials: value relieved by cost
      // recognition (JV0011) and any posting to the account that is not a material movement.
      differenceToLedger: warehouse || product || kw ? null : round2(led.closing - s.closingValue),
    };
  });

  const sum = key => round2(rows.reduce((t, r) => t + (r[key] || 0), 0));
  return {
    account: ledger.account,
    dataQuality: await pucDataQuality({ dateTo: to }),
    filters: { project: project || null, product: product || null, warehouse: warehouse || null, dateFrom: from, dateTo: to },
    rows,
    projects: projectSummaries,
    totals: {
      openingValue: sum('openingValue'),
      purchasedValue: sum('purchasedValue'),
      transferredInValue: sum('transferredInValue'),
      transferredOutValue: sum('transferredOutValue'),
      returnedValue: sum('returnedValue'),
      closingValue: sum('closingValue'),
      ledgerClosing: round2(projectSummaries.reduce((t, s) => t + s.ledger.closing, 0)),
    },
  };
}

/**
 * One project's raw materials, item by item: the allocated balance of each material, the source
 * documents its cost comes from (each Purchase Invoice with vendor, quantity and unit cost), and -
 * separately - what is ordered on the project's Purchase Orders (committed, not yet actual).
 */
async function getProjectMaterialBreakdown(projectId) {
  checkId(projectId, 'project');
  const project = await Project.findById(projectId).select('projectNumber name boqLines startDate').lean();
  if (!project) throw new ApiError('Project not found', 404);

  // The project's BOQ lines, each with its unit price converted to EGP (see the header comment).
  const boqDate = project.startDate || new Date();
  const currencies = new Map();
  const boqByProduct = new Map();
  for (const line of project.boqLines || []) {
    const code = (line.currency || 'EGP').toUpperCase();
    let unitsPerBase = 1;
    let conversionError = null;
    if (code !== 'EGP') {
      if (!currencies.has(code)) currencies.set(code, await Currency.findOne({ code }).lean());
      const currency = currencies.get(code);
      if (currency) unitsPerBase = rateForDate(currency, boqDate).unitsPerBase;
      else conversionError = `The BOQ currency ${code} is not configured - its price cannot be converted to EGP.`;
    }
    boqByProduct.set(idOf(line.product), {
      _id: line._id,
      quantity: line.quantity,
      unit: line.unit || null,
      unitPrice: line.unitPrice,
      currency: code,
      unitsPerBase: conversionError ? null : unitsPerBase,
      unitPriceEgp: conversionError ? null : round2(line.unitPrice / unitsPerBase),
      rateDate: code === 'EGP' ? null : boqDate,
      conversionError,
    });
  }

  const movements = await loadMovements({ projectIds: [projectId] });
  const byProduct = new Map();
  for (const m of movements) {
    if (!byProduct.has(m.product)) byProduct.set(m.product, { balance: emptyBalance(), sources: [] });
    const g = byProduct.get(m.product);
    addMovement(g.balance, m, false);
    g.sources.push({
      kind: m.kind,
      date: m.date,
      quantity: m.quantity,
      unitCost: m.unitCost,
      amount: round2(m.amount),
      invoice: m.invoice,
      warehouse: m.warehouse,
      counterpartProject: m.counterpartProject || null,
    });
  }

  // Committed: lines of the project's open / draft Purchase Orders that name a catalog product.
  const orders = await Requisition.find({ project: projectId, status: { $in: ['open', 'draft'] } }).select('code status items').lean();
  const ordered = new Map();
  for (const order of orders) {
    for (const item of order.items || []) {
      const product = idOf(item.product);
      if (!product) continue;
      if (!ordered.has(product)) ordered.set(product, { quantity: 0, amount: 0, units: new Set(), purchaseOrders: [] });
      const o = ordered.get(product);
      o.quantity += item.quantity || 0;
      o.amount += item.lineTotal ?? (item.quantity || 0) * (item.unitPrice || 0);
      if (item.unit) o.units.add(item.unit);
      o.purchaseOrders.push({ _id: order._id, code: order.code, status: order.status, quantity: item.quantity, unit: item.unit || null, unitPrice: item.unitPrice });
    }
  }

  const productIds = [...new Set([...byProduct.keys(), ...ordered.keys(), ...boqByProduct.keys()])];
  const products = await Product.find({ _id: { $in: productIds } }).select('title category subcategory brand model specifications sku type').lean();
  const productById = new Map(products.map(p => [String(p._id), p]));
  const ledger = await pucLedgerByProject([String(project._id)], {});

  const materials = productIds
    .map(id => {
      const g = byProduct.get(id);
      const o = ordered.get(id);
      const sources = g ? g.sources.sort((a, b) => new Date(a.date) - new Date(b.date)) : [];
      const balance = finishBalance(g ? g.balance : emptyBalance());
      const boq = boqByProduct.get(id) || null;
      // Actual purchase cost only (Purchase Invoices) - committed Purchase Order cost stays separate.
      const purchaseUnitCost = balance.purchasedQuantity > 0 ? round2(balance.purchasedValue / balance.purchasedQuantity) : null;
      const committedUnitCost = o && o.quantity > 0 ? round2(o.amount / o.quantity) : null;
      let status = 'ok';
      if (!boq) status = 'missing_boq';
      else if (boq.conversionError) status = 'currency_not_configured';
      else if (purchaseUnitCost === null) status = 'missing_cost';
      const unitDifference = status === 'ok' ? round2(boq.unitPriceEgp - purchaseUnitCost) : null;
      const poUnits = o ? [...o.units] : [];
      return {
        boq,
        purchaseUnitCost,
        committedUnitCost,
        contribution: {
          status,
          unitDifference,
          // (BOQ unit price - unit cost) x BOQ quantity - see the header comment.
          total: status === 'ok' ? round2(unitDifference * boq.quantity) : null,
          quantityBasis: boq ? boq.quantity : null,
          unitMismatch: !!(boq && boq.unit && poUnits.length && poUnits.some(u => u.toLowerCase() !== boq.unit.toLowerCase())),
        },
        product: productSummary(productById.get(id)),
        units: o ? [...o.units] : [],
        ...balance,
        sources,
        purchaseInvoices: new Set(sources.filter(s => s.invoice).map(s => String(s.invoice._id))).size,
        ordered: o ? { quantity: round4(o.quantity), amount: round2(o.amount), units: [...o.units], purchaseOrders: o.purchaseOrders } : null,
      };
    })
    .sort((a, b) => String(a.product?.title?.en || '').localeCompare(String(b.product?.title?.en || '')));

  return {
    project: { _id: project._id, projectNumber: project.projectNumber, name: project.name || null },
    account: ledger.account,
    ledger: ledger.byProject.get(String(project._id)) || { opening: 0, debit: 0, credit: 0, closing: 0 },
    materials,
    totals: {
      purchasedValue: round2(materials.reduce((t, m) => t + m.purchasedValue, 0)),
      closingValue: round2(materials.reduce((t, m) => t + m.closingValue, 0)),
      orderedAmount: round2(materials.reduce((t, m) => t + (m.ordered?.amount || 0), 0)),
      // BOQ value (EGP) of the lines whose price could be converted, and the contribution of the
      // lines that have both a BOQ price and a purchase cost - the others are counted, not zeroed.
      boqValue: round2(materials.reduce((t, m) => t + (m.boq?.unitPriceEgp != null ? m.boq.unitPriceEgp * m.boq.quantity : 0), 0)),
      contribution: round2(materials.reduce((t, m) => t + (m.contribution.total || 0), 0)),
      contributionLines: materials.filter(m => m.contribution.status === 'ok').length,
      missingCostLines: materials.filter(m => m.contribution.status === 'missing_cost').length,
      missingBoqLines: materials.filter(m => m.contribution.status === 'missing_boq').length,
      currencyErrorLines: materials.filter(m => m.contribution.status === 'currency_not_configured').length,
    },
  };
}

module.exports = { getPucRawMaterialBalances, getProjectMaterialBreakdown, loadMovements };
