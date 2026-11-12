const asyncHandler = require('express-async-handler');
const ApiError = require('../../utils/apiError');
const apiResponse = require('../../utils/apiResponse');
const proposalService = require('../../services/commercial/proposalService');

// Deal Engine C12-C17. The internal copy (priced BOQ, pricing stack, approval log) is for the MD,
// the Commercial Director and Sales - checked here from the DB-loaded membership (req.commercialRole).
const INTERNAL_ROLES = ['md', 'commercial_director', 'sales'];

function copyFor(req) {
  const copy = req.query.copy === 'internal' ? 'internal' : 'customer';
  if (copy === 'internal' && !INTERNAL_ROLES.includes(req.commercialRole)) {
    throw new ApiError('The internal copy (with prices and the pricing stack) is for the MD, the Commercial Director and Sales.', 403);
  }
  return copy;
}

function sendPdf(res, pdf, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).send(pdf);
}

const crmRoleOf = user => (Array.isArray(user?.systemMemberships) ? user.systemMemberships.find(m => m.system === 'CRM' && m.isActive)?.role : null) || null;

exports.issueProposal = asyncHandler(async (req, res) => {
  const proposal = await proposalService.issueProposal(req.params.revisionId, {
    userId: req.user._id,
    userName: req.user.name || null,
    crmRole: crmRoleOf(req.user),
    commercialRole: req.commercialRole,
    releaseOverrideNote: req.body?.releaseOverrideNote || null,
  });
  res.status(201).json(apiResponse('Proposal issued successfully', true, proposal));
});

exports.releaseCheck = asyncHandler(async (req, res) => {
  res.status(200).json(apiResponse('Release check', true, await proposalService.releaseCheck(req.params.revisionId)));
});

exports.previewProposal = asyncHandler(async (req, res) => {
  const copy = copyFor(req);
  const { pdf, proposalNumber } = await proposalService.previewProposal(req.params.revisionId, { copy });
  sendPdf(res, pdf, `DRAFT-${proposalNumber}${copy === 'internal' ? '-internal' : ''}.pdf`);
});

exports.getProposalPdf = asyncHandler(async (req, res) => {
  const copy = copyFor(req);
  const { pdf, proposal } = await proposalService.getProposalPdf(req.params.id, { copy });
  sendPdf(res, pdf, `${proposal.proposalNumber}${copy === 'internal' ? '-internal' : ''}.pdf`);
});

exports.listProposalsForProject = asyncHandler(async (req, res) => {
  const proposals = await proposalService.listProposalsForProject(req.params.projectId);
  res.status(200).json(apiResponse('Proposals retrieved successfully', true, proposals));
});
