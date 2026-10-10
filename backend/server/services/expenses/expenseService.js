const Expense = require('../../models/expense/expenseModel');
const Vendor = require('../../models/vendor/vendor');
const Payment = require('../../models/vendor/paymentModel');
// Payment's save hook looks these models up by name - make sure they are registered.
require('../../models/vendor/purchaseOrder');
require('../../models/userModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const ApiError = require('../../utils/apiError');
const { computeOrderTotals, round2 } = require('../../utils/orderTotals');
const { AutomaticJournalAccountCodes, isPaymentAccountEligible } = require('../../utils/accountingConstants');
const { postAutomaticJournalEntry, getAccountIdByCode, resolveVendorNumber } = require('../accounting/accountingEventService');
const { resolveExpenseCategory } = require('./expenseCategoryService');
const { assertPeriodsOpen } = require('../accounting/accountingPeriodService');

/** An account an expense can be recorded on: an active Chart of Accounts account of type 'expense'. */
const isExpenseAccountEligible = account => !!account && account.isActive !== false && account.type === 'expense';

const getExpenseAccountOptions = () =>
  ChartOfAccount.find({ type: 'expense', isActive: { $ne: false } })
    .select('code name nameAr type')
    .sort({ code: 1 })
    .lean();

/**
 * Pays (part of) a vendor expense through the existing Payment model (category 'expense', the
 * vendor and the chosen Cash/Cash-Equivalent account - its own hooks update the warehouse and
 * vendor balances) and posts EXPENSE_PAYMENT_RECORDED:
 *
 *   Dr  Suppliers - the vendor (Vendor Number as Sub Account)   amount
 *       Cr  the payment account                                 amount
 *
 * A payment can never exceed what is still owed; the expense is only updated if nobody paid it in
 * the meantime, so a repeated/concurrent request cannot pay twice.
 */
async function addExpensePayment(expenseId, { amount, paymentAccount, warehouseId, date, notes }, userId, session) {
  const expense = await Expense.findById(expenseId).session(session || null);
  if (!expense) throw new ApiError('Expense not found', 404);
  if (!expense.vendor) throw new ApiError('Payments can only be added to vendor expenses.', 400);

  const value = round2(Number(amount));
  const remaining = round2(expense.totalAmount - (expense.paidAmount || 0));
  if (!(value > 0)) throw new ApiError('Payment amount must be greater than 0.', 400);
  if (value > remaining) throw new ApiError(`Payment amount (${value}) exceeds the remaining amount (${remaining}).`, 400);

  const account = await ChartOfAccount.findById(paymentAccount).session(session || null).lean();
  if (!isPaymentAccountEligible(account)) throw new ApiError('The payment method must be a Cash or Cash Equivalent account.', 400);

  const vendorId = expense.vendor._id || expense.vendor;
  const vendorNumber = await resolveVendorNumber(vendorId, { required: true }, session);
  const paymentDate = date ? new Date(date) : new Date();
  await assertPeriodsOpen(paymentDate, session);

  const [payment] = await Payment.create(
    [
      {
        warehouseId,
        type: 'out',
        amountPaid: value,
        paymentAccount: account._id,
        paymentCategory: 'expense',
        vendorId,
        notes: notes || `Expense payment - ${expense.reference || expense._id}`,
        createdBy: userId,
      },
    ],
    { session }
  );

  const entry = await postAutomaticJournalEntry({
    accountingAction: 'EXPENSE_PAYMENT_RECORDED',
    sourceType: 'PAYMENT',
    sourceId: payment._id,
    date: paymentDate,
    description: notes?.trim() || `Expense payment - ${expense.vendor.name || 'vendor'}${expense.reference ? ` (${expense.reference})` : ''}`,
    lines: [
      { account: await getAccountIdByCode(AutomaticJournalAccountCodes.suppliers, session), debit: value, credit: 0 },
      { account: account._id, debit: 0, credit: value },
    ],
    party: { number: vendorNumber, type: 'vendor' },
    session,
  });

  const paidAmount = round2((expense.paidAmount || 0) + value);
  const { matchedCount } = await Expense.updateOne(
    { _id: expense._id, paidAmount: expense.paidAmount || 0 },
    {
      $set: { paidAmount, paymentStatus: paidAmount >= expense.totalAmount ? 'paid' : 'partially_paid' },
      $push: { payments: { payment: payment._id, amount: value, paymentAccount: account._id, date: paymentDate, journalEntry: entry._id, createdBy: userId } },
    },
    { session }
  );
  if (matchedCount !== 1) throw new ApiError('This expense was paid by another request at the same time. Please refresh and try again.', 409);
  return { payment, journalEntry: entry };
}

/**
 * Creates a vendor expense and its EXPENSE_RECORDED entry in the caller's transaction:
 *
 *   Dr  the selected expense account                         amount
 *   Dr  Input VAT (the same account Purchase Orders use)    VAT
 *       Cr  Suppliers - the vendor (Vendor Number as Sub Account)   amount + VAT
 *
 * adds amount + VAT to the vendor's balance (like a Purchase Order), and - when `payment` is given -
 * pays it straight away through addExpensePayment. Never touches inventory.
 */
async function createExpense(input, userId, session) {
  const { vendor: vendorId, expenseAccount: expenseAccountId, amount, vatPercentage, date, reference, notes, payment, category } = input;

  const vendorNumber = await resolveVendorNumber(vendorId, { required: true }, session);
  const expenseAccount = await ChartOfAccount.findById(expenseAccountId).session(session || null).lean();
  if (!isExpenseAccountEligible(expenseAccount)) throw new ApiError('The expense account must be an active Chart of Accounts expense account.', 400);

  const categoryId = await resolveExpenseCategory(category, { session });
  await assertPeriodsOpen(date ? new Date(date) : new Date(), session);
  const base = round2(Number(amount));
  const { vatAmount, total } = computeOrderTotals({ subtotal: base, vatPercentage });
  const expenseDate = date ? new Date(date) : new Date();

  const [expense] = await Expense.create(
    [
      {
        vendor: vendorId,
        expenseAccount: expenseAccount._id,
        category: categoryId,
        amount: base,
        vatPercentage: Number(vatPercentage) || 0,
        vatAmount,
        totalAmount: total,
        paidAmount: 0,
        paymentStatus: 'unpaid',
        date: expenseDate,
        reference,
        notes,
        payments: [],
        createdBy: userId,
      },
    ],
    { session }
  );

  const lines = [{ account: expenseAccount._id, debit: base, credit: 0 }];
  if (vatAmount > 0) lines.push({ account: await getAccountIdByCode(AutomaticJournalAccountCodes.inputVat, session), debit: vatAmount, credit: 0 });
  lines.push({ account: await getAccountIdByCode(AutomaticJournalAccountCodes.suppliers, session), debit: 0, credit: total });

  const entry = await postAutomaticJournalEntry({
    accountingAction: 'EXPENSE_RECORDED',
    sourceType: 'EXPENSE',
    sourceId: expense._id,
    date: expenseDate,
    description: `Expense - ${expenseAccount.name}${reference ? ` (${reference})` : ''}`,
    lines,
    party: { number: vendorNumber, type: 'vendor' },
    session,
  });

  await Expense.updateOne({ _id: expense._id }, { $set: { journalEntry: entry._id } }, { session });
  await Vendor.updateOne({ _id: vendorId }, { $inc: { balance: total } }, { session });

  if (payment?.paymentAccount) {
    await addExpensePayment(expense._id, { amount: payment.amount ?? total, paymentAccount: payment.paymentAccount, warehouseId: payment.warehouseId, date: expenseDate, notes: payment.notes }, userId, session);
  }
  return expense;
}

/** Only the free-text fields and the category - amounts, accounts and vendor are fixed once posted. */
async function updateExpense(id, { reference, notes, category }, session) {
  const expense = await Expense.findById(id).session(session || null);
  if (!expense) throw new ApiError('Expense not found', 404);
  if (!expense.vendor) throw new ApiError('Legacy expenses cannot be edited.', 400);
  if (reference !== undefined) expense.reference = reference;
  if (notes !== undefined) expense.notes = notes;
  if (category !== undefined) expense.category = await resolveExpenseCategory(category, { currentCategoryId: expense.category?._id || expense.category, session });
  await expense.save({ session });
  return expense;
}

module.exports = { createExpense, addExpensePayment, updateExpense, getExpenseAccountOptions, isExpenseAccountEligible };
