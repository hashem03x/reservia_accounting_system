const Payment = require('../../models/vendor/paymentModel');
const Warehouse = require('../../models/inventory/warehouseModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const ApiError = require('../../utils/apiError');
const { round2, toBaseAmount, basePerUnit } = require('../../utils/currencyMath');
const { isPaymentAccountEligible } = require('../../utils/accountingConstants');
const { postAutomaticJournalEntry } = require('./accountingEventService');
const { assertPeriodsOpen } = require('./accountingPeriodService');
const { resolveEntryCurrency } = require('./currencyService');

// Transfer Money between two warehouses' Cash/Cash-Equivalent accounts. Unlike the old
// transferController.js#transferMoney (two Payment docs via a free-text `paymentMethod`, never a
// journal entry), this posts the SAME shape of entry every other Payment-creating flow in this
// codebase does - one balanced automatic JournalEntry, atomic with the two Payment docs, idempotent
// via (sourceType, sourceId, accountingAction), and reversible through the normal Journal Entry
// "Reverse" action (MONEY_TRANSFER is not in journalEntryController.js's reversal denylist, so no
// dedicated reversal code is needed for it):
//
//   Dr  the destination Cash/Cash-Equivalent account   amount
//       Cr  the source Cash/Cash-Equivalent account    amount
async function eligiblePaymentAccount(id, session, label) {
  const account = await ChartOfAccount.findById(id).session(session || null).lean();
  if (!isPaymentAccountEligible(account)) throw new ApiError(`The ${label} account must be a Cash or Cash Equivalent account.`, 400);
  return account;
}

/**
 * `currency`/`foreignAmount` are purely descriptive: no ChartOfAccount carries a currency field
 * (every account is implicitly EGP, like every other automatic entry in this codebase), so the
 * money actually moved is always the EGP `amount`. A foreign currency is resolved through the
 * existing Currency Manager rate for the transfer date (currencyService.resolveEntryCurrency) -
 * never a client-supplied rate - purely to convert `foreignAmount` to the real EGP amount and to
 * label the transfer/journal entry for a user who thinks of it in that currency. Since both legs of
 * the entry always carry the identical EGP amount by construction, no FX gain/loss ever arises and
 * no gain/loss account is ever needed.
 */
async function transferMoney({ fromWarehouseId, toWarehouseId, fromAccount: fromAccountId, toAccount: toAccountId, amount, currency, foreignAmount, date, notes }, userId, session) {
  const [fromAccount, toAccount] = await Promise.all([eligiblePaymentAccount(fromAccountId, session, 'source'), eligiblePaymentAccount(toAccountId, session, 'destination')]);
  if (String(fromAccount._id) === String(toAccount._id)) throw new ApiError('Source and destination accounts must be different.', 400);

  const [fromWarehouse, toWarehouse] = await Promise.all([Warehouse.findById(fromWarehouseId).session(session || null), Warehouse.findById(toWarehouseId).session(session || null)]);
  if (!fromWarehouse) throw new ApiError('Source warehouse does not exist.', 404);
  if (!toWarehouse) throw new ApiError('Target warehouse does not exist.', 404);

  const transferDate = date ? new Date(date) : new Date();
  await assertPeriodsOpen(transferDate, session);

  let egpAmount = round2(Number(amount));
  let fxNote = '';
  if (currency && String(currency).trim().toUpperCase() !== 'EGP') {
    const resolved = await resolveEntryCurrency({ currency, date: transferDate, session });
    const foreign = Number(foreignAmount ?? amount);
    if (!(foreign > 0)) throw new ApiError('A foreign amount greater than 0 is required for a foreign-currency transfer.', 400);
    egpAmount = toBaseAmount(foreign, resolved.unitsPerBase);
    fxNote = ` (${foreign.toFixed(2)} ${resolved.code} @ ${basePerUnit(resolved.unitsPerBase).toFixed(4)})`;
  }
  if (!(egpAmount > 0)) throw new ApiError('Amount must be greater than 0.', 400);

  const description = `Money transfer: ${fromAccount.code} - ${fromAccount.name} to ${toAccount.code} - ${toAccount.name}${fxNote}`;

  const [paymentOut] = await Payment.create(
    [{ warehouseId: fromWarehouse._id, type: 'out', amountPaid: egpAmount, paymentAccount: fromAccount._id, paymentCategory: 'transfer', notes: notes || description, createdBy: userId }],
    { session }
  );
  const [paymentIn] = await Payment.create(
    [{ warehouseId: toWarehouse._id, type: 'in', amountPaid: egpAmount, paymentAccount: toAccount._id, paymentCategory: 'transfer', notes: notes || description, createdBy: userId }],
    { session }
  );

  const journalEntry = await postAutomaticJournalEntry({
    accountingAction: 'MONEY_TRANSFER',
    sourceType: 'PAYMENT',
    sourceId: paymentOut._id,
    date: transferDate,
    description,
    lines: [
      { account: toAccount._id, debit: egpAmount, credit: 0 },
      { account: fromAccount._id, debit: 0, credit: egpAmount },
    ],
    session,
  });

  return { paymentOut, paymentIn, journalEntry, amount: egpAmount };
}

module.exports = { transferMoney };
