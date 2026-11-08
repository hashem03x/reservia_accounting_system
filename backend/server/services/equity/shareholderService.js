const mongoose = require('mongoose');
const Shareholder = require('../../models/equity/shareholderModel');
const ChartOfAccount = require('../../models/accounting/chartOfAccountModel');
const ApiError = require('../../utils/apiError');
const { round2 } = require('../../utils/orderTotals');
const { isPaymentAccountEligible, AutomaticJournalAccountCodes } = require('../../utils/accountingConstants');
const { postAutomaticJournalEntry } = require('../accounting/accountingEventService');
const { requireCompanyCapital, totalActiveOwnershipPercentage, setIssuedCapital } = require('./companyCapitalService');

const isEquityAccountEligible = account => !!account && account.isActive !== false && account.type === 'equity';

const getEquityAccountOptions = () =>
  ChartOfAccount.find({ type: 'equity', isActive: { $ne: false } })
    .select('code name nameAr type')
    .sort({ code: 1 })
    .lean();

// Mongoose validation errors (ownership over 100%, wrong equity account) and a duplicate National
// ID (the unique index on shareholderModel.js) as clean 400s.
const asBadRequest = err => {
  if (err instanceof mongoose.Error.ValidationError || err?.message?.includes('cannot exceed 100%') || err?.message?.includes('equity account')) return new ApiError(err.message, 400);
  if (err?.code === 11000 && err?.keyPattern?.nationalId) return new ApiError('A shareholder with this National ID already exists.', 400);
  return err;
};

/** A shareholder's target capital (ownership % x Issued Capital) - computed on the fly, never
 * stored, so it can never drift out of sync with Issued Capital (brief: "automatically calculated
 * ... must be READ-ONLY"). Shared by addContribution's own overpayment check and
 * controller/equity/shareholderController.js's response shaping, so both use the same number. */
const allocatedCapital = (shareholder, issuedCapital) => round2((issuedCapital * (shareholder.ownershipPercentage || 0)) / 100);

/**
 * Records a capital contribution and its SHAREHOLDER_CONTRIBUTION entry in the caller's transaction:
 *
 *   Dr  the fixed NBE "Capital" bank account (AutomaticJournalAccountCodes.capitalContributionBankAccount)   amount
 *       Cr  the fixed Capital equity account (AutomaticJournalAccountCodes.capitalContributionEquityAccount) amount
 *
 * Both accounts are fixed/non-selectable (see this function's account-resolution block below) -
 * every shareholder's contribution lands on the SAME two accounts; which shareholder it belongs
 * to is carried entirely by the Shareholder Number, stamped as the Sub Account of the equity line
 * only (journalLinePartyService.js) - a shareholder sub-account belongs on an equity account,
 * never on the bank / cash line. The shareholder is only updated if its share capital is
 * unchanged since it was read, so a concurrent duplicate cannot be applied twice.
 *
 * `idempotencyKey` (optional, generated once per "Add Payment" dialog open - see
 * reversalService.js's identical convention): a retried/double-click submission carrying the same
 * key is recognized here and returns the ALREADY-posted entry instead of posting a second one.
 */
async function addContribution(shareholderId, { amount, date, reference, notes, idempotencyKey }, userId, session) {
  const shareholder = await Shareholder.findById(shareholderId).session(session || null);
  if (!shareholder) throw new ApiError('Shareholder not found', 404);
  if (shareholder.status !== 'active') throw new ApiError('Contributions can only be recorded for an active shareholder.', 400);

  if (idempotencyKey) {
    const duplicate = shareholder.contributions.find(c => c.idempotencyKey === idempotencyKey);
    if (duplicate) return { _id: duplicate.journalEntry, alreadyRecorded: true };
  }

  const value = round2(Number(amount));
  if (!(value > 0)) throw new ApiError('Contribution amount must be greater than 0.', 400);

  // "Finalization" (brief: "Total shareholder ownership must equal 100% before finalizing the
  // capital structure") is not a separate stored flag - it IS this check: real money can only be
  // recorded once the capital structure (Issued Capital + every active shareholder's ownership %)
  // is actually complete, so "remaining unpaid" always means something real.
  const { issuedCapital, paidInCapital } = await requireCompanyCapital(session);
  const totalOwnership = await totalActiveOwnershipPercentage(session);
  if (totalOwnership !== 100) {
    throw new ApiError(`Active shareholders' ownership totals ${totalOwnership}%, not 100% - finish defining the capital structure before recording payments.`, 400);
  }

  const allocated = allocatedCapital(shareholder, issuedCapital);
  if (round2((shareholder.shareCapital || 0) + value) > allocated + 0.01) {
    throw new ApiError(`This payment would bring ${shareholder.name}'s paid-in capital above their allocated ${allocated} (ownership ${shareholder.ownershipPercentage}% of Issued Capital). Remaining unpaid: ${round2(allocated - (shareholder.shareCapital || 0))}.`, 400);
  }
  if (round2(paidInCapital + value) > issuedCapital + 0.01) {
    throw new ApiError(`This payment would bring total Paid-in Capital above Issued Capital (${issuedCapital}).`, 400);
  }

  // Capital Contributions always post to two FIXED accounts - the "NBE \"Capital\" -EGP" bank
  // account and the "Capital" equity account - resolved here by their real Chart of Accounts code
  // (the same AutomaticJournalAccountCodes convention every other automatic posting uses), never
  // trusted from the request body. Any `paymentAccount`/`equityAccount` a client submits is
  // ignored entirely (not merely overridden) - there is nothing in the request that can redirect
  // where this money is posted.
  const [cashAccount, capitalAccount] = await Promise.all([
    ChartOfAccount.findOne({ code: AutomaticJournalAccountCodes.capitalContributionBankAccount }).session(session || null).lean(),
    ChartOfAccount.findOne({ code: AutomaticJournalAccountCodes.capitalContributionEquityAccount }).session(session || null).lean(),
  ]);
  if (!isPaymentAccountEligible(cashAccount)) {
    throw new ApiError(`Capital contributions must be received into account ${AutomaticJournalAccountCodes.capitalContributionBankAccount} (NBE), but it is missing, inactive, or no longer a Cash/Cash Equivalent account. Contact an administrator before recording this contribution.`, 400);
  }
  if (!isEquityAccountEligible(capitalAccount)) {
    throw new ApiError(`Capital contributions must be credited to account ${AutomaticJournalAccountCodes.capitalContributionEquityAccount} (Capital), but it is missing, inactive, or no longer an equity account. Contact an administrator before recording this contribution.`, 400);
  }

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
      { account: capitalAccount._id, debit: 0, credit: value, partyNumber: shareholder.shareholderNumber, partyType: 'shareholder' },
    ],
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
          idempotencyKey: idempotencyKey || null,
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

/**
 * Sets Issued Capital and creates every shareholder of a brand-new capital structure (brief
 * Scenario 1: "Enter Issued Capital, enter Number of Shareholders, N sections appear") in ONE
 * transaction - all of it commits together or none of it does, the same "the payment record and
 * its Journal Entry are created consistently" guarantee this module already gives a single
 * contribution, now extended to the whole initial setup. Each shareholder is still validated
 * exactly as createShareholder already does (ownership <= 100% together, National ID format/
 * uniqueness, equity account eligibility) - this is pure orchestration, no parallel rule set.
 */
async function setupCapitalStructure({ issuedCapital, shareholders }, userId, session) {
  await setIssuedCapital(issuedCapital, userId, session);
  if (!Array.isArray(shareholders) || shareholders.length === 0) throw new ApiError('At least one shareholder is required.', 400);
  const created = [];
  for (const fields of shareholders) {
    // eslint-disable-next-line no-await-in-loop
    created.push(await createShareholder(fields, userId, session));
  }
  return created;
}

/** Profile fields, ownership, equity account and status - never the number or the share capital. */
async function updateShareholder(id, body, session) {
  const shareholder = await Shareholder.findById(id).session(session || null);
  if (!shareholder) throw new ApiError('Shareholder not found', 404);
  ['name', 'nameAr', 'address', 'ownershipPercentage', 'equityAccount', 'status', 'phone', 'email', 'nationalId', 'notes'].forEach(field => {
    if (body[field] !== undefined) shareholder[field] = body[field];
  });
  try {
    await shareholder.save({ session });
  } catch (err) {
    throw asBadRequest(err);
  }
  return shareholder;
}

module.exports = { createShareholder, updateShareholder, addContribution, getEquityAccountOptions, isEquityAccountEligible, allocatedCapital, setupCapitalStructure };
