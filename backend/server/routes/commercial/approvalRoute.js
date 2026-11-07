const express = require('express');
const authController = require('../../controller/user/authController');
const { requireCommercialAccess } = require('../../middleware/commercialAccess');
const approvalController = require('../../controller/commercial/approvalController');

// Mounted at /api/v1/commercial/approvals. Role-per-stage is enforced INSIDE
// approvalService.js#setStageStatus (against req.commercialRole, read from the DB-backed
// membership, never from the request) - not re-litigated here, same shape CRM's
// requireCrmRole-per-route uses, just data-driven by stage instead of fixed per route.
const router = express.Router();

router.use(authController.protect, requireCommercialAccess);

router.patch('/:id/:stage', approvalController.setStageStatus);
router.get('/:id/log', approvalController.getApprovalLog);

module.exports = router;
