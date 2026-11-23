const Expense = require('../../models/expense/expenseModel');
const Vendor = require('../../models/vendor/vendor');
const Payment = require('../../models/vendor/paymentModel');
// Payment's save hook looks these models up by name - make sure they are registered.
require('../../models/vendor/purchaseOrder');
require('../../models/userModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const ApiError = require('../../utils/apiError');
const { computeOrderTotals, round2 } = require('../../utils/orderTotals');
const { DEFAULT_VAT_TREATMENT, splitCostForVatTreatment } = require('../../utils/vatTreatment');
const { AutomaticJournalAccountCodes, SalariesPayableAccountName, isPaymentAccountEligible } = require('../../utils/accountingConstants');
const { postAutomaticJournalEntry, getAccountIdByCode, getAccountIdByName, resolveVendorNumber } = require('../accounting/accountingEventService');
const { resolveExpenseCategory } = require('./expenseCategoryService');
const { assertPeriodsOpen } = require('../accounting/accountingPeriodService');

/** An account an expense can be recorded on: an active Chart of Accounts account of type 'expense'. */
const isExpenseAccountEligible = account => !!account && account.isActive !== false && account.type === 'expense';

/** An account a liability-type expense can credit: an active Chart of Accounts account of type 'liability'. */
const isLiabilityAccountEligible = account => !!account && account.isActive !== false && account.type === 'liability';

/**
 * The liability account a given expense's payable sits on - Suppliers (the vendor's control
 * account) for an ordinary vendor expense, Salaries Payable for a salary expense (docs section
 * "Salary Expenses"), or the expense's OWN stored `liabilityAccount` for a liability expense (the
 * user's own choice, validated against isLiabilityAccountEligible when the expense was created -
 * never re-validated here, mirroring how `expenseAccount` itself is fixed once posted). Resolved
 * fresh every time an entry is posted (Suppliers/Salaries Payable are never stored on the Expense
 * itself) - if Salaries Payable can't be resolved (missing or inactive), this throws rather than
 * silently falling back to Suppliers/a vendor account.
 */
const resolvePayableAccountId = (expense, session) => {
  if (expense.expenseType === 'salary') return getAccountIdByName(SalariesPayableAccountName, { type: 'liability' }, session);
  if (expense.expenseType === 'liability') return Promise.resolve(expense.liabilityAccount._id || expense.liabilityAccount);
  return getAccountIdByCode(AutomaticJournalAccountCodes.suppliers, session);
};

const getExpenseAccountOptions = () =>
  ChartOfAccount.find({ type: 'expense', isActive: { $ne: false } })
    .select('code name nameAr type')
    .sort({ code: 1 })
    .lean();

/** Real, active liability accounts a liability-type expense may credit (Task 2 - Add Expense liability support). */
const getLiabilityAccountOptions = () =>
  ChartOfAccount.find({ type: 'liability', isActive: { $ne: false } })
    .select('code name nameAr type parentGroupNameEn parentGroupNameAr')
    .sort({ code: 1 })
    .lean();

/**
 * Pays (part of) a vendor, salary or liability expense through the existing Payment model
 * (category 'expense' and the chosen Cash/Cash-Equivalent account - its own hooks update the
 * warehouse and, for a vendor expense, the vendor balance) and posts EXPENSE_PAYMENT_RECORDED -
 * this IS the liability settlement the task's accounting notes describe, reusing exactly the same
 * mechanism a vendor/salary payable already settles through, never a second one:
 *
 *   Dr  Suppliers (vendor) / Salaries Payable (salary) / liabilityAccount (liability)   amount
 *       Cr  the payment account                                                         amount
 *
 * A payment can never exceed what is still owed; the expense is only updated if nobody paid it in
 * the meantime, so a repeated/concurrent request cannot pay twice.
 */
async function addExpensePayment(expenseId, { amount, paymentAccount, warehouseId, date, notes }, userId, session) {
  const expense = await Expense.findById(expenseId).session(session || null);
  if (!expense) throw new ApiError('Expense not found', 404);
  const isSalary = expense.expenseType === 'salary';
  const isLiability = expense.expenseType === 'liability';
  if (!expense.vendor && !isSalary && !isLiability) throw new ApiError('Payments can only be added to vendor, salary or liability expenses.', 400);

  const value = round2(Number(amount));
  const remaining = round2(expense.totalAmount - (expense.paidAmount || 0));
  if (!(value > 0)) throw new ApiError('Payment amount must be greater than 0.', 400);
  if (value > remaining) throw new ApiError(`Payment amount (${value}) exceeds the remaining amount (${remaining}).`, 400);

  const account = await ChartOfAccount.findById(paymentAccount).session(session || null).lean();
  if (!isPaymentAccountEligible(account)) throw new ApiError('The payment method must be a Cash or Cash Equivalent account.', 400);

  let vendorId = null;
  let vendorNumber = null;
  if (!isSalary && !isLiability) {
    vendorId = expense.vendor._id || expense.vendor;
    vendorNumber = await resolveVendorNumber(vendorId, { required: true }, session);
  }
  const paymentDate = date ? new Date(date) : new Date();
  await assertPeriodsOpen(paymentDate, session);
  const kindLabel = isSalary ? 'Salary' : isLiability ? 'Liability' : 'Expense';
  const payableLabel = isSalary ? 'Salaries Payable' : isLiability ? expense.liabilityAccount.name || 'liability' : expense.vendor.name || 'vendor';

  const [payment] = await Payment.create(
    [
      {
        warehouseId,
        type: 'out',
        amountPaid: value,
        paymentAccount: account._id,
        paymentCategory: 'expense',
        vendorId: vendorId || undefined,
        // ERP CHG-11: never a database id in a note - the reference, or the vendor and the date.
        notes: notes || `${kindLabel} payment - ${expense.reference || [isSalary ? 'Salaries' : isLiability ? payableLabel : expense.vendor?.name, expense.date ? new Date(expense.date).toISOString().slice(0, 10) : null].filter(Boolean).join(' ') || 'no reference'}`,
        createdBy: userId,
      },
    ],
    { session }
  );

  const payableAccountId = await resolvePayableAccountId(expense, session);

  const entry = await postAutomaticJournalEntry({
    accountingAction: 'EXPENSE_PAYMENT_RECORDED',
    sourceType: 'PAYMENT',
    sourceId: payment._id,
    date: paymentDate,
    description: notes?.trim() || `${kindLabel} payment - ${payableLabel}${expense.reference ? ` (${expense.reference})` : ''}`,
    lines: [
      { account: payableAccountId, debit: value, credit: 0 },
      { account: account._id, debit: 0, credit: value },
    ],
    party: !isSalary && !isLiability ? { number: vendorNumber, type: 'vendor' } : undefined,
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
 * Creates a vendor, salary or liability expense and its EXPENSE_RECORDED entry in the caller's
 * transaction. With the default VAT Accounting Treatment ('recoverable', utils/vatTreatment.js):
 *
 *   Dr  the selected expense account                                     amount
 *   Dr  Input VAT (the same account Purchase Orders use)                VAT
 *       Cr  Suppliers / Salaries Payable / liabilityAccount   amount + VAT
 *
 * With 'non_recoverable' instead, VAT is folded into the expense account debit - there is no
 * separate Input VAT line at all:
 *
 *   Dr  the selected expense account                                amount + VAT
 *       Cr  Suppliers / Salaries Payable / liabilityAccount   amount + VAT
 *
 * This IS expense recognition (the task's own distinction: Dr Expense / Cr a liability), not a
 * liability settlement - settling it later is addExpensePayment's job (Dr the SAME liability
 * account / Cr cash), never a second recognition. A vendor expense adds amount + VAT to the
 * vendor's balance (like a Purchase Order); a salary expense (`expenseType: 'salary'`) or a
 * liability expense (`expenseType: 'liability'`) has no vendor at all - the credit goes to
 * Salaries Payable, or to the user's own chosen liability account, instead. Either way, when
 * `payment` is given, it's paid straight away through addExpensePayment. Never touches inventory.
 */
async function createExpense(input, userId, session) {
  const { vendor: vendorId, expenseAccount: expenseAccountId, liabilityAccount: liabilityAccountId, amount, vatPercentage, vatTreatment, date, reference, notes, payment, category, expenseType } = input;
  const isSalary = expenseType === 'salary';
  const isLiability = expenseType === 'liability';

  const vendorNumber = isSalary || isLiability ? null : await resolveVendorNumber(vendorId, { required: true }, session);
  const expenseAccount = await ChartOfAccount.findById(expenseAccountId).session(session || null).lean();
  if (!isExpenseAccountEligible(expenseAccount)) throw new ApiError('The expense account must be an active Chart of Accounts expense account.', 400);
  // Resolved (and allowed to throw) BEFORE the Expense/journal entry are created, so a missing or
  // inactive Salaries Payable / liability account aborts cleanly - never silently falls back to
  // Suppliers/a vendor account.
  let liabilityAccount = null;
  if (isLiability) {
    liabilityAccount = await ChartOfAccount.findById(liabilityAccountId).session(session || null).lean();
    if (!isLiabilityAccountEligible(liabilityAccount)) throw new ApiError('The liability account must be an active Chart of Accounts liability account.', 400);
  }
  const payableAccountId = await resolvePayableAccountId({ expenseType: isSalary ? 'salary' : isLiability ? 'liability' : 'vendor', liabilityAccount }, session);

  const categoryId = await resolveExpenseCategory(category, { session });
  await assertPeriodsOpen(date ? new Date(date) : new Date(), session);
  const base = round2(Number(amount));
  const { vatAmount, total } = computeOrderTotals({ subtotal: base, vatPercentage });
  const expenseDate = date ? new Date(date) : new Date();
  const resolvedVatTreatment = vatTreatment || DEFAULT_VAT_TREATMENT;
  const { costDebit: expenseDebit, vatLineAmount } = splitCostForVatTreatment({ baseCost: base, vatAmount, vatTreatment: resolvedVatTreatment });

  const [expense] = await Expense.create(
    [
      {
        expenseType: isSalary ? 'salary' : isLiability ? 'liability' : 'vendor',
        vendor: isSalary || isLiability ? undefined : vendorId,
        expenseAccount: expenseAccount._id,
        liabilityAccount: isLiability ? liabilityAccount._id : undefined,
        category: categoryId,
        amount: base,
        vatPercentage: Number(vatPercentage) || 0,
        vatAmount,
        vatTreatment: resolvedVatTreatment,
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

  const lines = [{ account: expenseAccount._id, debit: expenseDebit, credit: 0 }];
  if (vatLineAmount > 0) lines.push({ account: await getAccountIdByCode(AutomaticJournalAccountCodes.inputVat, session), debit: vatLineAmount, credit: 0 });
  lines.push({ account: payableAccountId, debit: 0, credit: total });

  const entry = await postAutomaticJournalEntry({
    accountingAction: 'EXPENSE_RECORDED',
    sourceType: 'EXPENSE',
    sourceId: expense._id,
    date: expenseDate,
    description: `${isSalary ? 'Salary' : isLiability ? 'Liability' : 'Expense'} - ${expenseAccount.name}${reference ? ` (${reference})` : ''}`,
    lines,
    party: !isSalary && !isLiability ? { number: vendorNumber, type: 'vendor' } : undefined,
    session,
  });

  await Expense.updateOne({ _id: expense._id }, { $set: { journalEntry: entry._id } }, { session });
  if (!isSalary && !isLiability) await Vendor.updateOne({ _id: vendorId }, { $inc: { balance: total } }, { session });

  if (payment?.paymentAccount) {
    await addExpensePayment(expense._id, { amount: payment.amount ?? total, paymentAccount: payment.paymentAccount, warehouseId: payment.warehouseId, date: expenseDate, notes: payment.notes }, userId, session);
  }
  return expense;
}

/** Only the free-text fields and the category - amounts, accounts and vendor are fixed once posted. */
async function updateExpense(id, { reference, notes, category }, session) {
  const expense = await Expense.findById(id).session(session || null);
  if (!expense) throw new ApiError('Expense not found', 404);
  if (!expense.vendor && !['salary', 'liability'].includes(expense.expenseType)) throw new ApiError('Legacy expenses cannot be edited.', 400);
  if (reference !== undefined) expense.reference = reference;
  if (notes !== undefined) expense.notes = notes;
  if (category !== undefined) expense.category = await resolveExpenseCategory(category, { currentCategoryId: expense.category?._id || expense.category, session });
  await expense.save({ session });
  return expense;
}

module.exports = { createExpense, addExpensePayment, updateExpense, getExpenseAccountOptions, getLiabilityAccountOptions, isExpenseAccountEligible, isLiabilityAccountEligible };
