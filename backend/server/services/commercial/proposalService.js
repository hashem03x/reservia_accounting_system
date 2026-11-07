const ApiError = require('../../utils/apiError');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const CommercialProposal = require('../../models/commercial/commercialProposalModel');
const { PROPOSAL_VALIDITY_DAYS } = require('../../utils/commercial/constants');

// Reservia Commercial - issuing a proposal freezes a snapshot of the revision's current
// boqLines/pricing/feasibility, exactly mirroring services/crm/quotationService.js's
// "compute once, store, never recompute on read" guarantee. A later Price Book price change or a
// further edit to the revision can never retroactively alter a proposal already issued.

async function issueProposal(revisionId, { userId } = {}) {
  const revision = await CommercialRevision.findById(revisionId);
  if (!revision) throw new ApiError('Commercial revision not found.', 404);
  if (revision.releaseStatus !== 'APPROVED FOR ISSUE') {
    throw new ApiError('This revision is NOT RELEASED - every required approval stage must be Approved before a proposal can be issued.', 400);
  }

  const version = (await CommercialProposal.countDocuments({ project: revision.project })) + 1;
  const validUntil = new Date(Date.now() + PROPOSAL_VALIDITY_DAYS * 86400000);

  return CommercialProposal.create({
    revision: revision._id,
    project: revision.project,
    version,
    validUntil,
    boqLinesSnapshot: revision.boqLines,
    pricingSnapshot: revision.pricing,
    feasibilitySnapshot: revision.feasibility,
    issuedBy: userId,
  });
}

async function listProposalsForProject(projectId) {
  return CommercialProposal.find({ project: projectId }).sort({ version: -1 });
}

module.exports = { issueProposal, listProposalsForProject };
