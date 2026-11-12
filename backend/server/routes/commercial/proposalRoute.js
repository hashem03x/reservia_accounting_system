const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCommercialAccess } = require('../../middleware/commercialAccess');
const proposalController = require('../../controller/commercial/proposalController');

// Mounted at /api/v1/commercial/proposals.
const router = express.Router();

router.use(authController.protect, requireCommercialAccess);

router.post('/revision/:revisionId', proposalController.issueProposal);
// Deal Engine C14/C16: DRAFT preview of the next proposal (customer or internal copy).
router.get('/revision/:revisionId/preview', proposalController.previewProposal);
// Deal Engine C20: what blocks the release right now (stale or non-approved supplier prices).
router.get('/revision/:revisionId/release-check', proposalController.releaseCheck);
// Deal Engine C15/C16: an issued proposal's PDF (stored customer copy, or internal copy).
router.get('/:id/pdf', proposalController.getProposalPdf);
router.get('/project/:projectId', proposalController.listProposalsForProject);

module.exports = router;
