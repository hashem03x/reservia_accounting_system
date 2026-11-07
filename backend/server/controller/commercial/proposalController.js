const asyncHandler = require('express-async-handler');
const apiResponse = require('../../utils/apiResponse');
const proposalService = require('../../services/commercial/proposalService');

exports.issueProposal = asyncHandler(async (req, res) => {
  const proposal = await proposalService.issueProposal(req.params.revisionId, { userId: req.user._id });
  res.status(201).json(apiResponse('Proposal issued successfully', true, proposal));
});

exports.listProposalsForProject = asyncHandler(async (req, res) => {
  const proposals = await proposalService.listProposalsForProject(req.params.projectId);
  res.status(200).json(apiResponse('Proposals retrieved successfully', true, proposals));
});
