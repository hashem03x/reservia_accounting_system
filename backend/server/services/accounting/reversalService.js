const mongoose = require('mongoose');
const JournalEntry = require('../../models/accounting/journalEntryModel');
const AccountingReversal = require('../../models/accounting/accountingReversalModel');
const Payment = require('../../models/vendor/paymentModel');
const SalesOrder = require('../../models/sales/salesOrderModel');
const SalesOrderReturn = require('../../models/sales/salesOrderReturnModel');
const PurchaseOrder = require('../../models/vendor/purchaseOrder');
const PurchaseOrderReturn = require('../../models/vendor/purchaseOrderReturn');
const AdvancedPayment = require('../../models/payments/advancedPaymentModel');
const Product = require('../../models/inventory/productModel');
const Transfer = require('../../models/inventory/transferModel');
const Vendor = require('../../models/vendor/vendor');
const User = require('../../models/userModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const ApiError = require('../../utils/apiError');
const { round2 } = require('../../utils/orderTotals');
const { AutomaticJournalAccountCodes: CODES, isPaymentAccountEligible } = require('../../utils/accountingConstants');
const { mirrorReverseEntry } = require('./journalReversalCore');
const { postAutomaticJournalEntry, getAccountIdByCode, resolveVendorNumber, resolveCustomerNumber, deterministicSourceId } = require('./accountingEventService');
const { assertPeriodsOpen } = require('./accountingPeriodService');
const { claimAndApplyPaymentReversal, PAYMENT_ACTIONS } = require('../payments/paymentReversalService');
const { logAccountingEvent } = require('../../utils/accountingLogger');

// The accounting reversal engine: sales returns, purchase returns, payment reversals and settlement
// (advance application) reversals, each as ONE transaction that posts the compensating journal
// entries, updates every document and balance the original moved, and writes an AccountingReversal
// record linking it all. Originals are never deleted or edited (beyond being marked reversed); the
// compensating entries come from the original entries or the same posting rules that created them.
//
//   Payment reversal     every entry the payment posted is mirrored (debit <-> credit); the order /
//                        expense paid amount, customer / vendor / warehouse balances are restored.
//   Settlement reversal  an advance applied to an order (at creation) or through a payment: its
//                        entry is mirrored, the advance's balance and usage entry are restored and
//                        the document is outstanding again. The advance's own cash is untouched.
//   Sales return         returned quantities come off the order (its totals recompute), goods go
//                        back into stock, the project's executed % drops - which reverses the
//                        returned slice of revenue, VAT, withholding and receivables, and moves the
//                        recognized cost back to PUC (accountingEventService.js recognition entries).
//                        Optionally refunds what is now paid in excess (Dr AR / Cr cash).
//   Purchase return      returned quantities come off the order, stock (and project allocation) is
//                        given back, and the returned slice of the receipt is reversed with the same
//                        accounts the receipt used: Dr Suppliers (+ WHT) / Cr inventory, project WIP
//                        or the service's PUC account (+ Input VAT). Optionally records the vendor's
//                        refund of what is now paid in excess (Dr cash / Cr Suppliers).
//
// Idempotency: every request carries a key; the AccountingReversal's unique index on it makes a
// retried or concurrent request return the first result. Payments and advance usage entries are
// also claimed atomically, so nothing can be reversed twice by any path.

const RECOGNITION_ACTIONS = ['PROJECT_REVENUE_RECOGNITION', 'PROJECT_COST_RECOGNITION'];
const SETTLEMENT_ACTIONS = { SO: 'SO_CUSTOMER_ADVANCE_APPLIED', PO: 'PO_SUPPLIER_ADVANCE_APPLIED' };
const ADVANCE_PAYMENT_ACTIONS = ['PAYMENT_CUSTOMER_ADVANCE_APPLIED', 'PAYMENT_VENDOR_ADVANCE_APPLIED'];

const oid = id => new mongoose.Types.ObjectId(String(id));
const isId = id => mongoose.Types.ObjectId.isValid(String(id || ''));

function cleanInput({ reason, date, idempotencyKey }) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) throw new ApiError('A reason is required for a reversal.', 400);
  if (text.length > 1000) throw new ApiError('The reason cannot exceed 1000 characters.', 400);
  const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
  if (!key || key.length > 200) throw new ApiError('A request key (idempotencyKey) is required.', 400);
  const when = date ? new Date(date) : new Date();
  if (Number.isNaN(when.getTime())) throw new ApiError('Invalid reversal date.', 400);
  if (when > new Date(Date.now() + 60 * 1000)) throw new ApiError('A reversal cannot be dated in the future.', 400);
  return { reason: text, date: when, idempotencyKey: key };
}

/**
 * Runs `work` in one transaction, once per idempotency key. A key already used returns its record
 * (`replayed: true`) when it was for the same operation, and is refused otherwise.
 */
async function runOnce({ idempotencyKey, type, target }, work) {
  const sameTarget = r => r.type === type && Object.entries(target).every(([k, v]) => String(r[k] || '') === String(v || ''));
  const existing = await AccountingReversal.findOne({ idempotencyKey }).lean();
  if (existing) {
    if (!sameTarget(existing)) throw new ApiError('This request key was already used for a different reversal.', 409);
    return { reversal: existing, replayed: true };
  }
  const session = await mongoose.startSession();
  try {
    let record;
    await session.withTransaction(async () => {
      // A concurrent request with this key that committed first: replay its result (checked inside
      // the transaction, after any write conflict made withTransaction retry this callback).
      const done = await AccountingReversal.findOne({ idempotencyKey }).session(session).lean();
      if (done) throw Object.assign(new Error('replay'), { replay: done });
      record = await work(session);
    });
    logAccountingEvent('ACCOUNTING_REVERSAL', { type, reversalId: String(record._id), ...Object.fromEntries(Object.entries(target).map(([k, v]) => [k, String(v)])) });
    return { reversal: record.toObject ? record.toObject() : record, replayed: false };
  } catch (err) {
    if (err?.replay) {
      if (!sameTarget(err.replay)) throw new ApiError('This request key was already used for a different reversal.', 409);
      return { reversal: err.replay, replayed: true };
    }
    // The same key committed by a concurrent request in the meantime: that result is the answer.
    if (err?.code === 11000 && /idempotencyKey/.test(String(err.message || JSON.stringify(err.keyPattern || {})))) {
      const again = await AccountingReversal.findOne({ idempotencyKey }).lean();
      if (again && sameTarget(again)) return { reversal: again, replayed: true };
    }
    throw err;
  } finally {
    session.endSession();
  }
}

async function createRecord(data, session) {
  const [record] = await AccountingReversal.create([data], { session });
  return record;
}

async function assertCashAccount(accountId, session) {
  if (!isId(accountId)) throw new ApiError('Select the cash or bank account for the refund.', 400);
  const account = await ChartOfAccount.findById(accountId).session(session).lean();
  if (!account || !isPaymentAccountEligible(account)) throw new ApiError('The refund account must be an active Cash or Cash Equivalent account.', 400);
  return account;
}

// ---------------------------------------------------------------- payments

/** Reverses a payment's journal entries (mirrors) and claims + undoes the payment's document effects. */
async function reversePaymentInSession(payment, { reason, date, userId }, session) {
  const entries = await JournalEntry.find({ sourceType: 'PAYMENT', sourceId: payment._id, status: 'posted', reversalOfEntry: null }).session(session);
  const unsupported = entries.find(e => !PAYMENT_ACTIONS.includes(e.accountingAction));
  if (unsupported) throw new ApiError(`Entry #${unsupported.entryNumber} of this payment cannot be reversed here.`, 400);
  await assertPeriodsOpen(date, session);
  const reversals = [];
  for (const entry of entries) {
    // eslint-disable-next-line no-await-in-loop
    const { reversal } = await mirrorReverseEntry({ entryId: entry._id, date, reason, userId, session });
    reversals.push(reversal);
  }
  const applied = await claimAndApplyPaymentReversal(payment._id, { reversalEntryId: reversals[0]?._id || null, reason, userId }, session);
  if (!applied) throw new ApiError('This payment has already been reversed.', 409);
  return { entries, reversals, applied };
}

async function loadPayment(paymentId, session) {
  if (!isId(paymentId)) throw new ApiError('Invalid payment id.', 400);
  const payment = await Payment.collection.findOne({ _id: oid(paymentId) }, { session });
  if (!payment) throw new ApiError('Payment not found.', 404);
  if (payment.reversedAt || payment.reversedByEntry) throw new ApiError('This payment has already been reversed.', 409);
  return payment;
}

/**
 * Reverses a cash / bank payment (customer receipt, vendor payment, expense or fixed asset payment,
 * or a return refund). A payment funded from an Advanced Payment is a settlement - reversed with
 * reverseSettlement - so the two are never confused.
 */
async function reversePayment({ paymentId, reason, date, idempotencyKey, userId }) {
  const input = cleanInput({ reason, date, idempotencyKey });
  return runOnce({ idempotencyKey: input.idempotencyKey, type: 'payment', target: { payment: paymentId } }, async session => {
    const payment = await loadPayment(paymentId, session);
    if (payment.advancedPayment) throw new ApiError('This payment applied an Advanced Payment - reverse it as a settlement from the advance, so the advance is restored.', 400);
    const { entries, reversals, applied } = await reversePaymentInSession(payment, { ...input, userId }, session);
    return createRecord(
      {
        type: 'payment',
        scope: 'full',
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        date: input.date,
        payment: payment._id,
        salesOrder: payment.salesOrderId || null,
        purchaseOrder: payment.purchaseOrderId || null,
        project: payment.projectId || null,
        amount: applied.amount,
        originalEntries: entries.map(e => e._id),
        reversalEntries: reversals.map(r => r._id),
        notes: entries.length ? [] : ['This payment had no journal entry (recorded with a legacy payment method) - only its document effects were reversed.'],
        createdBy: userId,
      },
      session
    );
  });
}

// ---------------------------------------------------------------- settlements (advance applications)

/**
 * Undoes an advance applied to an order when the order was created: the advance gets the amount back
 * (its usage entry kept, marked reversed), the order is outstanding again, and the customer / vendor
 * balance owes it again. Used by reverseSettlement and by Journal Entries -> Reverse of the
 * SO_CUSTOMER_ADVANCE_APPLIED / PO_SUPPLIER_ADVANCE_APPLIED entry. Returns null when nothing is left
 * to restore (already reversed).
 */
async function applySettlementReversal({ kind, orderId, advancedPaymentId }, session) {
  const advance = await AdvancedPayment.findById(advancedPaymentId).session(session);
  if (!advance) return null;
  const field = kind === 'SO' ? 'salesOrder' : 'purchaseOrder';
  const entry = advance.usageHistory.find(u => String(u[field]?._id || u[field] || '') === String(orderId) && !u.payment && !u.reversed);
  if (!entry) return null;
  entry.reversed = true;
  entry.note = entry.note || 'Settlement reversed';
  const consumed = round2(entry.amountConsumed);
  advance.remainingAmount = round2(Math.min(advance.amount, advance.remainingAmount + consumed));
  await advance.save({ session });

  if (kind === 'SO') {
    const order = await SalesOrder.findById(orderId).session(session);
    if (order) {
      order.paidAmount = round2(Math.max(0, (order.paidAmount || 0) - consumed));
      await order.save({ session });
      await User.updateOne({ _id: order.customer?._id || order.customer }, { $inc: { balance: -consumed } }, { session });
    }
  } else {
    const order = await PurchaseOrder.findById(orderId).session(session);
    if (order) {
      order.paidAmount = round2(Math.max(0, (order.paidAmount || 0) - consumed));
      await order.save({ session });
      await Vendor.updateOne({ _id: order.vendorId?._id || order.vendorId }, { $inc: { balance: consumed } }, { session });
    }
  }
  return { advancedPayment: advance._id, consumed };
}

/** Journal Entries -> Reverse of an advance-applied entry: the same settlement effects. */
async function applySettlementEntryReversal(originalEntry, session) {
  const kind = Object.keys(SETTLEMENT_ACTIONS).find(k => SETTLEMENT_ACTIONS[k] === originalEntry.accountingAction);
  if (!kind || !originalEntry.advancedPayment || !originalEntry.sourceId) return null;
  return applySettlementReversal({ kind, orderId: originalEntry.sourceId, advancedPaymentId: originalEntry.advancedPayment }, session);
}

/**
 * Reverses one application of an Advanced Payment: to a Sales / Purchase Order at its creation
 * (`salesOrderId` / `purchaseOrderId`), or through an Add Payment (`paymentId`). Only that
 * application is undone - the advance's own receipt / disbursement stays.
 */
async function reverseSettlement({ advancedPaymentId, salesOrderId, purchaseOrderId, paymentId, reason, date, idempotencyKey, userId }) {
  const input = cleanInput({ reason, date, idempotencyKey });
  if (!isId(advancedPaymentId)) throw new ApiError('Invalid advanced payment id.', 400);
  const targets = [salesOrderId, purchaseOrderId, paymentId].filter(Boolean);
  if (targets.length !== 1 || !isId(targets[0])) throw new ApiError('Choose the one order or payment whose settlement to reverse.', 400);

  return runOnce({ idempotencyKey: input.idempotencyKey, type: 'settlement', target: { advancedPayment: advancedPaymentId, ...(paymentId ? { payment: paymentId } : salesOrderId ? { salesOrder: salesOrderId } : { purchaseOrder: purchaseOrderId }) } }, async session => {
    const advance = await AdvancedPayment.findById(advancedPaymentId).session(session).lean();
    if (!advance) throw new ApiError('Advanced payment not found.', 404);

    if (paymentId) {
      const payment = await loadPayment(paymentId, session);
      if (String(payment.advancedPayment || '') !== String(advance._id)) throw new ApiError('This payment did not use this advanced payment.', 400);
      const { entries, reversals, applied } = await reversePaymentInSession(payment, { ...input, userId }, session);
      if (!applied.advance) throw new ApiError('This settlement has already been reversed.', 409);
      return createRecord(
        {
          type: 'settlement',
          scope: 'full',
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          date: input.date,
          advancedPayment: advance._id,
          payment: payment._id,
          salesOrder: payment.salesOrderId || null,
          purchaseOrder: payment.purchaseOrderId || null,
          project: advance.project?._id || advance.project || null,
          amount: applied.advance.restored,
          originalEntries: entries.map(e => e._id),
          reversalEntries: reversals.map(r => r._id),
          createdBy: userId,
        },
        session
      );
    }

    const kind = salesOrderId ? 'SO' : 'PO';
    const orderId = salesOrderId || purchaseOrderId;
    await assertPeriodsOpen(input.date, session);
    const entry = await JournalEntry.findOne({ sourceType: kind, sourceId: oid(orderId), accountingAction: SETTLEMENT_ACTIONS[kind], status: 'posted' }).session(session);
    let reversal = null;
    if (entry) ({ reversal } = await mirrorReverseEntry({ entryId: entry._id, date: input.date, reason: input.reason, userId, session }));
    const applied = await applySettlementReversal({ kind, orderId, advancedPaymentId: advance._id }, session);
    if (!applied) throw new ApiError('This settlement has already been reversed (or the advance was not applied to this order).', 409);
    return createRecord(
      {
        type: 'settlement',
        scope: 'full',
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        date: input.date,
        advancedPayment: advance._id,
        salesOrder: salesOrderId || null,
        purchaseOrder: purchaseOrderId || null,
        project: advance.project?._id || advance.project || null,
        amount: applied.consumed,
        originalEntries: entry ? [entry._id] : [],
        reversalEntries: reversal ? [reversal._id] : [],
        notes: entry ? [] : ['The application had no journal entry - only the advance and order balances were restored.'],
        createdBy: userId,
      },
      session
    );
  });
}

// ---------------------------------------------------------------- returns

/** Checks the requested lines against what is still returnable on the order. */
function returnLines(order, items, productField) {
  if (!Array.isArray(items) || !items.length) throw new ApiError('Choose at least one item and quantity to return.', 400);
  const seen = new Set();
  return items.map(({ productId, quantity }) => {
    const qty = Number(quantity);
    if (!isId(productId)) throw new ApiError('Invalid product id.', 400);
    if (seen.has(String(productId))) throw new ApiError('Each item can be listed once per return.', 400);
    seen.add(String(productId));
    if (!Number.isFinite(qty) || qty <= 0) throw new ApiError('Return quantities must be greater than zero.', 400);
    const item = order.items.find(i => String(i[productField]?._id || i[productField]) === String(productId));
    if (!item) throw new ApiError('An item to return is not on this order.', 400);
    const left = round2((item.starterQuantity || 0) - (item.returnedQuantity || 0));
    if (qty > left) throw new ApiError(`Only ${left} of "${item[productField]?.title?.en || item[productField]?.title?.ar || productId}" can still be returned.`, 400);
    return { item, productId: String(productId), quantity: qty, amount: round2(qty * (item.unitPriceAfterDiscount || 0)) };
  });
}

const fullyReturned = order => order.items.every(i => (i.returnedQuantity || 0) >= (i.starterQuantity || 0));

/**
 * Sales return (full or partial). `items`: [{ productId, quantity }]. `warehouseId`: where returned
 * goods are received (and the refund's cash location). `refund`: { paymentAccount } to pay back what
 * the order is now paid in excess; without it the excess stays as the customer's credit.
 */
async function returnSalesOrder({ salesOrderId, items, warehouseId, refund, reason, date, idempotencyKey, userId, afterReturn }) {
  const input = cleanInput({ reason, date, idempotencyKey });
  if (!isId(salesOrderId)) throw new ApiError('Invalid sales invoice id.', 400);
  return runOnce({ idempotencyKey: input.idempotencyKey, type: 'sales_return', target: { salesOrder: salesOrderId } }, async session => {
    const order = await SalesOrder.findById(salesOrderId).session(session);
    if (!order) throw new ApiError('Sales invoice not found.', 404);
    if (order.orderStatus === 'canceled') throw new ApiError('A cancelled order cannot be returned.', 400);
    await assertPeriodsOpen(input.date, session);
    const lines = returnLines(order, items, 'product');
    const products = new Map((await Product.find({ _id: { $in: lines.map(l => l.productId) } }).session(session)).map(p => [String(p._id), p]));
    const needsWarehouse = lines.some(l => products.get(l.productId)?.type !== 'service') || refund;
    if (needsWarehouse && !isId(warehouseId)) throw new ApiError('Choose the warehouse receiving the returned goods.', 400);

    const recordId = new mongoose.Types.ObjectId();
    const before = { grandTotal: order.grandTotal, paid: order.paidAmount || 0 };
    const projectId = order.project?._id || order.project || null;
    const recognitionBefore = await JournalEntry.find({ triggeredBySalesOrder: order._id, accountingAction: { $in: RECOGNITION_ACTIONS } }).select('_id').session(session).lean();

    const returnRecords = [];
    for (const line of lines) {
      const product = products.get(line.productId);
      if (!product) throw new ApiError('A returned product no longer exists.', 404);
      line.item.returnedQuantity = round2((line.item.returnedQuantity || 0) + line.quantity);
      line.item.quantityToBeReturned = Math.max((line.item.quantityToBeReturned || 0) - line.quantity, 0);
      product.totalSold = Math.max((product.totalSold || 0) - line.quantity, 0);
      // A service has no stock - a returned service only reverses its sale.
      if (product.type !== 'service') {
        const stock = product.stock.find(s => String(s.warehouse) === String(warehouseId));
        if (!stock) throw new ApiError(`"${product.title?.en || product.title?.ar}" has no stock record in the chosen warehouse.`, 400);
        stock.quantity += line.quantity;
      }
      // eslint-disable-next-line no-await-in-loop
      await product.save({ session });
      // eslint-disable-next-line no-await-in-loop
      const [record] = await SalesOrderReturn.create([{ salesOrderId: order._id, warehouseId: warehouseId || null, productId: product._id, returnedQuantity: line.quantity, returnedAmount: line.amount, notes: input.reason, reversal: recordId, createdBy: userId }], { session });
      returnRecords.push(record._id);
    }
    await order.save({ session }); // totals, outstanding amount and payment status recompute

    const returnedTotal = round2(before.grandTotal - order.grandTotal);
    // The customer owes the returned total less (models/sales/salesOrderModel.js charged the
    // outstanding amount to the balance when the order was created).
    await User.updateOne({ _id: order.customer?._id || order.customer }, { $inc: { balance: returnedTotal } }, { session });

    // The executed % drops by the returned amount: the recognition entries reverse the returned
    // slice of revenue (with VAT / withholding / receivable) and cost (back to PUC).
    if (projectId) {
      // eslint-disable-next-line global-require
      await require('../project/projectAccountingService').recalculateExecutedPercentage(projectId, session, order._id);
    }
    const known = new Set(recognitionBefore.map(e => String(e._id)));
    const recognition = await JournalEntry.find({ triggeredBySalesOrder: order._id, accountingAction: { $in: RECOGNITION_ACTIONS } }).session(session).lean();
    const reversalEntries = recognition.filter(e => !known.has(String(e._id))).map(e => e._id);
    const originalEntries = recognition.filter(e => known.has(String(e._id)) && e.reference !== 'DERECOGNITION').map(e => e._id);

    // What the order is now paid beyond its total.
    const excess = round2((order.paidAmount || 0) - order.grandTotal);
    let refundPayment = null;
    const notes = [];
    if (refund) {
      if (excess <= 0) throw new ApiError('Nothing is paid in excess after this return - there is nothing to refund.', 400);
      const account = await assertCashAccount(refund.paymentAccount, session);
      refundPayment = new Payment({ warehouseId, salesOrderId: order._id, customerId: order.customer?._id || order.customer, amountPaid: excess, type: 'out', paymentAccount: account._id, paymentCategory: 'sales-return', notes: `Refund - ${input.reason}`.slice(0, 500), createdBy: userId });
      await refundPayment.save({ session }); // order paid amount, customer and warehouse balances
      const customerNumber = await resolveCustomerNumber(order.customer, { required: true }, session);
      const arId = await getAccountIdByCode(CODES.accountsReceivableProjects, session);
      const refundEntry = await postAutomaticJournalEntry({
        accountingAction: 'SO_REFUND_RECORDED',
        sourceType: 'PAYMENT',
        sourceId: refundPayment._id,
        date: input.date,
        description: `Customer refund - SO ${order.code || order._id} (${input.reason})`.slice(0, 1000),
        project: projectId,
        lines: [
          { account: arId, debit: excess, credit: 0, project: projectId, partyNumber: customerNumber, partyType: 'customer' },
          { account: account._id, debit: 0, credit: excess, project: projectId },
        ],
        session,
      });
      reversalEntries.push(refundEntry._id);
    } else if (excess > 0) {
      notes.push(`${excess} remains paid in excess - kept as the customer's credit.`);
    }
    // Internal callers only (the website-order return keeps its legacy online refund in this same
    // transaction) - never exposed through the API. Runs last: its payment updates the order itself.
    if (afterReturn) await afterReturn({ order, lines, session });
    if (!projectId || !reversalEntries.length) notes.push('The order had no revenue recognized in the ledger, so the return posted no revenue reversal.');

    return createRecord(
      {
        type: 'sales_return',
        scope: fullyReturned(order) ? 'full' : 'partial',
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        date: input.date,
        salesOrder: order._id,
        project: projectId,
        items: lines.map(l => ({ product: oid(l.productId), quantity: l.quantity, amount: l.amount })),
        amount: Math.max(0, returnedTotal),
        returnRecords,
        refundPayment: refundPayment?._id || null,
        refundAmount: refundPayment ? excess : 0,
        originalEntries,
        reversalEntries,
        notes,
        createdBy: userId,
        _id: recordId,
      },
      session
    );
  });
}

// Stock received from a Purchase Order goes back to the vendor: from the receiving warehouse first,
// then from the warehouses it was transferred to (the order's stock may have moved on).
async function takeStockBack(product, warehouseId, quantity, session) {
  const source = product.stock.find(s => String(s.warehouse) === String(warehouseId));
  if (!source) throw new ApiError(`"${product.title?.en || product.title?.ar}" has no stock record in the chosen warehouse.`, 400);
  const transfers = await Transfer.find({ 'details.product': product._id, sourceWarehouse: warehouseId, status: { $ne: 'cancelled' } }).session(session).lean();
  const targets = [...new Set(transfers.map(t => String(t.targetWarehouse)))];
  const available = source.quantity + targets.reduce((s, w) => s + (product.stock.find(x => String(x.warehouse) === w)?.quantity || 0), 0);
  if (available < quantity) throw new ApiError(`Only ${available} of "${product.title?.en || product.title?.ar}" is in stock to give back.`, 400);
  let left = quantity;
  const take = entry => {
    const q = Math.min(entry.quantity, left);
    if (q > 0) {
      entry.quantity -= q;
      left -= q;
    }
  };
  take(source);
  for (const w of targets) if (left > 0) take(product.stock.find(x => String(x.warehouse) === w) || { quantity: 0 });
}

// Moving average after giving back `quantity` bought at `amount` (the rule the order receipt used).
function costAfterReturn(product, quantity, amount) {
  const onHand = (product.stock || []).reduce((s, e) => s + (e.quantity || 0), 0);
  const remainingQty = onHand - quantity;
  if (remainingQty <= 0) return 0;
  const cost = (onHand * (product.cost || 0) - amount) / remainingQty;
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

/**
 * Purchase return (full or partial). `items`: [{ productId, quantity }]. `warehouseId`: the
 * warehouse the goods leave from. `refund`: { paymentAccount } when the vendor pays back what the
 * order is now paid in excess; without it the excess stays as a debit balance with the vendor.
 */
async function returnPurchaseOrder({ purchaseOrderId, items, warehouseId, refund, reason, date, idempotencyKey, userId }) {
  const input = cleanInput({ reason, date, idempotencyKey });
  if (!isId(purchaseOrderId)) throw new ApiError('Invalid purchase invoice id.', 400);
  return runOnce({ idempotencyKey: input.idempotencyKey, type: 'purchase_return', target: { purchaseOrder: purchaseOrderId } }, async session => {
    const order = await PurchaseOrder.findById(purchaseOrderId).session(session);
    if (!order) throw new ApiError('Purchase invoice not found.', 404);
    await assertPeriodsOpen(input.date, session);
    const lines = returnLines(order, items, 'productId');
    const products = new Map((await Product.find({ _id: { $in: lines.map(l => l.productId) } }).session(session)).map(p => [String(p._id), p]));
    const physical = lines.filter(l => products.get(l.productId)?.type !== 'service');
    const services = lines.filter(l => products.get(l.productId)?.type === 'service');
    if ((physical.length || refund) && !isId(warehouseId)) throw new ApiError('Choose the warehouse the goods are returned from.', 400);

    const recordId = new mongoose.Types.ObjectId();
    const projectId = order.project?._id || order.project || null;
    const before = { net: order.totalAmount || 0, vat: order.vatAmount || 0, wht: order.withholdingTaxAmount || 0, grandTotal: order.grandTotal || 0 };

    const returnRecords = [];
    for (const line of lines) {
      const product = products.get(line.productId);
      if (!product) throw new ApiError('A returned product no longer exists.', 404);
      line.item.returnedQuantity = round2((line.item.returnedQuantity || 0) + line.quantity);
      if (product.type !== 'service') {
        // Stock received on a project order was allocated to the project - release the returned
        // quantity back into the warehouse first, so it can leave.
        // eslint-disable-next-line global-require, no-await-in-loop
        await require('../inventory/poProjectAllocationService').releaseAllocationForReturn(order, line.productId, line.quantity, { userId, session });
        // eslint-disable-next-line no-await-in-loop
        const fresh = await Product.findById(line.productId).session(session);
        fresh.cost = costAfterReturn(fresh, line.quantity, line.amount);
        // eslint-disable-next-line no-await-in-loop
        await takeStockBack(fresh, warehouseId, line.quantity, session);
        // eslint-disable-next-line no-await-in-loop
        await fresh.save({ session });
      }
      // eslint-disable-next-line no-await-in-loop
      const [record] = await PurchaseOrderReturn.create([{ purchaseOrderId: order._id, warehouseId: warehouseId || null, productId: product._id, returnedQuantity: line.quantity, returnedAmount: line.amount, notes: input.reason, reversal: recordId, createdBy: userId }], { session });
      returnRecords.push(record._id);
    }
    await order.save({ session }); // totals, VAT, withholding, outstanding amount recompute

    // The returned slice of the receipt, split between goods and services by their returned amounts
    // (the service side takes the exact remainder - the same split the receipt entries used).
    const delta = { net: round2(before.net - (order.totalAmount || 0)), vat: round2(before.vat - (order.vatAmount || 0)), wht: round2(before.wht - (order.withholdingTaxAmount || 0)) };
    const returnedTotal = round2(before.grandTotal - (order.grandTotal || 0));
    const physicalNet = round2(physical.reduce((s, l) => s + l.amount, 0));
    const share = delta.net > 0 ? physicalNet / round2(physicalNet + services.reduce((s, l) => s + l.amount, 0)) : 0;
    const part = {
      physical: { net: services.length ? round2(delta.net * share) : delta.net, vat: services.length ? round2(delta.vat * share) : delta.vat, wht: services.length ? round2(delta.wht * share) : delta.wht },
    };
    part.service = { net: round2(delta.net - part.physical.net), vat: round2(delta.vat - part.physical.vat), wht: round2(delta.wht - part.physical.wht) };

    const vendorNumber = await resolveVendorNumber(order.vendorId, { required: true }, session);
    const [suppliersId, inputVatId, whtPayableId] = await Promise.all([CODES.suppliers, CODES.inputVat, CODES.withholdingTaxPayable].map(code => getAccountIdByCode(code, session)));
    const originals = await JournalEntry.find({ sourceType: 'PO', sourceId: order._id, accountingAction: { $in: ['PO_INVENTORY_RECEIPT', 'PO_INVENTORY_TO_WIP', 'PO_SERVICE_TO_WIP'] }, status: 'posted' }).session(session).lean();
    const original = action => originals.find(e => e.accountingAction === action) || null;
    const reversalEntries = [];
    const notes = [];

    const postReturn = async (kind, amounts, creditLines, reverses) => {
      if (amounts.net <= 0) return;
      if (!reverses) {
        notes.push(`The order's ${kind === 'physical' ? 'goods' : 'services'} receipt had no journal entry, so no reversal entry was posted for them.`);
        return;
      }
      const lines = [{ account: suppliersId, debit: round2(amounts.net + amounts.vat - amounts.wht), credit: 0, project: projectId, partyNumber: vendorNumber, partyType: 'vendor' }];
      if (amounts.wht > 0) lines.push({ account: whtPayableId, debit: amounts.wht, credit: 0, project: projectId });
      lines.push(...creditLines);
      if (amounts.vat > 0) lines.push({ account: inputVatId, debit: 0, credit: amounts.vat, project: projectId });
      const entry = await postAutomaticJournalEntry({
        accountingAction: 'PURCHASE_RETURN',
        sourceType: 'PO_RETURN',
        sourceId: deterministicSourceId(`${recordId}:${kind}`),
        date: input.date,
        description: `Purchase return - PO ${order.code || order._id} (${input.reason})`.slice(0, 1000),
        project: projectId,
        reversalOfEntry: reverses._id,
        lines: lines.filter(l => l.debit > 0 || l.credit > 0),
        session,
      });
      reversalEntries.push(entry._id);
    };

    // Goods: the receipt went to Materials Inventory and, on a project order, on to the project's
    // WIP - so the return comes out of WIP when that transfer was posted, out of inventory otherwise.
    if (physical.length) {
      const toWip = original('PO_INVENTORY_TO_WIP');
      const receipt = original('PO_INVENTORY_RECEIPT');
      const creditAccount = await getAccountIdByCode(toWip ? CODES.wipRawMaterials : CODES.materialsInventory, session);
      await postReturn('physical', part.physical, [{ account: creditAccount, debit: 0, credit: part.physical.net, project: projectId }], toWip || receipt);
    }
    // Services: each service's own PUC account (the account its cost was posted to).
    if (services.length) {
      const byAccount = new Map();
      for (const l of services) {
        const puc = String(products.get(l.productId).pucAccount?._id || products.get(l.productId).pucAccount || '');
        if (!puc) throw new ApiError('A returned service has no PUC account configured.', 400);
        byAccount.set(puc, round2((byAccount.get(puc) || 0) + l.amount));
      }
      // Distributed by service amount; the last account takes the rounding remainder.
      const entries = [...byAccount.entries()];
      const total = round2(entries.reduce((s, [, a]) => s + a, 0));
      let given = 0;
      const credits = entries.map(([account, a], i) => {
        const amount = i === entries.length - 1 ? round2(part.service.net - given) : round2((part.service.net * a) / total);
        given = round2(given + amount);
        return { account: oid(account), debit: 0, credit: amount, project: projectId };
      });
      await postReturn('service', part.service, credits, original('PO_SERVICE_TO_WIP'));
    }

    // The vendor is owed the returned total less (models/vendor/purchaseOrder.js added the
    // outstanding amount to the balance when the order was created).
    await Vendor.updateOne({ _id: order.vendorId?._id || order.vendorId }, { $inc: { balance: -returnedTotal } }, { session });

    const excess = round2((order.paidAmount || 0) - (order.grandTotal || 0));
    let refundPayment = null;
    if (refund) {
      if (excess <= 0) throw new ApiError('Nothing is paid in excess after this return - there is no vendor refund to record.', 400);
      const account = await assertCashAccount(refund.paymentAccount, session);
      refundPayment = new Payment({ warehouseId, purchaseOrderId: order._id, vendorId: order.vendorId?._id || order.vendorId, amountPaid: excess, type: 'in', paymentAccount: account._id, paymentCategory: 'purchase-return', notes: `Vendor refund - ${input.reason}`.slice(0, 500), createdBy: userId });
      await refundPayment.save({ session }); // order paid amount, vendor and warehouse balances
      const refundEntry = await postAutomaticJournalEntry({
        accountingAction: 'PO_REFUND_RECORDED',
        sourceType: 'PAYMENT',
        sourceId: refundPayment._id,
        date: input.date,
        description: `Vendor refund - PO ${order.code || order._id} (${input.reason})`.slice(0, 1000),
        project: projectId,
        lines: [
          { account: account._id, debit: excess, credit: 0, project: projectId },
          { account: suppliersId, debit: 0, credit: excess, project: projectId, partyNumber: vendorNumber, partyType: 'vendor' },
        ],
        session,
      });
      reversalEntries.push(refundEntry._id);
    } else if (excess > 0) {
      notes.push(`${excess} remains paid in excess - the vendor owes it back (debit balance).`);
    }

    return createRecord(
      {
        _id: recordId,
        type: 'purchase_return',
        scope: fullyReturned(order) ? 'full' : 'partial',
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        date: input.date,
        purchaseOrder: order._id,
        project: projectId,
        items: lines.map(l => ({ product: oid(l.productId), quantity: l.quantity, amount: l.amount })),
        amount: Math.max(0, returnedTotal),
        returnRecords,
        refundPayment: refundPayment?._id || null,
        refundAmount: refundPayment ? excess : 0,
        originalEntries: originals.map(e => e._id),
        reversalEntries,
        notes,
        createdBy: userId,
      },
      session
    );
  });
}

// ---------------------------------------------------------------- history

/** Reversal records for a document (newest first), with their entries' numbers. */
async function listReversals({ salesOrder, purchaseOrder, payment, advancedPayment } = {}) {
  const filter = {};
  for (const [key, value] of Object.entries({ salesOrder, purchaseOrder, payment, advancedPayment })) {
    if (value === undefined || value === null || value === '') continue;
    if (!isId(value)) throw new ApiError(`Invalid ${key} id.`, 400);
    filter[key] = oid(value);
  }
  if (!Object.keys(filter).length) throw new ApiError('Choose the document whose reversals to list.', 400);
  return AccountingReversal.find(filter)
    .sort({ createdAt: -1 })
    .limit(200)
    .populate({ path: 'createdBy', select: 'name' })
    .populate({ path: 'originalEntries', select: 'entryNumber date description status' })
    .populate({ path: 'reversalEntries', select: 'entryNumber date description status' })
    .populate({ path: 'items.product', select: 'title sku type' })
    .lean();
}

module.exports = {
  reversePayment,
  reverseSettlement,
  returnSalesOrder,
  returnPurchaseOrder,
  listReversals,
  applySettlementReversal,
  applySettlementEntryReversal,
  ADVANCE_PAYMENT_ACTIONS,
};
