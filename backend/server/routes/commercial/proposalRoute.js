const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCommercialAccess } = require('../../middleware/commercialAccess');
const proposalController = require('../../controller/commercial/proposalController');

// Mounted at /api/v1/commercial/proposals.
const router = express.Router();

router.use(authController.protect, requireCommercialAccess);

router.post('/revision/:revisionId', proposalController.issueProposal);
router.get('/project/:projectId', proposalController.listProposalsForProject);

module.exports = router;
