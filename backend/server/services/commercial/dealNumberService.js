const Counter = require('../../models/config/counterModel');
const ApiError = require('../../utils/apiError');

// Reservia Commercial - the deal identifier chain (Developer Brief 5/6.1; the MD's reference build
// "Leads and ID chain"):
//
//   Commercial deal #        DEAL-<year>-<seq>        e.g. DEAL-2026-001 (one sequence per year)
//   Proposal #               <deal #>-P<nn>           e.g. DEAL-2026-001-P01 (nn = proposal version)
//   ERP project # (proposed) <deal #>-PRJ             e.g. DEAL-2026-001-PRJ
//
// The PROPOSED ERP number is a placeholder that names the deal until the ERP creates the real
// project (whose own number follows the ERP's sector-based rule, services/project/
// projectNumberService.js) - it never consumes an ERP project-number counter, so a lost deal leaves
// no gap in the ERP's own numbering, and it is never shown as an ERP project that exists.
//
// Same atomic Counter pattern as projectCodeService.js / projectNumberService.js.
const RANGE_MIN = 1;
const RANGE_MAX = 999999;

function formatDealNumber(year, seq) {
  return `DEAL-${year}-${String(seq).padStart(3, '0')}`;
}

function proposalNumberFor(dealNumber, version) {
  return `${dealNumber}-P${String(version).padStart(2, '0')}`;
}

function proposedErpProjectNumberFor(dealNumber) {
  return `${dealNumber}-PRJ`;
}

async function getNextDealNumber(date = new Date(), session) {
  const year = Number(new Date(date).toLocaleString('en-US', { timeZone: 'Africa/Cairo', year: 'numeric' }));
  const sequenceName = `commercialDealNumber:${year}`;
  let updated = await Counter.findOneAndUpdate({ _id: sequenceName, $expr: { $lt: ['$seq', '$max'] } }, { $inc: { seq: 1 } }, { new: true, session });
  if (!updated) {
    try {
      await Counter.create([{ _id: sequenceName, seq: RANGE_MIN - 1, min: RANGE_MIN, max: RANGE_MAX }], { session });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
    updated = await Counter.findOneAndUpdate({ _id: sequenceName, $expr: { $lt: ['$seq', '$max'] } }, { $inc: { seq: 1 } }, { new: true, session });
  }
  if (!updated) throw new ApiError(`Deal number range for ${year} is exhausted.`, 400);
  return formatDealNumber(year, updated.seq);
}

/** Gives a project its deal identifiers if it has none yet (legacy projects get them on first edit / handoff). */
async function ensureDealIdentifiers(project) {
  if (project.dealNumber) return false;
  project.dealNumber = await getNextDealNumber(project.createdAt || new Date());
  project.proposalNumber = proposalNumberFor(project.dealNumber, 1);
  project.proposedErpProjectNumber = proposedErpProjectNumberFor(project.dealNumber);
  return true;
}

module.exports = { getNextDealNumber, formatDealNumber, proposalNumberFor, proposedErpProjectNumberFor, ensureDealIdentifiers };
