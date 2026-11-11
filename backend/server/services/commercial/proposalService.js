const ApiError = require('../../utils/apiError');
const CommercialRevision = require('../../models/commercial/commercialRevisionModel');
const CommercialProposal = require('../../models/commercial/commercialProposalModel');
const CommercialProject = require('../../models/commercial/commercialProjectModel');
const { PROPOSAL_VALIDITY_DAYS } = require('../../utils/commercial/constants');
const { ensureDealIdentifiers, proposalNumberFor } = require('./dealNumberService');

// Reservia Commercial - issuing a proposal freezes a snapshot of the revision's current
// boqLines/pricing/feasibility, exactly mirroring services/crm/quotationService.js's
// "compute once, store, never recompute on read" guarantee. A later Price Book price change or a
// further edit to the revision can never retroactively alter a proposal already issued.
//
// Each proposal carries its Proposal # (<deal #>-P<version>, brief 6.1 / reference build ID chain);
// the project's `proposalNumber` then names the NEXT proposal to be issued.

async function issueProposal(revisionId, { userId } = {}) {
  const revision = await CommercialRevision.findById(revisionId);
  if (!revision) throw new ApiError('Commercial revision not found.', 404);
  if (!revision.isCurrent) throw new ApiError('Only the current revision can be issued as a proposal.', 400);
  if (revision.status === 'Draft') {
    throw new ApiError('This revision is in Draft - recalculate it and re-approve it before issuing a proposal.', 400);
  }
  if (revision.releaseStatus !== 'APPROVED FOR ISSUE') {
    throw new ApiError('This revision is NOT RELEASED - every required approval stage must be Approved before a proposal can be issued.', 400);
  }

  const project = await CommercialProject.findById(revision.project);
  if (!project) throw new ApiError('Commercial project not found.', 404);
  if (await ensureDealIdentifiers(project)) await project.save();

  const version = (await CommercialProposal.countDocuments({ project: revision.project })) + 1;
  const validUntil = new Date(Date.now() + PROPOSAL_VALIDITY_DAYS * 86400000);
  const proposalNumber = proposalNumberFor(project.dealNumber, version);

  const proposal = await CommercialProposal.create({
    revision: revision._id,
    project: revision.project,
    version,
    proposalNumber,
    validUntil,
    boqLinesSnapshot: revision.boqLines,
    pricingSnapshot: revision.pricing,
    feasibilitySnapshot: revision.feasibility,
    issuedBy: userId,
  });
  await CommercialProject.updateOne({ _id: project._id }, { $set: { proposalNumber: proposalNumberFor(project.dealNumber, version + 1) } });
  return proposal;
}

async function listProposalsForProject(projectId) {
  return CommercialProposal.find({ project: projectId }).sort({ version: -1 });
}

module.exports = { issueProposal, listProposalsForProject };
