const mongoose = require('mongoose');
const Shareholder = require('../../models/equity/shareholderModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const ApiError = require('../../utils/apiError');
const { round2 } = require('../../utils/orderTotals');
const { isPaymentAccountEligible } = require('../../utils/accountingConstants');
const { postAutomaticJournalEntry } = require('../accounting/accountingEventService');

const isEquityAccountEligible = account => !!account && account.isActive !== false && account.type === 'equity';

const getEquityAccountOptions = () =>
  ChartOfAccount.find({ type: 'equity', isActive: { $ne: false } })
    .select('code name nameAr type')
    .sort({ code: 1 })
    .lean();

// Mongoose validation errors (ownership over 100%, wrong equity account) as clean 400s.
const asBadRequest = err => (err instanceof mongoose.Error.ValidationError || err?.message?.includes('cannot exceed 100%') || err?.message?.includes('equity account') ? new ApiError(err.message, 400) : err);

/**
 * Records a capital contribution and its SHAREHOLDER_CONTRIBUTION entry in the caller's transaction:
 *
 *   Dr  the payment account (Cash / Cash Equivalent)      amount
 *       Cr  the equity account (shareholder's, unless another equity account is chosen)   amount
 *
 * with the Shareholder Number as the Sub Account of every line. The shareholder is only updated if
 * its share capital is unchanged since it was read, so a concurrent duplicate cannot be applied twice.
 */
async function addContribution(shareholderId, { amount, date, paymentAccount, equityAccount, reference, notes }, userId, session) {
  const shareholder = await Shareholder.findById(shareholderId).session(session || null);
  if (!shareholder) throw new ApiError('Shareholder not found', 404);
  if (shareholder.status !== 'active') throw new ApiError('Contributions can only be recorded for an active shareholder.', 400);

  const value = round2(Number(amount));
  if (!(value > 0)) throw new ApiError('Contribution amount must be greater than 0.', 400);

  const [cashAccount, capitalAccount] = await Promise.all([
    ChartOfAccount.findById(paymentAccount).session(session || null).lean(),
    ChartOfAccount.findById(equityAccount || shareholder.equityAccount?._id || shareholder.equityAccount).session(session || null).lean(),
  ]);
  if (!isPaymentAccountEligible(cashAccount)) throw new ApiError('The payment account must be a Cash or Cash Equivalent account.', 400);
  if (!isEquityAccountEligible(capitalAccount)) throw new ApiError('The equity account must be an active Chart of Accounts equity account.', 400);

  const contributionId = new mongoose.Types.ObjectId();
  const contributionDate = date ? new Date(date) : new Date();
  const entry = await postAutomaticJournalEntry({
    accountingAction: 'SHAREHOLDER_CONTRIBUTION',
    sourceType: 'SHAREHOLDER',
    sourceId: contributionId,
    date: contributionDate,
    description: notes?.trim() || `Capital contribution - ${shareholder.name}${reference ? ` (${reference})` : ''}`,
    lines: [
      { account: cashAccount._id, debit: value, credit: 0 },
      { account: capitalAccount._id, debit: 0, credit: value },
    ],
    party: { number: shareholder.shareholderNumber, type: 'shareholder' },
    session,
  });

  const { matchedCount } = await Shareholder.updateOne(
    { _id: shareholder._id, shareCapital: shareholder.shareCapital || 0 },
    {
      $set: { shareCapital: round2((shareholder.shareCapital || 0) + value) },
      $push: {
        contributions: {
          _id: contributionId,
          amount: value,
          date: contributionDate,
          paymentAccount: cashAccount._id,
          equityAccount: capitalAccount._id,
          journalEntry: entry._id,
          reference,
          notes,
          createdBy: userId,
        },
      },
    },
    { session }
  );
  if (matchedCount !== 1) throw new ApiError('This shareholder was changed by another request at the same time. Please refresh and try again.', 409);
  return entry;
}

/** Creates a shareholder and, when `contribution` is given, records it in the same transaction. */
async function createShareholder({ contribution, shareCapital, shareholderNumber, contributions, ...fields }, userId, session) {
  let shareholder;
  try {
    [shareholder] = await Shareholder.create([{ ...fields, createdBy: userId }], { session });
  } catch (err) {
    throw asBadRequest(err);
  }
  if (contribution?.amount) await addContribution(shareholder._id, contribution, userId, session);
  return shareholder;
}

/** Profile fields, ownership, equity account and status - never the number or the share capital. */
async function updateShareholder(id, body, session) {
  const shareholder = await Shareholder.findById(id).session(session || null);
  if (!shareholder) throw new ApiError('Shareholder not found', 404);
  ['name', 'ownershipPercentage', 'equityAccount', 'status', 'phone', 'email', 'nationalId', 'notes'].forEach(field => {
    if (body[field] !== undefined) shareholder[field] = body[field];
  });
  try {
    await shareholder.save({ session });
  } catch (err) {
    throw asBadRequest(err);
  }
  return shareholder;
}

module.exports = { createShareholder, updateShareholder, addContribution, getEquityAccountOptions, isEquityAccountEligible };
