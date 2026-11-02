const CompanyCapital = require('../../models/equity/companyCapitalModel');
const Shareholder = require('../../models/equity/shareholderModel');
const ApiError = require('../../utils/apiError');
const { round2 } = require('../../utils/orderTotals');

/** Sum of every shareholder's shareCapital (money ACTUALLY received) - active or inactive, since the
 * money was genuinely paid in regardless of a shareholder's current status; status only governs
 * future ownership/contribution eligibility, never past, already-posted payments. */
async function totalPaidInCapital(session) {
  const [row] = await Shareholder.aggregate([{ $group: { _id: null, total: { $sum: '$shareCapital' } } }]).session(session || null);
  return round2(row?.total || 0);
}

/** @returns {Promise<{issuedCapital: number, paidInCapital: number, unpaidCapital: number} | null>} null when Issued Capital has never been set. */
async function getCompanyCapital(session) {
  const [doc, paidInCapital] = await Promise.all([CompanyCapital.findById(CompanyCapital.SINGLETON_ID).session(session || null).lean(), totalPaidInCapital(session)]);
  if (!doc) return null;
  const issuedCapital = doc.issuedCapital;
  return { issuedCapital, paidInCapital, unpaidCapital: round2(issuedCapital - paidInCapital) };
}

/** Same as getCompanyCapital, but throws instead of returning null - for flows that need a real value to validate against (e.g. recording a contribution). */
async function requireCompanyCapital(session) {
  const capital = await getCompanyCapital(session);
  if (!capital) throw new ApiError('Set the company’s Issued Capital before recording shareholders or payments.', 400);
  return capital;
}

/** Sets Issued Capital. Refuses to set it below what has already been paid in - Paid-in Capital can never exceed Issued Capital, from either direction. */
async function setIssuedCapital(issuedCapital, userId, session) {
  const value = round2(Number(issuedCapital));
  if (!(value > 0)) throw new ApiError('Issued capital must be greater than 0.', 400);

  const paidInCapital = await totalPaidInCapital(session);
  if (value < paidInCapital) {
    throw new ApiError(`Issued capital cannot be set below the ${paidInCapital} already paid in by shareholders.`, 400);
  }

  const doc = await CompanyCapital.findByIdAndUpdate(
    CompanyCapital.SINGLETON_ID,
    { $set: { issuedCapital: value, updatedBy: userId || null } },
    { new: true, upsert: true, runValidators: true, session, setDefaultsOnInsert: true }
  );
  return { issuedCapital: doc.issuedCapital, paidInCapital, unpaidCapital: round2(doc.issuedCapital - paidInCapital) };
}

/**
 * Every active shareholder's ownership %, summed - the "is the capital structure finalized" gate
 * (brief: "Total shareholder ownership must equal 100% before finalizing the capital structure").
 * Finalization is not a separate stored flag - it IS this condition: once active ownership totals
 * exactly 100%, contributions are allowed; a lead with incomplete ownership can still be entered
 * and edited freely, it just can't take real money yet.
 */
async function totalActiveOwnershipPercentage(session) {
  const [row] = await Shareholder.aggregate([{ $match: { status: 'active' } }, { $group: { _id: null, total: { $sum: '$ownershipPercentage' } } }]).session(session || null);
  return Math.round((row?.total || 0) * 10000) / 10000;
}

module.exports = { getCompanyCapital, requireCompanyCapital, setIssuedCapital, totalPaidInCapital, totalActiveOwnershipPercentage };
