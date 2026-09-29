const JournalEntry = require('../../models/accounting/journalEntryModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');

// Journal Entries are the single source of truth for the General Ledger - account balances are
// always derived from posted journal lines at read time, never stored/duplicated on the account
// document itself, so there is no second transaction system that can drift out of sync with the
// journal (see reversia master spec's "General Ledger" section).

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Sum of posted debit/credit for a single account (matched by either the line's main `account`
 * or its `subAccount`), and the resulting balance. Sign convention: asset/expense accounts carry
 * a natural debit balance (debit - credit); liability/equity/revenue accounts carry a natural
 * credit balance (credit - debit).
 */
async function getAccountBalance(accountId) {
  const account = await ChartOfAccount.findById(accountId);
  if (!account) return null;

  const [totals] = await JournalEntry.aggregate([
    { $match: { status: 'posted' } },
    { $unwind: '$lines' },
    { $match: { $or: [{ 'lines.account': account._id }, { 'lines.subAccount': account._id }] } },
    { $group: { _id: null, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);

  const debit = totals?.debit || 0;
  const credit = totals?.credit || 0;
  const naturalDebit = ['asset', 'expense'].includes(account.type);
  const balance = round2(naturalDebit ? debit - credit : credit - debit);

  return { account: { _id: account._id, code: account.code, name: account.name, type: account.type }, debit: round2(debit), credit: round2(credit), balance };
}

/** Trial balance - every account with at least one posted line, per-account debit/credit totals. */
async function getTrialBalance() {
  const rows = await JournalEntry.aggregate([
    { $match: { status: 'posted' } },
    { $unwind: '$lines' },
    { $group: { _id: '$lines.account', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
    { $lookup: { from: 'chartofaccounts', localField: '_id', foreignField: '_id', as: 'account' } },
    { $unwind: '$account' },
    { $sort: { 'account.code': 1 } },
    {
      $project: {
        _id: 0,
        account: { _id: '$account._id', code: '$account.code', name: '$account.name', type: '$account.type' },
        debit: 1,
        credit: 1,
      },
    },
  ]);

  return rows.map(row => ({ ...row, debit: round2(row.debit), credit: round2(row.credit) }));
}

module.exports = { getAccountBalance, getTrialBalance };
